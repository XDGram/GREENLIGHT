// Stop hook tests. Git and `greenlight verify` are mocked; a few tests run the
// real CLI behind the hook to show its gates still apply. No Kane, network or credits.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm, chmod, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  runStopHook,
  resetStreak,
  cliVerifier,
  isRelevantPath,
  loadState,
  acquireLock,
  ensureGreenlightGitignore,
  GITIGNORE_CONTENT,
  STATE_FILE,
  LOCK_FILE,
} from "../../src/hook/index.js";
import { writeGenerated, approve } from "../../src/spec/index.js";

const SAMPLE = readFileSync(new URL("../fixtures/spec/smoke/greenlight.yaml", import.meta.url), "utf8");
const SAMPLE_HASH = "07bc6327dd53f62ecf79d8312c30342786a1bdac8211d71786a46a72fcc139d0";
const HOOK_BIN = fileURLToPath(new URL("../../bin/greenlight-stop-hook.js", import.meta.url));
const HUMAN = { PATH: process.env.PATH, HOME: process.env.HOME };
const C = (n) => String(n).repeat(40).slice(0, 40); // fake commit ids: C(1) = "1111…"
const STOP = { hook_event_name: "Stop", stop_hook_active: false };

// Guards: no network in this process, no real kane-cli anywhere.
const realFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error("real network request attempted in a hook test");
};
const temps = [];
const trap = await mkdtemp(path.join(os.tmpdir(), "gl-hook-trap-"));
temps.push(trap);
const KANE_MARKER = path.join(trap, "KANE_WAS_RUN");
await writeFile(path.join(trap, "kane-cli"), `#!/bin/sh\necho "$@" >> "${KANE_MARKER}"\nexit 2\n`);
await chmod(path.join(trap, "kane-cli"), 0o755);
const savedPath = process.env.PATH;
process.env.PATH = `${trap}${path.delimiter}${savedPath}`;
after(async () => {
  globalThis.fetch = realFetch;
  process.env.PATH = savedPath;
  assert.equal(existsSync(KANE_MARKER), false, "a real kane-cli was executed during the hook tests");
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

// ---------------------------------------------------------------- helpers

function terminal(answer) {
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.end(`${answer}\n`);
  const stdout = new PassThrough();
  stdout.isTTY = true;
  stdout.resume();
  return { stdin, stdout };
}

async function project({ approved = true, spec = SAMPLE } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "gl-hook-"));
  temps.push(root);
  await writeFile(path.join(root, "greenlight.yaml"), spec);
  await writeGenerated(root);
  if (approved) {
    const t = terminal(SAMPLE_HASH.slice(0, 12));
    const r = await approve({ root, env: HUMAN, ...t, approver: () => "dev" });
    if (spec === SAMPLE) assert.equal(r.approved, true);
  }
  return root;
}

/** Mutable fake repository. */
function repo({ head = C(1), dirty = [], remote, diff = {} } = {}) {
  const r = { head, dirty, remote: remote ?? head, diff, calls: [] };
  r.runGit = async (args) => {
    r.calls.push(args.join(" "));
    const key = args.join(" ");
    if (key === "status --porcelain=v1 --untracked-files=all") return { code: 0, stdout: r.dirty.map((f) => `?? ${f}\n`).join("") };
    if (key === "rev-parse HEAD") return { code: 0, stdout: `${r.head}\n` };
    if (key === "symbolic-ref --short -q HEAD") return { code: 0, stdout: "main\n" };
    if (key === "rev-parse --abbrev-ref --symbolic-full-name @{u}") return { code: 0, stdout: "origin/main\n" };
    if (key === "rev-parse @{u}") return { code: 0, stdout: `${r.remote}\n` };
    if (args[0] === "merge-base") return { code: 1, stdout: "" };
    if (args[0] === "diff") return { code: 0, stdout: (r.diff[`${args[2]}..${args[3]}`] ?? ["src/app.js"]).join("\n") };
    throw new Error(`unexpected git call ${key}`);
  };
  r.commit = (sha, files = ["src/app.js"]) => {
    r.diff[`${r.head}..${sha}`] = files;
    r.head = sha;
    r.remote = sha;
  };
  return r;
}

