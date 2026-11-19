// Pre-run credit estimate and spending authorisation.
//
// Calibration (Kane CLI 0.10.6, balance differences are the truth):
//   Smoke Run 1: 3 tests authored, Test Manager upload on      = 109.12 by balance
//                Kane-logged per test 31.68 / 33.68 / 24.73 (failed), 19.04 unlogged
//   Step 11 E1:  2 tests authored, --local, 3 steps each        =  76.64 by balance
//                Kane-logged per test 36.65 / 25.05 (failed),     14.94 unlogged
//   Smoke Run 2: 2 passing replays + 1 replay whose failed check ran live with the AI
//                = 14.30 by balance; the live AI step logged 13.92, replays ~0.13 each
//
// Tests do not cost the same: in both authoring runs the per-test cost varied by up
// to 12 credits, and every authoring run also spent 15-19 credits that no session
// log accounts for. So an authored test is budgeted at the most expensive test seen
// (36.65 -> 37) for up to REFERENCE_STEPS steps, plus a per-step amount beyond that
// (36.65 / 3 = 12.2 -> 12.5), and an authoring run adds a run-level overhead once
// (19.04 -> 20). E1 would now estimate 94 (actual 76.64), Run 1 131 (actual 109.12):
// deliberately conservative. These are estimates, not prices: callers can override
// every rate and add a margin >= 1, but nothing here can lower the caps, the reserve
// or the confirmation that authorizeRun() enforces.

import path from "node:path";
import { detectRecording } from "../spec/recordings.js";

/** Step count the per-test authoring rate already covers (the calibration tests had 3). */
export const REFERENCE_STEPS = 3;

export const DEFAULT_RATES = Object.freeze({
  authorPerTest: 37,
  authorPerExtraStep: 12.5,
  authorRunOverhead: 20,
  replayPassPerTest: 0.2,
  failingAiStep: 14,
});

export const RUN_KIND = Object.freeze({ ITERATION: "iteration", CERTIFICATION: "certification" });

/**
 * Estimate one run.
 * @param {{tests: {file: string, author: boolean, knownFailingSteps?: number, steps?: number|null}[]}} plan
 *   author: true when the test has no usable recording and will be written fresh.
 *   knownFailingSteps: steps known to fail (no recording, so they run live with the AI each time).
 *   steps: the approved test's step count (authoring cost grows beyond REFERENCE_STEPS).
 * @param {object} [opts]
 * @param {typeof DEFAULT_RATES} [opts.rates]
 * @param {number} [opts.margin]  multiplier applied to the total (default 1; never below 1)
 */
export function estimateRun(plan, { rates = DEFAULT_RATES, margin = 1 } = {}) {
  if (!plan || !Array.isArray(plan.tests) || plan.tests.length === 0) throw new TypeError("plan.tests must be a non-empty array");
  for (const k of Object.keys(DEFAULT_RATES)) {
    if (!(Number.isFinite(rates[k]) && rates[k] >= 0)) throw new TypeError(`rates.${k} must be a non-negative number`);
  }
  if (!(Number.isFinite(margin) && margin >= 1)) throw new TypeError("margin must be a number >= 1");

  const breakdown = plan.tests.map((t) => {
    const failing = t.knownFailingSteps ?? 0;
    if (!Number.isInteger(failing) || failing < 0) throw new TypeError(`knownFailingSteps must be a non-negative integer: ${t.file}`);
    const steps = t.steps ?? null;
    if (steps !== null && !(Number.isInteger(steps) && steps >= 1)) throw new TypeError(`steps must be a positive integer: ${t.file}`);
    let credits;
    let basis;
    if (t.author) {
      // Authoring cost already includes the AI working out every step.
      credits = rates.authorPerTest + Math.max(0, (steps ?? REFERENCE_STEPS) - REFERENCE_STEPS) * rates.authorPerExtraStep;
      basis = "author";
    } else {
      credits = rates.replayPassPerTest + failing * rates.failingAiStep;
      basis = failing > 0 ? "replay_with_live_failing_steps" : "replay";
    }
    return { file: t.file, basis, steps, knownFailingSteps: failing, credits: round(credits) };
  });
  const authoredTests = breakdown.filter((b) => b.basis === "author").length;
  const runOverhead = authoredTests > 0 ? rates.authorRunOverhead : 0;
  const subtotal = breakdown.reduce((s, b) => s + b.credits, 0) + runOverhead;
  return {
    credits: round(subtotal * margin),
    subtotal: round(subtotal),
    margin,
    rates: { ...rates },
    authoredTests,
    runOverhead,
    liveFailingSteps: breakdown.reduce((s, b) => s + (b.basis === "author" ? 0 : b.knownFailingSteps), 0),
    breakdown,
  };
}

