// Greenlight result classification and claim roll-up (Phase 1, Step 2).
//
// Input: a KaneRunResult from src/kane/runner.js (unchanged), plus the APPROVED
// list of tests and the claims each one verifies.
//
// Classification uses only:
//   - whether the run as a whole is trustworthy (completeness, exit code, timeout)
//   - Kane's final per-test status (testrun_member_end / testrun_authored_member_end)
// It never reads Kane's root-cause analysis, failure.yaml verdicts, bug verdicts,
// `verdict` events or any AI diagnosis. Kane's failure message is carried through
// for the failure report only.

import { memberKey } from "../kane/testrun-stream.js";

export const TEST_STATUS = Object.freeze({
  PASSED: "passed",
  APP_FAILURE: "app_failure",
  COULDNT_VERIFY: "couldnt_verify",
});

export const CLAIM_STATUS = Object.freeze({
  PASSED: "passed",
  FAILED: "failed",
  PARTIAL: "partial",
  COULDNT_VERIFY: "couldnt_verify",
});

export const PROJECT_STATUS = Object.freeze({
  PASSED: "passed",
  FAILED: "failed",
  COULDNT_VERIFY: "couldnt_verify",
});

// Exit codes Kane 0.10.6 documents for `testrun run`.
const EXIT_PASSED = 0;
const EXIT_FAILED = 1;

/**
 * Normalise the approved test list.
 * @param {{tests: {file: string, claims: string[]}[]}} approved
 */
export function normaliseApproved(approved) {
  if (!approved || !Array.isArray(approved.tests) || approved.tests.length === 0) {
    throw new TypeError("approved.tests must be a non-empty array");
  }
  const seen = new Set();
  return approved.tests.map((t) => {
    const file = memberKey(t?.file);
    if (!file.endsWith("_test.md")) throw new TypeError(`approved test is not a *_test.md file: ${t?.file}`);
    if (seen.has(file)) throw new TypeError(`approved test listed twice: ${file}`);
    seen.add(file);
    if (!Array.isArray(t.claims) || t.claims.length === 0) throw new TypeError(`approved test has no claims: ${file}`);
    const claims = [...new Set(t.claims.map((c) => String(c).trim()))];
    if (claims.some((c) => c === "")) throw new TypeError(`approved test has an empty claim id: ${file}`);
    return { file, claims };
  });
}

/**
 * Is the run as a whole trustworthy enough to use per-test statuses?
 * Returns facts only; every reason makes all tests couldnt_verify.
 * @param {import("../kane/runner.js").KaneRunResult} run
 */
export function assessRun(run) {
  const reasons = [];
  if (!run || typeof run !== "object") return { usable: false, reasons: ["no_run_result"] };
  if (run.timedOut) reasons.push("timed_out");
  if (run.exitCode === 2) reasons.push("exit_code_2");
  else if (run.exitCode === 3) reasons.push("exit_code_3");
  else if (run.exitCode === null || run.exitCode === undefined) reasons.push("no_exit_code");
  else if (run.exitCode !== EXIT_PASSED && run.exitCode !== EXIT_FAILED) reasons.push(`exit_code_${run.exitCode}`);
  const completeness = run.completeness ?? { complete: false, reasons: ["no_completeness"] };
  if (!completeness.complete) reasons.push("incomplete_run", ...completeness.reasons.map((r) => `incomplete:${r}`));
  if (!run.stream?.done) reasons.push("missing_completion_event");
  if (run.stream?.plan && !run.stream.plan.valid) reasons.push("plan_invalid");
  return { usable: reasons.length === 0, reasons: [...new Set(reasons)] };
}

/**
 * Map one approved test to a Greenlight status.
 * @returns {{status: string, reasons: string[]}}
 */
function classifyMember(member, runUsable) {
  if (!member) return { status: TEST_STATUS.COULDNT_VERIFY, reasons: ["not_reported_by_kane"] };
  if (!member.final) return { status: TEST_STATUS.COULDNT_VERIFY, reasons: ["missing_test_end_event"] };
  if (!runUsable) return { status: TEST_STATUS.COULDNT_VERIFY, reasons: ["run_not_usable"] };
  switch (member.final.status) {
    case "passed":
      return { status: TEST_STATUS.PASSED, reasons: [] };
    case "failed":
      return { status: TEST_STATUS.APP_FAILURE, reasons: [] };
    case "broken":
      return { status: TEST_STATUS.COULDNT_VERIFY, reasons: ["kane_status_broken"] };
    case "interrupted":
      return { status: TEST_STATUS.COULDNT_VERIFY, reasons: ["kane_status_interrupted"] };
    default:
      return { status: TEST_STATUS.COULDNT_VERIFY, reasons: [`kane_status_unknown:${member.final.status}`] };
  }
}

/**
 * Classify every approved test from one Kane run.
 *
 * @param {import("../kane/runner.js").KaneRunResult} run
 * @param {{tests: {file: string, claims: string[]}[]}} approved
 */
