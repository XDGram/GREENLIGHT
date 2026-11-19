// Pre-run credit estimate and spending authorisation.
//
// Rates come from the Kane CLI 0.10.6 smoke test (balance differences):
//   - Run 1: 3 short tests authored for the first time = 109.12 credits  (~36 each)
//   - Run 2: 2 passing replays + 1 replay whose failed check runs live with the AI
//            = 14.30 credits; the live AI step logged 13.92 (~14 per failing step),
//            the replays ~0.13 each (budgeted at 0.2)
// They are estimates, not prices. Callers can override them.

import { access } from "node:fs/promises";
import path from "node:path";

export const DEFAULT_RATES = Object.freeze({
  authorPerTest: 36,
  replayPassPerTest: 0.2,
  failingAiStep: 14,
});

export const RUN_KIND = Object.freeze({ ITERATION: "iteration", CERTIFICATION: "certification" });

/**
 * Estimate one run.
 * @param {{tests: {file: string, author: boolean, knownFailingSteps?: number}[]}} plan
 *   author: true when the test has no usable recording and will be written fresh.
 *   knownFailingSteps: steps known to fail (no recording, so they run live with the AI each time).
 * @param {object} [opts]
 * @param {typeof DEFAULT_RATES} [opts.rates]
 * @param {number} [opts.margin]  multiplier applied to the total (default 1)
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
    let credits;
    let basis;
    if (t.author) {
      // Authoring cost already includes the AI working out every step.
      credits = rates.authorPerTest;
      basis = "author";
    } else {
      credits = rates.replayPassPerTest + failing * rates.failingAiStep;
      basis = failing > 0 ? "replay_with_live_failing_steps" : "replay";
    }
    return { file: t.file, basis, knownFailingSteps: failing, credits };
  });
  const subtotal = breakdown.reduce((s, b) => s + b.credits, 0);
  const authoredTests = breakdown.filter((b) => b.basis === "author").length;
  return {
    credits: round(subtotal * margin),
    subtotal: round(subtotal),
    margin,
    rates: { ...rates },
    authoredTests,
    liveFailingSteps: breakdown.reduce((s, b) => s + (b.basis === "author" ? 0 : b.knownFailingSteps), 0),
    breakdown,
  };
}

/**
 * Build an estimation plan from what is on disk and the last result.
 * A test is "author" when Kane has no recording for it: output-<stem>/.internal/execution.json
 * next to the test file (Kane 0.10.6 layout). Known failing steps: one per test the
 * previous evaluation classified as app_failure (Kane stops a test at its first failed step).
 */
export async function planFromRecordings({ testsDir, files, previousEvaluation }) {
  const failing = new Map();
  for (const t of previousEvaluation?.tests ?? []) {
    if (t.status === "app_failure") failing.set(t.file, 1);
  }
  const tests = [];
  for (const file of files) {
    const stem = path.basename(file).replace(/_test\.md$/, "");
    let recorded = true;
    try {
      await access(path.join(testsDir, path.dirname(file), `output-${stem}`, ".internal", "execution.json"));
    } catch {
      recorded = false;
    }
    tests.push({ file: path.basename(file), author: !recorded, knownFailingSteps: recorded ? failing.get(path.basename(file)) ?? 0 : 0 });
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
