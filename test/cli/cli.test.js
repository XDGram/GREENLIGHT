// CLI tests. Every external effect is mocked through `deps`: Kane, the credit
// balance, the evidence validator and the deployment check. Real network access
// is blocked, and a booby-trapped kane-cli on PATH proves Kane never runs.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main, parseArgs, EXIT, UsageError } from "../../src/cli/main.js";
import { writeGenerated, approve } from "../../src/spec/index.js";
import { fabricatedRun } from "../verify/helpers.js";
import { zipOf } from "../report/zip-helper.js";

const SAMPLE = readFileSync(new URL("../fixtures/spec/smoke/greenlight.yaml", import.meta.url), "utf8");
const SAMPLE_HASH = "07bc6327dd53f62ecf79d8312c30342786a1bdac8211d71786a46a72fcc139d0";
const BIN = fileURLToPath(new URL("../../bin/greenlight.js", import.meta.url));
const PREVIEW = "https://gl-test-93mjujacr-timeb7208-5361s-projects.vercel.app/";
const COMMIT = "dc6150b46a46a85efb4255113f0eddc5370621c8";
const FILES = ["cart-add-two_test.md", "cart-then-about_test.md", "newsletter-subscribe_test.md"];
const EXEC_ID = "0a1b2c3d-0000-4000-8000-000000000001";
const HUMAN = { PATH: process.env.PATH, HOME: process.env.HOME };

// Guards: no real network, and any real kane-cli launch is detected.
const realFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error("real network request attempted in a CLI test");
};
const temps = [];
const trapDir = await mkdtemp(path.join(os.tmpdir(), "gl-cli-trap-"));
temps.push(trapDir);
const KANE_MARKER = path.join(trapDir, "KANE_WAS_RUN");
await writeFile(path.join(trapDir, "kane-cli"), `#!/bin/sh\necho "$@" >> "${KANE_MARKER}"\nexit 2\n`);
await chmod(path.join(trapDir, "kane-cli"), 0o755);
const savedPath = process.env.PATH;
process.env.PATH = `${trapDir}${path.delimiter}${savedPath}`;
after(async () => {
  globalThis.fetch = realFetch;
  process.env.PATH = savedPath;
  assert.equal(existsSync(KANE_MARKER), false, "a real kane-cli was executed during the CLI tests");
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

// ---------------------------------------------------------------- helpers

function sink() {
  const s = new PassThrough();
  let text = "";
  s.on("data", (c) => (text += c));
  return { stream: s, text: () => text };
}
function terminal(answer) {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  if (answer === undefined) stdin.end();
  else stdin.end(`${answer}\n`);
  const out = sink();
  out.stream.isTTY = true;
  return { stdin, out };
}

async function newProject({ spec = SAMPLE, generate = true, approved = true, recordings = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "gl-cli-"));
  temps.push(root);
  if (spec !== null) await writeFile(path.join(root, "greenlight.yaml"), spec);
  if (generate) await writeGenerated(root);
  if (approved) {
    const t = terminal(SAMPLE_HASH.slice(0, 12));
    const r = await approve({ root, env: HUMAN, stdin: t.stdin, stdout: t.out.stream, approver: () => "dev" });
    assert.equal(r.approved, true);
  }
  if (recordings) {
    for (const f of FILES) {
      const dir = path.join(root, ".greenlight", "tests", `output-${f.replace(/_test\.md$/, "")}`, ".internal");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "execution.json"), "{}");
    }
  }
  return root;
}