/**
 * Build an estimation plan from what is on disk and the last result.
 * A test is "author" unless detectRecording() finds its replayable recording
 * (output-<stem>/.internal/execution.json, a JSON object). Known failing steps: one per
 * test the previous evaluation classified as app_failure (Kane stops a test at its
 * first failed step).
 * @param {object} p
 * @param {string} p.testsDir
 * @param {string[]} p.files
 * @param {{tests: {file, status}[]}|null} [p.previousEvaluation]
 * @param {Record<string, number>} [p.stepCounts]  approved step count per test file
 */
export async function planFromRecordings({ testsDir, files, previousEvaluation, stepCounts = {} }) {
  const failing = new Map();
  for (const t of previousEvaluation?.tests ?? []) {
    if (t.status === "app_failure") failing.set(t.file, 1);
  }
  const tests = [];
  for (const file of files) {
    const name = path.basename(file);
    const { recorded } = await detectRecording({ testsDir, file });
    const steps = stepCounts[name] ?? stepCounts[file] ?? null;
    tests.push({ file: name, author: !recorded, knownFailingSteps: recorded ? failing.get(name) ?? 0 : 0, ...(steps === null ? {} : { steps }) });
  }
  return { tests };
}

/**
 * Decide whether a run may go ahead.
 * @param {object} p
 * @param {ReturnType<typeof estimateRun>} p.estimate
 * @param {{ok: boolean, balance: number|null}} p.balance   from readBalance()
 * @param {{maxPerRun: number, minReserve: number}} p.policy
 * @param {"iteration"|"certification"} p.runKind
 * @param {boolean} [p.confirmed]   explicit human confirmation for authoring / certification
 */
export function authorizeRun({ estimate, balance, policy, runKind, confirmed = false }) {
  if (!estimate || !Number.isFinite(estimate.credits)) throw new TypeError("estimate is required");
  if (!policy || !(policy.maxPerRun >= 0) || !(policy.minReserve >= 0)) {
    throw new TypeError("policy.maxPerRun and policy.minReserve must be non-negative numbers");
  }
  if (!Object.values(RUN_KIND).includes(runKind)) throw new TypeError(`runKind must be one of ${Object.values(RUN_KIND).join(", ")}`);

  const reasons = [];
  const confirmationReasons = [];
  if (estimate.authoredTests > 0) confirmationReasons.push("fresh_authoring");
  if (runKind === RUN_KIND.CERTIFICATION) confirmationReasons.push("certification");
  const requiresConfirmation = confirmationReasons.length > 0;

  if (!balance?.ok || !Number.isFinite(balance.balance)) reasons.push("balance_unavailable");
  if (estimate.credits > policy.maxPerRun) reasons.push("exceeds_per_run_cap");
  if (balance?.ok && Number.isFinite(balance.balance)) {
    if (estimate.credits > balance.balance) reasons.push("exceeds_balance");
    if (balance.balance - estimate.credits < policy.minReserve) reasons.push("breaches_minimum_reserve");
  }
  if (requiresConfirmation && confirmed !== true) reasons.push("confirmation_required");

  return {
    allowed: reasons.length === 0,
    reasons,
    requiresConfirmation,
    confirmationReasons,
    estimate: estimate.credits,
    balance: balance?.ok ? balance.balance : null,
    balanceAfterEstimate: balance?.ok ? round(balance.balance - estimate.credits) : null,
    policy: { ...policy },
    runKind,
  };
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}
