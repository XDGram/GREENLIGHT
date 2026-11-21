// Actual credit usage after a run, and reconciliation against the balance.
//
// Source: each test's Kane session log (<sessions>/<session_id>/events.ndjson).
// Rule, checked against the Run 1 / Run 2 balance differences:
//   sum the top-level `credits_consumed` of every `run_end` event.
//   - `per_flow_metadata[].credits_consumed` repeats the same amount: not added.
//   - `verdict.credits_consumed` is part of the run_end total: adding it would
//     exceed Run 2's real balance change (13.92 + 2.33 > 14.30). Recorded only.
//
// The logs are a LOWER BOUND, not the bill: Run 1 logged 90.08 against a real
// 109.12 (authoring with Test Manager upload), Run 2 logged 13.92 against 14.30
// (passing replays log nothing). The balance difference is authoritative, and
// every gap beyond tolerance is reported, never silently accepted.

import path from "node:path";
import { readFile } from "node:fs/promises";

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;
const SESSION_DONE = "test_md_done";

export const DEFAULT_TOLERANCE = Object.freeze({
  absolute: 1, // credits
  relative: 0.05, // of the balance change
  estimateRelative: 0.25, // actual may exceed the estimate by this fraction ...
  estimateAbsolute: 2, // ... plus this many credits, before it is "unexpected"
});

/** All Kane sessions a run used, from Step 1's stream snapshot (every attempt of every test). */
export function sessionsOfRun(runResult) {
  const out = [];
  const seen = new Set();
  const problems = [];
  for (const m of runResult?.stream?.members ?? []) {
    if (!m.attempts?.length) problems.push(`no_attempts:${m.file}`);
    for (const a of m.attempts ?? []) {
      const sessionId = a.end?.sessionId ?? a.start?.sessionId ?? null;
      if (!sessionId) {
        problems.push(`missing_session_id:${m.file}`);
        continue;
      }
      if (seen.has(sessionId)) continue;
      seen.add(sessionId);
      out.push({ file: m.file, mode: a.mode, sessionId, logPath: a.end?.logPath ?? a.start?.logPath ?? null });
    }
  }
  return { sessions: out, problems };
}

/** Read one session log and total its credits. Never throws for log problems. */
export async function readSessionCredits(logFile) {
  let text;
  try {
    text = await readFile(logFile, "utf8");
  } catch (err) {
    return { ok: false, credits: 0, verdictCredits: 0, runEnds: 0, problems: [err.code === "ENOENT" ? "session_log_missing" : "session_log_unreadable"] };
  }
  const problems = [];
  let credits = 0;
  let verdictCredits = 0;
  let runEnds = 0;
  let badLines = 0;
  let done = false;
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      badLines += 1;
      continue;
    }
    if (e?.type === SESSION_DONE) done = true;
    if (e?.type !== "run_end") continue;
    runEnds += 1;
    if (e.credits_consumed !== undefined) {
      if (typeof e.credits_consumed === "number" && Number.isFinite(e.credits_consumed) && e.credits_consumed >= 0) credits += e.credits_consumed;
      else problems.push("invalid_credit_value");
    }
    const v = e.verdict?.credits_consumed;
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) verdictCredits += v;
  }
  if (badLines) problems.push(`unparseable_lines:${badLines}`);
  if (!done) problems.push("session_log_incomplete");
  return { ok: problems.length === 0, credits: round(credits), verdictCredits: round(verdictCredits), runEnds, problems };
}

/**
 * Credits logged by Kane for one run.
 * @param {object} p
 * @param {import("../kane/runner.js").KaneRunResult} p.runResult
 * @param {string} [p.sessionsDir]  Kane sessions directory. When omitted, each test's log_path is used.
 */
export async function actualUsage({ runResult, sessionsDir }) {
  const { sessions, problems } = sessionsOfRun(runResult);
  if (sessions.length === 0) problems.push("no_sessions");
  const perSession = [];
  for (const s of sessions) {
    if (!SESSION_ID.test(s.sessionId)) {
      perSession.push({ ...s, logFile: null, ok: false, credits: 0, verdictCredits: 0, runEnds: 0, problems: ["invalid_session_id"] });
      continue;
    }
    const logFile = sessionsDir ? path.join(sessionsDir, s.sessionId, "events.ndjson") : s.logPath;
    if (!logFile) {
      perSession.push({ ...s, logFile: null, ok: false, credits: 0, verdictCredits: 0, runEnds: 0, problems: ["no_log_path"] });
      continue;
    }
    perSession.push({ ...s, logFile, ...(await readSessionCredits(logFile)) });
  }
  const sessionProblems = perSession.flatMap((s) => s.problems.map((p) => `${p}:${s.sessionId}`));
  const allProblems = [...problems, ...sessionProblems];
  return {
    loggedCredits: round(perSession.reduce((t, s) => t + s.credits, 0)),
    verdictCreditsIncluded: round(perSession.reduce((t, s) => t + s.verdictCredits, 0)),
    complete: allProblems.length === 0,
    problems: allProblems,
    sessions: perSession,
  };
}

