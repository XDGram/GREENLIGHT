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
//
// What counts as a recording: a test is recorded (replayable) ONLY when
// output-<stem>/.internal/execution.json exists as a regular file holding a JSON
// object. An output-<stem>/ directory alone proves nothing: in Step 11 E1, Kane
// 0.10.6 authored both tests under --local and left only .internal/meta.json,
// because it writes execution.json only through its Test Manager upload pipeline.
// detectRecording() is the single test for this, used by the recording snapshot,
// the credit estimate and `greenlight status`.

import path from "node:path";
import { readdir, readFile, writeFile, mkdir, lstat } from "node:fs/promises";
import { sha256File, sha256Bytes, canonicalJson } from "../evidence/hash.js";

export const RECORDINGS_FILE = path.join(".greenlight", "recordings.json");
export const RECORDINGS_SCHEMA = "greenlight.recordings/v1";
export const RECORDING_FILE = path.join(".internal", "execution.json");
const IGNORED = new Set([path.join(".internal", "meta.json"), "Result.md"]);

/** Why a test has no usable recording. */
export const NOT_RECORDED = Object.freeze({
  NO_OUTPUT_DIR: "no_output_dir",
  MISSING_EXECUTION_JSON: "missing_execution_json",
  NOT_A_REGULAR_FILE: "execution_json_not_a_regular_file",
  INVALID_EXECUTION_JSON: "invalid_execution_json",
});

const stemOfTest = (file) => path.basename(file).replace(/_test\.md$/, "");

/** Kane's output directory for one test file (next to the test file). */
export function recordingDir(testsDir, file) {
  return path.join(testsDir, path.dirname(file), `output-${stemOfTest(file)}`);
}

/**
 * The one shared answer to "does this test have a replayable recording?".
 * @returns {Promise<{file: string, recorded: boolean, reason: string|null}>}
 */
export async function detectRecording({ testsDir, file }) {
  const dir = recordingDir(testsDir, file);
  const no = (reason) => ({ file, recorded: false, reason });
  try {
    if (!(await lstat(dir)).isDirectory()) return no(NOT_RECORDED.NO_OUTPUT_DIR);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return no(NOT_RECORDED.NO_OUTPUT_DIR);
    throw err;
  }
  const blob = path.join(dir, RECORDING_FILE);
  let st;
  try {
    st = await lstat(blob);
  } catch (err) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") return no(NOT_RECORDED.MISSING_EXECUTION_JSON);
    throw err;
  }
  if (!st.isFile()) return no(NOT_RECORDED.NOT_A_REGULAR_FILE);
  let parsed;
  try {
    parsed = JSON.parse(await readFile(blob, "utf8"));
  } catch {
    return no(NOT_RECORDED.INVALID_EXECUTION_JSON);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return no(NOT_RECORDED.INVALID_EXECUTION_JSON);
  return { file, recorded: true, reason: null };
}

/**
 * Tests Kane authored in this run but did not keep as replayable recordings.
 * @param {object} p
 * @param {string} p.testsDir
 * @param {string[]} p.testFiles             approved test files
 * @param {object} p.runResult               KaneRunResult (stream snapshot with members[].attempts[].mode)
 * @returns {Promise<null | {code: "recording_not_retained", tests: {file: string, reason: string}[], message: string}>}
 */
export async function findUnretainedRecordings({ testsDir, testFiles, runResult }) {
  const approved = new Map(testFiles.map((f) => [path.basename(f), f]));
  const authored = new Set();
  for (const m of runResult?.stream?.members ?? []) {
    const key = path.basename(String(m?.file ?? ""));
    if (approved.has(key) && (m.attempts ?? []).some((a) => a.mode === "authored")) authored.add(approved.get(key));
  }
  const tests = [];
  for (const file of [...authored].sort()) {
    const d = await detectRecording({ testsDir, file });
    if (!d.recorded) tests.push({ file: path.basename(file), reason: d.reason });
  }
  if (tests.length === 0) return null;
  return {
    code: "recording_not_retained",
    tests,
    message:
      `Kane authored ${tests.length} test(s) in this run but kept no replayable recording (${RECORDING_FILE.split(path.sep).join("/")}): ` +
      `${tests.map((t) => t.file).join(", ")}. The next run cannot replay them: it will author them afresh and incur fresh-authoring credit costs again.`,
  };
}

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