/** Fake Kane: writes an evidence pack and returns a run result for the given statuses. */
function fakeKane(calls, statuses = { "cart-add-two_test.md": "passed", "cart-then-about_test.md": "passed", "newsletter-subscribe_test.md": "failed" }, extra = {}) {
  return async (opts) => {
    calls.push({ name: "runKane", opts });
    const store = path.join(opts.cwd, ".testmuai", "evidence");
    await mkdir(store, { recursive: true });
    await writeFile(path.join(store, `${EXEC_ID}.evidence`), zipOf({ "run.yaml": "status: finalized\n" }));
    const tags = { "cart-add-two_test.md": ["clm-001"], "cart-then-about_test.md": ["clm-001", "clm-003"], "newsletter-subscribe_test.md": ["clm-002"] };
    const run = fabricatedRun({ members: FILES.map((f) => ({ file: f, tags: tags[f], status: statuses[f], mode: "replay" })) });
    for (const m of run.stream.members) {
      if (m.final?.failure) {
        m.final.failure.step_index = 3;
        m.attempts.at(-1).end.failure.step_index = 3;
      }
    }
    run.stream.done.executionId = EXEC_ID;
    run.stream.summary.executionId = EXEC_ID;
    run.stream.summary.evidenceId = EXEC_ID;
    return { ...run, stdout: "{}\n", stderr: "", startedAt: "2026-11-19T12:00:00Z", endedAt: "2026-11-19T12:01:00Z", aborted: false, ...extra };
  };
}

const READY = { state: "ready", reasons: [], safeToRunKane: true, url: PREVIEW, deployedCommit: COMMIT, expectedCommit: COMMIT, environment: "preview" };

function deps(calls, over = {}) {
  let balance = 11076.5779;
  return {
    verifyDeployment: async (o) => (calls.push({ name: "verifyDeployment", opts: o }), READY),
    readBalance: async () => (calls.push({ name: "readBalance" }), { ok: true, balance }),
    runKane: fakeKane(calls),
    validator: async () => ({ exitCode: 0, stdout: '{"valid":true,"status":"finalized","diagnostics":[]}', stderr: "" }),
    now: () => new Date("2026-11-19T12:00:00.000Z"),
    ...over,
  };
}

/** Non-interactive stdin/stdout, as under Claude Code or CI. */
function piped() {
  const stdin = new PassThrough();
  stdin.end();
  return { stdin, out: null };
}

async function cli(argv, { root, d, stdin, env = HUMAN, signal } = {}) {
  const out = sink();
  const err = sink();
  const t = stdin ?? piped();
  const code = await main(argv, { cwd: root, env, stdin: t.stdin, stdout: t.out?.stream?.isTTY ? t.out.stream : out.stream, stderr: err.stream, deps: d, signal });
  const stdoutText = t.out?.stream?.isTTY ? t.out.text() : out.text();
  return { code, out: stdoutText, err: err.text() };
}
const kaneCalled = (calls) => calls.some((c) => c.name === "runKane");

// ---------------------------------------------------------------- arguments

test("argument parsing: commands, options, values and errors", () => {
  assert.deepEqual(parseArgs(["verify", "--url", PREVIEW, "--max-credits=10"]), { command: "verify", options: { url: PREVIEW, "max-credits": 10 } });
  assert.throws(() => parseArgs(["deploy"]), UsageError);
  assert.throws(() => parseArgs(["verify", "--yes"]), /unknown option/);
  assert.throws(() => parseArgs(["init", "--url", "x"]), /unknown option/);
  assert.throws(() => parseArgs(["verify", "--url"]), /needs a value/);
  assert.throws(() => parseArgs(["verify", "--max-credits", "lots"]), /non-negative number/);
  assert.throws(() => parseArgs(["verify", "--reserve", "-5"]), /needs a value|non-negative/);
});

test("usage errors exit 2; help exits 0", async () => {
  const root = await newProject({ spec: null, generate: false, approved: false });
  assert.equal((await cli(["bogus"], { root })).code, EXIT.USAGE);
  assert.equal((await cli([], { root })).code, EXIT.USAGE);
  const h = await cli(["--help"], { root });
  assert.equal(h.code, EXIT.OK);
  assert.match(h.out, /Exit codes: 0 passed · 1 app failures · 2 usage · 3 could not verify · 4 blocked · 130 interrupted/);
  const v = await cli(["verify", "--frobnicate"], { root });
  assert.equal(v.code, EXIT.USAGE);
  assert.match(v.err, /unknown option for verify: --frobnicate/);
});

