// Backend hardening regressions: structured CLI output, stable error codes, run
// history and integrity, concurrency, infrastructure retry, fix-limit tamper
// resistance, public redaction, publish preconditions and host safety.
// Every external effect is mocked; a booby-trapped kane-cli on PATH must never run.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod, symlink, unlink } from "node:fs/promises";
import { main, EXIT, ERRORS, CLI_RESULT_SCHEMA } from "../../src/cli/main.js";
import { writeGenerated, loadProject, approveRelayed, approve } from "../../src/spec/index.js";
import { runStopHook, acquireLock, deriveFixAttempts, loadState, VERIFY_LOCK_FILE } from "../../src/hook/index.js";
import { listRuns, checkRun } from "../../src/runs/history.js";
import { verifyRunRecord } from "../../src/evidence/collect.js";
import { redactPublicText, toPublicReport } from "../../src/report/index.js";
import { isLocalOrPrivateHost, assertPublicHost, isPrivateIp, endpointFor, verifyLiveDeployment } from "../../src/deploy/index.js";
import { parseSpec } from "../../src/spec/schema.js";
import { fabricatedRun } from "../verify/helpers.js";
import { zipOf } from "../report/zip-helper.js";

const E2E = readFileSync(new URL("../fixtures/spec/e2e/greenlight.yaml", import.meta.url), "utf8");
const FILES = ["cart-add-two_test.md", "newsletter-subscribe_test.md"];
const COMMIT = "dc6150b46a46a85efb4255113f0eddc5370621c8";
const PREVIEW = "https://gl-test-93mjujacr-timeb7208-5361s-projects.vercel.app/";
const EXEC_ID = "0a1b2c3d-0000-4000-8000-000000000003";
const HUMAN = { PATH: process.env.PATH, HOME: process.env.HOME };
const RELAY = { ...HUMAN, GREENLIGHT_RELAYED_APPROVAL: "1" };

const realFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error("real network request attempted");
};
const temps = [];
const trap = await mkdtemp(path.join(os.tmpdir(), "gl-backend-trap-"));
temps.push(trap);
const MARKER = path.join(trap, "KANE_WAS_RUN");
await writeFile(path.join(trap, "kane-cli"), `#!/bin/sh\necho "$@" >> "${MARKER}"\nexit 2\n`);
await chmod(path.join(trap, "kane-cli"), 0o755);
const savedPath = process.env.PATH;
process.env.PATH = `${trap}${path.delimiter}${savedPath}`;
after(async () => {
  globalThis.fetch = realFetch;
  process.env.PATH = savedPath;
  assert.equal(existsSync(MARKER), false, "a real kane-cli was executed");
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

function sink() {
  const s = new PassThrough();
  let t = "";
  s.on("data", (c) => (t += c));
  return { s, t: () => t };
}

async function project({ approval = "relayed" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "gl-backend-"));
  temps.push(root);
  await writeFile(path.join(root, "greenlight.yaml"), E2E);
  await writeGenerated(root);
  const hash = (await loadProject(root)).hash;
  if (approval === "relayed") assert.equal((await approveRelayed({ root, env: RELAY, hash })).approved, true);
  if (approval === "human") {
    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.end(`${hash.slice(0, 12)}\n`);
    const stdout = new PassThrough();
    stdout.isTTY = true;
    stdout.resume();
    assert.equal((await approve({ root, env: HUMAN, stdin, stdout, approver: () => "dev" })).approved, true);
  }
  return { root, hash };
}

/** Fake Kane. `script` gives each call's outcome: "pass" | "fail" | "infra" | "abort". */
function fakeKane(calls, script = ["fail"]) {
  return async (opts) => {
    const n = calls.filter((c) => c.name === "runKane").length;
    calls.push({ name: "runKane", opts });
    const kind = script[Math.min(n, script.length - 1)];
    const store = path.join(opts.cwd, ".testmuai", "evidence");
    await mkdir(store, { recursive: true });
    await writeFile(path.join(store, `${EXEC_ID}.evidence`), zipOf({ "run.yaml": "status: finalized\n" }));
    const statuses = kind === "pass" ? ["passed", "passed"] : kind === "fail" ? ["passed", "failed"] : ["broken", "broken"];
    const run = fabricatedRun({
      members: FILES.map((file, i) => ({ file, tags: [`clm-00${i + 1}`], status: statuses[i], mode: "authored", message: "Final verification failed at /root/.testmuai/kaneai/sessions/x for dev@example.com" })),
      ...(kind === "infra" ? { exitCode: 2 } : {}),
    });
    run.stream.done.executionId = EXEC_ID;
    run.stream.summary.executionId = EXEC_ID;
    run.stream.summary.evidenceId = EXEC_ID;
    return { ...run, stdout: "{}\n", stderr: "", aborted: kind === "abort" };
  };
}

function deps(calls, { script, balances = [11076.5779, 10999.9376, 10999.9376, 10923.2973] } = {}) {
  const b = [...balances];
  return {
    verifyDeployment: async (o) => (calls.push({ name: "verifyDeployment" }), { state: "ready", reasons: [], safeToRunKane: true, url: PREVIEW, deployedCommit: COMMIT, expectedCommit: COMMIT, environment: "preview" }),
    readBalance: async () => (calls.push({ name: "readBalance" }), { ok: true, balance: b.length > 1 ? b.shift() : b[0] }),
    runKane: fakeKane(calls, script),
    validator: async () => ({ exitCode: 0, stdout: '{"valid":true,"status":"finalized","diagnostics":[]}', stderr: "" }),
    now: (() => {
      let t = Date.parse("2026-11-19T12:00:00.000Z");
      return () => new Date((t += 1000));
    })(),
  };
}

async function cli(argv, { root, env = RELAY, d, signal } = {}) {
  const out = sink();
  const err = sink();
  const stdin = new PassThrough();
  stdin.end();
  const code = await main(argv, { cwd: root, env, stdin, stdout: out.s, stderr: err.s, deps: d, signal });
  return { code, out: out.t(), err: err.t(), json: argv.includes("--json") ? JSON.parse(out.t()) : null };
}
const kaneRuns = (calls) => calls.filter((c) => c.name === "runKane").length;

// ---------------------------------------------------------------- structured output and error codes

test("--json: one cli-result document on stdout, human lines on stderr, stable error codes", async () => {
  const { root, hash } = await project();
  const s = await cli(["status", "--json"], { root });
  assert.equal(s.code, EXIT.OK, s.err);
  assert.equal(s.json.schema, CLI_RESULT_SCHEMA);
  assert.deepEqual([s.json.command, s.json.ok, s.json.exitCode, s.json.error], ["status", true, 0, null]);
  assert.equal(s.json.data.spec.hash, hash);
  assert.deepEqual([s.json.data.approval.status, s.json.data.approval.method, s.json.data.approval.certifiable], ["approved", "relayed-by-agent", false]);
  assert.equal(s.json.data.recordings.status, "no_baseline");
  assert.equal(s.json.data.kane.retainsAuthoredRecordingsLocally, false);
  assert.match(s.err, /Specification: valid/, "human output still available on stderr");

  const blocked = await cli(["verify", "--json", "--url", PREVIEW], { root });
  assert.equal(blocked.code, EXIT.BLOCKED);
  assert.equal(blocked.json.error.code, "relayed_confirm_spend_required");
  assert.ok(blocked.json.error.action);

  const usage = await cli(["verify", "--json", "--nope"], { root });
  assert.deepEqual([usage.code, usage.json.error.code], [EXIT.USAGE, "usage_error"]);

  const empty = await mkdtemp(path.join(os.tmpdir(), "gl-empty-"));
  temps.push(empty);
  const missing = await cli(["generate", "--json"], { root: empty });
  assert.equal(missing.json.error.code, "spec_not_found");
  // Every code declares its exit code, HTTP status and next action.
  for (const [code, spec] of Object.entries(ERRORS)) assert.ok(Number.isInteger(spec.exit) && Number.isInteger(spec.http) && spec.action, code);
});

test("--json verify: run id, attempts, claims, evidence hashes, credits and warnings", async () => {
  const { root } = await project();
  const calls = [];
  const r = await cli(["verify", "--json", "--url", PREVIEW, "--confirm-spend", "100"], { root, d: deps(calls) });
  assert.equal(r.code, EXIT.FAILED, r.err);
  const d = r.json.data;
  assert.equal(d.status, "failed");
  assert.equal(d.runKind, "iteration");
  assert.equal(d.certifiable, false);
  assert.deepEqual(d.claims, [{ id: "CLM-001", status: "passed" }, { id: "CLM-002", status: "failed" }]);
  assert.equal(d.attempts.length, 1);
  assert.match(d.evidence.sha256, /^[0-9a-f]{64}$/);
  assert.equal(d.credits.actualSpend, 76.6403);
  assert.deepEqual(d.warnings.map((w) => w.code), ["recording_not_retained"]);
});

// ---------------------------------------------------------------- run history and integrity

test("runs and check-run: history is listed, tampering with a record or its evidence is detected", async () => {
  const { root } = await project();
  const calls = [];
  await cli(["verify", "--url", PREVIEW, "--confirm-spend", "100"], { root, d: deps(calls) });
  const runs = await cli(["runs", "--json"], { root });
  assert.equal(runs.code, EXIT.OK, runs.err);
  const [r] = runs.json.data.runs;
  assert.deepEqual([r.status, r.runKind, r.certification, r.integrity.ok], ["failed", "iteration", false, true]);
  assert.equal(r.credits.actualSpend, 76.6403);
  assert.ok(!JSON.stringify(r).includes(root), "summaries carry no local paths");

  assert.equal((await cli(["check-run", r.runId], { root })).code, EXIT.OK);
  const manifestFile = path.join(root, ".greenlight", "runs", r.runId, "manifest.json");
  const m = JSON.parse(await readFile(manifestFile, "utf8"));
  m.result.project = "passed";
  await writeFile(manifestFile, JSON.stringify(m));
  const bad = await cli(["check-run", r.runId, "--json"], { root });
  assert.deepEqual([bad.code, bad.json.error.code], [EXIT.COULDNT_VERIFY, "run_record_invalid"]);
  assert.ok(bad.json.data.problems.includes("record_hash_mismatch"));
  assert.equal((await cli(["runs"], { root })).code, EXIT.COULDNT_VERIFY);

  assert.equal((await cli(["check-run", "../../etc", "--json"], { root })).json.error.code, "run_not_found", "no path traversal through run ids");
  assert.equal((await cli(["check-run", "gl-nope", "--json"], { root })).json.error.code, "run_not_found");
});

test("verifyRunRecord: malformed manifests and symlinked evidence are reported, never followed", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gl-record-"));
  temps.push(dir);
  await writeFile(path.join(dir, "manifest.json"), "null");
  assert.deepEqual((await verifyRunRecord(dir)).problems, ["manifest_unreadable"]);
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ schema: "greenlight.run-manifest/v1" }));
  const v = await verifyRunRecord(dir);
  assert.equal(v.ok, false);
  assert.ok(v.problems.includes("stdout_reference_invalid"));
  const outside = path.join(dir, "..", `outside-${path.basename(dir)}`);
  await writeFile(outside, "x");
  temps.push(outside);
  await symlink(outside, path.join(dir, "kane-stdout.ndjson"));
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ schema: "greenlight.run-manifest/v1", outputs: { stdout: { file: "kane-stdout.ndjson", sha256: "a".repeat(64) }, stderr: { file: "/etc/passwd", sha256: "b".repeat(64) } } }));
  const p = (await verifyRunRecord(dir)).problems;
  assert.ok(p.includes("stdout_not_a_file"), p.join(","));
  assert.ok(p.includes("stderr_reference_invalid"), p.join(","));
});

