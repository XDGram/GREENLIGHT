// Server-side certification run (brief §11): the only way a Greenlight
// certification can come into existence.
//
// 1. The test version and its human (owner) approval are read from the SERVER's
//    store; the approved-test hash is re-derived from the stored spec text and
//    must equal both. Local approval files, relayed approvals and iteration
//    reports are never inputs.
// 2. The URL must be public (DNS-checked) and /greenlight.json must report the
//    requested commit.
// 3. The approved tests are written into an EMPTY workspace, so there are no
//    recordings and nothing cached: the run is fresh by construction.
// 4. Credits: estimate (fresh authoring), server cap and reserve, and the owner's
//    explicit per-request spend confirmation, all before Kane starts.
// 5. Kane runs (--local, --no-adaptive-heal, mandatory), results are classified
//    from Kane's verdicts only, evidence is collected, validated and hashed.
// 6. A permanent, write-once verification record is created for every run that
//    reached Kane, passed or not; `certified` is true only when it fully passed.

import path from "node:path";
import { mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { projectFromText, toApprovedTests } from "../spec/generate.js";
import { catalogFromSpec } from "../report/failure-report.js";
import { buildTestrunArgs } from "../kane/runner.js";
import { evaluateRun } from "../verify/classify.js";
import { collectEvidence } from "../evidence/collect.js";
import { estimateRun, authorizeRun } from "../credits/estimate.js";
import { actualUsage, reconcileUsage, creditRecord } from "../credits/usage.js";
import { requireReady } from "../deploy/check.js";
import { GreenlightError } from "../cli/errors.js";
import { approvalValidFor, buildVerificationRecord } from "./models.js";
import { browserApprovalRequired, verifyBrowserApproval, isGuestAccount } from "./approval-policy.js";
import { newId } from "./store.js";

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** The run id of a certification job's one Kane run (stable, so recovery can find it). */
export const certificationRunId = (jobId) => `cert-${jobId.slice(4, 20)}`;

/** Everything checked before any credit can be spent. Throws GreenlightError. */
export async function prepareCertification({ store, project, versionNo, request, config }) {
  const version = await store.getVersion(project.id, versionNo);
  const approval = await store.getApproval(project.id, versionNo);
  if (!approval) throw new GreenlightError("approval_not_certifiable", `Test version ${versionNo} has no human approval on the server.`);
  // Server authority: recompute the hash from the stored spec, never trust stored or submitted hashes.
  let derived;
  try {
    derived = projectFromText(version.specText);
  } catch {
    throw new GreenlightError("spec_invalid", "The stored specification no longer parses; it cannot be certified.");
  }
  if (derived.hash !== version.approvedTestHash) throw new GreenlightError("approval_hash_mismatch", "Stored tests do not match their recorded hash.");
  if (!approvalValidFor(approval, derived.hash)) throw new GreenlightError("approval_not_certifiable", "The approval is not a valid human approval for exactly these tests.");
  if (browserApprovalRequired(config, project.account)) {
    const b = verifyBrowserApproval(config, approval, derived.hash, project.account);
    if (!b.ok) throw new GreenlightError("approval_not_certifiable", `This account requires a signed browser approval by its approver (${b.reason}).`, { reason: b.reason });
  }
  if (request.approvedTestHash !== undefined && request.approvedTestHash !== derived.hash) {
    throw new GreenlightError("approval_hash_mismatch", "The submitted approved-test hash is not the approved version's hash.", { approved: derived.hash });
  }
  if (typeof request.commit !== "string" || !SHA.test(request.commit)) throw new GreenlightError("invalid_request", "commit must be a full lowercase git commit hash.");
  if (!Number.isFinite(request.confirmSpend) || request.confirmSpend <= 0) {
    throw new GreenlightError("confirmation_required", "Certification spends credits: confirmSpend (the most credits the owner accepts for this run) is required.");
  }
  const url = request.url ?? derived.spec.project.url;
  return { version, approval, derived, url };
}

/**
 * Run one certification job end to end.
 * @param {object} p
 * @param {import("./store.js").FileStore} p.store
 * @param {object} p.job          the job record (status running)
 * @param {object} p.config       server config (credit caps, timeouts)
 * @param {object} p.deps         runKane, readBalance, validator, verifyLiveDeployment, now
 * @returns {Promise<{record: object|null, outcome: string, error?: object}>}
 */
export async function runCertification({ store, job, config, deps }) {
  const project = await store.getProject(job.projectId);
  const { version, approval, derived, url } = await prepareCertification({ store, project, versionNo: job.version, request: job.request, config });
  // Guest accounts: a verification run, never a certification. The account decides, not the request.
  const guest = isGuestAccount(project.account);
  const selected = guest && Array.isArray(job.request.tests) && job.request.tests.length ? new Set(job.request.tests) : null;
  const rendered = selected ? derived.rendered.filter((r) => selected.has(r.file)) : derived.rendered;
  if (!rendered.length) throw new GreenlightError("invalid_request", "None of the chosen tests are in the approved version.");

  // The commit: confirmed on the live site (/greenlight.json), or, for guests whose site does not
  // publish it, the repository branch head the server read when the run was requested, recorded
  // as unconfirmed. Never a commit the requester typed in for guests.
  const unconfirmed = guest && job.request.commitSource === "branch_head";
  const deployment = unconfirmed
    ? { state: "ready", safeToRunKane: true, reasons: [], url, deployedCommit: job.request.commit, expectedCommit: job.request.commit, environment: "unconfirmed", commitSource: "branch_head_unconfirmed" }
    : await deps.verifyLiveDeployment({
        url,
        expectedCommit: job.request.commit,
        expectedEnvironment: job.request.environment,
        timeoutMs: guest ? Math.min(config.deployTimeoutMs, 60_000) : config.deployTimeoutMs,
        intervalMs: config.deployIntervalMs,
      });
  if (guest && !unconfirmed) deployment.commitSource = "live_site";
  try {
    requireReady(deployment);
  } catch {
    throw new GreenlightError(deployment.reasons.some((r) => /host_|localhost/.test(r)) ? "url_not_allowed" : "deployment_not_ready", `Deployment not ready: ${deployment.state} (${deployment.reasons.join(", ")}). Kane was not run.`, {
      state: deployment.state,
      reasons: deployment.reasons,
      deployedCommit: deployment.deployedCommit,
    });
  }

  // Fresh, empty workspace: no recordings, nothing cached (brief §11).
  const work = store.workDir(job.id);
  await rm(work, { recursive: true, force: true });
  const testsDir = path.join(work, "tests");
  await mkdir(testsDir, { recursive: true, mode: 0o700 });
  for (const r of rendered) await writeFile(path.join(testsDir, r.file), r.content, { flag: "wx", mode: 0o600 });
  const leftovers = (await readdir(testsDir)).filter((f) => f.startsWith("output-"));
  if (leftovers.length) throw new GreenlightError("internal_error", "The certification workspace was not empty.");

  // Credits, before Kane starts.
  const catalog = catalogFromSpec(derived.spec);
  const judged = derived.spec.tests.some((t) => t.steps.some((st) => st.kind === "check"));
  const plan = { tests: catalog.tests.filter((t) => !selected || selected.has(t.file)).map((t) => ({ file: t.file, author: true, steps: t.steps.length })) };
  const estimate = estimateRun(plan, config.rates ? { rates: config.rates } : {});
  const before = await deps.readBalance();
  const policy = { maxPerRun: Math.min(job.request.confirmSpend, config.maxCreditsPerRun, guest && config.guest ? config.guest.maxCreditsPerRun : Infinity), minReserve: config.reserve };
  const auth = authorizeRun({ estimate, balance: before, policy, runKind: "certification", confirmed: job.request.confirmSpend >= estimate.credits });
  if (!auth.allowed) {
    throw new GreenlightError(auth.reasons.includes("balance_unavailable") ? "balance_unavailable" : auth.reasons.includes("confirmation_required") ? "confirmation_required" : "credit_check_refused", `Credit check refused the certification run: ${auth.reasons.join(", ")}. Kane was not run.`, {
      reasons: auth.reasons,
      estimate: estimate.credits,
      cap: policy.maxPerRun,
      reserve: policy.minReserve,
    });
  }

  const files = rendered.map((r) => r.file);
  const runId = certificationRunId(job.id);
  const startedAt = deps.now().toISOString();
  const runResult = await deps.runKane({
    args: buildTestrunArgs({ testFiles: files, startUrl: url, runName: runId, remote: config.kaneRemote ?? null }),
    cwd: testsDir,
    timeoutMs: config.kaneTimeoutMs,
  });
  const endedAt = deps.now().toISOString();
  const evaluation = evaluateRun(runResult, toApprovedTests(rendered));
  const after = await deps.readBalance();
  const credits = creditRecord(reconcileUsage({ before, after, usage: await actualUsage({ runResult }), estimate: estimate.credits }));
  const collected = await collectEvidence({
    runId,
    runResult,
    kaneCwd: testsDir,
    projectRoot: store.evidenceRoot(job.id), // local: <root>/evidence/<jobId>/.greenlight/runs/<runId>/
    approvedTestHash: derived.hash,
    deployedCommit: deployment.deployedCommit,
    startUrl: url,
    validator: deps.validator,
    evaluation,
    approval: { method: approval.method, certifiable: !guest && !judged },
    credits,
    runKind: "certification",
    now: deps.now,
  });
  const record = buildVerificationRecord({
    id: newId("vr"),
    project,
    version,
    approval,
    deployment,
    evaluation,
    manifest: collected.manifest,
    credits,
    startedAt,
    endedAt,
    now: deps.now(),
    // Claims Kane judges by itself (`check` steps, from the one-page check) are a verdict,
    // not a certification: only exact visible-text checks can certify.
    certifiable: !guest && !judged,
    notCertifiableReason: guest ? "guest_verification" : "kane_judged_claims",
    testsRun: selected ? rendered.map((r) => r.file) : null,
  });
  // Evidence is archived and hash-verified BEFORE the record exists; then the
  // record, its run, claims and test results are written in one transaction.
  const run = await store.archiveRun({ job, runId, runDir: collected.runDir, now: deps.now() });
  await store.putRecord(record, { run });
  await store.cleanupRun({ jobId: job.id, runDir: collected.runDir });
  // The workspace held only generated tests and Kane's local copy of the pack (now stored).
  await rm(work, { recursive: true, force: true });
  return { record, outcome: record.certified ? "certified" : `not_certified:${record.status}` };
}
