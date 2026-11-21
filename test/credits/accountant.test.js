// Credit accountant tests. Kane is never executed and no credits are used:
// balances come from fake-kane-balance.mjs replaying Kane's real captured output,
// usage from sanitised copies of the real Run 1 / Run 2 session logs.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, writeFile, readFile, rm, cp } from "node:fs/promises";
import {
  readBalance,
  kaneBalanceReader,
  parseBalanceOutput,
  assertNotATestCommand,
  estimateRun,
  planFromRecordings,
  authorizeRun,
  actualUsage,
  readSessionCredits,
  sessionsOfRun,
  reconcileUsage,
  creditRecord,
  DEFAULT_RATES,
} from "../../src/credits/index.js";
import { evaluateRun } from "../../src/verify/classify.js";
import { runFromFixture, fabricatedRun, APPROVED_SMOKE } from "../verify/helpers.js";

const FIX = (p) => fileURLToPath(new URL(`../fixtures/kane/${p}`, import.meta.url));
const FAKE_BALANCE = FIX("fake-kane-balance.mjs");
const SESSIONS = (run) => FIX(`${run}/sessions`);
const fakeReader = (env = {}, opts = {}) =>
  kaneBalanceReader({ command: [process.execPath, FAKE_BALANCE], env: { ...process.env, ...env }, timeoutMs: 10_000, ...opts });
const balanceOf = (file) => readBalance(fakeReader({ FAKE_BALANCE_FILE: FIX(file) }));
const POLICY = { maxPerRun: 150, minReserve: 1000 };
const OK = (balance) => ({ ok: true, balance });

const temps = [];
after(() => Promise.all(temps.map((d) => rm(d, { recursive: true, force: true }))));
const tmp = async () => {
  const d = await mkdtemp(path.join(os.tmpdir(), "gl-credits-"));
  temps.push(d);
  return d;
};

// ---------------------------------------------------------------- balance

test("reads the real captured balances through a process", async () => {
  assert.deepEqual(await balanceOf("run1-authored/balance_before.txt"), { ok: true, balance: 11200, reason: null, detail: null });
  assert.equal((await balanceOf("run1-authored/balance_after.txt")).balance, 11090.8815);
  assert.equal((await balanceOf("run2-replay/balance_after.txt")).balance, 11076.5779);
});

test("missing or unusable balances are reported, never guessed", async () => {
  const d = await tmp();
  await writeFile(path.join(d, "junk.txt"), "Credits: lots\n");
  const cases = [
    [fakeReader({ FAKE_BALANCE_MODE: "not_logged_in" }), "nonzero_exit"],
    [fakeReader({ FAKE_BALANCE_FILE: path.join(d, "junk.txt") }), "unparseable_output"],
    [fakeReader({ FAKE_BALANCE_FILE: FIX("run1-authored/balance_before.txt"), FAKE_BALANCE_EXIT: "2" }), "nonzero_exit"],
    [fakeReader({ FAKE_BALANCE_MODE: "hang" }, { timeoutMs: 300 }), "timed_out"],
    [kaneBalanceReader({ command: "/nonexistent/kane-cli" }), "spawn_failed"],
    [async () => { throw new Error("boom"); }, "reader_failed"],
    [async () => ({ exitCode: 0, stdout: "Available credits: -5\n" }), "negative_balance"],
  ];
  for (const [reader, reason] of cases) {
    const r = await readBalance(reader);
    assert.equal(r.ok, false, reason);
    assert.equal(r.reason, reason);
  }
  const nl = await readBalance(fakeReader({ FAKE_BALANCE_MODE: "not_logged_in" }));
  assert.match(nl.detail, /Not authenticated/);
});

test("parseBalanceOutput", () => {
  assert.equal(parseBalanceOutput("Available credits: 11200\n"), 11200);
  assert.equal(parseBalanceOutput("noise\nAvailable credits: 0.5\n"), 0.5);
  assert.equal(parseBalanceOutput("Available credits: abc"), null);
  assert.equal(parseBalanceOutput(undefined), null);
});

