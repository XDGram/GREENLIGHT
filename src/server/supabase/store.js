// PRODUCTION persistence: Supabase Postgres (via service-role-only RPC
// functions, see supabase/migrations/) and Supabase Storage (private bucket).
//
// Same interface as FileStore. Atomicity lives in the database: every write is
// one RPC = one transaction (version numbering, write-once approvals, job state
// transitions, a record with its run, claims and test results). Immutability is
// enforced by triggers, not by this code.
//
// Evidence: each run's files are uploaded (never overwriting), downloaded again
// and SHA-256-checked BEFORE the run row and record are written, so a stored
// record always points at verified evidence. Object paths stay server-side.

import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { GreenlightError } from "../../cli/errors.js";
import { assertId, assertVersion, newId } from "../store.js";
import { describeRun } from "../run-archive.js";
import { createSupabaseClient } from "./client.js";

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

export class SupabaseStore {
  /**
   * @param {object} p
   * @param {ReturnType<typeof createSupabaseClient>} [p.client]  (tests inject one)
   * @param {string} [p.url]
   * @param {string} [p.serviceRoleKey]
   * @param {string} [p.bucket]
   * @param {string} [p.workRoot]  local scratch for Kane workspaces and in-flight evidence
   */
  constructor({ client, url, serviceRoleKey, fetchImpl, bucket = "greenlight-evidence", workRoot = path.join(os.tmpdir(), "greenlight-work") }) {
    this.db = client ?? createSupabaseClient({ url, serviceRoleKey, fetchImpl });
    this.bucket = bucket;
    this.workRoot = workRoot;
    this.kind = "supabase";
  }

  workDir(jobId) {
    return path.join(this.workRoot, "work", assertId("job", jobId));
  }
  evidenceRoot(jobId) {
    return path.join(this.workRoot, "evidence", assertId("job", jobId));
  }

  /** Readiness of the database API and the private evidence bucket (codes only). */
  async health() {
    return { store: "supabase", ...(await this.db.health(this.bucket)) };
  }

  /** Token hash -> {name, role, account}, or null. Revoked tokens never authenticate. */
  async authenticate(tokenSha256) {
    if (!/^[0-9a-f]{64}$/.test(tokenSha256 ?? "")) return null;
    return (await this.db.rpc("greenlight_authenticate", { p_token_sha256: tokenSha256 })) ?? null;
  }

  // ---- projects
  async createProject({ name, url, account, createdBy, now, id }) {
    const doc = { schema: "greenlight.project/v1", id: id ?? newId("prj"), name, url, account, createdBy, createdAt: now.toISOString() };
    return this.db.rpc("greenlight_create_project", { p_doc: doc });
  }
  /** Import an existing project document unchanged (id, account, timestamps). Fails if it exists. */
  async importProject(doc) {
    assertId("project", doc.id);
    return this.db.rpc("greenlight_create_project", { p_doc: doc });
  }
  async ensureAccount(slug) {
    return this.db.rpc("greenlight_ensure_account", { p_slug: slug });
  }
  async getProject(id, account) {
    return this.db.rpc("greenlight_get_project", { p_id: assertId("project", id), p_account: account ?? null });
  }
  async listProjects(account) {
    return this.db.rpc("greenlight_list_projects", { p_account: account });
  }

  // ---- test versions
  async listVersions(projectId) {
    return this.db.rpc("greenlight_list_versions", { p_project_id: assertId("project", projectId) });
  }
  async addVersion(projectId, version) {
    return this.db.rpc("greenlight_add_version", { p_project_id: assertId("project", projectId), p_doc: version });
  }
  async getVersion(projectId, n) {
    return this.db.rpc("greenlight_get_version", { p_project_id: assertId("project", projectId), p_version: assertVersion(n) });
  }

