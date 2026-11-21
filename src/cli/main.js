// Greenlight CLI (Phase 1, Step 8). Thin: argument parsing, terminal output
// and exit codes. All work is done by the Step 1-7 modules.
//
// Exit codes
//   0  success (verify: every approved claim passed)
//   1  verification failed: app failures to fix
//   2  usage error (unknown command or option)
//   3  could not verify (deployment not ready, Kane/infrastructure problem)
//   4  blocked by a gate (invalid spec, not approved, credit limits, no confirmation,
//      recording cache changed, file already exists)
//   130 interrupted (Ctrl-C)

import path from "node:path";
import { writeFile } from "node:fs/promises";
import { createInterface } from "node:readline";

import { runKane, buildTestrunArgs } from "../kane/runner.js";
import { evaluateRun } from "../verify/classify.js";
import { collectEvidence } from "../evidence/collect.js";
import { kaneEvidenceValidator } from "../evidence/validate.js";
import { readBalance, kaneBalanceReader } from "../credits/balance.js";
import { estimateRun, planFromRecordings, authorizeRun } from "../credits/estimate.js";
import { actualUsage, reconcileUsage, creditRecord } from "../credits/usage.js";
import { writeGenerated, loadProject, toApprovedTests, SPEC_FILE, TESTS_DIR } from "../spec/generate.js";
import { SpecError } from "../spec/schema.js";
import { approve, approveRelayed, checkApproval, detectAgentEnvironment, RELAYED_METHOD, RELAYED_ENV } from "../spec/approval.js";
import { checkRecordings, saveRecordingsBaseline, classifyRecordingChanges, findUnretainedRecordings, INTACT_RECORDING_STATUSES } from "../spec/recordings.js";
import { verifyDeployment, requireReady } from "../deploy/check.js";
import { buildFailureReport, renderMarkdown, renderCredits, writeFailureReport, catalogFromSpec, REPORTS_DIR } from "../report/failure-report.js";
import { redactUrl, redactText } from "../report/redact.js";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { ensureGreenlightGitignore, acquireLock, VERIFY_LOCK_FILE } from "../hook/state.js";
import { EXIT, ERRORS, errorBody, exitFor, GreenlightError } from "./errors.js";
import { KANE_CAPABILITIES, KANE_LIMITATIONS } from "../kane/capabilities.js";
import { listRuns, checkRun } from "../runs/history.js";
import { cmdPublish, PUBLISH_OPTIONS } from "./publish.js";
import { cmdSubmit, cmdServerApprove } from "./server-link.js";

export { EXIT, ERRORS };
export const CLI_RESULT_SCHEMA = "greenlight.cli-result/v1";

export const DEFAULTS = Object.freeze({
  maxCredits: 60,
  reserve: 500,
  kaneTimeoutMinutes: 30,
  deployTimeoutSeconds: 600,
  deployIntervalSeconds: 10,
});

const USAGE = `Usage: greenlight <command> [options]

Commands
  init        Create a starter greenlight.yaml (never overwrites)
  generate    Validate greenlight.yaml and write .greenlight/tests/*_test.md
  approve     Approve the generated tests (a person, at an interactive terminal)
  status      Show spec, approval, generated-test and recording-cache state
  verify      Check the live deployment, then run the approved tests with Kane
  runs        List this project's run history (.greenlight/runs/)
  check-run   Re-check one run record's hashes: greenlight check-run <run-id>
  submit      Propose greenlight.yaml as a server test version (creates the server project once)
  server-approve  A person approves the submitted version on the server (owner token)
  publish     Ask the Greenlight server for a fresh certification run (server-side)

Every command accepts --json: one greenlight.cli-result/v1 document on stdout
(human-readable lines go to stderr).

verify options
  --url <url>                     Live deployed URL to test (default: project.url)
  --environment <name>            Required deployment environment (e.g. preview)
  --max-credits <n>               Per-run credit cap (default ${DEFAULTS.maxCredits})
  --reserve <n>                   Credits that must remain after the run (default ${DEFAULTS.reserve})
  --kane <path>                   Kane CLI binary (default: $GREENLIGHT_KANE_BIN or kane-cli)
  --kane-timeout-minutes <n>      Kane run limit (default ${DEFAULTS.kaneTimeoutMinutes})
  --deploy-timeout-seconds <n>    How long to wait for the deployment (default ${DEFAULTS.deployTimeoutSeconds})
  --deploy-interval-seconds <n>   Time between deployment checks (default ${DEFAULTS.deployIntervalSeconds})
  --confirm-spend <n>             Relayed mode only: this run's credit confirmation and maximum spend
  --estimate-margin <n>           Multiply the credit estimate by n >= 1 (more conservative only)

Relayed mode (controlled tests only; never certifiable): with ${RELAYED_ENV}=1,
  greenlight approve --relayed <full hash>   records an approval a person gave in chat
  greenlight verify --confirm-spend <n>      is then required on every run

Exit codes: 0 passed · 1 app failures · 2 usage · 3 could not verify · 4 blocked · 130 interrupted
`;

