// Evidence collector tests. Kane is never executed: validation runs through
// test/fixtures/kane/fake-kane-validate.mjs (replaying Kane's real Run 1/Run 2
// validate output) or an inline stand-in.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, copyFile, readFile, writeFile, stat, readdir, symlink, rm, truncate } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import {
  collectEvidence,
  verifyRunRecord,
  describeStartUrl,
  recordHash,
  EVIDENCE_STATUS,
  kaneEvidenceValidator,
  interpretValidation,
  parseValidateOutput,
  checkZipStructure,
  sha256File,
  sha256Bytes,
  canonicalJson,
} from "../../src/evidence/index.js";
import { evaluateRun } from "../../src/verify/classify.js";
import { runFromFixture, APPROVED_SMOKE } from "../verify/helpers.js";

const FIX = (p) => fileURLToPath(new URL(`../fixtures/kane/${p}`, import.meta.url));
const FAKE_VALIDATE = FIX("fake-kane-validate.mjs");
const RUNS = {
  "run1-authored": "553326c5-1953-485e-89e4-308bd415c7b4",
  "run2-replay": "412b9281-8d80-4ea2-a6ef-7d2f348f21b2",
};
const APPROVED_HASH = "a".repeat(64);
const COMMIT = "dc6150b46a46a85efb4255113f0eddc5370621c8";
const PREVIEW = "https://gl-test-93mjujacr-timeb7208-5361s-projects.vercel.app";

const fakeValidator = (env = {}) =>
  kaneEvidenceValidator({ command: [process.execPath, FAKE_VALIDATE], env: { ...process.env, ...env }, timeoutMs: 10_000 });

const tempRoots = [];
after(() => Promise.all(tempRoots.map((r) => rm(r, { recursive: true, force: true }))));

/** A temp project with Kane's evidence store holding `packFile` under `executionId`. */
async function setup(dir, { packFile = FIX(`${dir}/pack.sanitized.evidence`), executionId = RUNS[dir], lines } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "gl-evidence-"));
  tempRoots.push(root);
  const kaneCwd = path.join(root, "kane");
  const store = path.join(kaneCwd, ".testmuai", "evidence");
  await mkdir(store, { recursive: true });
  if (packFile) await copyFile(packFile, path.join(store, `${executionId}.evidence`));
  const runResult = {
    ...runFromFixture(dir, lines !== undefined ? { lines } : {}),
    stdout: readFileSync(FIX(`${dir}/stdout.ndjson`), "utf8"),
    stderr: readFileSync(FIX(`${dir}/stderr.txt`), "utf8"),
    startedAt: "2026-11-19T10:17:38.000Z",
    endedAt: "2026-11-19T10:21:05.000Z",
  };
  return { root, kaneCwd, store, runResult, packPath: path.join(store, `${executionId}.evidence`) };
}

const collect = (s, extra = {}) =>
  collectEvidence({
    runId: "gl-run-1",
    runResult: s.runResult,
    kaneCwd: s.kaneCwd,
    projectRoot: s.root,
    approvedTestHash: APPROVED_HASH,
    deployedCommit: COMMIT,
    startUrl: PREVIEW,
    now: () => new Date("2026-11-19T12:00:00.000Z"),
    ...extra,
  });

const mode = async (p) => (await stat(p)).mode & 0o777;

// ---------------------------------------------------------------- happy paths

