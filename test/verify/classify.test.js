import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runKane } from "../../src/kane/runner.js";
import {
  evaluateRun,
  classifyTests,
  rollupClaims,
  projectVerdict,
  assessRun,
  normaliseApproved,
} from "../../src/verify/classify.js";
import { APPROVED_SMOKE, runFromFixture, fabricatedRun } from "./helpers.js";

const byFile = (tests) => Object.fromEntries(tests.map((t) => [t.file, t]));
const byId = (claims) => Object.fromEntries(claims.map((c) => [c.id, c]));
const T = (file, claims, status) => ({ file, claims, status, reasons: [], kane: null });

// ---------------------------------------------------------------- real fixtures

for (const dir of ["run1-authored", "run2-replay"]) {
  test(`${dir}: cart and about pass, subscribe is an app failure, project failed`, () => {
    const r = evaluateRun(runFromFixture(dir), APPROVED_SMOKE);
    assert.equal(r.run.usable, true, r.run.reasons.join(","));
    const t = byFile(r.tests);
    assert.equal(t["cart_test.md"].status, "passed");
    assert.equal(t["about_nav_test.md"].status, "passed");
    assert.equal(t["subscribe_test.md"].status, "app_failure");
    assert.equal(t["subscribe_test.md"].kane.failureStepIndex, 3);
    assert.match(t["subscribe_test.md"].kane.failureMessage, /Thanks for subscribing/);
    assert.equal(t["subscribe_test.md"].kane.mode, dir === "run1-authored" ? "authored" : "replay");

    const c = byId(r.claims);
    assert.equal(c["CLM-001"].status, "passed");
    assert.equal(c["CLM-002"].status, "failed");
    assert.equal(c["CLM-003"].status, "passed");

    assert.equal(r.project.status, "failed");
    assert.deepEqual(r.project.failingClaims, ["CLM-002"]);
    assert.deepEqual(r.project.unverifiedClaims, []);
    assert.deepEqual(r.project.counts, { passed: 2, failed: 1, partial: 0, couldnt_verify: 0 });
    assert.deepEqual(r.unapprovedTestsRun, []);
  });
}

test("Run 1 cut off mid-run: every test is couldnt_verify, even ones Kane already reported passed", () => {
  const r = evaluateRun(runFromFixture("run1-authored", { lines: 5 }), APPROVED_SMOKE);
  assert.equal(r.run.usable, false);
  assert.ok(r.run.reasons.includes("missing_completion_event"));
  assert.ok(r.run.reasons.includes("incomplete:members_without_end"));
  const t = byFile(r.tests);
  assert.equal(t["about_nav_test.md"].kane.status, "passed", "Kane's raw status is kept for the report");
  assert.equal(t["about_nav_test.md"].status, "couldnt_verify");
  assert.deepEqual(t["about_nav_test.md"].reasons, ["run_not_usable"]);
  assert.deepEqual(t["cart_test.md"].reasons, ["missing_test_end_event"]);
  assert.deepEqual(t["subscribe_test.md"].reasons, ["missing_test_end_event"]);
  assert.equal(r.project.status, "couldnt_verify");
  assert.deepEqual(r.project.failingClaims, [], "no fix loop on an incomplete run");
});

for (const [label, proc, reason] of [
  ["exit code 2", { exitCode: 2 }, "exit_code_2"],
  ["exit code 3", { exitCode: 3 }, "exit_code_3"],
  ["timeout", { timedOut: true }, "timed_out"],
  ["killed (no exit code)", { exitCode: null, signal: "SIGKILL" }, "no_exit_code"],
  ["unexpected exit code", { exitCode: 7 }, "exit_code_7"],
]) {
  test(`${label} on an otherwise complete Run 2 stream: all couldnt_verify`, () => {
    const r = evaluateRun(runFromFixture("run2-replay", proc), APPROVED_SMOKE);
    assert.equal(r.run.usable, false);
    assert.ok(r.run.reasons.includes(reason), r.run.reasons.join(","));
    assert.ok(r.tests.every((t) => t.status === "couldnt_verify"));
    assert.equal(r.project.status, "couldnt_verify");
  });
}

test("an end-to-end run through runKane with the fake Kane classifies the same as the fixture", async () => {
  const FIX = (p) => fileURLToPath(new URL(`../fixtures/kane/${p}`, import.meta.url));
  const run = await runKane({
    command: [process.execPath, FIX("fake-kane.mjs")],
    args: ["testrun", "run"],
    env: { ...process.env, FAKE_KANE_MODE: "replay", FAKE_KANE_STDOUT: FIX("run2-replay/stdout.ndjson"), FAKE_KANE_EXIT: "1" },
    timeoutMs: 20_000,
  });
  const r = evaluateRun(run, APPROVED_SMOKE);
  assert.equal(r.project.status, "failed");
  assert.deepEqual(r.project.failingClaims, ["CLM-002"]);
});