const OPTIONS = {
  verify: {
    "--url": "string",
    "--environment": "string",
    "--max-credits": "number",
    "--reserve": "number",
    "--kane": "string",
    "--kane-timeout-minutes": "number",
    "--deploy-timeout-seconds": "number",
    "--deploy-interval-seconds": "number",
    "--confirm-spend": "number",
    "--estimate-margin": "number",
  },
  init: {},
  generate: {},
  approve: { "--relayed": "string" },
  status: {},
  runs: {},
  "check-run": {},
  publish: PUBLISH_OPTIONS,
  submit: { "--project": "string" },
  "server-approve": { "--project": "string", "--version": "number" },
};
// Commands that take positional arguments (e.g. check-run <run-id>).
const POSITIONAL = { "check-run": 1 };

export class UsageError extends Error {}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") return { command: "help", options: {}, args: [] };
  if (!(command in OPTIONS)) throw new UsageError(`unknown command: ${command}`);
  const allowed = OPTIONS[command];
  const options = {};
  const args = [];
  for (let i = 0; i < rest.length; i++) {
    let arg = rest[i];
    let value;
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (!arg.startsWith("--")) {
      if (args.length >= (POSITIONAL[command] ?? 0)) throw new UsageError(`unexpected argument for ${command}: ${arg}`);
      args.push(arg);
      continue;
    }
    if (arg.startsWith("--") && arg.includes("=")) [arg, value] = [arg.slice(0, arg.indexOf("=")), arg.slice(arg.indexOf("=") + 1)];
    if (!(arg in allowed)) throw new UsageError(`unknown option for ${command}: ${arg}`);
    if (value === undefined) {
      value = rest[++i];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`${arg} needs a value`);
    }
    if (allowed[arg] === "number") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) throw new UsageError(`${arg} must be a non-negative number`);
      value = n;
    }
    options[arg.slice(2)] = value;
  }
  if (args.length < (POSITIONAL[command] ?? 0)) throw new UsageError(`${command} needs ${POSITIONAL[command]} argument(s)`);
  return { command, options, args };
}

/** Default external effects. Tests replace these. */
export function defaultDeps({ kane, env = process.env } = {}) {
  const command = kane ?? env.GREENLIGHT_KANE_BIN ?? "kane-cli";
  return {
    runKane: (opts) => runKane({ command, ...opts }),
    readBalance: () => readBalance(kaneBalanceReader({ command })),
    validator: kaneEvidenceValidator({ command }),
    verifyDeployment,
    now: () => new Date(),
    approve,
    fetch: (...a) => globalThis.fetch(...a),
  };
}

const STARTER = `# Greenlight specification. Edit it, then run:
#   greenlight generate   (writes .greenlight/tests/*_test.md and shows the hash)
#   greenlight approve    (you, at your own terminal: approves those exact tests)
#   greenlight verify     (checks the live deployment, then runs the tests with Kane)
version: 1

project:
  name: My App                              # required
  description: What the app does.           # optional
  url: https://my-app.example.com/          # required: the LIVE deployed URL (no localhost, no query string)

claims:                                     # what the app must do; ids are permanent (CLM-001, CLM-002, ...)
  - id: CLM-001
    text: Users can sign in.
    requirement: Optional source requirement text.

tests:                                      # each test becomes .greenlight/tests/<id>_test.md
  - id: sign-in                             # lowercase words joined by hyphens
    title: Sign in with a test account
    claims: [CLM-001]                       # one or more claim ids this test verifies
    steps:
      - name: Open the app
        do: Open the start page.            # an action, in plain English (no "verify"/"should")
      - name: Check the welcome
        expect_text: "Welcome back"         # the EXACT text that must be visible on the page
`;

/** Ask a person a question. Refuses agents/CI and non-interactive terminals. */
async function askHuman(io, question) {
  if (detectAgentEnvironment(io.env).length) return { ok: false, reason: "agent_or_ci_environment" };
  if (!io.stdin.isTTY || !io.stdout.isTTY) return { ok: false, reason: "not_interactive" };
  const rl = createInterface({ input: io.stdin, output: io.stdout, terminal: false });
  const answer = await new Promise((resolve) => {
    let done = false;
    rl.question(question, (a) => {
      done = true;
      rl.close();
      resolve(a);
    });
    rl.on("close", () => !done && resolve(null));
  });
  return { ok: true, answer: answer ?? "" };
}

// ---------------------------------------------------------------- commands

async function cmdInit(ctx) {
  const file = path.join(ctx.cwd, SPEC_FILE);
  try {
    await writeFile(file, STARTER, { flag: "wx" });
  } catch (err) {
    if (err.code === "EEXIST") return ctx.fail("spec_exists", `${SPEC_FILE} already exists; nothing was changed.`);
    throw err;
  }
  ctx.data({ created: SPEC_FILE });
  ctx.out(`Created ${SPEC_FILE}.`);
  ctx.out("Required: version, project.name, project.url (the live deployed URL), at least one claim and one test.");
  ctx.out("Claims: id (CLM-001...) and text. Tests: id, title, claims, and steps.");
  ctx.out('Each step has a name and either "do" (an action) or "expect_text" (exact visible text). Every test needs an expect_text step.');
  ctx.out("Next: edit it, then run greenlight generate.");
  return EXIT.OK;
}

