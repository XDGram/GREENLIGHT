// FILE-BACKED STORE: automated tests, local development and the SOURCE of the
// file -> Supabase migration (bin/greenlight-migrate-to-supabase.js) only.
// Production persistence is Supabase (src/server/supabase/store.js); the server
// binary refuses to start on this store.
//
// Same interface as SupabaseStore: projects, test versions, approvals, jobs,
// runs and verification records, as JSON files under one data dir.
//
//   <data>/projects/<projectId>/project.json
//   <data>/projects/<projectId>/versions/<n>.json        (spec text + rendered tests)
//   <data>/projects/<projectId>/approvals/<n>.json       (write-once)
//   <data>/jobs/<jobId>.json
//   <data>/records/<recordId>.json                       (write-once, permanent)
//   <data>/evidence/<jobId>/.greenlight/runs/<runId>/    (run manifest + evidence pack)
//   <data>/work/<jobId>/                                 (fresh per-run Kane workspace)
//
// Every id is validated against a strict pattern before it touches a path.
// Writes are atomic (temp file + rename); approvals and records use exclusive
// creation and are never rewritten. A single server process owns a data dir.

import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, readdir, open, access } from "node:fs/promises";
import { constants } from "node:fs";
import { GreenlightError } from "../cli/errors.js";
import { describeRun, runFiles } from "./run-archive.js";

export const ID = Object.freeze({
  project: /^prj_[0-9a-f]{32}$/,
  job: /^job_[0-9a-f]{32}$/,
  record: /^vr_[0-9a-f]{32}$/,
});
const VERSION = /^[1-9][0-9]{0,5}$/;

export const newId = (prefix) => `${prefix}_${randomUUID().replace(/-/g, "")}`;

export function assertId(kind, id) {
  if (typeof id !== "string" || !ID[kind].test(id)) throw new GreenlightError("not_found", `No such ${kind}.`);
  return id;
}
export function assertVersion(n) {
  const s = String(n);
  if (!VERSION.test(s)) throw new GreenlightError("not_found", "No such test version.");
  return Number(s);
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 });
  await rename(tmp, file);
}

/** Exclusive create: fails (conflict) if the file exists. Never overwrites. */
async function writeJsonOnce(file, value) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  let fh;
  try {
    fh = await open(file, "wx", 0o600);
  } catch (err) {
    if (err.code === "EEXIST") throw new GreenlightError("conflict", "That record already exists and is immutable.");
    throw err;
  }
  try {
    await fh.writeFile(JSON.stringify(value, null, 2) + "\n");
  } finally {
    await fh.close();
  }
}

export class FileStore {
  /** @param {string} dataDir absolute directory owned by this server */
  constructor(dataDir) {
    if (typeof dataDir !== "string" || !path.isAbsolute(dataDir)) throw new TypeError("FileStore needs an absolute data directory");
    this.dir = dataDir;
  }

  p(...parts) {
    return path.join(this.dir, ...parts);
  }
  runsDir() {
    return this.p("runs");
  }
  workDir(jobId) {
    return this.p("work", assertId("job", jobId));
  }
  evidenceRoot(jobId) {
    return this.p("evidence", assertId("job", jobId));
  }

  /** Tokens live in GREENLIGHT_API_TOKENS for this store; there is no token table. */
  /** Test-only store: ready when its data directory is writable. */
  async health() {
    try {
      await mkdir(this.dir, { recursive: true });
      await access(this.dir, constants.W_OK);
      return { store: "file", ok: true, database: "ok", storage: "ok" };
    } catch {
      return { store: "file", ok: false, database: "unreachable", storage: "unreachable" };
    }
  }

  async authenticate() {
    return null;
  }

