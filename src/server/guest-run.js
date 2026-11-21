// One guest demo run: a real Kane run of a guest's own approved tests against their public URL.
//
// It reuses the certification pipeline's parts (fresh workspace, credit estimate and cap, Kane
// with --local and --no-adaptive-heal, classification from Kane's verdicts only) but is never a
// certification: there is no owner approval, no deployed-commit check and no evidence pack in the
// certification store. Results are written only to greenlight.guest_runs.
//
// A run that fails before Kane starts is refunded (it counts against no limit); once Kane has
// started, the run counts whatever happens.

import path from "node:path";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { projectFromText, toApprovedTests } from "../spec/generate.js";
import { catalogFromSpec } from "../report/failure-report.js";
import { buildTestrunArgs } from "../kane/runner.js";
import { evaluateRun } from "../verify/classify.js";
import { estimateRun, authorizeRun } from "../credits/estimate.js";
import { actualUsage, reconcileUsage, creditRecord } from "../credits/usage.js";
import { requirePublicHost } from "../deploy/host.js";
import { GreenlightError, errorBody } from "../cli/errors.js";

/** Kane's run name for a guest run (stable, readable in the Kane dashboard). */
export const guestRunName = (runId) => `guest-${runId.slice(4, 20)}`;

/** The credit estimate a guest sees before starting a run (fresh authoring of every test). */
export function guestEstimate(spec, config) {
  const catalog = catalogFromSpec(spec);
  const plan = { tests: catalog.tests.map((t) => ({ file: t.file, author: true, steps: t.steps.length })) };
  return estimateRun(plan, config.rates ? { rates: config.rates } : {});
}

/**
 * @param {object} p
 * @param {object} p.store   SupabaseStore (guest methods)
 * @param {string} p.runId
 * @param {object} p.config  loadConfig() result with config.guest
 * @param {object} p.deps    runKane, readBalance, now, [checkHost]
 * @returns {Promise<object>} the settled run
 */
export async function runGuestRun({ store, runId, config, deps, log = () => {} }) {
  let run = await store.guestGetRun(runId);
  if (run.status !== "queued") return run;
  const fail = async (err, { refund }) => {
    const e = err instanceof GreenlightError ? errorBody(err.code, err.message, err.details) : errorBody("internal_error", "The demo run failed unexpectedly.");
    if (!(err instanceof GreenlightError)) log({ event: "guest_run_error", runId, error: String(err?.stack ?? err) });
    return store.guestUpdateRun(runId, "failed", { error: e }, { refund });
  };

  run = await store.guestUpdateRun(runId, "running", {});
  const work = path.join(config.workDir, "guest", runId);
  let kaneStarted = false;
  try {
    const project = await store.guestGetProject(run.projectId, null);
    if (!project.approvedAt) throw new GreenlightError("approval_not_certifiable", "The tests were not approved.");
    let derived;
    try {
      derived = projectFromText(project.specText);
    } catch {
      throw new GreenlightError("spec_invalid", "The stored tests no longer parse.");
    }
    if (derived.hash !== project.approvedTestHash) throw new GreenlightError("approval_hash_mismatch", "The stored tests do not match the approved hash.");
    const url = project.url;
    await (deps.checkHost ?? ((h) => requirePublicHost(h)))(new URL(url).hostname).catch(() => {
      throw new GreenlightError("url_not_allowed", "The app URL must be a public address.");
    });

    // Fresh, empty workspace: nothing recorded or cached.
    await rm(work, { recursive: true, force: true });
    const testsDir = path.join(work, "tests");
    await mkdir(testsDir, { recursive: true, mode: 0o700 });
    for (const r of derived.rendered) await writeFile(path.join(testsDir, r.file), r.content, { flag: "wx", mode: 0o600 });

    // Credits: the demo's own cap; the operator confirmed these limits when enabling guest mode.
    const estimate = guestEstimate(derived.spec, config);
    const before = await deps.readBalance();
    const policy = { maxPerRun: config.guest.maxCreditsPerRun, minReserve: config.reserve };
    const auth = authorizeRun({ estimate, balance: before, policy, runKind: "certification", confirmed: true });
    if (!auth.allowed) {
      throw new GreenlightError(auth.reasons.includes("balance_unavailable") ? "balance_unavailable" : "credit_check_refused", `The demo's credit check refused this run (${auth.reasons.join(", ")}). Kane was not run.`, {
        estimate: estimate.credits,
        cap: policy.maxPerRun,
      });
    }

    kaneStarted = true;
    const startedAt = deps.now().toISOString();
    const runResult = await deps.runKane({
      args: buildTestrunArgs({ testFiles: derived.rendered.map((r) => r.file), startUrl: url, runName: guestRunName(runId), remote: config.kaneRemote ?? null }),
      cwd: testsDir,
      timeoutMs: config.kaneTimeoutMs,
    });
    const endedAt = deps.now().toISOString();
    const evaluation = evaluateRun(runResult, toApprovedTests(derived.rendered));
    const after = await deps.readBalance();
    const credits = creditRecord(reconcileUsage({ before, after, usage: await actualUsage({ runResult }), estimate: estimate.credits }));
    const titles = new Map(catalogFromSpec(derived.spec).tests.map((t) => [t.file, t.title]));
    const claimText = new Map(derived.spec.claims.map((c) => [c.id, c.text]));
    const result = {
      status: evaluation.project.status,
      counts: evaluation.project.counts,
      reasons: evaluation.project.reasons,
      runUsable: evaluation.run.usable === true,
      claims: evaluation.claims.map((c) => ({ id: c.id, text: claimText.get(c.id) ?? null, status: c.status })),
      tests: evaluation.tests.map((t) => ({
        file: t.file,
        title: titles.get(t.file) ?? null,
        claims: t.claims,
        status: t.status,
        reasons: t.reasons,
        durationS: t.kane?.durationS ?? null,
        failureMessage: t.kane?.failureMessage ?? null,
        failureStepIndex: t.kane?.failureStepIndex ?? null,
      })),
      credits: { estimate: estimate.credits, actual: credits?.actualSpend ?? null },
      kane: { executionId: runResult?.stream?.done?.executionId ?? null, exitCode: runResult?.exitCode ?? null, timedOut: runResult?.aborted === true },
      startedAt,
      endedAt,
      approvedTestHash: derived.hash,
      certified: false,
      notCertifiedBecause: ["guest_demo_run"],
    };
    run = await store.guestUpdateRun(runId, "succeeded", { result });
    return run;
  } catch (err) {
    return fail(err, { refund: !kaneStarted });
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => {});
  }
}