async function loadOrReport(ctx) {
  try {
    return { project: await loadProject(ctx.cwd) };
  } catch (err) {
    if (err instanceof SpecError) return { exit: ctx.fail("spec_invalid", err.message, { problems: err.errors }) };
    if (err.code === "ENOENT") return { exit: ctx.fail("spec_not_found", `${SPEC_FILE} not found. Run greenlight init to create one.`) };
    throw err;
  }
}

async function cmdGenerate(ctx) {
  const loaded = await loadOrReport(ctx);
  if (!loaded.project) return loaded.exit;
  const r = await writeGenerated(ctx.cwd);
  ctx.data({
    hash: r.hash,
    approved: false,
    tests: r.project.rendered.map((g) => ({ file: path.posix.join(".greenlight/tests", g.file), claims: g.claims, sha256: g.sha256, written: r.written.includes(g.file) })),
    unexpected: r.unexpected.map((f) => path.posix.join(".greenlight/tests", f)),
  });
  if (await ensureGreenlightGitignore(ctx.cwd)) ctx.out("created   .greenlight/.gitignore (keeps local state, reports and recordings out of git)");
  for (const g of r.project.rendered) {
    const state = r.written.includes(g.file) ? "wrote    " : "unchanged";
    ctx.out(`${state} ${path.posix.join(".greenlight/tests", g.file)}  [${g.claims.join(", ")}]`);
  }
  for (const f of r.unexpected) ctx.out(`unexpected ${path.posix.join(".greenlight/tests", f)} (not in ${SPEC_FILE}; remove it)`);
  ctx.out(`Specification hash: ${r.hash}`);
  ctx.out("Not approved. Review the files above, then run greenlight approve yourself at your terminal.");
  if (r.unexpected.length) return ctx.fail("generated_tests_unexpected", `Unexpected test files: ${r.unexpected.join(", ")}. Remove them.`, { files: r.unexpected });
  return EXIT.OK;
}

async function cmdApprove(ctx) {
  if (ctx.options.relayed !== undefined) {
    const r = await approveRelayed({ root: ctx.cwd, env: ctx.env, hash: ctx.options.relayed, now: ctx.deps.now });
    if (!r.approved) {
      const why = {
        relayed_mode_not_enabled: `relayed approval needs ${RELAYED_ENV}=1`,
        full_hash_required: "the full 64-character approved-test hash is required",
        hash_mismatch: "that hash is not the current approved-test hash (run greenlight generate and use the hash it prints)",
        generated_tests_out_of_date: "generated tests do not match greenlight.yaml; run greenlight generate first",
        spec_invalid: "greenlight.yaml is invalid",
      }[r.reason] ?? r.reason;
      const code = { relayed_mode_not_enabled: "relayed_mode_not_enabled", full_hash_required: "relayed_hash_invalid", hash_mismatch: "relayed_hash_invalid", generated_tests_out_of_date: "generated_tests_out_of_date", spec_invalid: "spec_invalid" }[r.reason] ?? "approval_refused";
      return ctx.fail(code, `Relayed approval refused: ${why}. Nothing was approved.`, { reason: r.reason });
    }
    ctx.data({ approved: true, hash: r.hash, method: RELAYED_METHOD, certifiable: false });
    ctx.out(`Relayed approval recorded for hash ${r.hash} (method ${RELAYED_METHOD}).`);
    ctx.out("Controlled testing only: this approval can never be used for certification or publishing.");
    return EXIT.OK;
  }
  // The interactive prompt is a conversation with a person: in --json mode it still uses the terminal.
  const r = await ctx.deps.approve({ root: ctx.cwd, env: ctx.env, stdin: ctx.stdin, stdout: ctx.json ? process.stderr : ctx.stdout });
  if (!r.approved) return ctx.fail(r.reason === "spec_invalid" ? "spec_invalid" : r.reason === "generated_tests_out_of_date" ? "generated_tests_out_of_date" : "approval_refused", `Approval refused (${r.reason}).`, { reason: r.reason });
  ctx.data({ approved: true, hash: r.hash, method: r.record?.method ?? null, certifiable: r.record?.certifiable === true });
  return EXIT.OK;
}