test("the accountant can only run `kane-cli balance`, never a test", async () => {
  for (const args of [["testrun", "run", "a_test.md"], ["run", "objective"], ["testmd", "run", "a_test.md"], ["evidence", "validate"], []]) {
    assert.throws(() => assertNotATestCommand(args));
  }
  assert.doesNotThrow(() => assertNotATestCommand(["balance"]));
  const d = await tmp();
  const log = path.join(d, "calls.ndjson");
  await readBalance(fakeReader({ FAKE_BALANCE_FILE: FIX("run1-authored/balance_before.txt"), FAKE_BALANCE_LOG: log }));
  await readBalance(fakeReader({ FAKE_BALANCE_MODE: "not_logged_in", FAKE_BALANCE_LOG: log }));
  const calls = (await readFile(log, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(calls, [["balance"], ["balance"]]);
});

// ---------------------------------------------------------------- estimate

test("Run 1 plan (3 fresh tests) estimates 131: conservatively above the real 109.12", () => {
  const e = estimateRun({ tests: APPROVED_SMOKE.tests.map((t) => ({ file: t.file, author: true })) });
  assert.equal(e.credits, 131); // 20 run overhead + 3 x 37
  assert.equal(e.authoredTests, 3);
  assert.equal(e.runOverhead, 20);
  assert.ok(e.credits >= 109.1185 && e.credits <= 109.1185 * 1.25, "conservative, but not absurdly so");
});

test("Run 2 plan (2 passing replays, 1 known failing step) estimates 14.6 against a real 14.30", () => {
  const e = estimateRun({
    tests: [
      { file: "cart_test.md", author: false },
      { file: "about_nav_test.md", author: false },
      { file: "subscribe_test.md", author: false, knownFailingSteps: 1 },
    ],
  });
  assert.equal(e.credits, 14.6);
  assert.equal(e.authoredTests, 0);
  assert.equal(e.liveFailingSteps, 1);
  assert.deepEqual(e.breakdown.map((b) => b.basis), ["replay", "replay", "replay_with_live_failing_steps"]);
});

test("estimate: margin, custom rates and input checks", () => {
  const plan = { tests: [{ file: "a_test.md", author: false, knownFailingSteps: 2 }] };
  assert.equal(estimateRun(plan).credits, 28.2);
  assert.equal(estimateRun(plan, { margin: 1.5 }).credits, 42.3);
  assert.equal(estimateRun(plan, { rates: { ...DEFAULT_RATES, failingAiStep: 20 } }).credits, 40.2);
  assert.throws(() => estimateRun({ tests: [] }), /non-empty/);
  assert.throws(() => estimateRun(plan, { margin: 0.5 }), /margin/);
  assert.throws(() => estimateRun(plan, { rates: { ...DEFAULT_RATES, authorPerTest: -1 } }), /authorPerTest/);
  assert.throws(() => estimateRun({ tests: [{ file: "a_test.md", knownFailingSteps: 1.5 }] }), /integer/);
});

test("planFromRecordings: no recording means fresh authoring; previous app failures add live steps", async () => {
  const d = await tmp();
  await mkdir(path.join(d, "output-cart", ".internal"), { recursive: true });
  await writeFile(path.join(d, "output-cart", ".internal", "execution.json"), "{}");
  await mkdir(path.join(d, "output-subscribe", ".internal"), { recursive: true });
  await writeFile(path.join(d, "output-subscribe", ".internal", "execution.json"), "{}");
  const previous = evaluateRun(runFromFixture("run2-replay"), APPROVED_SMOKE);
  const plan = await planFromRecordings({ testsDir: d, files: ["cart_test.md", "subscribe_test.md", "about_nav_test.md"], previousEvaluation: previous });
  assert.deepEqual(plan.tests, [
    { file: "cart_test.md", author: false, knownFailingSteps: 0 },
    { file: "subscribe_test.md", author: false, knownFailingSteps: 1 },
    { file: "about_nav_test.md", author: true, knownFailingSteps: 0 },
  ]);
  assert.equal(estimateRun(plan).credits, 71.4); // 0.2 + 14.2 + 37 + 20 run overhead (one test authors)
});

// ---------------------------------------------------------------- authorisation

test("an iteration replay within limits is allowed without confirmation", () => {
  const e = estimateRun({ tests: [{ file: "a_test.md", author: false }] });
  const a = authorizeRun({ estimate: e, balance: OK(11076.5779), policy: POLICY, runKind: "iteration" });
  assert.equal(a.allowed, true, a.reasons.join(","));
  assert.equal(a.requiresConfirmation, false);
  assert.equal(a.balanceAfterEstimate, 11076.3779);
});

test("fresh authoring and certification need explicit confirmation", () => {
  const authoring = estimateRun({ tests: [{ file: "a_test.md", author: true }] });
  const a1 = authorizeRun({ estimate: authoring, balance: OK(11200), policy: POLICY, runKind: "iteration" });
  assert.deepEqual([a1.allowed, a1.reasons, a1.confirmationReasons], [false, ["confirmation_required"], ["fresh_authoring"]]);
  assert.equal(authorizeRun({ estimate: authoring, balance: OK(11200), policy: POLICY, runKind: "iteration", confirmed: true }).allowed, true);

  const replay = estimateRun({ tests: [{ file: "a_test.md", author: false }] });
  const c = authorizeRun({ estimate: replay, balance: OK(11200), policy: POLICY, runKind: "certification" });
  assert.deepEqual([c.allowed, c.confirmationReasons], [false, ["certification"]]);
  assert.equal(authorizeRun({ estimate: replay, balance: OK(11200), policy: POLICY, runKind: "certification", confirmed: "yes" }).allowed, false, "only literal true confirms");
});

test("per-run cap, reserve, balance and unknown balance all refuse the run", () => {
  const e = estimateRun({ tests: [1, 2, 3, 4, 5].map((i) => ({ file: `t${i}_test.md`, author: true })) }); // 205
  const cap = authorizeRun({ estimate: e, balance: OK(11200), policy: POLICY, runKind: "iteration", confirmed: true });
  assert.deepEqual(cap.reasons, ["exceeds_per_run_cap"]);

  const small = estimateRun({ tests: [{ file: "a_test.md", author: false, knownFailingSteps: 1 }] }); // 14.2
  const reserve = authorizeRun({ estimate: small, balance: OK(1010), policy: POLICY, runKind: "iteration" });
  assert.deepEqual(reserve.reasons, ["breaches_minimum_reserve"]);
  assert.equal(reserve.balanceAfterEstimate, 995.8);

  const broke = authorizeRun({ estimate: small, balance: OK(10), policy: { maxPerRun: 150, minReserve: 0 }, runKind: "iteration" });
  assert.deepEqual(broke.reasons, ["exceeds_balance", "breaches_minimum_reserve"]);

  const unknown = authorizeRun({ estimate: small, balance: { ok: false, balance: null, reason: "nonzero_exit" }, policy: POLICY, runKind: "iteration" });
  assert.deepEqual(unknown.reasons, ["balance_unavailable"]);
  assert.equal(unknown.allowed, false);

  const exact = authorizeRun({ estimate: small, balance: OK(1014.2), policy: POLICY, runKind: "iteration" });
  assert.equal(exact.allowed, true, "landing exactly on the reserve is allowed");
});

test("authorizeRun validates its inputs", () => {
  const e = estimateRun({ tests: [{ file: "a_test.md", author: false }] });
  assert.throws(() => authorizeRun({ estimate: e, balance: OK(1), policy: { maxPerRun: -1, minReserve: 0 }, runKind: "iteration" }), /policy/);
  assert.throws(() => authorizeRun({ estimate: e, balance: OK(1), policy: POLICY, runKind: "nightly" }), /runKind/);
  assert.throws(() => authorizeRun({ balance: OK(1), policy: POLICY, runKind: "iteration" }), /estimate/);
});

// ---------------------------------------------------------------- actual usage (real logs)

test("Run 1: logs total 90.08 across the three authored sessions; verdict credits are not added again", async () => {
  const u = await actualUsage({ runResult: runFromFixture("run1-authored"), sessionsDir: SESSIONS("run1-authored") });
  assert.equal(u.complete, true, u.problems.join(","));
  assert.equal(u.loggedCredits, 90.082768); // exact sum 90.0827675
  assert.equal(u.verdictCreditsIncluded, 2.46425);
  assert.equal(u.sessions.length, 3);
  assert.deepEqual(u.sessions.map((s) => [s.file, s.mode, s.runEnds]), [
    ["about_nav_test.md", "authored", 3],
    ["cart_test.md", "authored", 3],
    ["subscribe_test.md", "authored", 3],
  ]);
});

test("Run 2: passing replays log nothing; the live failing step logs 13.92", async () => {
  const u = await actualUsage({ runResult: runFromFixture("run2-replay"), sessionsDir: SESSIONS("run2-replay") });
  assert.equal(u.complete, true, u.problems.join(","));
  assert.equal(u.loggedCredits, 13.920988);
  const by = Object.fromEntries(u.sessions.map((s) => [s.file, s.credits]));
  assert.deepEqual(by, { "about_nav_test.md": 0, "cart_test.md": 0, "subscribe_test.md": 13.920988 });
});

test("Run 1 reconciliation: 19.04 credits unlogged -> discrepancy reported, balance used as the spend", async () => {
  const u = await actualUsage({ runResult: runFromFixture("run1-authored"), sessionsDir: SESSIONS("run1-authored") });
  const r = reconcileUsage({
    before: await balanceOf("run1-authored/balance_before.txt"),
    after: await balanceOf("run1-authored/balance_after.txt"),
    usage: u,
    estimate: 108,
  });
  assert.equal(r.status, "discrepancy");
  assert.deepEqual(r.reasons, ["unlogged_spend"]);
  assert.equal(r.spent, 109.1185);
  assert.equal(r.spentSource, "balance_difference");
  assert.equal(r.unloggedCredits, 19.035732);
});

test("Run 2 reconciliation: 0.38 unlogged is within tolerance -> consistent", async () => {
  const u = await actualUsage({ runResult: runFromFixture("run2-replay"), sessionsDir: SESSIONS("run2-replay") });
  const r = reconcileUsage({
    before: await balanceOf("run2-replay/balance_before.txt"),
    after: await balanceOf("run2-replay/balance_after.txt"),
    usage: u,
    estimate: 14.6,
  });
  assert.equal(r.status, "consistent", r.reasons.join(","));
  assert.equal(r.spent, 14.3036);
  assert.equal(r.unloggedCredits, 0.382612);
});

// ---------------------------------------------------------------- fabricated problems

test("unexpected cost: replays expected, but the balance dropped like an authoring run", async () => {
  const u = await actualUsage({ runResult: runFromFixture("run2-replay"), sessionsDir: SESSIONS("run2-replay") });
  const estimate = estimateRun({ tests: APPROVED_SMOKE.tests.map((t) => ({ file: t.file, author: false })) }).credits; // 0.6
  const r = reconcileUsage({ before: OK(11090.8815), after: OK(11000), usage: u, estimate });
  assert.equal(r.status, "discrepancy");
  assert.deepEqual(r.reasons, ["unlogged_spend", "exceeds_estimate"]);
});

test("logs claim more than the balance moved, and a balance that went up, are discrepancies", async () => {
  const u = { loggedCredits: 50, complete: true, problems: [] };
  assert.deepEqual(reconcileUsage({ before: OK(100), after: OK(90), usage: u }).reasons, ["logged_exceeds_balance_change"]);
  assert.deepEqual(reconcileUsage({ before: OK(100), after: OK(120), usage: { loggedCredits: 0, complete: true } }).reasons, ["balance_increased", "logged_exceeds_balance_change"]);
});

test("missing balances make reconciliation unverifiable: no actual spend, logs kept only as a lower bound", async () => {
  const u = await actualUsage({ runResult: runFromFixture("run2-replay"), sessionsDir: SESSIONS("run2-replay") });
  const r = reconcileUsage({ before: { ok: false, balance: null }, after: OK(11076.5779), usage: u, estimate: 14.6 });
  assert.equal(r.status, "unverifiable");
  assert.deepEqual(r.reasons, ["balance_before_unavailable"]);
  assert.equal(r.spent, null, "neither the logs nor the estimate stand in for the actual spend");
  assert.equal(r.spentSource, null);
  assert.equal(r.loggedCredits, 13.920988);
  assert.equal(r.loggedIsLowerBound, true);
  const rec = creditRecord(r);
  assert.deepEqual([rec.actualSpend, rec.actualSpendSource, rec.kaneReportedSpend, rec.estimate, rec.balanceBefore, rec.balanceAfter], [null, null, 13.920988, 14.6, null, 11076.5779]);
  assert.equal(reconcileUsage({ before: OK(1), after: { ok: false }, usage: u }).reasons.includes("balance_after_unavailable"), true);
});

// ---------------------------------------------------------------- Step 11 E1 regressions

// E1 (Kane 0.10.6, --local, 2 authored 3-step tests): balance 11076.5779 -> 10999.9376.
// Kane's session logs: cart-add-two 36.64698, newsletter-subscribe 25.053479.
const E1 = { before: 11076.5779, after: 10999.9376, cart: 36.64698, newsletter: 25.053479 };

test("E1 reconciliation: actual spend is the balance difference; the 14.94 Kane did not log stays visible", () => {
  const usage = { loggedCredits: Math.round((E1.cart + E1.newsletter) * 1e6) / 1e6, complete: true };
  const r = reconcileUsage({ before: OK(E1.before), after: OK(E1.after), usage, estimate: 72 });
  assert.equal(r.spent, 76.6403);
  assert.equal(r.spentSource, "balance_difference");
  assert.equal(r.status, "discrepancy");
  assert.ok(r.reasons.includes("unlogged_spend"), r.reasons.join(","));
  const rec = creditRecord(r);
  assert.deepEqual(rec, {
    status: "discrepancy",
    balanceBefore: 11076.5779,
    balanceAfter: 10999.9376,
    actualSpend: 76.6403,
    actualSpendSource: "balance_difference",
    kaneReportedSpend: 61.700459,
    kaneReportedIsLowerBound: true,
    discrepancy: 14.939841,
    estimate: 72,
    estimateDifference: 4.6403,
    reasons: r.reasons,
  });
});

test("E1 recalibration: two authored 3-step tests now estimate 94, above the real 76.64 and within the 100 cap", () => {
  const e = estimateRun({ tests: [{ file: "cart-add-two_test.md", author: true, steps: 3 }, { file: "newsletter-subscribe_test.md", author: true, steps: 3 }] });
  assert.equal(e.credits, 94);
  assert.ok(e.credits >= E1.before - E1.after);
  assert.ok(e.credits >= 72 && e.credits <= 100);
  // The most expensive single test E1 logged fits inside the per-test rate.
  assert.ok(DEFAULT_RATES.authorPerTest >= E1.cart);
  // Kane's unlogged run-level spend (E1 14.94, Run 1 19.04) fits inside the run overhead.
  assert.ok(DEFAULT_RATES.authorRunOverhead >= 19.04);
});

test("authoring estimates differ per test: longer tests cost more, overhead is charged once and only when authoring", () => {
  const e = estimateRun({ tests: [{ file: "a_test.md", author: true, steps: 3 }, { file: "b_test.md", author: true, steps: 5 }, { file: "c_test.md", author: false }] });
  assert.deepEqual(e.breakdown.map((b) => b.credits), [37, 62, 0.2]);
  assert.equal(e.runOverhead, 20);
  assert.equal(e.credits, 119.2);
  const replayOnly = estimateRun({ tests: [{ file: "a_test.md", author: false }, { file: "b_test.md", author: false, knownFailingSteps: 1 }] });
  assert.equal(replayOnly.runOverhead, 0);
  assert.equal(replayOnly.credits, 14.4, "the planned E2 replay figure is unchanged");
  // Fewer steps than the reference never make a test cheaper than the calibrated rate.
  assert.equal(estimateRun({ tests: [{ file: "a_test.md", author: true, steps: 1 }] }).breakdown[0].credits, 37);
  // Configurable, and margin can only add.
  assert.equal(estimateRun({ tests: [{ file: "a_test.md", author: true }] }, { rates: { ...DEFAULT_RATES, authorPerTest: 40, authorRunOverhead: 0 } }).credits, 40);
  assert.equal(estimateRun({ tests: [{ file: "a_test.md", author: true }] }, { margin: 1.5 }).credits, 85.5);
  assert.throws(() => estimateRun({ tests: [{ file: "a_test.md", author: true, steps: 0 }] }), /steps/);
  assert.throws(() => estimateRun({ tests: [{ file: "a_test.md", author: true }] }, { rates: { ...DEFAULT_RATES, authorRunOverhead: -1 } }), /authorRunOverhead/);
});

test("E1 layout: output dirs holding only meta.json are planned as fresh authoring, never as replays", async () => {
  const d = await tmp();
  for (const stem of ["cart-add-two", "newsletter-subscribe"]) {
    await mkdir(path.join(d, `output-${stem}`, ".internal"), { recursive: true });
    await writeFile(path.join(d, `output-${stem}`, ".internal", "meta.json"), '{"executions":[{"run_kind":"author","status":"passed"}]}');
  }
  const files = ["cart-add-two_test.md", "newsletter-subscribe_test.md"];
  const plan = await planFromRecordings({ testsDir: d, files, stepCounts: { "cart-add-two_test.md": 3, "newsletter-subscribe_test.md": 3 } });
  assert.deepEqual(plan.tests.map((t) => [t.file, t.author, t.steps]), [["cart-add-two_test.md", true, 3], ["newsletter-subscribe_test.md", true, 3]]);
  const e = estimateRun(plan);
  assert.equal(e.credits, 94);
  assert.equal(authorizeRun({ estimate: e, balance: OK(E1.after), policy: { maxPerRun: 28.3597, minReserve: 500 }, runKind: "iteration", confirmed: true }).reasons.includes("exceeds_per_run_cap"), true, "the remaining E2 budget cannot cover re-authoring");
});

test("incomplete and broken session logs are reported and make reconciliation a discrepancy", async () => {
  const d = await tmp();
  await cp(SESSIONS("run2-replay"), d, { recursive: true });
  const sub = path.join(d, "8d5ad336-e950-4e18-8e17-8e4884afa60a", "events.ndjson");
  const lines = (await readFile(sub, "utf8")).trim().split("\n");
  await writeFile(sub, lines.filter((l) => !l.includes("test_md_done")).join("\n") + "\n{cut off");
  await rm(path.join(d, "2d3d4d35-cf5f-4143-81b3-e52f04c1ffdf"), { recursive: true });

  const u = await actualUsage({ runResult: runFromFixture("run2-replay"), sessionsDir: d });
  assert.equal(u.complete, false);
  assert.ok(u.problems.includes("session_log_missing:2d3d4d35-cf5f-4143-81b3-e52f04c1ffdf"));
  assert.ok(u.problems.includes("session_log_incomplete:8d5ad336-e950-4e18-8e17-8e4884afa60a"));
  assert.ok(u.problems.includes("unparseable_lines:1:8d5ad336-e950-4e18-8e17-8e4884afa60a"));
  assert.equal(u.loggedCredits, 13.920988, "credits that were logged are still counted");

  const r = reconcileUsage({ before: OK(11090.8815), after: OK(11076.5779), usage: u, estimate: 14.6 });
  assert.equal(r.status, "discrepancy");
  assert.deepEqual(r.reasons, ["session_logs_incomplete"]);
});

test("invalid credit values, missing and unsafe session ids are reported", async () => {
  const d = await tmp();
  await mkdir(path.join(d, "aaaaaaaa-0000"), { recursive: true });
  await writeFile(
    path.join(d, "aaaaaaaa-0000", "events.ndjson"),
    '{"type":"run_end","credits_consumed":"12"}\n{"type":"run_end","credits_consumed":-3}\n{"type":"run_end","credits_consumed":2.5}\n{"type":"test_md_done"}\n',
  );
  const s = await readSessionCredits(path.join(d, "aaaaaaaa-0000", "events.ndjson"));
  assert.equal(s.credits, 2.5);
  assert.deepEqual(s.problems, ["invalid_credit_value", "invalid_credit_value"]);

  const run = fabricatedRun({ members: [{ file: "a_test.md", tags: ["clm-1"], status: "passed" }], exitCode: 0 });
  run.stream.members[0].attempts[0].start.sessionId = "../../etc";
  run.stream.members[0].attempts[0].end.sessionId = "../../etc";
  const u = await actualUsage({ runResult: run, sessionsDir: d });
  assert.deepEqual(u.problems, ["invalid_session_id:../../etc"]);

  const noId = fabricatedRun({ members: [{ file: "a_test.md", tags: ["clm-1"], status: "passed" }], exitCode: 0 });
  noId.stream.members[0].attempts[0].start.sessionId = null;
  noId.stream.members[0].attempts[0].end.sessionId = null;
  const u2 = await actualUsage({ runResult: noId, sessionsDir: d });
  assert.deepEqual(u2.problems, ["missing_session_id:a_test.md", "no_sessions"]);
});

test("a replay that broke and was re-authored counts both sessions once each", () => {
  const run = fabricatedRun({ members: [{ file: "a_test.md", tags: ["clm-1"], status: "passed", mode: "authored" }], exitCode: 0 });
  run.stream.members[0].attempts.unshift({ mode: "replay", start: { sessionId: "replay-0001" }, end: { status: "broken", sessionId: "replay-0001" } });
  const { sessions } = sessionsOfRun(run);
  assert.deepEqual(sessions.map((s) => [s.mode, s.sessionId]), [["replay", "replay-0001"], ["authored", "s-a_test.md"]]);
});

test("without sessionsDir, each test's own log_path from Kane is used", async () => {
  const run = runFromFixture("run2-replay");
  for (const m of run.stream.members) {
    for (const a of m.attempts) {
      a.end.logPath = path.join(SESSIONS("run2-replay"), a.end.sessionId, "events.ndjson");
    }
  }
  const u = await actualUsage({ runResult: run });
  assert.equal(u.loggedCredits, 13.920988);
  assert.equal(u.complete, true);
});