/**
 * Hash every file under each test's output directory, and say which tests are
 * actually recorded (detectRecording). Files are hashed whether or not the test
 * is recorded, so nothing in output-<stem>/ can change unnoticed.
 */
export async function snapshotRecordings({ testsDir, testFiles }) {
  const files = {};
  const recorded = [];
  const notRecorded = [];
  const missing = [];
  for (const tf of [...testFiles].sort()) {
    const stem = stemOfTest(tf);
    const dir = recordingDir(testsDir, tf);
    const listed = await listFiles(dir);
    if (listed !== null) {
      for (const f of listed.sort((a, b) => a.rel.localeCompare(b.rel))) {
        if (IGNORED.has(f.rel)) continue;
        const key = path.posix.join(`output-${stem}`, f.rel.split(path.sep).join("/"));
        files[key] = f.symlink ? "symlink" : (await sha256File(path.join(dir, f.rel))).sha256;
      }
    }
    const d = await detectRecording({ testsDir, file: tf });
    if (d.recorded) recorded.push(tf);
    else {
      notRecorded.push(tf);
      missing.push({ file: tf, reason: d.reason });
    }
  }
  return { files, recorded, notRecorded, missing, sha256: sha256Bytes(canonicalJson(files)) };
}

/** Record the current recordings as the trusted baseline for one approved hash. */
export async function saveRecordingsBaseline({ root, testsDir, testFiles, approvedHash, now = () => new Date() }) {
  const snap = await snapshotRecordings({ testsDir, testFiles });
  const record = { schema: RECORDINGS_SCHEMA, approvedHash, savedAt: now().toISOString(), ...snap };
  await mkdir(path.join(root, ".greenlight"), { recursive: true });
  await writeFile(path.join(root, RECORDINGS_FILE), JSON.stringify(record, null, 2) + "\n");
  return record;
}

/** Integrity statuses that mean the cache is intact, with or without replayable recordings. */
export const INTACT_RECORDING_STATUSES = Object.freeze(["unchanged", "partial", "not_recorded"]);

/**
 * Compare recordings on disk with the baseline.
 * status: no_baseline | stale (baseline belongs to another approved hash: re-record)
 *         | changed (files differ from the baseline)
 *         | not_recorded (intact, but no test has a replayable recording)
 *         | partial (intact, some tests recorded and some not)
 *         | unchanged (intact, and every test has a replayable recording)
 * A missing recording is never reported as "unchanged". `recorded` / `notRecorded`
 * always come from detectRecording(), never from the baseline.
 */
export async function checkRecordings({ root, testsDir, testFiles, approvedHash }) {
  const now = await snapshotRecordings({ testsDir, testFiles });
  const presence = { recorded: now.recorded, notRecorded: now.notRecorded, missing: now.missing };
  let baseline;
  try {
    baseline = JSON.parse(await readFile(path.join(root, RECORDINGS_FILE), "utf8"));
  } catch {
    return { status: "no_baseline", changed: [], added: [], removed: [], ...presence };
  }
  if (baseline.schema !== RECORDINGS_SCHEMA || baseline.approvedHash !== approvedHash) {
    return { status: "stale", changed: [], added: [], removed: [], baselineApprovedHash: baseline.approvedHash ?? null, ...presence };
  }
  const before = baseline.files ?? {};
  const changed = Object.keys(before).filter((k) => k in now.files && now.files[k] !== before[k]).sort();
  const removed = Object.keys(before).filter((k) => !(k in now.files)).sort();
  const added = Object.keys(now.files).filter((k) => !(k in before)).sort();
  let status;
  if (changed.length || removed.length || added.length) status = "changed";
  else if (now.recorded.length === 0) status = "not_recorded";
  else if (now.notRecorded.length > 0) status = "partial";
  else status = "unchanged";
  return { status, changed, added, removed, ...presence };
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