async function cmdStatus(ctx) {
  const s = await checkApproval(ctx.cwd);
  const kane = { version: KANE_CAPABILITIES.version, retainsAuthoredRecordingsLocally: KANE_CAPABILITIES.retainsAuthoredRecordingsLocally, limitations: KANE_LIMITATIONS };
  if (s.status === "spec_invalid") {
    ctx.out("Specification: INVALID");
    for (const r of s.reasons) ctx.out(`  - ${r}`);
    ctx.data({ spec: { valid: false, problems: s.reasons }, kane });
    return ctx.fail(String(s.reasons?.[0] ?? "").includes("not found") ? "spec_not_found" : "spec_invalid", "Specification invalid.", { problems: s.reasons });
  }
  ctx.out("Specification: valid");
  ctx.out(`  hash: ${s.currentHash}`);
  ctx.out(`Approval: ${s.status}`);
  if (s.approvedHash) ctx.out(`  approved hash: ${s.approvedHash}${s.approvedHash === s.currentHash ? " (matches)" : " (DOES NOT MATCH)"}`);
  for (const r of s.reasons ?? []) ctx.out(`  - ${r}`);
  ctx.out("Generated tests:");
  const gen = s.generated;
  for (const r of s.project.rendered) {
    const state = gen.missing.includes(r.file) ? "missing" : gen.modified.includes(r.file) ? "MODIFIED" : "ok";
    ctx.out(`  ${state.padEnd(8)} ${r.file}  [${r.claims.join(", ")}]`);
  }
  for (const f of gen.unexpected) ctx.out(`  UNEXPECTED ${f}`);
  let rec = { status: "n/a" };
  if (s.status === "approved") {
    rec = await checkRecordings({
      root: ctx.cwd,
      testsDir: path.join(ctx.cwd, TESTS_DIR),
      testFiles: s.project.rendered.map((r) => r.file),
      approvedHash: s.approvedHash,
    });
  }
  ctx.out(`Recording cache: ${rec.status}`);
  for (const f of [...(rec.changed ?? []), ...(rec.added ?? []), ...(rec.removed ?? [])]) ctx.out(`  - ${f}`);
  for (const m of rec.missing ?? []) ctx.out(`  not recorded (next run authors it afresh): ${m.file} (${m.reason})`);
  if ((rec.missing ?? []).length && !KANE_CAPABILITIES.retainsAuthoredRecordingsLocally) ctx.out(`  note: ${KANE_LIMITATIONS[0].summary}`);
  ctx.data({
    spec: { valid: true, hash: s.currentHash, project: { name: s.project.spec.project.name, url: s.project.spec.project.url }, claims: s.project.spec.claims.map((c) => ({ id: c.id, text: c.text })) },
    approval: { status: s.status, approvedHash: s.approvedHash ?? null, matches: s.approvedHash === s.currentHash, method: s.method ?? null, certifiable: s.certifiable === true, reasons: s.reasons ?? [] },
    generatedTests: { clean: gen.clean, tests: s.project.rendered.map((r) => ({ file: r.file, claims: r.claims, sha256: r.sha256 })), missing: gen.missing, modified: gen.modified, unexpected: gen.unexpected },
    recordings: { status: rec.status, recorded: rec.recorded ?? [], notRecorded: rec.notRecorded ?? [], missing: rec.missing ?? [], changed: rec.changed ?? [], added: rec.added ?? [], removed: rec.removed ?? [] },
    kane,
  });
  if (s.status !== "approved") return ctx.fail("tests_not_approved", `Tests are not approved (${s.status}).`, { status: s.status, reasons: s.reasons });
  if (!gen.clean) return ctx.fail("generated_tests_out_of_date", "Generated tests do not match greenlight.yaml.");
  if (rec.status === "changed") return ctx.fail("recording_cache_changed", "Recording cache changed.");
  if (rec.status === "stale") return ctx.fail("recording_cache_stale", "Recording cache is stale.");
  return EXIT.OK;
}

async function previousFailures(cwd) {
  try {
    const r = JSON.parse(await readFile(path.join(cwd, REPORTS_DIR, "latest.json"), "utf8"));
    return { tests: (r.failures ?? []).filter((f) => f.type === "app_failure").map((f) => ({ file: f.test.file, status: "app_failure" })) };
  } catch {
    return null;
  }
}

/** Exclusive for the whole run, whoever starts it (hook or person): never two Kane runs at once. */
async function cmdVerify(ctx) {
  const lock = await acquireLock(ctx.cwd, { file: VERIFY_LOCK_FILE, now: ctx.deps.now });
  if (!lock.acquired) {
    return ctx.fail("verify_already_running", `Another greenlight verify is already running (pid ${lock.holder?.pid ?? "?"}). Kane was not run.`, { holderPid: lock.holder?.pid ?? null });
  }
  try {
    return await verifyLocked(ctx);
  } finally {
    await lock.release();
  }
}

// Why a run could not be verified, when one retry is worth it (brief §6: retry
// infrastructure failures once). Never for interruptions, version mismatches or a
// Kane that would not start: those need a person, not another paid run.
const NO_RETRY = ["aborted", "version_mismatch", "spawn_failed", "plan_invalid"];
function infrastructureRetryReason(attempt) {
  const { evaluation, runResult } = attempt;
  if (runResult.aborted || evaluation.project.status !== "couldnt_verify") return null;
  const reasons = [...(evaluation.run.reasons ?? []), ...(runResult.completeness?.reasons ?? [])];
  if (reasons.some((r) => NO_RETRY.some((x) => r === x || r.endsWith(`:${x}`)))) return null;
  return reasons.length ? reasons.join(", ") : "tests_could_not_be_verified";
}