  // ---- approvals
  async putApproval(projectId, n, approval) {
    if (approval.projectId !== projectId || approval.version !== assertVersion(n)) throw new GreenlightError("internal_error", "Approval does not match its version.");
    return this.db.rpc("greenlight_put_approval", { p_doc: approval });
  }
  async getApproval(projectId, n) {
    return (await this.db.rpc("greenlight_get_approval", { p_project_id: assertId("project", projectId), p_version: assertVersion(n) })) ?? null;
  }

  // ---- jobs
  async putJob(job) {
    assertId("job", job.id);
    return this.db.rpc("greenlight_put_job", { p_doc: job });
  }
  async getJob(id) {
    return this.db.rpc("greenlight_get_job", { p_id: assertId("job", id) });
  }
  async listJobs({ statuses } = {}) {
    return this.db.rpc("greenlight_list_jobs", { p_statuses: statuses ?? null });
  }

  // ---- runs and evidence
  objectPrefix(projectId, runId) {
    if (!RUN_ID.test(runId)) throw new GreenlightError("internal_error", "Invalid run id.");
    return `projects/${assertId("project", projectId)}/runs/${runId}`;
  }

  /**
   * Upload a finished run's files to the private bucket, then download each one
   * again and compare SHA-256 and size. Throws (and stores nothing in the
   * database) if anything does not match. The local copy is kept on failure.
   */
  async archiveRun({ job, runId, runDir, now }) {
    const prefix = this.objectPrefix(job.projectId, runId);
    const { run, files } = await describeRun({ job, runId, runDir, storagePrefix: prefix, now });
    for (const f of files) {
      const bytes = await readFile(f.abs);
      if (sha256(bytes) !== f.sha256) throw new GreenlightError("run_record_invalid", `Run file changed while archiving: ${f.name}.`);
      await this.db.storage.upload(this.bucket, `${prefix}/${f.name}`, bytes, f.name.endsWith(".json") ? "application/json" : "application/octet-stream");
    }
    const check = await this.#verifyObjects(prefix, run.files);
    if (!check.ok) throw new GreenlightError("run_record_invalid", `Evidence upload verification failed: ${check.problems.join(", ")}.`, { problems: check.problems });
    return run;
  }

  async #verifyObjects(prefix, files) {
    const problems = [];
    for (const f of files) {
      try {
        const got = await this.db.storage.download(this.bucket, `${prefix}/${f.name}`);
        if (got.length !== f.bytes || sha256(got) !== f.sha256) problems.push(`hash_mismatch:${f.name}`);
      } catch (err) {
        problems.push(`${err?.code === "not_found" ? "missing" : "unreadable"}:${f.name}`);
      }
    }
    return { ok: problems.length === 0, problems };
  }

  /** Private: run row with storage prefix and file hashes. */
  async getRun(runId) {
    if (!RUN_ID.test(runId ?? "")) throw new GreenlightError("not_found", "No such run.");
    return this.db.rpc("greenlight_get_run", { p_run_id: runId });
  }

  /** Re-download a stored run's evidence and re-check every SHA-256. Paths are not returned. */
  async verifyRunEvidence(runId) {
    const run = await this.getRun(runId);
    const r = await this.#verifyObjects(run.storagePrefix, run.files);
    return { runId, ok: r.ok, problems: r.problems, files: run.files.length };
  }

  /** Remove the job's local in-flight evidence after its record is committed (only inside workRoot). */
  async cleanupRun({ jobId }) {
    const dir = this.evidenceRoot(jobId);
    if (path.resolve(dir).startsWith(path.resolve(this.workRoot) + path.sep)) await rm(dir, { recursive: true, force: true });
  }

  // ---- certification records: record + run + claims + tests in ONE transaction
  async putRecord(record, { run } = {}) {
    assertId("record", record.id);
    if (!run) throw new GreenlightError("internal_error", "A record is always stored with its run.");
    return this.db.rpc("greenlight_put_record", { p_record: record, p_run: run });
  }
  async getRecord(id) {
    return this.db.rpc("greenlight_get_record", { p_id: assertId("record", id) });
  }
  async listRecords(projectId) {
    return this.db.rpc("greenlight_list_records", { p_project_id: assertId("project", projectId) });
  }
}