for (const [dir, warnings] of [["run1-authored", 2], ["run2-replay", 0]]) {
  test(`${dir}: pack located, validated, copied privately, hashed; manifest verifies`, async () => {
    const s = await setup(dir);
    const r = await collect(s, {
      validator: fakeValidator({ FAKE_VALIDATE_OUTPUT: FIX(`${dir}/evidence-validate.json`) }),
      evaluation: evaluateRun(s.runResult, APPROVED_SMOKE),
    });
    const m = r.manifest;
    assert.equal(r.ok, true);
    assert.equal(m.evidence.status, "stored");
    assert.equal(m.evidence.executionId, RUNS[dir]);
    assert.equal(m.evidence.file, `evidence/${RUNS[dir]}.evidence`);
    assert.equal(m.evidence.validation.valid, true);
    assert.equal(m.evidence.validation.status, "finalized");
    assert.equal(m.evidence.validation.warnings.length, warnings, "warnings preserved");
    if (warnings) assert.equal(m.evidence.validation.warnings[0].code, "l1.failure.status_disagrees");

    // Hashes match the files on disk and the original pack.
    const stored = path.join(r.runDir, m.evidence.file);
    assert.equal(m.evidence.sha256, (await sha256File(s.packPath)).sha256);
    assert.equal(m.evidence.sha256, (await sha256File(stored)).sha256);
    assert.equal(m.outputs.stdout.sha256, sha256Bytes(readFileSync(FIX(`${dir}/stdout.ndjson`))));
    assert.equal(m.outputs.stderr.sha256, sha256Bytes(readFileSync(FIX(`${dir}/stderr.txt`))));
    assert.equal(await readFile(path.join(r.runDir, "kane-stdout.ndjson"), "utf8"), s.runResult.stdout);

    // Required manifest fields.
    assert.equal(m.schema, "greenlight.run-manifest/v1");
    assert.equal(m.runId, "gl-run-1");
    assert.equal(m.approvedTestHash, APPROVED_HASH);
    assert.equal(m.deployedCommit, COMMIT);
    assert.equal(m.startUrl.redacted, `${PREVIEW}/`);
    assert.equal(m.kane.pinnedVersion, "0.10.6");
    assert.equal(m.kane.reportedVersion, "0.10.6");
    assert.equal(m.kane.executionId, RUNS[dir]);
    assert.equal(m.private, true);
    assert.equal(m.result.project, "failed");
    assert.deepEqual(m.result.claims.map((c) => c.status), ["passed", "failed", "passed"]);

    // Record hash is computed last and covers everything else.
    assert.equal(m.recordSha256, recordHash(m));
    assert.equal((await readFile(path.join(r.runDir, "manifest.sha256"), "utf8")).split(/\s+/)[0], m.recordSha256);
    assert.deepEqual(await verifyRunRecord(r.runDir), { ok: true, problems: [], manifest: m });

    // Private on disk.
    assert.equal(await mode(r.runDir), 0o700);
    for (const f of ["manifest.json", "manifest.sha256", "kane-stdout.ndjson", "kane-stderr.txt", m.evidence.file]) {
      assert.equal(await mode(path.join(r.runDir, f)), 0o600, f);
    }
    assert.deepEqual((await readdir(path.join(r.runDir, "evidence"))).sort(), [`${RUNS[dir]}.evidence`], "no .partial left");
    assert.ok(r.runDir.startsWith(path.join(s.root, ".greenlight", "runs")));
  });
}