async function verifyLocked(ctx) {
  const o = ctx.options;
  const say = ctx.out;

  // 1. Valid, approved specification.
  const approval = await checkApproval(ctx.cwd);
  if (approval.status === "spec_invalid") {
    return ctx.fail("spec_invalid", `Specification invalid:\n  - ${approval.reasons.join("\n  - ")}`, { problems: approval.reasons });
  }
  if (approval.status !== "approved") {
    return ctx.fail(
      "tests_not_approved",
      [`Tests are not approved (${approval.status}${approval.reasons?.length ? `: ${approval.reasons.join(", ")}` : ""}).`, "Run greenlight generate, review the tests, then greenlight approve at your own terminal."],
      { status: approval.status, reasons: approval.reasons ?? [] },
    );
  }
  // Relayed approvals: controlled tests only, with an explicit per-run spend confirmation.
  const relayed = approval.method === RELAYED_METHOD;
  const relayMode = ctx.env[RELAYED_ENV] === "1";
  const confirmSpend = o["confirm-spend"];
  if (relayed && !relayMode) {
    return ctx.fail("relayed_mode_not_enabled", `These tests have a relayed approval, which only works with ${RELAYED_ENV}=1 (controlled testing). Kane was not run.`);
  }
  if (confirmSpend !== undefined && !relayed) {
    return ctx.fail("confirm_spend_not_allowed", "--confirm-spend is only accepted for a relayed approval; a person confirms spending at their terminal otherwise. Kane was not run.");
  }
  if (relayed && confirmSpend === undefined) {
    return ctx.fail("relayed_confirm_spend_required", "A relayed approval needs --confirm-spend <max credits> on every run. Kane was not run.");
  }
  const project = approval.project;
  const testFiles = project.rendered.map((r) => r.file);
  const testsDir = path.join(ctx.cwd, TESTS_DIR);
  ctx.data({ approvedHash: approval.approvedHash, approvalMethod: approval.method, certifiable: false, runKind: "iteration" });
  say(`Approved tests: ${testFiles.length} (hash ${approval.approvedHash.slice(0, 12)}…)`);
  if (relayed) say(`Approval: ${RELAYED_METHOD} (controlled test only; never certifiable). Spend confirmed for this run: at most ${confirmSpend} credits.`);

  // 2. Recording cache must not have been changed behind our back.
  const recordings = await checkRecordings({ root: ctx.cwd, testsDir, testFiles, approvedHash: approval.approvedHash });
  if (recordings.status === "changed" || recordings.status === "stale") {
    return ctx.fail(
      recordings.status === "changed" ? "recording_cache_changed" : "recording_cache_stale",
      [
        `Recording cache ${recordings.status}: ${[...(recordings.changed ?? []), ...(recordings.added ?? []), ...(recordings.removed ?? [])].join(", ") || "recorded for a different approval"}.`,
        "Kane will not run on recordings Greenlight did not record for these approved tests. Delete .greenlight/tests/output-*/ to record afresh.",
      ],
      { changed: recordings.changed ?? [], added: recordings.added ?? [], removed: recordings.removed ?? [] },
    );
  }

  // 3. Live deployment serving exactly HEAD.
  const url = o.url ?? project.spec.project.url;
  say(`Checking deployment ${redactUrl(url)} …`);
  const deployment = await ctx.deps.verifyDeployment({
    url,
    cwd: ctx.cwd,
    expectedEnvironment: o.environment,
    intervalMs: (o["deploy-interval-seconds"] ?? DEFAULTS.deployIntervalSeconds) * 1000,
    timeoutMs: (o["deploy-timeout-seconds"] ?? DEFAULTS.deployTimeoutSeconds) * 1000,
  });
  if (ctx.signal.aborted) return ctx.fail("interrupted", "Interrupted before Kane started.");
  ctx.data({ deployment: { state: deployment.state, reasons: deployment.reasons, url: redactUrl(url), expectedCommit: deployment.expectedCommit ?? null, deployedCommit: deployment.deployedCommit ?? null, environment: deployment.environment ?? null } });
  try {
    requireReady(deployment);
  } catch {
    const lines = [`Deployment not ready: ${deployment.state} (${deployment.reasons.join(", ")}). Kane was not run.`];
    if (deployment.deployedCommit && deployment.expectedCommit) lines.push(`  live commit ${deployment.deployedCommit.slice(0, 12)}, expected ${deployment.expectedCommit.slice(0, 12)}`);
    return ctx.fail(deployment.reasons.includes("localhost_not_allowed") ? "url_not_allowed" : "deployment_not_ready", lines, { state: deployment.state, reasons: deployment.reasons });
  }
  say(`Deployment ready: commit ${deployment.deployedCommit.slice(0, 12)} (${deployment.environment})`);

  // 4. Credits: estimate, limits, confirmation.
  const catalog = catalogFromSpec(project.spec);
  const stepCounts = Object.fromEntries(catalog.tests.map((t) => [t.file, t.steps.length]));
  const margin = o["estimate-margin"] ?? 1;
  if (!(Number.isFinite(margin) && margin >= 1)) {
    return ctx.fail("usage_error", "--estimate-margin must be a number >= 1 (it can only make the estimate more conservative). Kane was not run.");
  }
  const policy = relayed
    ? { maxPerRun: Math.min(confirmSpend, o["max-credits"] ?? Infinity), minReserve: o.reserve ?? DEFAULTS.reserve }
    : { maxPerRun: o["max-credits"] ?? DEFAULTS.maxCredits, minReserve: o.reserve ?? DEFAULTS.reserve };

  /** Estimate, enforce cap/reserve/balance and get confirmation. Returns {estimate, before} or an exit code. */
  const authorize = async ({ spentSoFar, retry }) => {
    const before = await ctx.deps.readBalance();
    const plan = await planFromRecordings({ testsDir, files: testFiles, previousEvaluation: await previousFailures(ctx.cwd), stepCounts });
    const estimate = estimateRun(plan, { margin, ...(ctx.deps.rates ? { rates: ctx.deps.rates } : {}) });
    // A retry spends against what is left of THIS run's cap (and, relayed, of --confirm-spend).
    const p = { maxPerRun: Math.max(0, policy.maxPerRun - spentSoFar), minReserve: policy.minReserve };
    let auth = authorizeRun({ estimate, balance: before, policy: p, runKind: "iteration", confirmed: relayed });
    say(`Credits: estimate ${estimate.credits} (${estimate.authoredTests} fresh recording(s), ${estimate.liveFailingSteps} known failing step(s)); balance ${before.ok ? before.balance : "unknown"}; cap ${p.maxPerRun}; reserve ${p.minReserve}`);
    if (auth.requiresConfirmation && auth.reasons.length === 1 && auth.reasons[0] === "confirmation_required") {
      const a = await askHuman(ctx, `${retry ? "Retry: this run" : "This run"} records ${estimate.authoredTests} test(s) afresh and is estimated to use ${estimate.credits} credits. Type "yes" to spend them: `);
      if (!a.ok) {
        return { exit: ctx.fail("confirmation_required", `Confirmation needed for fresh recording, and it can only come from a person at an interactive terminal (${a.reason}). Kane was not run.`, { reason: a.reason, estimate: estimate.credits }) };
      }
      if (a.answer.trim().toLowerCase() !== "yes") return { exit: ctx.fail("confirmation_declined", "Not confirmed. Kane was not run.") };
      auth = authorizeRun({ estimate, balance: before, policy: p, runKind: "iteration", confirmed: true });
    }
    if (!auth.allowed) {
      const code = auth.reasons.includes("balance_unavailable") ? "balance_unavailable" : "credit_check_refused";
      return { exit: ctx.fail(code, `Credit check refused the run: ${auth.reasons.join(", ")}. Kane was not run.`, { reasons: auth.reasons, estimate: estimate.credits, cap: p.maxPerRun, reserve: p.minReserve, balance: before.ok ? before.balance : null }) };
    }
    return { estimate, before };
  };

  // 5-6. Kane, classification, credits, evidence: one run record per attempt.
  const runAttempt = async ({ estimate, before, attemptNo, previousRunId }) => {
    const baseRunId = `gl-${ctx.deps.now().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "")}-${deployment.deployedCommit.slice(0, 8)}`;
    let runId = baseRunId;
    for (let n = 2; existsSync(path.join(ctx.cwd, ".greenlight", "runs", runId)); n++) runId = `${baseRunId}-${n}`;
    say(`Running Kane (run ${runId}) …`);
    const runResult = await ctx.deps.runKane({
      args: buildTestrunArgs({ testFiles, startUrl: url, runName: runId }),
      cwd: testsDir,
      timeoutMs: (o["kane-timeout-minutes"] ?? DEFAULTS.kaneTimeoutMinutes) * 60_000,
      abortSignal: ctx.signal,
    });
    const evaluation = evaluateRun(runResult, toApprovedTests(project.rendered));
    const after = await ctx.deps.readBalance();
    const usage = await actualUsage({ runResult });
    const creditsRecord = creditRecord(reconcileUsage({ before, after, usage, estimate: estimate.credits }));
    const warnings = [];
    const unretained = await findUnretainedRecordings({ testsDir, testFiles, runResult });
    if (unretained) warnings.push(unretained);
    const collected = await collectEvidence({
      runId,
      runResult,
      kaneCwd: testsDir,
      projectRoot: ctx.cwd,
      approvedTestHash: approval.approvedHash,
      deployedCommit: deployment.deployedCommit,
      startUrl: url,
      validator: ctx.deps.validator,
      evaluation,
      approval: { method: approval.method, certifiable: false },
      credits: creditsRecord,
      warnings,
      runKind: "iteration",
      attempt: attemptNo,
      previousRunId,
      now: ctx.deps.now,
    });
    return { runId, runResult, evaluation, creditsRecord, warnings, collected };
  };

  const attempts = [];
  let spentSoFar = 0;
  let next = await authorize({ spentSoFar: 0, retry: false });
  if (next.exit !== undefined) return next.exit;
  if (ctx.signal.aborted) return ctx.fail("interrupted", "Interrupted before Kane started.");
  let a;
  for (let attemptNo = 1; ; attemptNo++) {
    a = await runAttempt({ ...next, attemptNo, previousRunId: attempts.at(-1)?.runId ?? null });
    attempts.push(a);
    if (a.creditsRecord.actualSpend !== null) spentSoFar += a.creditsRecord.actualSpend;
    else spentSoFar += next.estimate.credits; // unknown spend: assume the estimate was used, never less
    const why = attemptNo === 1 ? infrastructureRetryReason(a) : null;
    if (!why || ctx.signal.aborted) break;
    say(`Could not verify (${why}): retrying once, as for any infrastructure failure.`);
    next = await authorize({ spentSoFar, retry: true });
    if (next.exit !== undefined) {
      // The retry was not authorised: the first attempt's result stands (could not verify).
      ctx.err("The retry was not run; reporting the first attempt.");
      ctx.clearError();
      break;
    }
  }

  // Recording baseline, after the last attempt.
  const { evaluation, runResult, collected, creditsRecord, warnings } = a;
  const saveBaseline = () => saveRecordingsBaseline({ root: ctx.cwd, testsDir, testFiles, approvedHash: approval.approvedHash, now: ctx.deps.now });
  if (evaluation.run.usable && recordings.status === "no_baseline") {
    await saveBaseline();
  } else if (INTACT_RECORDING_STATUSES.includes(recordings.status)) {
    const now = await checkRecordings({ root: ctx.cwd, testsDir, testFiles, approvedHash: approval.approvedHash });
    if (now.status === "changed") {
      const c = await classifyRecordingChanges({ testsDir, check: now });
      if (evaluation.run.usable && c.acceptable) {
        await saveBaseline();
        say(`Recordings updated for steps Kane recorded this run: ${c.authoredStems.join(", ")}`);
      } else {
        ctx.err(`Warning: recordings changed unexpectedly during this run (${c.unexpected.join(", ")}); the baseline was not updated and the next verify will stop.`);
      }
    }
  }

  say(`Evidence: ${collected.manifest.evidence.status}${collected.manifest.evidence.sha256 ? ` (sha256 ${collected.manifest.evidence.sha256.slice(0, 16)}…)` : ""}`);
  say(`Credits: ${renderCredits(creditsRecord)}`);
  for (const w of warnings) ctx.err(`Warning (${w.code}): ${w.message}`);

  const report = await buildFailureReport({
    evaluation,
    catalog,
    manifest: collected.manifest,
    runDir: collected.runDir,
    deployment,
    credits: creditsRecord,
    warnings,
    attempts: attempts.map((x) => ({ runId: x.runId, project: x.evaluation.project.status, actualSpend: x.creditsRecord.actualSpend })),
    always: true,
    now: ctx.deps.now,
  });
  for (const c of evaluation.claims) say(`  ${c.status.padEnd(14)} ${c.id}`);
  ctx.data({
    runId: a.runId,
    attempts: attempts.map((x) => ({ runId: x.runId, status: x.runResult.aborted ? "interrupted" : x.evaluation.project.status, credits: x.creditsRecord })),
    status: runResult.aborted ? "interrupted" : evaluation.project.status,
    claims: evaluation.claims.map((c) => ({ id: c.id, status: c.status })),
    tests: evaluation.tests.map((t) => ({ file: t.file, status: t.status, reasons: t.reasons })),
    evidence: { status: collected.manifest.evidence.status, sha256: collected.manifest.evidence.sha256 ?? null, recordSha256: collected.manifest.recordSha256 },
    credits: creditsRecord,
    totalActualSpend: attempts.every((x) => x.creditsRecord.actualSpend !== null) ? Math.round(attempts.reduce((t, x) => t + x.creditsRecord.actualSpend, 0) * 1e6) / 1e6 : null,
    warnings,
    report: path.posix.join(".greenlight", "reports", "latest.json"),
  });
  if (runResult.aborted) {
    await writeFailureReport({ root: ctx.cwd, report });
    return ctx.fail("interrupted", "Interrupted: Kane was stopped. Results from this run are not trusted.", { runId: a.runId });
  }
  if (evaluation.project.status === "passed") {
    // latest.json still records this run's credits and warnings (and clears an older failure report).
    await writeFailureReport({ root: ctx.cwd, report });
    say(`Verified: all ${evaluation.claims.length} claim(s) passed.`);
    return EXIT.OK;
  }
  const files = await writeFailureReport({ root: ctx.cwd, report });
  say("");
  say(renderMarkdown(report).trimEnd());
  say("");
  say(`Full report: ${path.relative(ctx.cwd, files.md)}`);
  return evaluation.project.status === "failed" ? EXIT.FAILED : EXIT.COULDNT_VERIFY;
}