/**
 * Compare Kane's logged credits, the balance change and the estimate.
 * The balance change is the ONLY actual spend. When either balance is unknown the
 * actual spend is null: neither Kane's logs nor the estimate ever stand in for it
 * (the logs are kept, flagged as a lower bound).
 *
 * @param {object} p
 * @param {{ok: boolean, balance: number|null}} p.before   readBalance() before the run
 * @param {{ok: boolean, balance: number|null}} p.after    readBalance() after the run
 * @param {Awaited<ReturnType<typeof actualUsage>>} p.usage
 * @param {number} [p.estimate]   estimateRun().credits
 * @param {typeof DEFAULT_TOLERANCE} [p.tolerance]
 */
export function reconcileUsage({ before, after, usage, estimate, tolerance = DEFAULT_TOLERANCE }) {
  const reasons = [];
  const logged = usage?.loggedCredits ?? null;
  const est = Number.isFinite(estimate) ? estimate : null;
  const balanceBefore = before?.ok && Number.isFinite(before.balance) ? before.balance : null;
  const balanceAfter = after?.ok && Number.isFinite(after.balance) ? after.balance : null;
  if (!usage?.complete) reasons.push("session_logs_incomplete");

  if (balanceBefore === null || balanceAfter === null) {
    if (balanceBefore === null) reasons.push("balance_before_unavailable");
    if (balanceAfter === null) reasons.push("balance_after_unavailable");
    return {
      status: "unverifiable",
      spent: null,
      spentSource: null,
      balanceBefore,
      balanceAfter,
      balanceDelta: null,
      loggedCredits: logged,
      loggedIsLowerBound: true,
      unloggedCredits: null,
      estimate: est,
      estimateDifference: null,
      reasons,
    };
  }

  const delta = round(balanceBefore - balanceAfter);
  const allowance = Math.max(tolerance.absolute, tolerance.relative * Math.abs(delta));
  if (delta < 0) reasons.push("balance_increased");
  if (logged !== null && logged > delta + allowance) reasons.push("logged_exceeds_balance_change");
  if (logged !== null && delta - logged > allowance) reasons.push("unlogged_spend");
  if (est !== null && delta > est * (1 + tolerance.estimateRelative) + tolerance.estimateAbsolute) {
    reasons.push("exceeds_estimate");
  }
  return {
    status: reasons.length ? "discrepancy" : "consistent",
    spent: delta,
    spentSource: "balance_difference",
    balanceBefore,
    balanceAfter,
    balanceDelta: delta,
    loggedCredits: logged,
    loggedIsLowerBound: true,
    unloggedCredits: logged === null ? null : round(delta - logged),
    estimate: est,
    estimateDifference: est === null ? null : round(delta - est),
    reasons,
  };
}

/**
 * The persisted credit record (run manifest and latest.json).
 * actualSpend is the balance difference or null, never an estimate or a log total.
 * discrepancy = actualSpend - kaneReportedSpend (credits Kane's logs do not account for).
 * @param {ReturnType<typeof reconcileUsage>} r
 */
export function creditRecord(r) {
  if (!r) return null;
  return {
    status: r.status,
    balanceBefore: r.balanceBefore ?? null,
    balanceAfter: r.balanceAfter ?? null,
    actualSpend: r.spentSource === "balance_difference" ? r.spent : null,
    actualSpendSource: r.spentSource === "balance_difference" ? "balance_difference" : null,
    kaneReportedSpend: r.loggedCredits ?? null,
    kaneReportedIsLowerBound: true,
    discrepancy: r.unloggedCredits ?? null,
    estimate: r.estimate ?? null,
    estimateDifference: r.estimateDifference ?? null,
    reasons: [...(r.reasons ?? [])],
  };
}

function round(n) {
  return Math.round(n * 1e6) / 1e6;
}
