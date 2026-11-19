// Run history: every `greenlight verify` attempt leaves an immutable record in
// .greenlight/runs/<run-id>/ (manifest.json + manifest.sha256 + Kane output +
// evidence pack). Nothing here writes or deletes; records are never rewritten.

import path from "node:path";
import { readdir, readFile, lstat } from "node:fs/promises";
import { verifyRunRecord, MANIFEST_FILE } from "../evidence/collect.js";
import { GreenlightError } from "../cli/errors.js";

export const RUNS_DIR = path.join(".greenlight", "runs");
export const RUN_SUMMARY_SCHEMA = "greenlight.run-summary/v1";
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** Validate a run id before it is ever joined into a path. */
export function assertRunId(runId) {
  if (typeof runId !== "string" || !RUN_ID.test(runId)) throw new GreenlightError("run_not_found", `Not a run id: ${JSON.stringify(runId)}.`);
  return runId;
}

/** Status of a run as people should read it: interrupted and unverifiable runs stay distinct. */
export function runStatus(manifest) {
  if (!manifest?.result) return "unknown";
  if (manifest.kane?.timedOut) return manifest.result.project === "passed" ? "passed" : "couldnt_verify";
  if ((manifest.kane?.streamIncompleteReasons ?? []).includes("aborted")) return "interrupted";
  return manifest.result.project ?? "unknown";
}

/** Summary safe for listing (no local paths). */
export function summariseManifest(m) {
  return {
    schema: RUN_SUMMARY_SCHEMA,
    runId: m.runId,
    runKind: m.runKind ?? "iteration",
    certification: m.certification === true,
    attempt: m.attempt ?? 1,
    previousRunId: m.previousRunId ?? null,
    createdAt: m.createdAt,
    approvedTestHash: m.approvedTestHash,
    deployedCommit: m.deployedCommit,
    url: m.startUrl?.redacted ?? null,
    status: runStatus(m),
    claims: m.result?.claims ?? [],
    evidence: { status: m.evidence?.status ?? null, sha256: m.evidence?.sha256 ?? null },
    credits: m.credits ? { actualSpend: m.credits.actualSpend ?? null, kaneReportedSpend: m.credits.kaneReportedSpend ?? null, discrepancy: m.credits.discrepancy ?? null, estimate: m.credits.estimate ?? null, status: m.credits.status ?? null } : null,
    warnings: (m.warnings ?? []).map((w) => w.code),
    approval: m.approval ?? null,
    recordSha256: m.recordSha256 ?? null,
  };
}

/**
 * Every run record, oldest first. Unreadable records are listed as such, never hidden.
 * @param {string} root
 * @param {{verify?: boolean}} [opts]  verify: also re-check every record's hashes
 */
export async function listRuns(root, { verify = false } = {}) {
  const dir = path.join(root, RUNS_DIR);
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory() || !RUN_ID.test(e.name)) continue;
    const runDir = path.join(dir, e.name);
    let manifest = null;
    try {
      manifest = JSON.parse(await readFile(path.join(runDir, MANIFEST_FILE), "utf8"));
    } catch {
      out.push({ schema: RUN_SUMMARY_SCHEMA, runId: e.name, status: "record_unreadable", createdAt: null, integrity: verify ? { ok: false, problems: ["manifest_unreadable"] } : undefined });
      continue;
    }
    const summary = summariseManifest({ ...manifest, runId: manifest.runId ?? e.name });
    if (manifest.runId !== e.name) summary.status = "record_mismatch";
    if (verify) {
      const v = await verifyRunRecord(runDir);
      summary.integrity = { ok: v.ok && manifest.runId === e.name, problems: manifest.runId === e.name ? v.problems : [...v.problems, "run_id_mismatch"] };
    }
    out.push(summary);
  }
  return out.sort((a, b) => String(a.createdAt ?? "").localeCompare(String(b.createdAt ?? "")) || a.runId.localeCompare(b.runId));
}

/** Re-check one run record: its own hash and every file hash it lists. */
export async function checkRun(root, runId) {
  assertRunId(runId);
  const runDir = path.join(root, RUNS_DIR, runId);
  try {
    const st = await lstat(runDir);
    if (!st.isDirectory()) throw new Error("not a directory");
  } catch {
    throw new GreenlightError("run_not_found", `No run record ${runId} in ${RUNS_DIR}.`);
  }
  const v = await verifyRunRecord(runDir);
  const problems = [...v.problems];
  if (v.manifest && v.manifest.runId !== runId) problems.push("run_id_mismatch");
  return { runId, ok: problems.length === 0, problems, summary: v.manifest ? summariseManifest(v.manifest) : null };
}