async function cmdRuns(ctx) {
  const runs = await listRuns(ctx.cwd, { verify: true });
  ctx.data({ runs });
  if (!runs.length) ctx.out("No runs yet.");
  for (const r of runs) {
    const ok = r.integrity?.ok === false ? `  INTEGRITY: ${r.integrity.problems.join(", ")}` : "";
    ctx.out(`${r.createdAt ?? "?"}  ${r.runId}  ${String(r.status).padEnd(14)} ${r.deployedCommit ? r.deployedCommit.slice(0, 12) : ""}  spend ${r.credits?.actualSpend ?? "unknown"}${r.warnings?.length ? `  warnings: ${r.warnings.join(", ")}` : ""}${ok}`);
  }
  const bad = runs.filter((r) => r.integrity && !r.integrity.ok);
  return bad.length ? ctx.fail("run_record_invalid", `${bad.length} run record(s) failed their integrity check.`, { runIds: bad.map((r) => r.runId) }) : EXIT.OK;
}

async function cmdCheckRun(ctx) {
  const r = await checkRun(ctx.cwd, ctx.args[0]);
  ctx.data(r);
  if (!r.ok) return ctx.fail("run_record_invalid", `Run ${r.runId} failed its integrity check: ${r.problems.join(", ")}.`, { problems: r.problems });
  ctx.out(`Run ${r.runId}: record and files match their hashes (record sha256 ${r.summary.recordSha256}).`);
  return EXIT.OK;
}