// ---------------------------------------------------------------- init / generate / status

test("init creates a valid starter spec and never overwrites", async () => {
  const root = await newProject({ spec: null, generate: false, approved: false });
  const r = await cli(["init"], { root });
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out, /Created greenlight\.yaml/);
  assert.match(r.out, /Every test needs an expect_text step/);
  const text = await readFile(path.join(root, "greenlight.yaml"), "utf8");
  await writeFile(path.join(root, "greenlight.yaml"), text + "# my edit\n");
  const again = await cli(["init"], { root });
  assert.equal(again.code, EXIT.BLOCKED);
  assert.match(again.err, /already exists; nothing was changed/);
  assert.match(await readFile(path.join(root, "greenlight.yaml"), "utf8"), /# my edit\n$/);
  const g = await cli(["generate"], { root });
  assert.equal(g.code, EXIT.OK, g.err);
  assert.match(g.out, /wrote {5}\.greenlight\/tests\/sign-in_test\.md {2}\[CLM-001\]/);
});

test("generate lists tests and the hash, and never approves", async () => {
  const root = await newProject({ generate: false, approved: false });
  const r = await cli(["generate"], { root });
  assert.equal(r.code, EXIT.OK);
  for (const f of FILES) assert.match(r.out, new RegExp(`wrote {5}\\.greenlight/tests/${f}`));
  assert.match(r.out, /\[CLM-001, CLM-003\]/);
  assert.match(r.out, new RegExp(`Specification hash: ${SAMPLE_HASH}`));
  assert.match(r.out, /Not approved\./);
  assert.equal(existsSync(path.join(root, ".greenlight", "approval.json")), false);
  assert.match((await cli(["generate"], { root })).out, /unchanged/);
});

test("missing or invalid configuration is reported with exit 4", async () => {
  const none = await newProject({ spec: null, generate: false, approved: false });
  for (const cmd of ["generate", "status", "verify"]) {
    const r = await cli([cmd], { root: none, d: deps([]) });
    assert.equal(r.code, EXIT.BLOCKED, cmd);
    assert.match(r.err + r.out, /not found|INVALID|invalid/i, cmd);
  }
  const bad = await newProject({ spec: "version: 1\nproject: {a: 1}\n", generate: false, approved: false });
  const g = await cli(["generate"], { root: bad });
  assert.equal(g.code, EXIT.BLOCKED);
  assert.match(g.err, /flow mappings/);
});

test("status shows spec, approval, hash integrity, generated tests and recording cache", async () => {
  const root = await newProject();
  let r = await cli(["status"], { root });
  assert.equal(r.code, EXIT.OK);
  assert.match(r.out, /Specification: valid/);
  assert.match(r.out, /Approval: approved/);
  assert.match(r.out, /approved hash: 07bc.*\(matches\)/);
  assert.match(r.out, /ok {7}cart-then-about_test\.md {2}\[CLM-001, CLM-003\]/);
  assert.match(r.out, /Recording cache: no_baseline/);

  await writeFile(path.join(root, ".greenlight", "tests", "cart-add-two_test.md"), "edited");
  r = await cli(["status"], { root });
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.out, /Approval: invalidated/);
  assert.match(r.out, /MODIFIED cart-add-two_test\.md/);

  const unapproved = await newProject({ approved: false });
  r = await cli(["status"], { root: unapproved });
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.out, /Approval: not_approved/);
  assert.match(r.out, /Recording cache: n\/a/);
});

// ---------------------------------------------------------------- approve

test("approve keeps every restriction: agent env, non-interactive, wrong answer", async () => {
  const root = await newProject({ approved: false });
  const agent = await cli(["approve"], { root, env: { ...HUMAN, CLAUDECODE: "1" }, stdin: terminal(SAMPLE_HASH.slice(0, 12)) });
  assert.equal(agent.code, EXIT.BLOCKED);
  assert.match(agent.out, /looks like an AI agent or CI/);
  const piped = await cli(["approve"], { root });
  assert.equal(piped.code, EXIT.BLOCKED);
  assert.match(piped.out, /needs an interactive terminal/);
  assert.equal((await cli(["approve"], { root, stdin: terminal("nope") })).code, EXIT.BLOCKED);
  assert.equal(existsSync(path.join(root, ".greenlight", "approval.json")), false);
  const ok = await cli(["approve"], { root, stdin: terminal(SAMPLE_HASH.slice(0, 12)) });
  assert.equal(ok.code, EXIT.OK, ok.out);
});

