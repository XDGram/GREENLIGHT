// CLI relayed mode: `approve --relayed <hash>` and `verify --confirm-spend <n>`.
// Every external effect is mocked; real network is blocked and a booby-trapped
// kane-cli on PATH must never run.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, chmod } from "node:fs/promises";
import { main, EXIT } from "../../src/cli/main.js";
import { writeGenerated, loadProject, approve, approveRelayed } from "../../src/spec/index.js";
import { runStopHook, cliVerifier } from "../../src/hook/index.js";
import { fabricatedRun } from "../verify/helpers.js";
import { zipOf } from "../report/zip-helper.js";

const E2E = readFileSync(new URL("../fixtures/spec/e2e/greenlight.yaml", import.meta.url), "utf8");
const FILES = ["cart-add-two_test.md", "newsletter-subscribe_test.md"];
const COMMIT = "dc6150b46a46a85efb4255113f0eddc5370621c8";
const PREVIEW = "https://gl-test-93mjujacr-timeb7208-5361s-projects.vercel.app/";
const EXEC_ID = "0a1b2c3d-0000-4000-8000-000000000002";
const HUMAN = { PATH: process.env.PATH, HOME: process.env.HOME };
const RELAY = { ...HUMAN, GREENLIGHT_RELAYED_APPROVAL: "1" };

const realFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error("real network request attempted in a relayed-mode test");
};
const temps = [];
const trap = await mkdtemp(path.join(os.tmpdir(), "gl-relay-trap-"));
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
  const root = await mkdtemp(path.join(os.tmpdir(), "gl-relay-cli-"));
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

function fakeKane(calls, kaneOpts = {}) {
  return async (opts) => {
    calls.push({ name: "runKane", opts });
    const store = path.join(opts.cwd, ".testmuai", "evidence");
    await mkdir(store, { recursive: true });
    await writeFile(path.join(store, `${EXEC_ID}.evidence`), zipOf({ "run.yaml": "status: finalized\n" }));
    const run = fabricatedRun({
      members: [
        { file: "cart-add-two_test.md", tags: ["clm-001"], status: "passed", mode: "authored" },
        { file: "newsletter-subscribe_test.md", tags: ["clm-002"], status: "failed", mode: "authored" },
      ],
    });
    run.stream.members[1].final.failure.step_index = 3;
    run.stream.done.executionId = EXEC_ID;
    run.stream.summary.executionId = EXEC_ID;
    run.stream.summary.evidenceId = EXEC_ID;
    // Like Kane: recordings and run history next to the tests.
    const runKind = calls.filter((c) => c.name === "runKane").length === 1 ? "author" : "replay";
    for (const f of FILES) {
      const dir = path.join(opts.cwd, `output-${f.replace(/_test\.md$/, "")}`, ".internal");
      await mkdir(path.join(dir, "steps"), { recursive: true });
      // kaneOpts.noRecording: what Kane 0.10.6 did in Step 11 E1 under --local (only meta.json kept).
      if (!kaneOpts.noRecording) {
        await writeFile(path.join(dir, "execution.json"), "{}");
        await writeFile(path.join(dir, "steps", "1.json"), "step 1");
      }
      await writeFile(path.join(dir, "meta.json"), JSON.stringify({ executions: [{ run_kind: f.startsWith("newsletter") && kaneOpts.liveStep ? "author" : runKind }] }));
      if (f.startsWith("newsletter") && kaneOpts.liveStep) await writeFile(path.join(dir, "steps", "3.json"), "step 3, authored live");
      if (f.startsWith("cart") && kaneOpts.tamper) await writeFile(path.join(dir, "steps", "1.json"), "rewritten during replay");
    }
    return { ...run, stdout: "{}\n", stderr: "", aborted: false };
  };
}

function deps(calls, balance = 11076.5779, kaneOpts = {}) {
  return {
    verifyDeployment: async (o) => (calls.push({ name: "verifyDeployment", opts: o }), { state: "ready", reasons: [], safeToRunKane: true, url: PREVIEW, deployedCommit: COMMIT, expectedCommit: COMMIT, environment: "preview" }),
    readBalance: async () => (calls.push({ name: "readBalance" }), { ok: true, balance }),
    runKane: fakeKane(calls, kaneOpts),
    validator: async () => ({ exitCode: 0, stdout: '{"valid":true,"status":"finalized","diagnostics":[]}', stderr: "" }),
    now: () => new Date("2026-11-19T12:00:00.000Z"),
  };
}

