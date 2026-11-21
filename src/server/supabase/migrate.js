// File-backed store -> Supabase, without losing or overwriting anything.
//
//   - Dry run by default: everything is read and compared, nothing is written.
//   - Never overwrites: an object that already exists in Supabase is compared;
//     identical -> "skipped_identical", different -> "conflict" (left untouched).
//   - Never silently drops: everything not imported is listed with a reason
//     (conflict, refused). Source files are only read, never changed or deleted.
//   - Records are imported only if their own hash verifies and their evidence
//     is present; evidence is uploaded and SHA-256-checked like a live run.
//   - Ids, version numbers and timestamps are preserved.

import path from "node:path";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { canonicalJson } from "../../evidence/hash.js";
import { verifyRecordIntegrity } from "../models.js";
import { certificationRunId } from "../certify.js";

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const TERMINAL = new Set(["succeeded", "failed"]);

async function existing(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err?.code === "not_found") return null;
    throw err;
  }
}

/**
 * @param {object} p
 * @param {import("../store.js").FileStore} p.source
 * @param {import("./store.js").SupabaseStore} p.target
 * @param {boolean} [p.apply]  false (default) = dry run
 * @param {(e: object) => void} [p.log]
 */
export async function migrateFileStoreToSupabase({ source, target, apply = false, log = () => {} }) {
  const report = { mode: apply ? "apply" : "dry_run", imported: [], skippedIdentical: [], conflicts: [], refused: [], wouldImport: [] };
  const note = (bucket, kind, id, extra = {}) => {
    const e = { kind, id, ...extra };
    report[bucket].push(e);
    log({ event: bucket, ...e });
  };
  const act = async (kind, id, write) => {
    if (!apply) return note("wouldImport", kind, id);
    await write();
    note("imported", kind, id);
  };

  // Projects are read directly from the source tree (all accounts).
  let projectIds = [];
  try {
    projectIds = (await readdir(source.p("projects"))).filter((x) => /^prj_[0-9a-f]{32}$/.test(x)).sort();
  } catch {
    /* empty source */
  }

  const blocked = new Set(); // projects whose dependants must not be imported
  for (const projectId of projectIds) {
    const project = await source.getProject(projectId);
    const there = await existing(() => target.getProject(projectId));
    if (there) {
      if (!same(there, project)) {
        note("conflicts", "project", projectId, { reason: "exists_with_different_content" });
        blocked.add(projectId); // nothing below can be attached to a project that is not this one
        continue;
      }
      note("skippedIdentical", "project", projectId);
    } else {
      await act("project", projectId, async () => {
        await target.ensureAccount(project.account); // creates the account only if missing
        await target.importProject(project);
      });
    }

    // Test versions, in order, keeping their numbers.
    for (const v of await source.listVersions(projectId)) {
      const t = await existing(() => target.getVersion(projectId, v.version));
      if (t) {
        if (t.approvedTestHash !== v.approvedTestHash || t.specText !== v.specText) {
          note("conflicts", "test_version", `${projectId}/${v.version}`, { reason: "exists_with_different_content" });
          blocked.add(projectId);
          continue; // its approval and jobs would describe different tests
        }
        note("skippedIdentical", "test_version", `${projectId}/${v.version}`);
      } else {
        await act("test_version", `${projectId}/${v.version}`, async () => {
          const { version, ...doc } = v;
          const stored = await target.addVersion(projectId, doc);
          if (stored.version !== v.version) throw new Error(`version numbering diverged for ${projectId}: source ${v.version}, Supabase ${stored.version}`);
        });
      }

      const a = await source.getApproval(projectId, v.version);
      if (!a) continue;
      const ta = await existing(() => target.getApproval(projectId, v.version));
      if (ta) {
        if (ta.recordSha256 !== a.recordSha256) note("conflicts", "approval", `${projectId}/${v.version}`, { reason: "exists_with_different_content" });
        else note("skippedIdentical", "approval", `${projectId}/${v.version}`);
      } else await act("approval", `${projectId}/${v.version}`, () => target.putApproval(projectId, v.version, a));
    }
  }

  // Jobs and their records.
  const records = new Map();
  for (const projectId of projectIds) for (const r of await source.listRecords(projectId)) records.set(r.id, r);
  for (const job of (await source.listJobs()).sort((x, y) => x.createdAt.localeCompare(y.createdAt))) {
    if (!projectIds.includes(job.projectId)) {
      note("refused", "job", job.id, { reason: "project_missing_in_source" });
      continue;
    }
    if (blocked.has(job.projectId)) {
      note("refused", "job", job.id, { reason: "project_or_version_conflict_in_supabase" });
      continue;
    }
    if (!TERMINAL.has(job.status)) {
      note("refused", "job", job.id, { reason: `not_finished:${job.status} (start the file-backed server once so it settles interrupted jobs, then migrate)` });
      continue;
    }
    const tj = await existing(() => target.getJob(job.id));
    if (tj) {
      if (!same(tj, job)) note("conflicts", "job", job.id, { reason: "exists_with_different_content" });
      else note("skippedIdentical", "job", job.id);
      continue;
    }
    if (job.status === "failed") {
      await act("job", job.id, () => target.putJob(job));
      continue;
    }
    // succeeded: its record (and the run's evidence) must come with it.
    const record = records.get(job.recordId);
    if (!record) {
      note("refused", "job", job.id, { reason: "record_missing_in_source" });
      continue;
    }
    if (!verifyRecordIntegrity(record).ok) {
      note("refused", "record", record.id, { reason: "record_hash_mismatch (tampered or corrupted; not imported)" });
      continue;
    }
    const runId = record.execution?.runId ?? certificationRunId(job.id);
    const runDir = path.join(source.evidenceRoot(job.id), ".greenlight", "runs", runId);
    if (!existsSync(runDir)) {
      note("refused", "record", record.id, { reason: "evidence_missing_in_source" });
      continue;
    }
    await act("job+record", `${job.id}/${record.id}`, async () => {
      const { status, finishedAt, recordId, outcome, ...base } = job;
      await target.putJob({ ...base, status: "running", startedAt: job.startedAt ?? job.createdAt, finishedAt: null, recordId: null, outcome: null });
      const run = await target.archiveRun({ job, runId, runDir, now: new Date(record.createdAt) });
      await target.putRecord(record, { run });
      await target.putJob(job);
    });
  }

  // Records without a job in the source are listed, never dropped silently.
  const jobRecordIds = new Set((await source.listJobs()).map((j) => j.recordId).filter(Boolean));
  for (const id of records.keys()) if (!jobRecordIds.has(id)) note("refused", "record", id, { reason: "no_job_in_source" });

  report.summary = Object.fromEntries(["imported", "wouldImport", "skippedIdentical", "conflicts", "refused"].map((k) => [k, report[k].length]));
  return report;
}