  // ---- projects (scoped to an account)
  async createProject({ name, url, account, createdBy, now }) {
    const project = { schema: "greenlight.project/v1", id: newId("prj"), name, url, account, createdBy, createdAt: now.toISOString() };
    await writeJsonOnce(this.p("projects", project.id, "project.json"), project);
    return project;
  }
  async getProject(id, account) {
    const p = await readJson(this.p("projects", assertId("project", id), "project.json"));
    if (!p || (account !== undefined && p.account !== account)) throw new GreenlightError("not_found", "No such project.");
    return p;
  }
  async listProjects(account) {
    let names = [];
    try {
      names = await readdir(this.p("projects"));
    } catch {
      return [];
    }
    const out = [];
    for (const n of names.filter((x) => ID.project.test(x))) {
      const p = await readJson(this.p("projects", n, "project.json"));
      if (p && p.account === account) out.push(p);
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // ---- test versions
  async listVersions(projectId) {
    let names = [];
    try {
      names = await readdir(this.p("projects", assertId("project", projectId), "versions"));
    } catch {
      return [];
    }
    const out = [];
    for (const n of names.filter((x) => /^[1-9][0-9]*\.json$/.test(x))) out.push(await readJson(this.p("projects", projectId, "versions", n)));
    return out.filter(Boolean).sort((a, b) => a.version - b.version);
  }
  async addVersion(projectId, version) {
    const existing = await this.listVersions(projectId);
    const n = (existing.at(-1)?.version ?? 0) + 1;
    const v = { ...version, version: n };
    await writeJsonOnce(this.p("projects", assertId("project", projectId), "versions", `${n}.json`), v);
    return v;
  }
  async getVersion(projectId, n) {
    const v = await readJson(this.p("projects", assertId("project", projectId), "versions", `${assertVersion(n)}.json`));
    if (!v) throw new GreenlightError("not_found", "No such test version.");
    return v;
  }

  // ---- approvals (write-once: a version is approved at most once)
  async putApproval(projectId, n, approval) {
    await writeJsonOnce(this.p("projects", assertId("project", projectId), "approvals", `${assertVersion(n)}.json`), approval);
    return approval;
  }
  async getApproval(projectId, n) {
    return readJson(this.p("projects", assertId("project", projectId), "approvals", `${assertVersion(n)}.json`));
  }

  // ---- jobs
  async putJob(job) {
    await writeJsonAtomic(this.p("jobs", `${assertId("job", job.id)}.json`), job);
    return job;
  }
  async getJob(id) {
    const j = await readJson(this.p("jobs", `${assertId("job", id)}.json`));
    if (!j) throw new GreenlightError("not_found", "No such job.");
    return j;
  }
  async listJobs(/* { statuses } ignored: callers filter */) {
    let names = [];
    try {
      names = await readdir(this.p("jobs"));
    } catch {
      return [];
    }
    const out = [];
    for (const n of names.filter((x) => /^job_[0-9a-f]{32}\.json$/.test(x))) out.push(await readJson(this.p("jobs", n)));
    return out.filter(Boolean);
  }

  // ---- runs (evidence stays in the run directory; the run row is write-once)
  async archiveRun({ job, runId, runDir, now }) {
    const rel = path.relative(this.dir, runDir).split(path.sep).join("/");
    const { run } = await describeRun({ job, runId, runDir, storagePrefix: `local:${rel}`, now });
    return run;
  }
  async getRun(runId) {
    const r = await readJson(this.p("runs", `${runId}.json`));
    if (!r || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(runId)) throw new GreenlightError("not_found", "No such run.");
    return r;
  }
  async verifyRunEvidence(runId) {
    const run = await this.getRun(runId);
    const dir = path.join(this.dir, run.storagePrefix.replace(/^local:/, ""));
    const now = new Map((await runFiles(dir).catch(() => [])).map((f) => [f.name, f]));
    const problems = [];
    for (const f of run.files) {
      const got = now.get(f.name);
      if (!got) problems.push(`missing:${f.name}`);
      else if (got.sha256 !== f.sha256 || got.bytes !== f.bytes) problems.push(`hash_mismatch:${f.name}`);
    }
    return { runId, ok: problems.length === 0, problems, files: run.files.length };
  }
  async cleanupRun() {
    /* file store keeps evidence in place */
  }

  // ---- verification records (permanent, write-once), with their run
  async putRecord(record, { run } = {}) {
    if (run) await writeJsonOnce(this.p("runs", `${run.runId}.json`), run);
    await writeJsonOnce(this.p("records", `${assertId("record", record.id)}.json`), record);
    return record;
  }
  async getRecord(id) {
    const r = await readJson(this.p("records", `${assertId("record", id)}.json`));
    if (!r) throw new GreenlightError("not_found", "No such verification record.");
    return r;
  }
  async listRecords(projectId) {
    let names = [];
    try {
      names = await readdir(this.p("records"));
    } catch {
      return [];
    }
    const out = [];
    for (const n of names.filter((x) => /^vr_[0-9a-f]{32}\.json$/.test(x))) {
      const r = await readJson(this.p("records", n));
      if (r && r.projectId === projectId) out.push(r);
    }
    return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
