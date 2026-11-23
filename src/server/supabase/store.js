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

  /** One stored run file, downloaded and checked against its recorded SHA-256 and size. */
  async getRunFile(runId, name) {
    const run = await this.getRun(runId);
    const f = run.files.find((x) => x.name === name);
    if (!f) throw new GreenlightError("not_found", "No such evidence file.");
    const bytes = await this.db.storage.download(this.bucket, `${run.storagePrefix}/${f.name}`);
    if (bytes.length !== f.bytes || sha256(bytes) !== f.sha256) throw new GreenlightError("run_record_invalid", "The stored evidence file does not match its recorded hash.");
    return { name: f.name, sha256: f.sha256, bytes };
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

  // ---- web accounts (Sign in with Google), project details, tokens, settings, admin
  async webSignIn({ provider, subject, account, email, name }) {
    return this.db.rpc("greenlight_web_sign_in", { p_provider: provider, p_subject: subject, p_account: account, p_email: email ?? null, p_name: name ?? null });
  }
  async putProjectDetails(projectId, account, doc, by) {
    return this.db.rpc("greenlight_put_project_details", { p_project_id: assertId("project", projectId), p_account: account, p_doc: doc, p_by: by });
  }
  async getProjectDetails(projectId) {
    return this.db.rpc("greenlight_get_project_details", { p_project_id: assertId("project", projectId) });
  }
  async issueToken(account, role, tokenSha256, label) {
    return this.db.rpc("greenlight_issue_token", { p_account: account, p_role: role, p_token_sha256: tokenSha256, p_label: label });
  }
  async listAccountTokens(account) {
    return this.db.rpc("greenlight_list_account_tokens", { p_account: account });
  }
  async revokeAccountToken(account, id) {
    return this.db.rpc("greenlight_revoke_account_token", { p_account: account, p_id: id });
  }
  async getSettings() {
    return this.db.rpc("greenlight_get_settings", {});
  }
  async setSetting(key, value, by) {
    return this.db.rpc("greenlight_set_setting", { p_key: key, p_value: value, p_by: by });
  }
  async adminEvent(actor, action, target, detail = {}) {
    return this.db.rpc("greenlight_admin_event", { p_actor: actor, p_action: action, p_target: target ?? null, p_detail: detail });
  }
  async adminOverview() {
    return this.db.rpc("greenlight_admin_overview", {});
  }
  async adminList(kind, limit = 100) {
    return this.db.rpc("greenlight_admin_list", { p_kind: kind, p_limit: limit });
  }
  async adminRevokeToken(id, actor) {
    return this.db.rpc("greenlight_admin_revoke_token", { p_id: id, p_actor: actor });
  }

  // ---- guest accounts (anonymous, never certify) and the Fix Centre
  async guestAccount(slug) {
    try {
      return await this.db.rpc("greenlight_guest_account", { p_slug: slug });
    } catch (err) {
      if (!err?.missingFunction) throw err;
    }
    // Before the journey migration: the same account and owner user through the base functions.
    if (!/^v-[0-9a-f]{24}$/.test(slug)) throw new GreenlightError("internal_error", "Bad guest account.");
    await this.db.rpc("greenlight_ensure_account", { p_slug: slug });
    try {
      await this.db.rpc("greenlight_create_user", { p_account: slug, p_name: "owner", p_role: "owner" });
    } catch (err) {
      if (err?.code !== "conflict") throw err;
    }
    return { account: slug, user: "owner" };
  }
  /** Atomic per-visitor/daily reservation; {reservation: null} when the database predates it. */
  async reserveGuestRun(account, { credits, perAccount, perDay, dailyCredits, maxPerRun }) {
    try {
      return await this.db.rpc("greenlight_reserve_guest_run", { p_account: account, p_credits: credits, p_per_account: perAccount, p_per_day: perDay, p_daily_credits: dailyCredits, p_max_per_run: maxPerRun });
    } catch (err) {
      if (err?.missingFunction) return { reservation: null, unavailable: true };
      throw err;
    }
  }
  async attachGuestRun(reservation, jobId) {
    return this.db.rpc("greenlight_attach_guest_run", { p_reservation: reservation, p_job_id: jobId });
  }
  async releaseGuestRun(reservation) {
    return this.db.rpc("greenlight_release_guest_run", { p_reservation: reservation });
  }
  async guestRunUsage(account) {
    return this.db.rpc("greenlight_guest_run_usage", { p_account: account });
  }
  async agentRequestCreate({ id, account, projectId, fixId = null, kind, input, maxOpen = 10 }) {
    return this.db.rpc("greenlight_agent_request_create", { p_id: id, p_account: account, p_project_id: assertId("project", projectId), p_fix_id: fixId, p_kind: kind, p_input: input, p_max_open: maxOpen });
  }
  async agentRequestGet(id, account) {
    if (!/^ar_[0-9a-f]{32}$/.test(String(id ?? ""))) throw new GreenlightError("not_found", "No such request.");
    return this.db.rpc("greenlight_agent_request_get", { p_id: id, p_account: account });
  }
  async agentRequestList(account, { projectId = null, openOnly = false } = {}) {
    return this.db.rpc("greenlight_agent_request_list", { p_account: account, p_project_id: projectId, p_open_only: openOnly });
  }
  async agentRequestClaim(id, account) {
    if (!/^ar_[0-9a-f]{32}$/.test(String(id ?? ""))) throw new GreenlightError("not_found", "No such request.");
    return this.db.rpc("greenlight_agent_request_claim", { p_id: id, p_account: account });
  }
  async agentRequestComplete(id, account, status, result, error = null) {
    return this.db.rpc("greenlight_agent_request_complete", { p_id: id, p_account: account, p_status: status, p_result: result ?? null, p_error: error });
  }
  async agentRequestCancel(id, account) {
    if (!/^ar_[0-9a-f]{32}$/.test(String(id ?? ""))) throw new GreenlightError("not_found", "No such request.");
    return this.db.rpc("greenlight_agent_request_cancel", { p_id: id, p_account: account });
  }
  async fixOpen({ id, projectId, account, recordId, testFile, doc }) {
    return this.db.rpc("greenlight_fix_open", { p_id: id, p_project_id: assertId("project", projectId), p_account: account, p_record_id: assertId("record", recordId), p_test_file: testFile, p_doc: doc ?? {} });
  }
  async fixGet(id, account) {
    if (!/^fx_[0-9a-f]{32}$/.test(String(id ?? ""))) throw new GreenlightError("not_found", "No such fix item.");
    return this.db.rpc("greenlight_fix_get", { p_id: id, p_account: account });
  }
  async fixList(account, projectId = null) {
    return this.db.rpc("greenlight_fix_list", { p_account: account, p_project_id: projectId });
  }
  async fixUpdate(id, account, status, patch = {}) {
    return this.db.rpc("greenlight_fix_update", { p_id: id, p_account: account, p_status: status ?? null, p_patch: patch });
  }
  async fixAppend(id, account, messages) {
    return this.db.rpc("greenlight_fix_append", { p_id: id, p_account: account, p_messages: messages });
  }

  // ---- guest demo (separate tables; never certification data)
  async guestCreate(id, ipHash, maxPerIpHour) {
    return this.db.rpc("greenlight_guest_create", { p_id: guestId("gst", id), p_ip_hash: ipHash, p_max_per_ip_hour: maxPerIpHour });
  }
  async guestGet(id) {
    return this.db.rpc("greenlight_guest_get", { p_id: guestId("gst", id) });
  }
  async guestUseAi(id, max) {
    return this.db.rpc("greenlight_guest_use_ai", { p_id: guestId("gst", id), p_max: max });
  }
  async guestCreateProject(doc, maxProjects) {
    guestId("gpj", doc.id);
    guestId("gst", doc.guestId);
    return this.db.rpc("greenlight_guest_create_project", { p_doc: doc, p_max_projects: maxProjects });
  }
  async guestListProjects(guest) {
    return this.db.rpc("greenlight_guest_list_projects", { p_guest: guestId("gst", guest) });
  }
  /** guest null: any guest's project (the worker, for a run it was given). */
  async guestGetProject(id, guest) {
    return this.db.rpc("greenlight_guest_get_project", { p_id: guestId("gpj", id), p_guest: guest === null ? null : guestId("gst", guest) });
  }
  async guestApprove(id, guest, hash) {
    return this.db.rpc("greenlight_guest_approve", { p_id: guestId("gpj", id), p_guest: guestId("gst", guest), p_hash: hash });
  }
  async guestStartRun(doc, perGuest, perDay) {
    guestId("grn", doc.id);
    return this.db.rpc("greenlight_guest_start_run", { p_doc: doc, p_per_guest: perGuest, p_per_day: perDay });
  }
  async guestUpdateRun(id, status, doc = {}, { refund = false } = {}) {
    return this.db.rpc("greenlight_guest_update_run", { p_id: guestId("grn", id), p_status: status, p_doc: doc, p_refund: refund });
  }
  async guestGetRun(id) {
    return this.db.rpc("greenlight_guest_get_run", { p_id: guestId("grn", id) });
  }
  async guestListRuns(projectId) {
    return this.db.rpc("greenlight_guest_list_runs", { p_project_id: guestId("gpj", projectId) });
  }
  async guestRunsToday() {
    return this.db.rpc("greenlight_guest_runs_today", {});
  }
}

/** Guest ids: gst_ (session), gpj_ (project), grn_ (run) + 32 hex. */
export function guestId(prefix, id) {
  if (!new RegExp(`^${prefix}_[0-9a-f]{32}$`).test(String(id ?? ""))) throw new GreenlightError("not_found", "Not found.");
  return id;
}