// ---------------------------------------------------------------- concurrency

test("two verifications cannot run at once: the second is refused before Kane or credits", async () => {
  const { root } = await project();
  const lock = await acquireLock(root, { file: VERIFY_LOCK_FILE });
  assert.equal(lock.acquired, true);
  const calls = [];
  const r = await cli(["verify", "--json", "--url", PREVIEW, "--confirm-spend", "100"], { root, d: deps(calls) });
  assert.deepEqual([r.code, r.json.error.code], [EXIT.BLOCKED, "verify_already_running"]);
  assert.deepEqual(calls, [], "no deployment check, balance read or Kane");
  await lock.release();
  const ok = await cli(["verify", "--url", PREVIEW, "--confirm-spend", "100"], { root, d: deps(calls) });
  assert.equal(ok.code, EXIT.FAILED);
  assert.equal(existsSync(path.join(root, VERIFY_LOCK_FILE)), false, "released after the run");
});

test("stale lock takeover is atomic: of many contenders exactly one wins", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gl-lock-"));
  temps.push(dir);
  await mkdir(path.join(dir, ".greenlight"), { recursive: true });
  await writeFile(path.join(dir, ".greenlight", "hook.lock"), JSON.stringify({ pid: 999999999, at: "2020-01-01T00:00:00.000Z" }));
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => acquireLock(dir, { pid: 1000 + i, isAlive: (pid) => pid !== 999999999 })));
  assert.equal(results.filter((r) => r.acquired).length, 1);
  const leftovers = (await readdir(path.join(dir, ".greenlight"))).filter((f) => f.includes(".stale-"));
  assert.deepEqual(leftovers, []);
});