/** Fake `greenlight verify`: returns queued exit codes, writing a report on failure. */
function verifier(codes) {
  const v = { calls: 0 };
  v.run = async ({ cwd }) => {
    v.calls += 1;
    const code = codes.length ? codes.shift() : 0;
    if (code === 1) {
      await mkdir(path.join(cwd, ".greenlight", "reports"), { recursive: true });
      await writeFile(path.join(cwd, ".greenlight", "reports", "latest.md"), `# Greenlight: verification failed\n\n### CLM-002 Users can subscribe to the newsletter.\n- Failed step 3 "Check the confirmation"\n`);
    }
    return { exitCode: code, stdout: code === 0 ? "Verified" : "", stderr: code === 3 ? "Deployment not ready: stale_deployment (commit_mismatch, timed_out). Kane was not run." : code === 4 ? "Credit check refused the run: exceeds_per_run_cap. Kane was not run." : "" };
  };
  return v;
}

const hook = (root, r, v, over = {}) => runStopHook({ input: STOP, cwd: root, runGit: r.runGit, runVerify: v.run, now: () => new Date("2026-11-19T12:00:00Z"), ...over });
const state = async (root) => (await loadState(root)).state;

// ---------------------------------------------------------------- skipping

test("not a Greenlight project, or not a Stop event: allowed, nothing touched", async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), "gl-hook-"));
  temps.push(empty);
  const v = verifier([]);
  const r = await runStopHook({ input: STOP, cwd: empty, runGit: repo().runGit, runVerify: v.run });
  assert.deepEqual([r.exitCode, r.decision], [0, "not_a_greenlight_project"]);
  assert.equal(existsSync(path.join(empty, ".greenlight")), false);
  const root = await project();
  const r2 = await runStopHook({ input: { hook_event_name: "PreToolUse" }, cwd: root, runVerify: v.run });
  assert.equal(r2.decision, "not_a_stop_event");
  assert.equal(v.calls, 0);
});

test("clean verified commit: passes once, then skipped on later stops", async () => {
  const root = await project();
  const r = repo();
  const v = verifier([0]);
  let out = await hook(root, r, v);
  assert.deepEqual([out.exitCode, out.decision], [0, "verified"]);
  assert.match(out.stdout, /verified commit 111111111111/);
  const s = await state(root);
  assert.equal(s.lastVerified.commit, C(1));
  assert.equal(s.lastRun.result, "passed");
  assert.equal(s.currentCommit, C(1));
  assert.equal(s.approvedHash, SAMPLE_HASH);
  out = await hook(root, r, v);
  assert.deepEqual([out.exitCode, out.decision], [0, "already_verified"]);
  assert.equal(v.calls, 1);
});

test("a new commit touching only Greenlight/Claude files is skipped; a relevant change is verified", async () => {
  const root = await project();
  const r = repo();
  const v = verifier([0, 0]);
  await hook(root, r, v);
  r.commit(C(2), [".greenlight/approval.json", ".claude/settings.json"]);
  let out = await hook(root, r, v);
  assert.deepEqual([out.exitCode, out.decision], [0, "no_relevant_changes"]);
  assert.equal(v.calls, 1);
  r.commit(C(3), ["src/cart.js"]);
  out = await hook(root, r, v);
  assert.equal(out.decision, "verified");
  assert.equal(v.calls, 2);
  assert.equal(isRelevantPath(".greenlight/tests/x_test.md"), false);
  assert.equal(isRelevantPath("greenlight.yaml"), true, "spec changes are relevant (and need re-approval)");
});

// ---------------------------------------------------------------- commit / push first

test("uncommitted relevant work: Claude is asked once to commit and push; never verified dirty", async () => {
  const root = await project();
  const r = repo({ dirty: ["src/app.js"] });
  const v = verifier([]);
  let out = await hook(root, r, v);
  assert.deepEqual([out.exitCode, out.decision], [2, "uncommitted_changes"]);
  assert.match(out.stderr, /committed and pushed before it can verify[\s\S]*src\/app\.js/);
  out = await hook(root, r, v, { input: { ...STOP, stop_hook_active: true } });
  assert.deepEqual([out.exitCode, out.decision], [1, "uncommitted_changes_unresolved"], "no infinite loop");
  assert.equal(v.calls, 0);
});

test("only Greenlight's own files dirty counts as clean", async () => {
  const root = await project();
  const v = verifier([0]);
  const out = await hook(root, repo({ dirty: [".greenlight/state.json", ".claude/settings.local.json"] }), v);
  assert.equal(out.decision, "verified");
});