const COMMANDS = { init: cmdInit, generate: cmdGenerate, approve: cmdApprove, status: cmdStatus, verify: cmdVerify, runs: cmdRuns, "check-run": cmdCheckRun, publish: cmdPublish, submit: cmdSubmit, "server-approve": cmdServerApprove };

/**
 * Run the CLI. Never calls process.exit; returns the exit code.
 * With --json, stdout carries exactly one greenlight.cli-result/v1 document and
 * every human-readable line goes to stderr.
 * @param {string[]} argv
 * @param {object} [io]  cwd, env, stdin, stdout, stderr, signal, deps
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const secrets = [];
  const clean = (s) => redactText(String(s), secrets);
  const json = argv.includes("--json");
  const human = json ? stderr : stdout;
  const result = { error: null, data: {} };
  const ctx = {
    cwd: io.cwd ?? process.cwd(),
    env,
    stdin: io.stdin ?? process.stdin,
    stdout,
    json,
    signal: io.signal ?? new AbortController().signal,
    out: (s) => human.write(`${clean(s)}\n`),
    err: (s) => stderr.write(`${clean(s)}\n`),
    /** Record a stable error code, print the message, return its exit code. */
    fail: (code, message, details) => {
      for (const line of [].concat(message)) stderr.write(`${clean(line)}\n`);
      result.error = errorBody(code, clean([].concat(message).join(" ")), details);
      return exitFor(code);
    },
    /** Merge structured result data for --json output. */
    data: (obj) => Object.assign(result.data, obj),
    clearError: () => {
      result.error = null;
    },
  };
  const finish = (command, exitCode) => {
    if (json) {
      const doc = {
        schema: CLI_RESULT_SCHEMA,
        command,
        ok: exitCode === EXIT.OK,
        exitCode,
        error: result.error,
        data: result.data,
      };
      stdout.write(`${clean(JSON.stringify(doc))}\n`);
    }
    return exitCode;
  };
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
      if (json) {
        ctx.fail("usage_error", `greenlight: ${err.message}`);
        return finish(argv[0] ?? null, EXIT.USAGE);
      }
      stderr.write(`greenlight: ${err.message}\n\n${USAGE}`);
      return EXIT.USAGE;
    }
    throw err;
  }
  if (parsed.command === "help") {
    stdout.write(USAGE);
    return argv.length ? EXIT.OK : EXIT.USAGE;
  }
  ctx.options = parsed.options;
  ctx.args = parsed.args;
  if (parsed.options.url) {
    try {
      const u = new URL(parsed.options.url);
      for (const v of [u.username, u.password, ...u.searchParams.values(), u.hash.slice(1)]) if (v) secrets.push(v);
    } catch {
      /* invalid URL: reported by the deployment check */
    }
  }
  ctx.deps = { ...defaultDeps({ kane: parsed.options.kane, env }), ...(io.deps ?? {}) };
  try {
    return finish(parsed.command, await COMMANDS[parsed.command](ctx));
  } catch (err) {
    if (ctx.signal.aborted) return finish(parsed.command, ctx.fail("interrupted", "Interrupted."));
    if (err instanceof GreenlightError) return finish(parsed.command, ctx.fail(err.code, err.message, err.details));
    return finish(parsed.command, ctx.fail("internal_error", `greenlight: ${err?.message ?? err}`));
  }
}