// ---------------------------------------------------------------- per-test mapping

test("status mapping: passed, failed, broken, interrupted, unknown, no end event", () => {
  const run = fabricatedRun({
    members: [
      { file: "a_test.md", tags: ["clm-1"], status: "passed" },
      { file: "b_test.md", tags: ["clm-1"], status: "failed" },
      { file: "c_test.md", tags: ["clm-1"], status: "broken" },
      { file: "d_test.md", tags: ["clm-1"], status: "interrupted" },
      { file: "e_test.md", tags: ["clm-1"], status: "skipped" },
      { file: "f_test.md", tags: ["clm-1"] },
    ],
    exitCode: 1,
  });
  // A test with no end event makes the run incomplete, so classify per-member on a
  // complete run first, then check the incomplete case separately.
  const complete = fabricatedRun({
    members: [
      { file: "a_test.md", tags: ["clm-1"], status: "passed" },
      { file: "b_test.md", tags: ["clm-1"], status: "failed" },
      { file: "c_test.md", tags: ["clm-1"], status: "broken" },
      { file: "d_test.md", tags: ["clm-1"], status: "interrupted" },
      { file: "e_test.md", tags: ["clm-1"], status: "skipped" },
    ],
    exitCode: 1,
  });
  const approved = { tests: ["a", "b", "c", "d", "e", "f"].map((x) => ({ file: `${x}_test.md`, claims: ["CLM-1"] })) };
  const t = byFile(classifyTests(complete, approved).tests);
  assert.equal(t["a_test.md"].status, "passed");
  assert.equal(t["b_test.md"].status, "app_failure");
  assert.deepEqual([t["c_test.md"].status, t["c_test.md"].reasons], ["couldnt_verify", ["kane_status_broken"]]);
  assert.deepEqual([t["d_test.md"].status, t["d_test.md"].reasons], ["couldnt_verify", ["kane_status_interrupted"]]);
  assert.deepEqual([t["e_test.md"].status, t["e_test.md"].reasons], ["couldnt_verify", ["kane_status_unknown:skipped"]]);
  assert.deepEqual([t["f_test.md"].status, t["f_test.md"].reasons], ["couldnt_verify", ["not_reported_by_kane"]]);

  const ti = byFile(classifyTests(run, approved).tests);
  assert.deepEqual(ti["f_test.md"].reasons, ["missing_test_end_event"]);
  assert.ok(Object.values(ti).every((x) => x.status === "couldnt_verify"), "incomplete run: nothing is trusted");
});

test("authored and replayed end events are classified identically", () => {
  for (const mode of ["authored", "replay"]) {
    const run = fabricatedRun({ members: [{ file: "a_test.md", tags: ["clm-1"], status: "failed", mode }], exitCode: 1 });
    const [t] = classifyTests(run, { tests: [{ file: "a_test.md", claims: ["CLM-1"] }] }).tests;
    assert.equal(t.status, "app_failure");
    assert.equal(t.kane.mode, mode);
  }
});

test("Kane's AI diagnosis is ignored: an 'agent_misstep' failure is still an app failure", () => {
  const run = fabricatedRun({
    members: [{ file: "a_test.md", tags: ["clm-1"], status: "failed", message: "bug verdict: automation_bug/agent_misstep" }],
    exitCode: 1,
    extraEvents: [
      { type: "verdict", result: "pass", exit_code: 0 },
      { type: "test_md_bug_verdict", confirmed: false, family: "automation_bug", category: "agent_misstep" },
    ],
  });
  const r = evaluateRun(run, { tests: [{ file: "a_test.md", claims: ["CLM-1"] }] });
  assert.equal(r.tests[0].status, "app_failure");
  assert.equal(r.project.status, "failed");
});

test("missing completion event alone makes the run unusable", () => {
  const run = fabricatedRun({ members: [{ file: "a_test.md", tags: ["clm-1"], status: "passed" }], done: false, exitCode: 0 });
  const r = evaluateRun(run, { tests: [{ file: "a_test.md", claims: ["CLM-1"] }] });
  assert.ok(r.run.reasons.includes("missing_completion_event"));
  assert.equal(r.tests[0].status, "couldnt_verify");
  assert.equal(r.project.status, "couldnt_verify");
});