test("the real binary refuses to approve from this agent's shell", async () => {
  const root = await newProject({ approved: false });
  const r = spawnSync(process.execPath, [BIN, "approve"], { cwd: root, env: { ...process.env, CLAUDECODE: "1" }, encoding: "utf8" });
  assert.equal(r.status, EXIT.BLOCKED);
  assert.match(r.stdout, /Approval refused/);
});

// ---------------------------------------------------------------- verify: gates

test("verify refuses unapproved or invalidated tests before anything else", async () => {
  for (const setup of [{ approved: false }, { approved: true }]) {
    const root = await newProject(setup);
    if (setup.approved) await writeFile(path.join(root, "greenlight.yaml"), SAMPLE.replace('"Items in cart: 2"', '"Items in cart: 9"'));
    const calls = [];
    const r = await cli(["verify"], { root, d: deps(calls) });
    assert.equal(r.code, EXIT.BLOCKED);
    assert.match(r.err, /Tests are not approved \((not_approved|invalidated)/);
    assert.deepEqual(calls, [], "no deployment check, balance read or Kane");
  }
});

test("verify never runs Kane against a stale or unverifiable deployment", async () => {
  for (const dep of [
    { state: "stale_deployment", reasons: ["commit_mismatch", "timed_out"], safeToRunKane: false, deployedCommit: "8f315c8a4da544f77af0e1df801cb07fbb597923", expectedCommit: COMMIT },
    { state: "couldnt_verify", reasons: ["dirty_working_tree"], safeToRunKane: false },
    { state: "ready", reasons: [], safeToRunKane: false }, // inconsistent: still refused
  ]) {
    const root = await newProject({ recordings: true });
    const calls = [];
    const r = await cli(["verify"], { root, d: deps(calls, { verifyDeployment: async () => dep }) });
    assert.equal(r.code, EXIT.COULDNT_VERIFY);
    assert.match(r.err, /Deployment not ready: .*Kane was not run/);
    assert.equal(kaneCalled(calls), false);
    assert.equal(calls.some((c) => c.name === "readBalance"), false, "no credit check either");
  }
});

test("verify passes the live URL and options to the deployment check, with the secret query redacted in output", async () => {
  const root = await newProject({ recordings: true });
  const calls = [];
  const url = `${PREVIEW}?x-vercel-protection-bypass=TOPSECRET42`;
  const r = await cli(["verify", "--url", url, "--environment", "preview", "--deploy-timeout-seconds", "5", "--deploy-interval-seconds", "1"], {
    root,
    d: deps(calls, { verifyDeployment: async (o) => (calls.push({ name: "verifyDeployment", opts: o }), { ...READY, url }) }),
  });
  const dc = calls.find((c) => c.name === "verifyDeployment").opts;
  assert.equal(dc.url, url, "the real URL is used for the check");
  assert.equal(dc.expectedEnvironment, "preview");
  assert.equal(dc.timeoutMs, 5000);
  assert.equal(dc.intervalMs, 1000);
  assert.equal(calls.find((c) => c.name === "runKane").opts.args.includes(url), true, "and for Kane's start URL");
  assert.equal((r.out + r.err).includes("TOPSECRET42"), false);
  assert.match(r.out, /Checking deployment https:\/\/gl-test-93mjujacr.*\/\?REDACTED/);
  const report = await readFile(path.join(root, ".greenlight", "reports", "latest.md"), "utf8");
  assert.equal(report.includes("TOPSECRET42"), false);
});

test("credit refusals: cap, reserve and unknown balance stop verify before Kane", async () => {
  const cases = [
    [[], { recordings: false }, {}, /exceeds_per_run_cap/], // 3 fresh recordings = 156 > default cap 60
    [["--reserve", "11076"], { recordings: true }, {}, /breaches_minimum_reserve/],
    [[], { recordings: true }, { readBalance: async () => ({ ok: false, balance: null, reason: "nonzero_exit" }) }, /balance_unavailable/],
  ];
  for (const [args, setup, over, re] of cases) {
    const root = await newProject(setup);
    const calls = [];
    const r = await cli(["verify", ...args], { root, d: deps(calls, over) });
    assert.equal(r.code, EXIT.BLOCKED);
    assert.match(r.err, re);
    assert.match(r.err, /Kane was not run/);
    assert.equal(kaneCalled(calls), false);
  }
});

test("fresh recording needs a person to type yes; agents and pipes cannot confirm", async () => {
  const run = async (opts) => {
    const root = await newProject({ recordings: false });
    const calls = [];
    const r = await cli(["verify", "--max-credits", "200"], { root, d: deps(calls), ...opts });
    return { r, calls };
  };
  let x = await run({});
  assert.equal(x.r.code, EXIT.BLOCKED);
  assert.match(x.r.err, /only come from a person at an interactive terminal \(not_interactive\)/);
  assert.equal(kaneCalled(x.calls), false);

  x = await run({ env: { ...HUMAN, CLAUDECODE: "1" }, stdin: terminal("yes") });
  assert.match(x.r.err, /agent_or_ci_environment/);
  assert.equal(kaneCalled(x.calls), false);

  x = await run({ stdin: terminal("no") });
  assert.match(x.r.err, /Not confirmed/);
  assert.equal(kaneCalled(x.calls), false);

  x = await run({ stdin: terminal("yes") });
  assert.match(x.r.out, /records 3 test\(s\) afresh and is estimated to use 156 credits/);
  assert.equal(kaneCalled(x.calls), true);
});

test("Kane runs only after every gate, in order, with the safe default flags", async () => {
  const root = await newProject({ recordings: true });
  const calls = [];
  const r = await cli(["verify"], { root, d: deps(calls) });
  assert.deepEqual(calls.map((c) => c.name), ["verifyDeployment", "readBalance", "runKane", "readBalance"]);
  const k = calls.find((c) => c.name === "runKane").opts;
  assert.deepEqual(k.args.slice(0, 2), ["testrun", "run"]);
  for (const f of FILES) assert.ok(k.args.includes(f));
  for (const flag of ["--agent", "--headless", "--no-adaptive-heal", "--local", "--override-start-url"]) assert.ok(k.args.includes(flag), flag);
  assert.equal(k.cwd, path.join(root, ".greenlight", "tests"));
  assert.equal(k.timeoutMs, 30 * 60_000);
  assert.ok(k.abortSignal, "Ctrl-C reaches Kane");
  assert.match(r.out, /Credits: estimate 14\.6 \(0 fresh recording\(s\), 0 known failing step\(s\)\)|Credits: estimate 0\.6/);
});

// ---------------------------------------------------------------- verify: outcomes

test("app failure: exit 1, failure report written, claims listed", async () => {
  const root = await newProject({ recordings: true });
  const r = await cli(["verify"], { root, d: deps([]) });
  assert.equal(r.code, EXIT.FAILED, r.err);
  assert.match(r.out, /failed {9}CLM-002/);
  assert.match(r.out, /passed {9}CLM-001/);
  assert.match(r.out, /## App failures: fix the application code/);
  assert.match(r.out, /Failed step 3 "Check the confirmation": page must show the exact text "Thanks for subscribing, smoke@example\.com!"/);
  assert.match(r.out, /Full report: \.greenlight\/reports\/latest\.md/);
  const report = JSON.parse(await readFile(path.join(root, ".greenlight", "reports", "latest.json"), "utf8"));
  assert.equal(report.kind, "app_failure");
  assert.ok(existsSync(path.join(root, ".greenlight", "runs")), "evidence record written");
  assert.match(r.out, /Evidence: stored/);
});

test("known failing step from the last report raises the next estimate", async () => {
  const root = await newProject({ recordings: true });
  await cli(["verify"], { root, d: deps([]) });
  const second = await cli(["verify"], { root, d: deps([]) });
  assert.match(second.out, /Credits: estimate 14\.6 \(0 fresh recording\(s\), 1 known failing step\(s\)\)/);
});

test("all claims pass: exit 0, a passing report with no failures records the run's credits", async () => {
  const root = await newProject({ recordings: true });
  const calls = [];
  const r = await cli(["verify"], { root, d: deps(calls, { runKane: fakeKane(calls, Object.fromEntries(FILES.map((f) => [f, "passed"]))) }) });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /Verified: all 3 claim\(s\) passed\./);
  const latest = JSON.parse(await readFile(path.join(root, ".greenlight", "reports", "latest.json"), "utf8"));
  assert.equal(latest.kind, "passed");
  assert.deepEqual(latest.failures, []);
  assert.equal(latest.project.status, "passed");
  assert.equal(latest.credits.actualSpendSource, "balance_difference");
  assert.deepEqual(latest.warnings, [], "replayed tests with recordings: nothing to warn about");
});

test("infrastructure failure inside Kane: exit 3 and a could-not-verify report", async () => {
  const root = await newProject({ recordings: true });
  const calls = [];
  const r = await cli(["verify"], { root, d: deps(calls, { runKane: fakeKane(calls, { "cart-add-two_test.md": "passed", "cart-then-about_test.md": "broken", "newsletter-subscribe_test.md": "passed" }) }) });
  assert.equal(r.code, EXIT.COULDNT_VERIFY);
  assert.match(r.out, /do not change application code/);
});

test("interrupt during the deployment wait: exit 130, Kane never starts", async () => {
  const root = await newProject({ recordings: true });
  const calls = [];
  const ac = new AbortController();
  const r = await cli(["verify"], {
    root,
    signal: ac.signal,
    d: deps(calls, { verifyDeployment: async () => (ac.abort(), READY) }),
  });
  assert.equal(r.code, EXIT.INTERRUPTED);
  assert.equal(kaneCalled(calls), false);
});

test("interrupt during Kane: exit 130 and the run is reported as untrusted", async () => {
  const root = await newProject({ recordings: true });
  const calls = [];
  const r = await cli(["verify"], { root, d: deps(calls, { runKane: fakeKane(calls, undefined, { aborted: true }) }) });
  assert.equal(r.code, EXIT.INTERRUPTED);
  assert.match(r.err, /Interrupted: Kane was stopped/);
});

test("a changed recording cache blocks verify before the deployment check", async () => {
  const root = await newProject({ recordings: true });
  await cli(["verify"], { root, d: deps([]) }); // records the baseline
  await writeFile(path.join(root, ".greenlight", "tests", "output-cart-add-two", ".internal", "execution.json"), '{"healed":true}');
  const calls = [];
  const r = await cli(["verify"], { root, d: deps(calls) });
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.err, /Recording cache changed: output-cart-add-two\/\.internal\/execution\.json/);
  assert.deepEqual(calls, []);
});

test("unexpected errors are caught and reported, not thrown", async () => {
  const root = await newProject({ recordings: true });
  const r = await cli(["verify"], { root, d: deps([], { verifyDeployment: async () => { throw new Error("boom"); } }) });
  assert.equal(r.code, EXIT.COULDNT_VERIFY);
  assert.match(r.err, /greenlight: boom/);
});

test("the real binary end to end without mocks stops at the gates (no approval), touching nothing", async () => {
  const root = await newProject({ approved: false });
  const r = spawnSync(process.execPath, [BIN, "verify"], { cwd: root, env: HUMAN, encoding: "utf8" });
  assert.equal(r.status, EXIT.BLOCKED);
  assert.match(r.stderr, /Tests are not approved/);
});
