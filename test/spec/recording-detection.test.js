// Recording detection and retention: regressions from Step 11 E1, where Kane 0.10.6
// authored both tests under --local and kept only output-<stem>/.internal/meta.json.
// No Kane is executed and no credits are used.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import {
  detectRecording,
  snapshotRecordings,
  saveRecordingsBaseline,
  checkRecordings,
  findUnretainedRecordings,
  NOT_RECORDED,
  INTACT_RECORDING_STATUSES,
} from "../../src/spec/index.js";
import { planFromRecordings } from "../../src/credits/index.js";
import { runFromFixture } from "../verify/helpers.js";

const HASH = "68d811b0ab3cd7f57c015348a47208b8e7efc176d3bea30d7fd9127b4728e152";
const FILES = ["cart-add-two_test.md", "newsletter-subscribe_test.md"];

const temps = [];
after(() => Promise.all(temps.map((d) => rm(d, { recursive: true, force: true }))));
async function project() {
  const root = await mkdtemp(path.join(os.tmpdir(), "gl-rec-"));
  temps.push(root);
  const testsDir = path.join(root, ".greenlight", "tests");
  await mkdir(testsDir, { recursive: true });
  return { root, testsDir };
}

/** Exactly what E1 left behind: an output dir with only Kane's run history. */
async function e1Output(testsDir, stem) {
  const dir = path.join(testsDir, `output-${stem}`, ".internal");
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "meta.json"),
    JSON.stringify({ executions: [{ execution_id: "9ebe566c", run_kind: "author", status: "passed", valid: true }] }),
  );
}

async function realRecording(testsDir, stem) {
  const dir = path.join(testsDir, `output-${stem}`, ".internal");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "execution.json"), JSON.stringify({ instructions: [{ action: "click" }] }));
  await writeFile(path.join(dir, "meta.json"), '{"executions":[]}');
}

/** A KaneRunResult stream snapshot where the given files were authored (or replayed). */
const runWith = (modes) => ({ stream: { members: Object.entries(modes).map(([file, mode]) => ({ file, attempts: [{ mode }] })) } });

test("E1: an output dir with only meta.json is not a recording", async () => {
  const { testsDir } = await project();
  await e1Output(testsDir, "cart-add-two");
  assert.deepEqual(await detectRecording({ testsDir, file: "cart-add-two_test.md" }), {
    file: "cart-add-two_test.md",
    recorded: false,
    reason: NOT_RECORDED.MISSING_EXECUTION_JSON,
  });
  assert.equal((await detectRecording({ testsDir, file: "newsletter-subscribe_test.md" })).reason, NOT_RECORDED.NO_OUTPUT_DIR);
});

test("only a regular execution.json holding a JSON object counts as a recording", async () => {
  const { testsDir } = await project();
  const internal = path.join(testsDir, "output-a", ".internal");
  await mkdir(internal, { recursive: true });
  const blob = path.join(internal, "execution.json");
  const check = async () => detectRecording({ testsDir, file: "a_test.md" });

  for (const bad of ["", "not json", "[]", "null", "42", '"x"']) {
    await writeFile(blob, bad);
    assert.deepEqual([(await check()).recorded, (await check()).reason], [false, NOT_RECORDED.INVALID_EXECUTION_JSON], `content ${JSON.stringify(bad)}`);
  }
  await rm(blob);
  await mkdir(blob);
  assert.equal((await check()).reason, NOT_RECORDED.NOT_A_REGULAR_FILE, "a directory named execution.json");
  await rm(blob, { recursive: true });
  await writeFile(path.join(internal, "elsewhere.json"), "{}");
  await symlink(path.join(internal, "elsewhere.json"), blob);
  assert.equal((await check()).reason, NOT_RECORDED.NOT_A_REGULAR_FILE, "a symlink is not trusted");
  await rm(blob);
  await writeFile(blob, "{}");
  assert.deepEqual(await check(), { file: "a_test.md", recorded: true, reason: null });
});

test("E1: the recording baseline lists both tests as NOT recorded", async () => {
  const { root, testsDir } = await project();
  for (const s of ["cart-add-two", "newsletter-subscribe"]) await e1Output(testsDir, s);
  const snap = await snapshotRecordings({ testsDir, testFiles: FILES });
  assert.deepEqual(snap.recorded, []);
  assert.deepEqual(snap.notRecorded, FILES);
  assert.deepEqual(snap.missing.map((m) => m.reason), [NOT_RECORDED.MISSING_EXECUTION_JSON, NOT_RECORDED.MISSING_EXECUTION_JSON]);
  const base = await saveRecordingsBaseline({ root, testsDir, testFiles: FILES, approvedHash: HASH });
  assert.deepEqual(base.recorded, [], "the old bug wrote recorded: [both] here");
});