export function classifyTests(run, approved) {
  const approvedTests = normaliseApproved(approved);
  const runAssessment = assessRun(run);
  const members = new Map((run?.stream?.members ?? []).map((m) => [m.file, m]));

  let tests = approvedTests.map(({ file, claims }) => {
    const member = members.get(file);
    const { status, reasons } = classifyMember(member, runAssessment.usable);
    const r = [...reasons];

    // Claim membership comes from the approved list. Kane lowercases the
    // `tags:` it read from the test file; if they do not cover the approved
    // claims, the file Kane ran is not the approved one.
    let finalStatus = status;
    if (member?.final && member.inPlan) {
      const kaneTags = new Set((member.tags ?? []).map((t) => String(t).toLowerCase()));
      const missing = claims.filter((c) => !kaneTags.has(c.toLowerCase()));
      if (missing.length) {
        finalStatus = TEST_STATUS.COULDNT_VERIFY;
        r.push(`claim_tags_missing:${missing.join(",")}`);
      }
    }

    return {
      file,
      claims,
      status: finalStatus,
      reasons: r,
      // Kane's raw report, for the failure report. Not used for classification beyond `status`.
      kane: member?.final
        ? {
            status: member.final.status,
            mode: member.final.mode,
            durationS: member.final.durationS,
            testId: member.final.testId,
            sessionId: member.final.sessionId,
            logPath: member.final.logPath,
            failureMessage: member.final.failure?.message ?? null,
            failureStepIndex: member.final.failure?.step_index ?? null,
          }
        : null,
    };
  });

  // Cross-check: the exit code must agree with the per-test statuses.
  // exit 0 = every test passed; exit 1 = at least one failed or broke.
  const crossCheck = [];
  if (runAssessment.usable) {
    const statuses = [...members.values()].filter((m) => m.inPlan).map((m) => m.final?.status);
    const allPassed = statuses.length > 0 && statuses.every((s) => s === "passed");
    if (run.exitCode === EXIT_PASSED && !allPassed) crossCheck.push("exit_0_but_not_all_passed");
    if (run.exitCode === EXIT_FAILED && allPassed) crossCheck.push("exit_1_but_all_passed");
    if (run.stream.done.overallStatus === "passed" && !allPassed) crossCheck.push("overall_passed_but_not_all_passed");
    if (run.stream.done.overallStatus === "failed" && allPassed) crossCheck.push("overall_failed_but_all_passed");
  }
  if (crossCheck.length) {
    tests = tests.map((t) => ({
      ...t,
      status: TEST_STATUS.COULDNT_VERIFY,
      reasons: [...t.reasons, ...crossCheck.map((c) => `inconsistent:${c}`)],
    }));
  }

  // Tests Kane ran that were not approved: reported, never counted.
  const approvedFiles = new Set(approvedTests.map((t) => t.file));
  const unapproved = [...members.keys()].filter((f) => !approvedFiles.has(f));

  return {
    run: { ...runAssessment, usable: runAssessment.usable && crossCheck.length === 0, inconsistencies: crossCheck },
    tests,
    unapprovedTestsRun: unapproved,
  };
}

/**
 * Roll per-test statuses up to claims.
 *   all passed                          -> passed
 *   all failed                          -> failed
 *   passed and failed (any unverified)  -> partial
 *   failed and unverified, none passed  -> failed
 *   unverified and no failed test       -> couldnt_verify
 *   no tests                            -> couldnt_verify
 */
export function rollupClaims(tests) {
  const byClaim = new Map();
  for (const t of tests) {
    for (const claim of t.claims) {
      if (!byClaim.has(claim)) byClaim.set(claim, []);
      byClaim.get(claim).push(t);
    }
  }
  return [...byClaim.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([id, ts]) => {
      const counts = { passed: 0, app_failure: 0, couldnt_verify: 0 };
      for (const t of ts) counts[t.status] += 1;
      let status;
      if (ts.length === 0) status = CLAIM_STATUS.COULDNT_VERIFY;
      else if (counts.app_failure === 0 && counts.couldnt_verify > 0) status = CLAIM_STATUS.COULDNT_VERIFY;
      else if (counts.app_failure === 0) status = CLAIM_STATUS.PASSED;
      else if (counts.passed === 0) status = CLAIM_STATUS.FAILED;
      else status = CLAIM_STATUS.PARTIAL;
      return { id, status, counts, tests: ts.map((t) => ({ file: t.file, status: t.status })) };
    });
}

/**
 * Project-level verdict.
 *   every claim passed                   -> passed
 *   any claim failed or partial          -> failed (fixable app failures exist)
 *   otherwise any claim couldnt_verify   -> couldnt_verify
 */
export function projectVerdict(claims, runAssessment) {
  const counts = { passed: 0, failed: 0, partial: 0, couldnt_verify: 0 };
  for (const c of claims) counts[c.status] += 1;
  let status;
  const reasons = [];
  if (claims.length === 0) {
    status = PROJECT_STATUS.COULDNT_VERIFY;
    reasons.push("no_claims");
  } else if (counts.failed + counts.partial > 0) {
    status = PROJECT_STATUS.FAILED;
  } else if (counts.couldnt_verify > 0) {
    status = PROJECT_STATUS.COULDNT_VERIFY;
  } else {
    status = PROJECT_STATUS.PASSED;
  }
  if (runAssessment && !runAssessment.usable) reasons.push("run_not_usable");
  return {
    status,
    counts,
    reasons,
    // Claims with app failures: candidates for the automatic fix loop.
    failingClaims: claims.filter((c) => c.status === CLAIM_STATUS.FAILED || c.status === CLAIM_STATUS.PARTIAL).map((c) => c.id),
    unverifiedClaims: claims.filter((c) => c.status === CLAIM_STATUS.COULDNT_VERIFY).map((c) => c.id),
    // Some claims failed while others could not be checked at all.
    hasUnverifiedClaims: counts.couldnt_verify > 0,
  };
}

/** Classify one Kane run end to end: tests -> claims -> project. */
export function evaluateRun(run, approved) {
  const classified = classifyTests(run, approved);
  const claims = rollupClaims(classified.tests);
  const project = projectVerdict(claims, classified.run);
  return { run: classified.run, tests: classified.tests, claims, project, unapprovedTestsRun: classified.unapprovedTestsRun };
}