test("committed but unpushed: Claude is asked once to push", async () => {
  const root = await project();
  const r = repo({ head: C(2), remote: C(1) });
  const v = verifier([]);
  let out = await hook(root, r, v);
  assert.deepEqual([out.exitCode, out.decision], [2, "unpushed_commit"]);
  assert.match(out.stderr, /must be pushed first/);
  out = await hook(root, r, v);
  assert.equal(out.exitCode, 1);
  assert.equal(v.calls, 0);
});

// ---------------------------------------------------------------- app failures and the fix loop

test("app failure: exit 2 with the report and fix-the-app instructions; the same commit is never re-run", async () => {
  const root = await project();
  const r = repo();
  const v = verifier([1]);
  let out = await hook(root, r, v);
  assert.deepEqual([out.exitCode, out.decision], [2, "app_failure"]);
  assert.match(out.stderr, /FAILED for commit 111111111111 \(automatic fix attempt 1 of 3\)/);
  assert.match(out.stderr, /### CLM-002 Users can subscribe to the newsletter\./);
  assert.match(out.stderr, /fix the APPLICATION code/);
  assert.match(out.stderr, /do not weaken or remove approved tests/);
  assert.match(out.stderr, /propose the change for a person to approve/);
  const s = await state(root);
  assert.equal(s.fixAttempts, 1);
  assert.deepEqual(s.lastReport, { commit: C(1), path: path.join(".greenlight", "reports", "latest.md"), at: "2026-11-19T12:00:00.000Z" });
  out = await hook(root, r, v, { input: { ...STOP, stop_hook_active: true } });
  assert.deepEqual([out.exitCode, out.decision], [1, "same_commit_already_run"]);
  assert.equal(v.calls, 1, "no duplicate run for the failed commit");
});

// ---------------------------------------------------------------- run warnings (Step 11 E1)

const RETENTION = {
  code: "recording_not_retained",
  tests: [{ file: "cart-add-two_test.md", reason: "missing_execution_json" }, { file: "newsletter-subscribe_test.md", reason: "missing_execution_json" }],
  message: "Kane authored 2 test(s) in this run but kept no replayable recording (.internal/execution.json): cart-add-two_test.md, newsletter-subscribe_test.md. The next run cannot replay them: it will author them afresh and incur fresh-authoring credit costs again.",
};

/** Fake verify that, like the real one, writes latest.json (with warnings) for the run it just did. */
function warningVerifier(code, { generatedAt = "2026-11-19T12:00:00.000Z", warnings = [RETENTION] } = {}) {
  const v = verifier([code]);
  const run = v.run;
  v.run = async (o) => {
    const res = await run(o);
    await mkdir(path.join(o.cwd, ".greenlight", "reports"), { recursive: true });
    await writeFile(path.join(o.cwd, ".greenlight", "reports", "latest.json"), JSON.stringify({ generatedAt, warnings, failures: [] }));
    return res;
  };
  return v;
}

test("E1: an app failure with unretained recordings: exit 2, attempt 1 of 3, and the warning is in the hook output", async () => {
  const root = await project();
  const out = await hook(root, repo(), warningVerifier(1));
  assert.deepEqual([out.exitCode, out.decision], [2, "app_failure"]);
  assert.match(out.stderr, /automatic fix attempt 1 of 3/);
  assert.match(out.stderr, /Greenlight warning \(recording_not_retained\): Kane authored 2 test\(s\)/);
  assert.match(out.stderr, /incur fresh-authoring credit costs again/);
  assert.ok(out.stderr.indexOf("recording_not_retained") < out.stderr.indexOf("### CLM-002"), "shown before the report, so clipping cannot hide it");
  assert.deepEqual(out.warnings, ["recording_not_retained"]);
  assert.deepEqual((await state(root)).lastRun.warnings, ["recording_not_retained"]);
});

test("a passing run still surfaces a recording warning (exit 0)", async () => {
  const root = await project();
  const out = await hook(root, repo(), warningVerifier(0));
  assert.deepEqual([out.exitCode, out.decision], [0, "verified"]);
  assert.match(out.stdout, /Greenlight warning \(recording_not_retained\)/);
  assert.match(out.stdout, /every approved claim passed/);
});

test("a could-not-verify run surfaces this run's warnings; an older report's warnings are never repeated", async () => {
  let root = await project();
  let out = await hook(root, repo(), warningVerifier(3));
  assert.deepEqual([out.exitCode, out.decision], [1, "couldnt_verify"]);
  assert.match(out.stderr, /Greenlight warning \(recording_not_retained\)/);

  root = await project();
  out = await hook(root, repo(), warningVerifier(1, { generatedAt: "2026-11-19T11:59:59.000Z" }));
  assert.equal(out.exitCode, 2);
  assert.doesNotMatch(out.stderr, /recording_not_retained/, "latest.json written before this verification started");
  assert.deepEqual(out.warnings, []);
});

test("successful fix: failure, new commit passes, counter resets", async () => {
  const root = await project();
  const r = repo();
  const v = verifier([1, 0]);
  assert.equal((await hook(root, r, v)).exitCode, 2);
  r.commit(C(2));
  const out = await hook(root, r, v, { input: { ...STOP, stop_hook_active: true } });
  assert.deepEqual([out.exitCode, out.decision], [0, "verified"]);
  const s = await state(root);
  assert.equal(s.fixAttempts, 0);
  assert.equal(s.lastVerified.commit, C(2));
});

test("three automatic fix attempts, then the loop stops and needs a person", async () => {
  const root = await project();
  const r = repo();
  const v = verifier([1, 1, 1, 1, 0]);
  const decisions = [];
  for (let i = 1; i <= 4; i++) {
    if (i > 1) r.commit(C(i));
    const out = await hook(root, r, v);
    decisions.push([out.exitCode, out.decision, (await state(root)).fixAttempts]);
  }
  assert.deepEqual(decisions, [
    [2, "app_failure", 1],
    [2, "app_failure", 2],
    [2, "app_failure", 3],
    [1, "fix_limit_reached", 3],
  ]);
  assert.equal((await state(root)).humanNeeded, true);
  r.commit(C(5));
  const stopped = await hook(root, r, v);
  assert.deepEqual([stopped.exitCode, stopped.decision], [1, "human_needed"]);
  assert.equal(v.calls, 4, "no verification while a person is needed");

  assert.deepEqual(await resetStreak({ cwd: root }), { ok: true });
  const resumed = await hook(root, r, v);
  assert.equal(resumed.decision, "verified");
  assert.equal((await state(root)).fixAttempts, 0);
});

test("a human-approved test change resets the counter and the stop", async () => {
  const root = await project();
  const r = repo();
  const v = verifier([1, 1, 1, 1]);
  for (let i = 1; i <= 4; i++) {
    if (i > 1) r.commit(C(i));
    await hook(root, r, v);
  }
  assert.equal((await state(root)).humanNeeded, true);
  // A person changes an approved test and re-approves it.
  const changed = SAMPLE.replace('"Items in cart: 2"', '"Items in cart: 3"');
  await writeFile(path.join(root, "greenlight.yaml"), changed);
  await writeGenerated(root);
  const { approve: approveFn, loadProject } = await import("../../src/spec/index.js");
  const p = await loadProject(root);
  assert.equal((await approveFn({ root, env: HUMAN, ...terminal(p.hash.slice(0, 12)), approver: () => "dev" })).approved, true);
  r.commit(C(5));
  const out = await hook(root, r, verifier([0]));
  assert.equal(out.decision, "verified");
  const s = await state(root);
  assert.equal(s.approvedHash, p.hash);
  assert.equal(s.fixAttempts, 0);
  assert.equal(s.humanNeeded, false);
});

// ---------------------------------------------------------------- untrusted verification

test("could not verify / blocked gate: a blocker for the user, never counted, never a code-fix request", async () => {
  for (const [code, decision, re] of [
    [3, "couldnt_verify", /could not verify the deployment[\s\S]*not an application failure[\s\S]*stale_deployment/],
    [4, "blocked", /a gate needs a person[\s\S]*exceeds_per_run_cap/],
  ]) {
    const root = await project();
    const r = repo();
    const v = verifier([code]);
    const out = await hook(root, r, v);
    assert.deepEqual([out.exitCode, out.decision], [1, decision]);
    assert.match(out.stderr, re);
    assert.equal(/fix the APPLICATION/.test(out.stderr), false);
    const s = await state(root);
    assert.equal(s.fixAttempts, 0);
    assert.equal(s.lastRun.result, decision);
    assert.equal((await hook(root, r, v)).decision, "same_commit_already_run");
    assert.equal(v.calls, 1);
  }
});

test("interrupted or crashed verification is not counted and may run again for the same commit", async () => {
  for (const code of [130, null]) {
    const root = await project();
    const r = repo();
    const v = verifier([code, 0]);
    const out = await hook(root, r, v);
    assert.equal(out.exitCode, 1);
    assert.equal((await state(root)).fixAttempts, 0);
    assert.equal((await hook(root, r, v)).decision, "verified", "re-run allowed after interruption/crash");
  }
});

test("an abort signal reaches the verifier and is recorded as interrupted", async () => {
  const root = await project();
  const ac = new AbortController();
  const v = { run: async ({ signal }) => { ac.abort(); assert.equal(signal.aborted, true); return { exitCode: 130, stdout: "", stderr: "", aborted: true }; } };
  const out = await runStopHook({ input: STOP, cwd: root, runGit: repo().runGit, runVerify: v.run, signal: ac.signal });
  assert.equal(out.decision, "interrupted");
  assert.equal((await state(root)).lastRun.result, "interrupted");
  assert.equal(existsSync(path.join(root, LOCK_FILE)), false, "lock released");
});

// ---------------------------------------------------------------- concurrency and robustness

test("concurrent hook runs: only one verification executes", async () => {
  const root = await project();
  let release;
  const gate = new Promise((r) => (release = r));
  let calls = 0;
  const slow = async () => {
    calls += 1;
    await gate;
    return { exitCode: 0, stdout: "", stderr: "" };
  };
  const first = hook(root, repo(), { run: slow });
  await new Promise((r) => setTimeout(r, 50));
  const second = await hook(root, repo(), { run: slow });
  assert.deepEqual([second.exitCode, second.decision], [0, "already_running"]);
  release();
  assert.equal((await first).decision, "verified");
  assert.equal(calls, 1);
  assert.equal(existsSync(path.join(root, LOCK_FILE)), false);
});

test("a lock left by a dead process or too old is taken over; a live one is respected", async () => {
  const root = await project();
  await writeFile(path.join(root, LOCK_FILE), JSON.stringify({ pid: 999999, at: "2026-11-19T11:59:00Z" }));
  const out = await hook(root, repo(), verifier([0]), { lockOptions: { isAlive: () => false } });
  assert.equal(out.decision, "verified");

  await writeFile(path.join(root, LOCK_FILE), JSON.stringify({ pid: 4242, at: "2026-11-19T11:59:00Z" }));
  const busy = await hook(root, repo({ head: C(2) }), verifier([0]), { lockOptions: { isAlive: () => true } });
  assert.equal(busy.decision, "already_running");
  const old = await acquireLock(root, { now: () => new Date("2026-11-19T15:00:00Z"), isAlive: () => true });
  assert.equal(old.acquired, true, "older than two hours: stale");
  await old.release();
});

test("the lock and state are saved even when verification throws", async () => {
  const root = await project();
  await assert.rejects(hook(root, repo(), { run: async () => { throw new Error("boom"); } }), /boom/);
  assert.equal(existsSync(path.join(root, LOCK_FILE)), false);
  assert.equal((await state(root)).currentCommit, C(1));
});

test("corrupt state fails closed until a person resets it; git failures are a blocker", async () => {
  const root = await project();
  await mkdir(path.join(root, ".greenlight"), { recursive: true });
  await writeFile(path.join(root, STATE_FILE), "{not json");
  assert.equal((await loadState(root)).problem, "state_unreadable");
  const v = verifier([0]);
  const blocked = await hook(root, repo(), v);
  assert.deepEqual([blocked.exitCode, blocked.decision], [1, "state_unreadable"]);
  assert.match(blocked.stderr, /greenlight-stop-hook reset/);
  assert.equal(v.calls, 0, "never verifies on an untrusted attempt count");
  assert.equal((await resetStreak({ cwd: root, now: () => new Date("2026-11-19T11:00:00Z") })).ok, true);
  assert.equal((await hook(root, repo(), v)).decision, "verified");
  const broken = { runGit: async () => ({ code: 128, stdout: "", stderr: "not a git repository" }) };
  const out = await hook(root, broken, verifier([]));
  assert.deepEqual([out.exitCode, out.decision], [1, "git_unavailable"]);
});

test(".greenlight/.gitignore keeps local files out of git, ignores itself, and is never overwritten", async () => {
  const root = await project();
  await hook(root, repo(), verifier([0]));
  const text = await readFile(path.join(root, ".greenlight", ".gitignore"), "utf8");
  assert.equal(text, GITIGNORE_CONTENT);
  for (const p of ["state.json", "hook.lock", "runs/", "reports/", "tests/output-*/", "tests/.testmuai/", ".gitignore"]) assert.ok(text.includes(p), p);
  for (const p of ["approval.json", "greenlight.yaml"]) assert.equal(text.includes(p), false, `${p} must stay committable`);
  await writeFile(path.join(root, ".greenlight", ".gitignore"), "custom\n");
  assert.equal(await ensureGreenlightGitignore(root), false);
  assert.equal(await readFile(path.join(root, ".greenlight", ".gitignore"), "utf8"), "custom\n");
});

test("with real git, Greenlight's own files do not dirty the working tree", async () => {
  const root = await project();
  const g = (...a) => spawnSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.invalid", ...a], { encoding: "utf8" });
  g("init", "-q", "-b", "main");
  await ensureGreenlightGitignore(root);
  g("add", ".");
  g("commit", "-q", "-m", "app");
  await mkdir(path.join(root, ".greenlight", "tests", "output-cart-add-two", ".internal"), { recursive: true });
  await writeFile(path.join(root, ".greenlight", "tests", "output-cart-add-two", ".internal", "execution.json"), "{}");
  await writeFile(path.join(root, STATE_FILE), "{}");
  await mkdir(path.join(root, ".greenlight", "reports"), { recursive: true });
  await writeFile(path.join(root, ".greenlight", "reports", "latest.md"), "x");
  assert.equal(g("status", "--porcelain=v1", "--untracked-files=all").stdout, "");
  const tracked = g("ls-files").stdout;
  assert.match(tracked, /\.greenlight\/approval\.json/);
  assert.match(tracked, /\.greenlight\/tests\/cart-add-two_test\.md/);
});

// ---------------------------------------------------------------- gates are never bypassed

test("the hook never calls Kane, the balance or the deployment check itself", async () => {
  const dir = fileURLToPath(new URL("../../src/hook/", import.meta.url));
  for (const f of await readdir(dir)) {
    const src = await readFile(path.join(dir, f), "utf8");
    assert.equal(/from\s+["']\.\.\/(kane|credits|evidence)\//.test(src), false, `${f} imports Kane/credits/evidence`);
    assert.equal(/verifyDeployment|runKane|readBalance|authorizeRun/.test(src), false, `${f} bypasses the CLI gates`);
  }
});

test("real CLI behind the hook: unapproved tests stop at the approval gate", async () => {
  const root = await project({ approved: false });
  const out = await runStopHook({ input: STOP, cwd: root, runGit: repo().runGit, env: HUMAN, runVerify: cliVerifier() });
  assert.deepEqual([out.exitCode, out.decision], [1, "blocked"]);
  assert.match(out.stderr, /Tests are not approved/);
});

test("real CLI behind the hook: the deployment gate refuses before any network or Kane", async () => {
  const root = await project();
  const out = await runStopHook({ input: STOP, cwd: root, runGit: repo().runGit, env: HUMAN, runVerify: cliVerifier({ extraArgs: ["--url", "http://localhost:3000/"] }) });
  assert.deepEqual([out.exitCode, out.decision], [1, "couldnt_verify"]);
  assert.match(out.stderr, /Deployment not ready: couldnt_verify \(localhost_not_allowed\)\. Kane was not run\./);
});

test("the verifier runs `greenlight verify` non-interactively, so it can never approve or confirm spending", async () => {
  const src = await readFile(fileURLToPath(new URL("../../src/hook/stop-hook.js", import.meta.url)), "utf8");
  assert.match(src, /spawn\(process\.execPath, \[CLI, "verify", \.\.\.extraArgs\], \{ cwd, env, stdio: \["ignore", "pipe", "pipe"\] \}\)/);
  assert.equal(/"approve"/.test(src.replace(/\/\/.*$/gm, "")), false);
});

// ---------------------------------------------------------------- the real hook binary

test("hook binary: Claude Code input on stdin, exit codes and the reset command", async () => {
  const empty = await mkdtemp(path.join(os.tmpdir(), "gl-hook-"));
  temps.push(empty);
  let r = spawnSync(process.execPath, [HOOK_BIN], { cwd: empty, input: JSON.stringify({ ...STOP, cwd: empty, session_id: "s" }), env: HUMAN, encoding: "utf8" });
  assert.equal(r.status, 0);
  r = spawnSync(process.execPath, [HOOK_BIN], { cwd: empty, input: "{not json", env: HUMAN, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /could not parse hook input/);
  r = spawnSync(process.execPath, [HOOK_BIN, "bogus"], { cwd: empty, env: HUMAN, encoding: "utf8" });
  assert.equal(r.status, 1);
  const root = await project();
  r = spawnSync(process.execPath, [HOOK_BIN, "reset"], { cwd: root, env: HUMAN, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /counter reset/);
  assert.equal((await state(root)).fixAttempts, 0);
});
