// Recording-cache integrity, tracked separately from the approved-test hash.
//
// Kane stores each test's recording in output-<stem>/ next to the test file.
// Recordings are a cache tied to one approved version of the tests: they are
// not part of the approved-test hash, but they must not change behind our back
// (e.g. adaptive healing rewriting a step) and must be discarded when the
// approved tests change.
//
// Hashed: every file under output-<stem>/ except
//   - .internal/meta.json  (Kane appends run history on every run; verified in Run 2)
//   - Result.md            (rewritten on every run)

import path from "node:path";
import { readdir, readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { sha256File, sha256Bytes, canonicalJson } from "../evidence/hash.js";

export const RECORDINGS_FILE = path.join(".greenlight", "recordings.json");
export const RECORDINGS_SCHEMA = "greenlight.recordings/v1";
const IGNORED = new Set([path.join(".internal", "meta.json"), "Result.md"]);

async function listFiles(dir, base = dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === "ENOENT") return null;
    throw err;
  }
  const out = [];
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isSymbolicLink()) out.push({ rel: path.relative(base, full), symlink: true });
    else if (e.isDirectory()) out.push(...(await listFiles(full, base)));
    else if (e.isFile()) out.push({ rel: path.relative(base, full), symlink: false });
  }
  return out;
}

/** Hash every recording file for the given test files. */
export async function snapshotRecordings({ testsDir, testFiles }) {
  const files = {};
  const recorded = [];
  const notRecorded = [];
  for (const tf of [...testFiles].sort()) {
    const stem = path.basename(tf).replace(/_test\.md$/, "");
    const dir = path.join(testsDir, `output-${stem}`);
    const listed = await listFiles(dir);
    if (listed === null) {
      notRecorded.push(tf);
      continue;
    }
    recorded.push(tf);
    for (const f of listed.sort((a, b) => a.rel.localeCompare(b.rel))) {
      if (IGNORED.has(f.rel)) continue;
      const key = path.posix.join(`output-${stem}`, f.rel.split(path.sep).join("/"));
      files[key] = f.symlink ? "symlink" : (await sha256File(path.join(dir, f.rel))).sha256;
    }
  }
  return { files, recorded, notRecorded, sha256: sha256Bytes(canonicalJson(files)) };
}

/** Record the current recordings as the trusted baseline for one approved hash. */
export async function saveRecordingsBaseline({ root, testsDir, testFiles, approvedHash, now = () => new Date() }) {
  const snap = await snapshotRecordings({ testsDir, testFiles });
  const record = { schema: RECORDINGS_SCHEMA, approvedHash, savedAt: now().toISOString(), ...snap };
  await mkdir(path.join(root, ".greenlight"), { recursive: true });
  await writeFile(path.join(root, RECORDINGS_FILE), JSON.stringify(record, null, 2) + "\n");
  return record;
}

/**
 * Compare recordings on disk with the baseline.
 * status: no_baseline | stale (baseline belongs to another approved hash: re-record)
 *         | unchanged | changed
 */
export async function checkRecordings({ root, testsDir, testFiles, approvedHash }) {
  let baseline;
  try {
    baseline = JSON.parse(await readFile(path.join(root, RECORDINGS_FILE), "utf8"));
  } catch {
    return { status: "no_baseline", changed: [], added: [], removed: [] };
  }
  if (baseline.schema !== RECORDINGS_SCHEMA || baseline.approvedHash !== approvedHash) {
    return { status: "stale", changed: [], added: [], removed: [], baselineApprovedHash: baseline.approvedHash ?? null };
  }
  const now = await snapshotRecordings({ testsDir, testFiles });
  const before = baseline.files ?? {};
  const changed = Object.keys(before).filter((k) => k in now.files && now.files[k] !== before[k]).sort();
  const removed = Object.keys(before).filter((k) => !(k in now.files)).sort();
  const added = Object.keys(now.files).filter((k) => !(k in before)).sort();
  const status = changed.length || removed.length || added.length ? "changed" : "unchanged";
  return { status, changed, added, removed };
}

/**
 * Which recording changes a finished run may legitimately have made.
 * Kane logs each test's run kind in output-<stem>/.internal/meta.json
 * (executions[-1].run_kind, verified in Run 2): "author" means Kane wrote
 * steps this run (first recording, or a check that had never passed), so new or
 * changed recordings for that test are expected. A "replay" test must not change.
 * Removed recording files are never accepted.
 * @returns {Promise<{acceptable: boolean, authoredStems: string[], unexpected: string[]}>}
 */
export async function classifyRecordingChanges({ testsDir, check }) {
  const touched = [...(check.changed ?? []), ...(check.added ?? [])];
  const stemOf = (p) => /^output-([^/]+)\//.exec(p)?.[1] ?? null;
  const authoredStems = [];
  const unexpected = [...(check.removed ?? [])];
  const kinds = new Map();
  for (const p of touched) {
    const stem = stemOf(p);
    if (!stem) {
      unexpected.push(p);
      continue;
    }
    if (!kinds.has(stem)) {
      let kind = null;
      try {
        const meta = JSON.parse(await readFile(path.join(testsDir, `output-${stem}`, ".internal", "meta.json"), "utf8"));
        kind = meta?.executions?.at?.(-1)?.run_kind ?? null;
      } catch {
        kind = null;
      }
      kinds.set(stem, kind);
      if (kind === "author") authoredStems.push(stem);
    }
    if (kinds.get(stem) !== "author") unexpected.push(p);
  }
  return { acceptable: unexpected.length === 0, authoredStems: authoredStems.sort(), unexpected };
}