test("real Run 1 / Run 2 packs (only when GREENLIGHT_REAL_EVIDENCE_DIR is set)", { skip: !process.env.GREENLIGHT_REAL_EVIDENCE_DIR }, async () => {
  for (const dir of Object.keys(RUNS)) {
    const real = path.join(process.env.GREENLIGHT_REAL_EVIDENCE_DIR, `${RUNS[dir]}.evidence`);
    const s = await setup(dir, { packFile: real });
    const r = await collect(s, { validator: fakeValidator({ FAKE_VALIDATE_OUTPUT: FIX(`${dir}/evidence-validate.json`) }) });
    assert.equal(r.manifest.evidence.status, "stored", dir);
    assert.equal(r.manifest.evidence.sha256, (await sha256File(real)).sha256);
    assert.equal((await checkZipStructure(real)).ok, true);
    assert.equal((await verifyRunRecord(r.runDir)).ok, true);
    await rm(s.root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- missing / bad evidence

test("missing pack: recorded as missing, validator never called, record still verifies", async () => {
  const s = await setup("run2-replay", { packFile: null });
  let called = false;
  const r = await collect(s, { validator: async () => ((called = true), {}) });
  assert.equal(r.ok, false);
  assert.equal(r.manifest.evidence.status, "missing");
  assert.equal(r.manifest.evidence.sha256, null);
  assert.equal(called, false);
  assert.equal(existsSync(path.join(r.runDir, "evidence")), false);
  assert.equal((await verifyRunRecord(r.runDir)).ok, true);
});

test("incomplete run without testrun_done: no execution id, nothing collected", async () => {
  const s = await setup("run1-authored", { lines: 5 });
  const r = await collect(s, { validator: async () => assert.fail("must not validate") });
  assert.equal(r.manifest.evidence.status, "no_execution_id");
  assert.equal(r.manifest.kane.streamComplete, false);
  assert.ok(r.manifest.kane.streamIncompleteReasons.includes("missing_completion_event"));
  assert.equal((await verifyRunRecord(r.runDir)).ok, true);
});

test("execution id that could escape the evidence directory is refused", async () => {
  const s = await setup("run2-replay");
  s.runResult.stream.done.executionId = "../../etc/passwd";
  s.runResult.stream.summary.evidenceId = "../../etc/passwd";
  const r = await collect(s, { validator: async () => assert.fail("must not validate") });
  assert.equal(r.manifest.evidence.status, "invalid_execution_id");
  assert.equal(r.manifest.evidence.source, null);
});

test("summary evidence id that disagrees with testrun_done is refused", async () => {
  const s = await setup("run2-replay");
  s.runResult.stream.summary.evidenceId = "00000000-0000-0000-0000-000000000000";
  const r = await collect(s, { validator: async () => assert.fail("must not validate") });
  assert.equal(r.manifest.evidence.status, "execution_id_mismatch");
});

test("a symlink in place of the pack is refused", async () => {
  const s = await setup("run2-replay", { packFile: null });
  await symlink(FIX("run2-replay/pack.sanitized.evidence"), s.packPath);
  const r = await collect(s, { validator: async () => assert.fail("must not validate") });
  assert.equal(r.manifest.evidence.status, "not_a_regular_file");
});

for (const [label, mutate, reason] of [
  ["truncated pack", async (p) => truncate(p, 4000), "no_end_of_central_directory"],
  ["not a zip", async (p) => writeFile(p, Buffer.alloc(4096, 0x41)), "not_a_zip"],
  ["empty file", async (p) => writeFile(p, ""), "too_small"],
]) {
  test(`corrupted pack (${label}) is rejected before copying or validating`, async () => {
    const s = await setup("run2-replay");
    await mutate(s.packPath);
    const r = await collect(s, { validator: async () => assert.fail("must not validate") });
    assert.equal(r.manifest.evidence.status, "corrupted");
    assert.equal(r.manifest.evidence.zipCheck.reason, reason);
    assert.equal(existsSync(path.join(r.runDir, "evidence")), false);
    assert.equal((await verifyRunRecord(r.runDir)).ok, true);
  });
}

test("validator reports invalid: pack is not kept; diagnostics are recorded", async () => {
  const s = await setup("run1-authored");
  const report = path.join(s.root, "invalid.json");
  await writeFile(report, JSON.stringify({ valid: false, status: "live", diagnostics: [
    { code: "l0.seal.missing", severity: "error", location: "run.yaml", message: "pack is not sealed" },
    { code: "l1.x", severity: "warning", location: "a", message: "w" },
  ] }));
  const r = await collect(s, { validator: fakeValidator({ FAKE_VALIDATE_OUTPUT: report, FAKE_VALIDATE_EXIT: "1" }) });
  const e = r.manifest.evidence;
  assert.equal(r.ok, false);
  assert.equal(e.status, "invalid");
  assert.equal(e.validation.exitCode, 1);
  assert.equal(e.validation.errors[0].code, "l0.seal.missing");
  assert.equal(e.validation.warnings.length, 1);
  assert.equal(e.file, null);
  assert.deepEqual(await readdir(path.join(r.runDir, "evidence")), [], "invalid pack removed");
  assert.equal((await verifyRunRecord(r.runDir)).ok, true);
});

test("exit 0 with valid:false is still invalid (both are required)", async () => {
  const s = await setup("run2-replay");
  const report = path.join(s.root, "r.json");
  await writeFile(report, '{"valid":false,"status":"finalized","diagnostics":[]}');
  const r = await collect(s, { validator: fakeValidator({ FAKE_VALIDATE_OUTPUT: report }) });
  assert.equal(r.manifest.evidence.status, "invalid");
});

test("exit 1 with valid:true is still invalid (both are required)", async () => {
  const s = await setup("run2-replay");
  const r = await collect(s, { validator: fakeValidator({ FAKE_VALIDATE_EXIT: "1" }) });
  assert.equal(r.manifest.evidence.status, "invalid");
});

test("unreadable validator output, validator 'not found', timeout and crash are all handled", async () => {
  const cases = [
    [fakeValidator({ FAKE_VALIDATE_MODE: "garbage" }), "validation_output_unreadable"],
    [async () => ({ exitCode: 2, stdout: "", stderr: "not found" }), "not_found_by_validator"],
    [kaneEvidenceValidator({ command: [process.execPath, FAKE_VALIDATE], env: { ...process.env, FAKE_VALIDATE_MODE: "hang" }, timeoutMs: 300 }), "validation_unavailable"],
    [async () => { throw new Error("validator crashed"); }, "validation_unavailable"],
    [kaneEvidenceValidator({ command: "/nonexistent/kane-cli" }), "validation_unavailable"],
  ];
  for (const [validator, expected] of cases) {
    const s = await setup("run2-replay");
    const r = await collect(s, { validator });
    assert.equal(r.manifest.evidence.status, expected);
    assert.equal(r.ok, false);
    assert.deepEqual(await readdir(path.join(r.runDir, "evidence")), []);
    await rm(s.root, { recursive: true, force: true });
  }
});

test("a pack modified while being validated is rejected", async () => {
  const s = await setup("run2-replay");
  const r = await collect(s, {
    validator: async (p) => {
      await writeFile(p, "tampered", { flag: "a" });
      return { exitCode: 0, stdout: '{"valid":true,"status":"finalized","diagnostics":[]}', stderr: "" };
    },
  });
  assert.equal(r.manifest.evidence.status, "changed_during_validation");
  assert.deepEqual(await readdir(path.join(r.runDir, "evidence")), []);
});

test("the validator is given the private copy, not Kane's original", async () => {
  const s = await setup("run2-replay");
  let validated;
  const r = await collect(s, {
    validator: async (p) => ((validated = p), { exitCode: 0, stdout: '{"valid":true,"status":"finalized","diagnostics":[]}', stderr: "" }),
  });
  assert.ok(validated.startsWith(r.runDir), validated);
});

// ---------------------------------------------------------------- record integrity

test("verifyRunRecord detects tampering with the pack, outputs, manifest and hash file", async () => {
  const s = await setup("run2-replay");
  const r = await collect(s, { validator: fakeValidator({ FAKE_VALIDATE_OUTPUT: FIX("run2-replay/evidence-validate.json") }) });
  const pack = path.join(r.runDir, r.manifest.evidence.file);

  await writeFile(pack, "x", { flag: "a" });
  assert.deepEqual((await verifyRunRecord(r.runDir)).problems, ["evidence_hash_mismatch", "evidence_size_mismatch"]);

  await writeFile(path.join(r.runDir, "kane-stderr.txt"), "edited");
  assert.ok((await verifyRunRecord(r.runDir)).problems.includes("stderr_hash_mismatch"));

  const mPath = path.join(r.runDir, "manifest.json");
  const m = JSON.parse(await readFile(mPath, "utf8"));
  m.deployedCommit = "f".repeat(40);
  await writeFile(mPath, JSON.stringify(m));
  assert.ok((await verifyRunRecord(r.runDir)).problems.includes("record_hash_mismatch"));

  await writeFile(path.join(r.runDir, "manifest.sha256"), "0".repeat(64));
  assert.ok((await verifyRunRecord(r.runDir)).problems.includes("record_hash_file_mismatch"));

  await rm(path.join(r.runDir, "kane-stdout.ndjson"));
  assert.ok((await verifyRunRecord(r.runDir)).problems.includes("stdout_missing"));

  await writeFile(mPath, "{not json");
  assert.deepEqual((await verifyRunRecord(r.runDir)).problems, ["manifest_unreadable"]);
});

test("verifyRunRecord refuses file paths outside the run directory", async () => {
  const s = await setup("run2-replay", { packFile: null });
  const r = await collect(s, { validator: async () => ({}) });
  const mPath = path.join(r.runDir, "manifest.json");
  const m = JSON.parse(await readFile(mPath, "utf8"));
  m.outputs.stdout.file = "../../../etc/hostname";
  m.recordSha256 = recordHash(m);
  await writeFile(mPath, JSON.stringify(m));
  await writeFile(path.join(r.runDir, "manifest.sha256"), m.recordSha256);
  assert.ok((await verifyRunRecord(r.runDir)).problems.includes("stdout_path_outside_run"));
});

test("record hash is deterministic and covers every field", () => {
  const a = { schema: "s", runId: "r", nested: { b: 1, a: [1, { y: 2, x: 1 }] } };
  const b = { nested: { a: [1, { x: 1, y: 2 }], b: 1 }, runId: "r", schema: "s" };
  assert.equal(recordHash(a), recordHash(b));
  assert.notEqual(recordHash(a), recordHash({ ...a, runId: "r2" }));
  assert.equal(recordHash({ ...a, recordSha256: "anything" }), recordHash(a));
  assert.equal(canonicalJson({ b: 1, a: undefined, c: [undefined] }), '{"b":1,"c":[null]}');
  assert.throws(() => canonicalJson({ x: NaN }), /non-finite/);
});

test("an existing run directory is never overwritten", async () => {
  const s = await setup("run2-replay", { packFile: null });
  await collect(s, { validator: async () => ({}) });
  await assert.rejects(collect(s, { validator: async () => ({}) }), /EEXIST/);
});

// ---------------------------------------------------------------- inputs and helpers

test("inputs are validated before anything is written", async () => {
  const s = await setup("run2-replay");
  const bad = [
    [{ runId: "../escape" }, /runId/],
    [{ runId: "" }, /runId/],
    [{ approvedTestHash: "abc" }, /approvedTestHash/],
    [{ deployedCommit: "dc6150b" }, /deployedCommit/],
    [{ deployedCommit: "DC6150B46A46A85EFB4255113F0EDDC5370621C8" }, /deployedCommit/],
    [{ startUrl: "ftp://x" }, /http/],
    [{ runResult: null }, /runResult/],
  ];
  for (const [over, re] of bad) await assert.rejects(collect(s, { validator: async () => ({}), ...over }), re);
  assert.equal(existsSync(path.join(s.root, ".greenlight")), false);
});

test("start URL: query, fragment and credentials are never stored, only hashed", () => {
  const d = describeStartUrl("https://user:pw@app.vercel.app/path?x-vercel-protection-bypass=SECRET#frag");
  assert.equal(d.redacted, "https://app.vercel.app/path?REDACTED");
  assert.equal(d.queryOrFragmentRemoved, true);
  assert.equal(JSON.stringify(d).includes("SECRET"), false);
  assert.equal(JSON.stringify(d).includes("pw"), false);
  assert.equal(d.sha256, sha256Bytes("https://user:pw@app.vercel.app/path?x-vercel-protection-bypass=SECRET#frag"));
  assert.equal(describeStartUrl(undefined), null);
  assert.equal(describeStartUrl("https://a.b").queryOrFragmentRemoved, false);
});

test("a stored manifest never contains the bypass secret", async () => {
  const s = await setup("run2-replay");
  const r = await collect(s, {
    startUrl: `${PREVIEW}/?x-vercel-protection-bypass=TOPSECRET123`,
    validator: fakeValidator({ FAKE_VALIDATE_OUTPUT: FIX("run2-replay/evidence-validate.json") }),
  });
  assert.equal((await readFile(path.join(r.runDir, "manifest.json"), "utf8")).includes("TOPSECRET123"), false);
});

test("parseValidateOutput and interpretValidation", () => {
  assert.equal(parseValidateOutput("noise\n{\"valid\":true}\n").valid, true);
  assert.equal(parseValidateOutput('{"other":1}\n'), null);
  assert.equal(parseValidateOutput(undefined), null);
  assert.equal(interpretValidation({ exitCode: null }).outcome, "validation_unavailable");
  assert.equal(interpretValidation({ exitCode: 0, timedOut: true, stdout: '{"valid":true}' }).outcome, "validation_unavailable");
  const real = interpretValidation({ exitCode: 0, stdout: readFileSync(FIX("run1-authored/evidence-validate.json"), "utf8") });
  assert.equal(real.outcome, "valid");
  assert.deepEqual(real.warnings.map((w) => w.code), ["l1.failure.status_disagrees", "l1.failure.missing"]);
  assert.deepEqual(real.errors, []);
});

test("committed sanitised packs are structurally valid zips with no personal data", async () => {
  for (const dir of Object.keys(RUNS)) {
    const p = FIX(`${dir}/pack.sanitized.evidence`);
    assert.equal((await checkZipStructure(p)).ok, true);
    const bytes = readFileSync(p);
    // Zip entries are deflated, so also check the account name is absent from the inflated text below.
    assert.equal(bytes.includes(Buffer.from("sadiqyusuf")), false);
  }
});