async function cli(argv, { root, env = RELAY, d } = {}) {
  const out = sink();
  const err = sink();
  const stdin = new PassThrough();
  stdin.end();
  const code = await main(argv, { cwd: root, env, stdin, stdout: out.s, stderr: err.s, deps: d });
  return { code, out: out.t(), err: err.t() };
}
const names = (calls) => calls.map((c) => c.name);

// ---------------------------------------------------------------- approve --relayed

test("approve --relayed: needs relayed mode and the full current hash; then records a non-certifiable approval", async () => {
  const { root, hash } = await project({ approval: "none" });
  let r = await cli(["approve", "--relayed", hash], { root, env: HUMAN });
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.err, /needs GREENLIGHT_RELAYED_APPROVAL=1/);
  r = await cli(["approve", "--relayed", hash.slice(0, 12)], { root });
  assert.match(r.err, /full 64-character approved-test hash is required/);
  r = await cli(["approve", "--relayed", "f".repeat(64)], { root });
  assert.match(r.err, /not the current approved-test hash/);
  assert.equal(existsSync(path.join(root, ".greenlight", "approval.json")), false);
  assert.equal((await cli(["approve", "--relayed"], { root })).code, EXIT.USAGE);

  r = await cli(["approve", "--relayed", hash], { root });
  assert.equal(r.code, EXIT.OK, r.err);
  assert.match(r.out, /Relayed approval recorded for hash [0-9a-f]{64} \(method relayed-by-agent\)/);
  assert.match(r.out, /can never be used for certification or publishing/);
  const s = await cli(["status"], { root });
  assert.match(s.out, /Approval: approved/);
});

test("plain `greenlight approve` is unchanged: still refused for an agent, even in relayed mode", async () => {
  const { root } = await project({ approval: "none" });
  const r = await cli(["approve"], { root, env: { ...RELAY, CLAUDECODE: "1" } });
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.out, /looks like an AI agent or CI/);
});

// ---------------------------------------------------------------- verify gates

test("relayed approval: verify refuses without relayed mode or without --confirm-spend, before any check", async () => {
  const { root } = await project();
  for (const [args, env, re] of [
    [["verify", "--confirm-spend", "100"], HUMAN, /only works with GREENLIGHT_RELAYED_APPROVAL=1/],
    [["verify"], RELAY, /needs --confirm-spend <max credits> on every run/],
  ]) {
    const calls = [];
    const r = await cli(args, { root, env, d: deps(calls) });
    assert.equal(r.code, EXIT.BLOCKED);
    assert.match(r.err, re);
    assert.deepEqual(calls, []);
  }
});

test("--confirm-spend cannot replace a person's confirmation on human-approved tests", async () => {
  const { root } = await project({ approval: "human" });
  const calls = [];
  const r = await cli(["verify", "--confirm-spend", "1000"], { root, env: RELAY, d: deps(calls) });
  assert.equal(r.code, EXIT.BLOCKED);
  assert.match(r.err, /only accepted for a relayed approval/);
  assert.deepEqual(calls, []);
});

test("E1 shape: two fresh recordings (estimate 94) run under --confirm-spend 100 without a prompt", async () => {
  const { root } = await project();
  const calls = [];
  const r = await cli(["verify", "--url", PREVIEW, "--confirm-spend", "100"], { root, d: deps(calls) });
  assert.equal(r.code, EXIT.FAILED, r.err);
  assert.deepEqual(names(calls), ["verifyDeployment", "readBalance", "runKane", "readBalance"]);
  assert.match(r.out, /Approval: relayed-by-agent \(controlled test only; never certifiable\)\. Spend confirmed for this run: at most 100 credits\./);
  assert.match(r.out, /Credits: estimate 94 \(2 fresh recording\(s\), 0 known failing step\(s\)\); balance 11076\.5779; cap 100; reserve 500/);
  const k = calls.find((c) => c.name === "runKane").opts;
  for (const flag of ["--agent", "--headless", "--no-adaptive-heal", "--local", "--override-start-url"]) assert.ok(k.args.includes(flag), flag);
  const runs = await readdir(path.join(root, ".greenlight", "runs"));
  const manifest = JSON.parse(await readFile(path.join(root, ".greenlight", "runs", runs[0], "manifest.json"), "utf8"));
  assert.deepEqual(manifest.approval, { method: "relayed-by-agent", certifiable: false });
});