test("invalid plan makes the run unusable", () => {
  const run = fabricatedRun({ members: [{ file: "a_test.md", tags: ["clm-1"], status: "passed" }], planValid: false, exitCode: 2 });
  const r = evaluateRun(run, { tests: [{ file: "a_test.md", claims: ["CLM-1"] }] });
  assert.ok(r.run.reasons.includes("plan_invalid"));
  assert.ok(r.run.reasons.includes("exit_code_2"));
  assert.equal(r.project.status, "couldnt_verify");
});

test("cancelled summary makes the run unusable", () => {
  const run = fabricatedRun({ members: [{ file: "a_test.md", tags: ["clm-1"], status: "passed" }], cancelled: true, exitCode: 0 });
  const r = evaluateRun(run, { tests: [{ file: "a_test.md", claims: ["CLM-1"] }] });
  assert.ok(r.run.reasons.includes("incomplete:cancelled"));
  assert.equal(r.tests[0].status, "couldnt_verify");
});

test("exit code that contradicts per-test statuses makes every test couldnt_verify", () => {
  const approved = { tests: [{ file: "a_test.md", claims: ["CLM-1"] }] };
  const exit0Failed = fabricatedRun({ members: [{ file: "a_test.md", tags: ["clm-1"], status: "failed" }], exitCode: 0 });
  const r1 = evaluateRun(exit0Failed, approved);
  assert.equal(r1.run.usable, false);
  assert.deepEqual(r1.run.inconsistencies, ["exit_0_but_not_all_passed"]);
  assert.equal(r1.tests[0].status, "couldnt_verify");

  const exit1Passed = fabricatedRun({ members: [{ file: "a_test.md", tags: ["clm-1"], status: "passed" }], exitCode: 1, overallStatus: "passed" });
  const r2 = evaluateRun(exit1Passed, approved);
  assert.deepEqual(r2.run.inconsistencies, ["exit_1_but_all_passed"]);
  assert.equal(r2.project.status, "couldnt_verify");

  const overallMismatch = fabricatedRun({ members: [{ file: "a_test.md", tags: ["clm-1"], status: "failed" }], exitCode: 1, overallStatus: "passed" });
  assert.deepEqual(evaluateRun(overallMismatch, approved).run.inconsistencies, ["overall_passed_but_not_all_passed"]);
});

test("an approved test Kane never ran is couldnt_verify; an unapproved test Kane ran is reported, not counted", () => {
  const run = fabricatedRun({
    members: [
      { file: "a_test.md", tags: ["clm-1"], status: "passed" },
      { file: "extra_test.md", tags: ["clm-1"], status: "passed" },
    ],
    exitCode: 0,
  });
  const r = evaluateRun(run, { tests: [{ file: "a_test.md", claims: ["CLM-1"] }, { file: "b_test.md", claims: ["CLM-2"] }] });
  const t = byFile(r.tests);
  assert.equal(t["a_test.md"].status, "passed");
  assert.deepEqual([t["b_test.md"].status, t["b_test.md"].reasons], ["couldnt_verify", ["not_reported_by_kane"]]);
  assert.deepEqual(r.unapprovedTestsRun, ["extra_test.md"]);
  assert.equal(byId(r.claims)["CLM-2"].status, "couldnt_verify");
  assert.equal(r.project.status, "couldnt_verify");
  assert.equal(r.tests.length, 2, "only approved tests are classified");
});

test("tags in the file Kane ran must cover the approved claims (case-insensitive)", () => {
  const run = fabricatedRun({ members: [{ file: "a_test.md", tags: ["clm-1"], status: "passed" }], exitCode: 0 });
  const ok = classifyTests(run, { tests: [{ file: "a_test.md", claims: ["CLM-1"] }] }).tests[0];
  assert.equal(ok.status, "passed");
  const bad = classifyTests(run, { tests: [{ file: "a_test.md", claims: ["CLM-1", "CLM-9"] }] }).tests[0];
  assert.equal(bad.status, "couldnt_verify");
  assert.deepEqual(bad.reasons, ["claim_tags_missing:CLM-9"]);
});

test("a test that replayed broken and was then re-authored as passed uses its final status", () => {
  const run = fabricatedRun({
    members: [{ file: "a_test.md", tags: ["clm-1"], status: "passed", mode: "authored" }],
    exitCode: 0,
  });
  // Insert an earlier broken replay attempt for the same test.
  const m = run.stream.members[0];
  m.attempts.unshift({ mode: "replay", start: null, end: { status: "broken" } });
  const [t] = classifyTests(run, { tests: [{ file: "a_test.md", claims: ["CLM-1"] }] }).tests;
  assert.equal(t.status, "passed");
  assert.equal(t.kane.mode, "authored");
});