// ---------------------------------------------------------------- infrastructure retry

test("infrastructure failure: retried exactly once, both attempts recorded; a second failure stays couldnt_verify", async () => {
  const { root } = await project();
  const calls = [];
  const r = await cli(["verify", "--json", "--url", PREVIEW, "--confirm-spend", "200"], { root, d: deps(calls, { script: ["infra", "infra"] }) });
  assert.equal(r.code, EXIT.COULDNT_VERIFY, r.err);
  assert.equal(kaneRuns(calls), 2, "one retry, never more");
  assert.equal(r.json.data.attempts.length, 2);
  assert.match(r.out + r.err, /retrying once/);
  const runs = await listRuns(root);
  assert.deepEqual(runs.map((x) => [x.attempt, x.status]), [[1, "couldnt_verify"], [2, "couldnt_verify"]]);
  assert.equal(runs[1].previousRunId, runs[0].runId);
});

test("infrastructure failure then pass: the retry's result is reported", async () => {
  const { root } = await project();
  const calls = [];
  const r = await cli(["verify", "--json", "--url", PREVIEW, "--confirm-spend", "200"], { root, d: deps(calls, { script: ["infra", "pass"] }) });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.equal(r.json.data.status, "passed");
  assert.equal(r.json.data.totalActualSpend, 153.2806);
});

test("the retry must fit the confirmed spend: with too little left it is not run", async () => {
  const { root } = await project();
  const calls = [];
  const r = await cli(["verify", "--json", "--url", PREVIEW, "--confirm-spend", "100"], { root, d: deps(calls, { script: ["infra", "pass"] }) });
  assert.equal(kaneRuns(calls), 1, "76.64 spent of 100: a 94-credit retry is refused before Kane");
  assert.equal(r.code, EXIT.COULDNT_VERIFY);
  assert.equal(r.json.data.status, "couldnt_verify");
  assert.match(r.err, /retry was not run/);
});

test("no retry for app failures or interruptions", async () => {
  for (const [script, code] of [[["fail"], EXIT.FAILED], [["abort"], EXIT.INTERRUPTED]]) {
    const { root } = await project();
    const calls = [];
    const r = await cli(["verify", "--url", PREVIEW, "--confirm-spend", "300"], { root, d: deps(calls, { script }) });
    assert.equal(r.code, code, r.err);
    assert.equal(kaneRuns(calls), 1, script[0]);
  }
});

// ---------------------------------------------------------------- fix limit tamper resistance

async function fakeRun(root, { runId, at, project: status, commit, hash }) {
  const dir = path.join(root, ".greenlight", "runs", runId);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "manifest.json"), JSON.stringify({ schema: "greenlight.run-manifest/v1", runId, createdAt: at, approvedTestHash: hash, deployedCommit: commit, result: { project: status } }));
}

test("deleting state.json cannot reset the three-attempt limit: run records are counted", async () => {
  const { root, hash } = await project();
  const c = (n) => String(n).repeat(40);
  for (let i = 1; i <= 4; i++) await fakeRun(root, { runId: `gl-${i}`, at: `2026-11-19T12:0${i}:00.000Z`, project: "failed", commit: c(i), hash });
  assert.equal((await deriveFixAttempts(root, { approvedHash: hash })).failedCommits, 4);
  assert.equal((await deriveFixAttempts(root, { approvedHash: "0".repeat(64) })).failedCommits, 0, "other approvals do not count");
  await fakeRun(root, { runId: "gl-0", at: "2026-11-19T11:00:00.000Z", project: "passed", commit: c(9), hash });
  assert.equal((await deriveFixAttempts(root, { approvedHash: hash })).failedCommits, 4, "a pass BEFORE the streak does not reset it");
  assert.equal((await deriveFixAttempts(root, { approvedHash: hash, since: "2026-11-19T12:02:30.000Z" })).failedCommits, 2, "a human reset does");

  // The hook: no state file at all, yet 4 failed commits on record -> a person is needed.
  const git = async (args) => {
    const k = args.join(" ");
    if (k.startsWith("status")) return { code: 0, stdout: "" };
    if (k === "rev-parse HEAD" || k === "rev-parse @{u}") return { code: 0, stdout: `${c(5)}\n` };
    if (k.startsWith("symbolic-ref")) return { code: 0, stdout: "main\n" };
    if (k.startsWith("rev-parse --abbrev-ref")) return { code: 0, stdout: "origin/main\n" };
    throw new Error(k);
  };
  let verified = 0;
  const out = await runStopHook({ input: { hook_event_name: "Stop" }, cwd: root, runGit: git, env: RELAY, runVerify: async () => (verified++, { exitCode: 0, stdout: "", stderr: "" }) });
  assert.deepEqual([out.exitCode, out.decision], [1, "human_needed"]);
  assert.equal(verified, 0);
  assert.equal((await loadState(root)).state.humanNeeded, true);
});

