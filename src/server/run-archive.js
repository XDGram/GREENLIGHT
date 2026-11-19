// Turning a finished run directory (manifest + Kane output + evidence pack) into
// the run row both stores persist. The run record is re-verified against its own
// hashes BEFORE anything is archived, so a corrupted local copy never becomes
// stored evidence.

import path from "node:path";
import { readdir, lstat } from "node:fs/promises";
import { sha256File } from "../evidence/hash.js";
import { verifyRunRecord } from "../evidence/collect.js";
import { GreenlightError } from "../cli/errors.js";

/** Every regular file under runDir (relative POSIX paths), hashed. Symlinks are refused. */
export async function runFiles(runDir) {
  const out = [];
  async function walk(dir) {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const st = await lstat(abs);
      if (st.isSymbolicLink()) throw new GreenlightError("internal_error", "Run directory contains a symbolic link; refusing to archive it.");
      if (st.isDirectory()) await walk(abs);
      else if (st.isFile()) {
        const h = await sha256File(abs);
        out.push({ name: path.relative(runDir, abs).split(path.sep).join("/"), abs, sha256: h.sha256, bytes: h.bytes });
      }
    }
  }
  await walk(runDir);
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Verify the run directory and describe it as a run row.
 * @returns {Promise<{run: object, files: {name, abs, sha256, bytes}[]}>}
 */
export async function describeRun({ job, runId, runDir, storagePrefix, now }) {
  const v = await verifyRunRecord(runDir);
  if (!v.ok) throw new GreenlightError("run_record_invalid", `Run ${runId} failed its integrity check before archiving: ${v.problems.join(", ")}.`, { problems: v.problems });
  const m = v.manifest;
  if (m.runId !== runId) throw new GreenlightError("run_record_invalid", "Run id does not match its manifest.");
  const files = await runFiles(runDir);
  return {
    files,
    run: {
      runId,
      jobId: job.id,
      projectId: job.projectId,
      runKind: m.runKind,
      manifest: m,
      manifestSha256: m.recordSha256,
      evidenceStatus: m.evidence?.status ?? "missing",
      evidenceSha256: m.evidence?.sha256 ?? null,
      evidenceBytes: m.evidence?.bytes ?? null,
      storagePrefix,
      files: files.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })),
      createdAt: now.toISOString(),
    },
  };
}