test("assessRun handles a missing run result", () => {
  assert.deepEqual(assessRun(null), { usable: false, reasons: ["no_run_result"] });
});

// ---------------------------------------------------------------- claim roll-up

test("claim roll-up rules", () => {
  const cases = [
    [["passed", "passed"], "passed"],
    [["app_failure", "app_failure"], "failed"],
    [["passed", "app_failure"], "partial"],
    [["passed", "app_failure", "couldnt_verify"], "partial"],
    [["app_failure", "couldnt_verify"], "failed"],
    [["passed", "couldnt_verify"], "couldnt_verify"],
    [["couldnt_verify", "couldnt_verify"], "couldnt_verify"],
    [["passed"], "passed"],
    [["app_failure"], "failed"],
  ];
  for (const [statuses, expected] of cases) {
    const [claim] = rollupClaims(statuses.map((s, i) => T(`t${i}_test.md`, ["CLM-X"], s)));
    assert.equal(claim.status, expected, `${statuses.join("+")} -> ${expected}`);
    assert.equal(claim.tests.length, statuses.length);
  }
});

test("a test can verify several claims, and claims come out sorted", () => {
  const claims = rollupClaims([
    T("a_test.md", ["CLM-2", "CLM-1"], "passed"),
    T("b_test.md", ["CLM-2"], "app_failure"),
  ]);
  assert.deepEqual(claims.map((c) => [c.id, c.status]), [["CLM-1", "passed"], ["CLM-2", "partial"]]);
  assert.deepEqual(claims[1].counts, { passed: 1, app_failure: 1, couldnt_verify: 0 });
});

// ---------------------------------------------------------------- project verdict

test("project verdict rules", () => {
  const C = (...statuses) => statuses.map((s, i) => ({ id: `CLM-${i}`, status: s }));
  assert.equal(projectVerdict(C("passed", "passed")).status, "passed");
  assert.equal(projectVerdict(C("passed", "failed")).status, "failed");
  assert.equal(projectVerdict(C("passed", "partial")).status, "failed");
  assert.equal(projectVerdict(C("passed", "couldnt_verify")).status, "couldnt_verify");
  const mixed = projectVerdict(C("failed", "couldnt_verify", "passed"));
  assert.equal(mixed.status, "failed");
  assert.equal(mixed.hasUnverifiedClaims, true);
  assert.deepEqual(mixed.failingClaims, ["CLM-0"]);
  assert.deepEqual(mixed.unverifiedClaims, ["CLM-1"]);
  const none = projectVerdict([]);
  assert.equal(none.status, "couldnt_verify");
  assert.deepEqual(none.reasons, ["no_claims"]);
  assert.deepEqual(projectVerdict(C("passed"), { usable: false }).reasons, ["run_not_usable"]);
});

test("all approved tests passing in a complete run gives a passed project", () => {
  const run = fabricatedRun({
    members: [
      { file: "a_test.md", tags: ["clm-1"], status: "passed" },
      { file: "b_test.md", tags: ["clm-2"], status: "passed", mode: "authored" },
    ],
    exitCode: 0,
  });
  const r = evaluateRun(run, { tests: [{ file: "a_test.md", claims: ["CLM-1"] }, { file: "b_test.md", claims: ["CLM-2"] }] });
  assert.equal(r.run.usable, true);
  assert.equal(r.project.status, "passed");
  assert.deepEqual(r.project.counts, { passed: 2, failed: 0, partial: 0, couldnt_verify: 0 });
});

// ---------------------------------------------------------------- approved input validation

test("approved test list is validated", () => {
  assert.throws(() => normaliseApproved(undefined), /non-empty/);
  assert.throws(() => normaliseApproved({ tests: [] }), /non-empty/);
  assert.throws(() => normaliseApproved({ tests: [{ file: "a.md", claims: ["C"] }] }), /_test\.md/);
  assert.throws(() => normaliseApproved({ tests: [{ file: "a_test.md", claims: [] }] }), /no claims/);
  assert.throws(() => normaliseApproved({ tests: [{ file: "a_test.md", claims: [" "] }] }), /empty claim/);
  assert.throws(
    () => normaliseApproved({ tests: [{ file: "a_test.md", claims: ["C"] }, { file: "x/a_test.md", claims: ["C"] }] }),
    /twice/,
  );
  assert.deepEqual(normaliseApproved({ tests: [{ file: "dir/a_test.md", claims: ["C", "C"] }] }), [{ file: "a_test.md", claims: ["C"] }]);
});