test("three failed commits still allow the third fix to be verified", async () => {
  const { root, hash } = await project();
  const c = (n) => String(n).repeat(40);
  for (let i = 1; i <= 3; i++) await fakeRun(root, { runId: `gl-${i}`, at: `2026-11-19T12:0${i}:00.000Z`, project: "failed", commit: c(i), hash });
  const git = async (args) => {
    const k = args.join(" ");
    if (k.startsWith("status")) return { code: 0, stdout: "" };
    if (k === "rev-parse HEAD" || k === "rev-parse @{u}") return { code: 0, stdout: `${c(4)}\n` };
    if (k.startsWith("symbolic-ref")) return { code: 0, stdout: "main\n" };
    if (k.startsWith("rev-parse --abbrev-ref")) return { code: 0, stdout: "origin/main\n" };
    throw new Error(k);
  };
  let verified = 0;
  const out = await runStopHook({ input: { hook_event_name: "Stop" }, cwd: root, runGit: git, env: RELAY, runVerify: async () => (verified++, { exitCode: 0, stdout: "", stderr: "" }) });
  assert.equal(verified, 1);
  assert.equal(out.decision, "verified");
});

// ---------------------------------------------------------------- public redaction

test("public outputs drop local paths, emails and credit balances", async () => {
  assert.equal(redactPublicText("pack at /root/.testmuai/x.evidence and /tmp/claude-0/a/b, C:\\Users\\dev\\x"), "pack at <local-path> and <local-path>, <local-path>");
  assert.equal(redactPublicText("account dev@example.com"), "account REDACTED_EMAIL");
  assert.equal(redactPublicText("https://app.example.com/a?x-vercel-protection-bypass=s3cr3t"), "https://app.example.com/a?REDACTED");
  const { root } = await project();
  const calls = [];
  await cli(["verify", "--url", PREVIEW, "--confirm-spend", "100"], { root, d: deps(calls) });
  const pub = await readFile(path.join(root, ".greenlight", "reports", "latest.public.json"), "utf8");
  for (const leak of ["/root/", "dev@example.com", root, "balanceBefore", "balanceAfter", "packPath", "sessionLog"]) assert.ok(!pub.includes(leak), `public report leaks ${leak}`);
  assert.equal(toPublicReport(null), null);
  const priv = JSON.parse(await readFile(path.join(root, ".greenlight", "reports", "latest.json"), "utf8"));
  assert.equal(priv.certification, false, "iteration reports are never certifications");
  assert.equal(priv.runKind, "iteration");
});

// ---------------------------------------------------------------- publish preconditions

test("publish: refused for agents, without a server, and for relayed approvals; never certifies locally", async () => {
  const { root } = await project();
  const agent = await cli(["publish", "--json", "--project", "prj_x", "--version", "1", "--confirm-spend", "100"], { root, env: { ...RELAY, CLAUDECODE: "1" } });
  assert.deepEqual([agent.code, agent.json.error.code], [EXIT.BLOCKED, "forbidden"]);
  const noServer = await cli(["publish", "--json", "--project", "prj_x", "--version", "1", "--confirm-spend", "100"], { root, env: HUMAN });
  assert.equal(noServer.json.error.code, "server_not_configured");
  const relayed = await cli(["publish", "--json", "--project", "prj_x", "--version", "1", "--confirm-spend", "100"], { root, env: { ...HUMAN, GREENLIGHT_API_URL: "https://gl.example.com", GREENLIGHT_API_TOKEN: "t".repeat(20) } });
  assert.deepEqual([relayed.code, relayed.json.error.code], [EXIT.BLOCKED, "approval_not_certifiable"]);
});