test("E1 regression: authored tests Kane did not keep are flagged, and the real spend (not the estimate) is persisted", async () => {
  const { root } = await project();
  const calls = [];
  const balances = [11076.5779, 10999.9376]; // E1's real balances, before and after
  const d = { ...deps(calls, 0, { noRecording: true }), readBalance: async () => (calls.push({ name: "readBalance" }), { ok: true, balance: balances.shift() }) };
  const r = await cli(["verify", "--url", PREVIEW, "--confirm-spend", "100"], { root, d });
  assert.equal(r.code, EXIT.FAILED, r.err);
  assert.match(r.err, /Warning \(recording_not_retained\): Kane authored 2 test\(s\) .* fresh-authoring credit costs again/);
  assert.match(r.out, /Credits: actual 76\.6403 \(balance 11076\.5779 -> 10999\.9376\)/);
  assert.match(r.out, /## Warnings\n- `recording_not_retained`/);

  const latest = JSON.parse(await readFile(path.join(root, ".greenlight", "reports", "latest.json"), "utf8"));
  assert.deepEqual(latest.warnings.map((w) => [w.code, w.tests.map((t) => t.file)]), [["recording_not_retained", FILES]]);
  assert.equal(latest.credits.actualSpend, 76.6403);
  assert.equal(latest.credits.actualSpendSource, "balance_difference");
  assert.equal(latest.credits.balanceBefore, 11076.5779);
  assert.equal(latest.credits.balanceAfter, 10999.9376);
  assert.equal(latest.credits.estimate, 94);
  assert.equal(latest.credits.estimateDifference, -17.3597);
  assert.ok("kaneReportedSpend" in latest.credits && "discrepancy" in latest.credits);
  assert.notEqual(latest.credits.actualSpend, latest.credits.estimate, "the estimate never stands in for the spend");
  const pub = JSON.parse(await readFile(path.join(root, ".greenlight", "reports", "latest.public.json"), "utf8"));
  assert.equal(pub.credits.actualSpend, 76.6403);

  const runs = await readdir(path.join(root, ".greenlight", "runs"));
  const manifest = JSON.parse(await readFile(path.join(root, ".greenlight", "runs", runs[0], "manifest.json"), "utf8"));
  assert.deepEqual(manifest.credits, latest.credits);
  assert.equal(manifest.warnings[0].code, "recording_not_retained");
  assert.deepEqual(manifest.approval, { method: "relayed-by-agent", certifiable: false }, "still never certifiable");

  const baseline = JSON.parse(await readFile(path.join(root, ".greenlight", "recordings.json"), "utf8"));
  assert.deepEqual(baseline.recorded, [], "missing recordings are not recorded as recorded");
  const status = await cli(["status"], { root });
  assert.match(status.out, /Recording cache: not_recorded/);
  assert.match(status.out, /not recorded \(next run authors it afresh\): cart-add-two_test\.md \(missing_execution_json\)/);
  assert.doesNotMatch(status.out, /Recording cache: unchanged/);

  // The next run is planned and priced as fresh authoring again, and E2's remaining budget refuses it.
  const calls2 = [];
  const again = await cli(["verify", "--url", PREVIEW, "--confirm-spend", "28.3597"], { root, d: deps(calls2, 10999.9376, { noRecording: true }) });
  assert.equal(again.code, EXIT.BLOCKED);
  assert.match(again.out, /Credits: estimate 94 \(2 fresh recording\(s\)/);
  assert.match(again.err, /exceeds_per_run_cap/);
  assert.equal(names(calls2).includes("runKane"), false);
});

test("relayed spend limits are enforced: estimate above --confirm-spend, --max-credits, reserve", async () => {
  const cases = [
    [["--confirm-spend", "71"], 11076.5779, /exceeds_per_run_cap/],
    [["--confirm-spend", "100", "--max-credits", "60"], 11076.5779, /exceeds_per_run_cap/],
    [["--confirm-spend", "100"], 560, /breaches_minimum_reserve/],
  ];
  for (const [args, balance, re] of cases) {
    const { root } = await project();
    const calls = [];
    const r = await cli(["verify", "--url", PREVIEW, ...args], { root, d: deps(calls, balance) });
    assert.equal(r.code, EXIT.BLOCKED);
    assert.match(r.err, re);
    assert.equal(calls.some((c) => c.name === "runKane"), false);
  }
});

test("E2 shape: after E1, the next estimate is 14.4 and fits the 33 credits left in the 105 budget", async () => {
  const { root } = await project();
  const calls = [];
  await cli(["verify", "--url", PREVIEW, "--confirm-spend", "100"], { root, d: deps(calls) });
  const r = await cli(["verify", "--url", PREVIEW, "--confirm-spend", "33"], { root, d: deps(calls, 11076.5779, { liveStep: true }) });
  assert.match(r.out, /Credits: estimate 14\.4 \(0 fresh recording\(s\), 1 known failing step\(s\)\)/);
  assert.equal(calls.filter((c) => c.name === "runKane").length, 2);
});

test("a step Kane records live (run_kind author) re-baselines the cache; the next verify is not blocked", async () => {
  const { root } = await project();
  const calls = [];
  await cli(["verify", "--url", PREVIEW, "--confirm-spend", "100"], { root, d: deps(calls) });
  const e2 = await cli(["verify", "--url", PREVIEW, "--confirm-spend", "33"], { root, d: deps(calls, 11076.5779, { liveStep: true }) });
  assert.match(e2.out, /Recordings updated for steps Kane recorded this run: newsletter-subscribe/);
  const third = await cli(["verify", "--url", PREVIEW, "--confirm-spend", "33"], { root, d: deps(calls) });
  assert.equal(/Recording cache changed/.test(third.err), false, third.err);
  assert.equal(calls.filter((c) => c.name === "runKane").length, 3);
});

test("a replayed test whose recording changed is flagged, the baseline kept, and the next verify blocked", async () => {
  const { root } = await project();
  const calls = [];
  await cli(["verify", "--url", PREVIEW, "--confirm-spend", "100"], { root, d: deps(calls) });
  const tampered = await cli(["verify", "--url", PREVIEW, "--confirm-spend", "33"], { root, d: deps(calls, 11076.5779, { tamper: true }) });
  assert.match(tampered.err, /recordings changed unexpectedly during this run \(output-cart-add-two\/\.internal\/steps\/1\.json\)/);
  const next = await cli(["verify", "--url", PREVIEW, "--confirm-spend", "33"], { root, d: deps(calls) });
  assert.equal(next.code, EXIT.BLOCKED);
  assert.match(next.err, /Recording cache changed: output-cart-add-two\/\.internal\/steps\/1\.json/);
  assert.equal(calls.filter((c) => c.name === "runKane").length, 2);
});

// ---------------------------------------------------------------- Stop hook

test("Stop hook passes GREENLIGHT_CONFIRM_SPEND for that invocation; without it verify is blocked", async () => {
  const { root } = await project();
  const git = async (args) => {
    const k = args.join(" ");
    if (k.startsWith("status")) return { code: 0, stdout: "" };
    if (k === "rev-parse HEAD" || k === "rev-parse @{u}") return { code: 0, stdout: `${COMMIT}\n` };
    if (k.startsWith("symbolic-ref")) return { code: 0, stdout: "main\n" };
    if (k.startsWith("rev-parse --abbrev-ref")) return { code: 0, stdout: "origin/main\n" };
    throw new Error(k);
  };
  // Real CLI behind the hook; the localhost URL is refused by the deployment gate before any network or Kane.
  const env = { ...RELAY, GREENLIGHT_URL: "http://localhost:3000/" };
  const blocked = await runStopHook({ input: { hook_event_name: "Stop" }, cwd: root, runGit: git, env });
  assert.equal(blocked.decision, "blocked");
  assert.match(blocked.stderr, /needs --confirm-spend/);

  await rm(path.join(root, ".greenlight", "state.json"));
  const withSpend = await runStopHook({ input: { hook_event_name: "Stop" }, cwd: root, runGit: git, env: { ...env, GREENLIGHT_CONFIRM_SPEND: "100" } });
  assert.equal(withSpend.decision, "couldnt_verify");
  assert.match(withSpend.stderr, /localhost_not_allowed/);
  assert.equal(typeof cliVerifier, "function");
});