test("E1: missing recordings are never reported as unchanged or replayable", async () => {
  const { root, testsDir } = await project();
  for (const s of ["cart-add-two", "newsletter-subscribe"]) await e1Output(testsDir, s);
  await saveRecordingsBaseline({ root, testsDir, testFiles: FILES, approvedHash: HASH });
  const c = await checkRecordings({ root, testsDir, testFiles: FILES, approvedHash: HASH });
  assert.equal(c.status, "not_recorded");
  assert.notEqual(c.status, "unchanged");
  assert.deepEqual(c.recorded, []);
  assert.ok(INTACT_RECORDING_STATUSES.includes(c.status), "intact: verify may proceed, as fresh authoring");
  const plan = await planFromRecordings({ testsDir, files: FILES });
  assert.ok(plan.tests.every((t) => t.author === true), "planned as fresh authoring, never as a replay");
});

test("a baseline written by the old bug (recorded: both, files: {}) does not make missing recordings look replayable", async () => {
  const { root, testsDir } = await project();
  for (const s of ["cart-add-two", "newsletter-subscribe"]) await e1Output(testsDir, s);
  await mkdir(path.join(root, ".greenlight"), { recursive: true });
  await writeFile(
    path.join(root, ".greenlight", "recordings.json"),
    JSON.stringify({ schema: "greenlight.recordings/v1", approvedHash: HASH, files: {}, recorded: FILES, notRecorded: [], sha256: "x" }),
  );
  const c = await checkRecordings({ root, testsDir, testFiles: FILES, approvedHash: HASH });
  assert.equal(c.status, "not_recorded");
  assert.deepEqual(c.recorded, []);
});

test("partial and fully recorded caches are told apart", async () => {
  const { root, testsDir } = await project();
  await realRecording(testsDir, "cart-add-two");
  await e1Output(testsDir, "newsletter-subscribe");
  await saveRecordingsBaseline({ root, testsDir, testFiles: FILES, approvedHash: HASH });
  let c = await checkRecordings({ root, testsDir, testFiles: FILES, approvedHash: HASH });
  assert.deepEqual([c.status, c.recorded, c.notRecorded], ["partial", ["cart-add-two_test.md"], ["newsletter-subscribe_test.md"]]);

  await realRecording(testsDir, "newsletter-subscribe");
  c = await checkRecordings({ root, testsDir, testFiles: FILES, approvedHash: HASH });
  assert.equal(c.status, "changed", "a recording appearing outside a Greenlight run is still an integrity change");
  await saveRecordingsBaseline({ root, testsDir, testFiles: FILES, approvedHash: HASH });
  c = await checkRecordings({ root, testsDir, testFiles: FILES, approvedHash: HASH });
  assert.equal(c.status, "unchanged");
});

test("E1: tests Kane authored but did not keep are reported as recording_not_retained", async () => {
  const { testsDir } = await project();
  for (const s of ["cart-add-two", "newsletter-subscribe"]) await e1Output(testsDir, s);
  const w = await findUnretainedRecordings({ testsDir, testFiles: FILES, runResult: runWith({ "cart-add-two_test.md": "authored", "newsletter-subscribe_test.md": "authored" }) });
  assert.equal(w.code, "recording_not_retained");
  assert.deepEqual(w.tests, [
    { file: "cart-add-two_test.md", reason: NOT_RECORDED.MISSING_EXECUTION_JSON },
    { file: "newsletter-subscribe_test.md", reason: NOT_RECORDED.MISSING_EXECUTION_JSON },
  ]);
  assert.match(w.message, /next run .* author them afresh and incur fresh-authoring credit costs/);
});

test("retention: kept recordings, replays and unapproved tests raise no warning", async () => {
  const { testsDir } = await project();
  await realRecording(testsDir, "cart-add-two");
  await e1Output(testsDir, "newsletter-subscribe");
  assert.equal(await findUnretainedRecordings({ testsDir, testFiles: FILES, runResult: runWith({ "cart-add-two_test.md": "authored" }) }), null);
  assert.equal(await findUnretainedRecordings({ testsDir, testFiles: FILES, runResult: runWith({ "newsletter-subscribe_test.md": "replay" }) }), null);
  assert.equal(await findUnretainedRecordings({ testsDir, testFiles: FILES, runResult: runWith({ "other_test.md": "authored" }) }), null);
  assert.equal(await findUnretainedRecordings({ testsDir, testFiles: FILES, runResult: {} }), null);
});

test("retention check reads Kane's real authored stream (smoke Run 1): nothing kept on disk -> all three flagged", async () => {
  const { testsDir } = await project();
  const files = ["cart_test.md", "subscribe_test.md", "about_nav_test.md"];
  const w = await findUnretainedRecordings({ testsDir, testFiles: files, runResult: runFromFixture("run1-authored") });
  assert.deepEqual(w.tests.map((t) => t.file), ["about_nav_test.md", "cart_test.md", "subscribe_test.md"]);
  assert.equal(await findUnretainedRecordings({ testsDir, testFiles: files, runResult: runFromFixture("run2-replay") }), null, "replays author nothing");
});