test("publish: the server's approved version must be exactly the local approved tests", async () => {
  const { root } = await project({ approval: "human" });
  const fetched = [];
  const git = async (args) => {
    const k = args.join(" ");
    if (k.startsWith("status")) return { code: 0, stdout: "" };
    if (k === "rev-parse HEAD" || k === "rev-parse @{u}") return { code: 0, stdout: `${COMMIT}\n` };
    if (k.startsWith("symbolic-ref")) return { code: 0, stdout: "main\n" };
    if (k.startsWith("rev-parse --abbrev-ref")) return { code: 0, stdout: "origin/main\n" };
    throw new Error(k);
  };
  const d = {
    runGit: git,
    fetch: async (url, init) => {
      fetched.push([init.method, url]);
      return { ok: true, status: 200, json: async () => ({ status: "approved", approvedTestHash: "0".repeat(64) }) };
    },
  };
  const r = await cli(["publish", "--json", "--project", "prj_x", "--version", "1", "--confirm-spend", "100"], { root, env: { ...HUMAN, GREENLIGHT_API_URL: "https://gl.example.com", GREENLIGHT_API_TOKEN: "t".repeat(20) }, d });
  assert.equal(r.json.error.code, "approval_hash_mismatch");
  assert.deepEqual(fetched.map((f) => f[0]), ["GET"], "no certification is requested");
});

// ---------------------------------------------------------------- host safety

test("host safety: loopback, private, link-local, reserved and local names are never verified", async () => {
  for (const h of ["localhost", "127.0.0.1", "127.8.8.8", "0.0.0.0", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "[::1]", "::", "[::ffff:127.0.0.1]", "[::ffff:7f00:1]", "fd00::1", "fe80::1", "app.local", "x.internal", "printer", "0x7f.1", "app.localhost"]) {
    assert.equal(isLocalOrPrivateHost(h), true, h);
  }
  for (const h of ["gl-test-93mjujacr-timeb7208-5361s-projects.vercel.app", "example.com", "8.8.8.8", "[2606:4700::1111]"]) assert.equal(isLocalOrPrivateHost(h), false, h);
  assert.equal(isPrivateIp("172.32.0.1"), false);
  assert.deepEqual(await assertPublicHost("rebind.example.com", { lookup: async () => [{ address: "93.184.216.34" }, { address: "127.0.0.1" }] }), { ok: false, reason: "host_resolves_to_private_address" });
  assert.equal((await assertPublicHost("ok.example.com", { lookup: async () => [{ address: "93.184.216.34" }] })).ok, true);
  assert.equal((await assertPublicHost("gone.example.com", { lookup: async () => { throw new Error("ENOTFOUND"); } })).reason, "host_unresolvable");
  assert.equal(endpointFor("http://169.254.169.254/").ok, false);
  assert.throws(() => parseSpec(E2E.replace("https://gl-test-93mjujacr-timeb7208-5361s-projects.vercel.app/", "http://10.0.0.8/")), /private/);
  assert.throws(() => parseSpec(E2E.replace("text: Users can add items to the cart.", "text: Users can add items --> # injected")), /-->/);
});

test("server-side deployment check: DNS is checked before any request, and the commit must match", async () => {
  let fetched = 0;
  const fetchImpl = async () => (fetched++, new Response(JSON.stringify({ commit: COMMIT, environment: "preview" }), { status: 200 }));
  const refused = await verifyLiveDeployment({ url: "https://rebind.example.com/", expectedCommit: COMMIT, fetchImpl, checkHost: async () => ({ ok: false, reason: "host_resolves_to_private_address" }) });
  assert.deepEqual([refused.state, refused.reasons, fetched], ["couldnt_verify", ["host_resolves_to_private_address"], 0]);
  const ok = await verifyLiveDeployment({ url: "https://app.example.com/", expectedCommit: COMMIT, fetchImpl, checkHost: async () => ({ ok: true }) });
  assert.equal(ok.state, "ready");
  const stale = await verifyLiveDeployment({ url: "https://app.example.com/", expectedCommit: "1".repeat(40), fetchImpl, checkHost: async () => ({ ok: true }), timeoutMs: 0 });
  assert.equal(stale.state, "stale_deployment");
});

test("generated tests are never written through a symlink", async () => {
  const { root } = await project();
  const target = path.join(root, "victim.txt");
  await writeFile(target, "keep me");
  const file = path.join(root, ".greenlight", "tests", "cart-add-two_test.md");
  await unlink(file);
  await symlink(target, file);
  const r = await cli(["generate", "--json"], { root });
  assert.equal(r.json.error.code, "internal_error");
  assert.match(r.json.error.message, /symbolic link/);
  assert.equal(await readFile(target, "utf8"), "keep me");
});
