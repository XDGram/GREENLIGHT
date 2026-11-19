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
import { actualUsage, reconcileUsage } from "../credits/usage.js";
import { writeGenerated, loadProject, toApprovedTests, SPEC_FILE, TESTS_DIR } from "../spec/generate.js";
import { SpecError } from "../spec/schema.js";
import { approve, checkApproval, detectAgentEnvironment } from "../spec/approval.js";
import { checkRecordings, saveRecordingsBaseline } from "../spec/recordings.js";
import { verifyDeployment, requireReady } from "../deploy/check.js";
import { buildFailureReport, renderMarkdown, writeFailureReport, catalogFromSpec, REPORTS_DIR } from "../report/failure-report.js";
import { redactUrl, redactText } from "../report/redact.js";
import { readFile } from "node:fs/promises";

export const EXIT = Object.freeze({ OK: 0, FAILED: 1, USAGE: 2, COULDNT_VERIFY: 3, BLOCKED: 4, INTERRUPTED: 130 });

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

verify options
  --url <url>                     Live deployed URL to test (default: project.url)
  --environment <name>            Required deployment environment (e.g. preview)
  --max-credits <n>               Per-run credit cap (default ${DEFAULTS.maxCredits})
  --reserve <n>                   Credits that must remain after the run (default ${DEFAULTS.reserve})
  --kane <path>                   Kane CLI binary (default: $GREENLIGHT_KANE_BIN or kane-cli)
  --kane-timeout-minutes <n>      Kane run limit (default ${DEFAULTS.kaneTimeoutMinutes})
  --deploy-timeout-seconds <n>    How long to wait for the deployment (default ${DEFAULTS.deployTimeoutSeconds})
  --deploy-interval-seconds <n>   Time between deployment checks (default ${DEFAULTS.deployIntervalSeconds})

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
  },
  init: {},
  generate: {},
  approve: {},
  status: {},
};

export class UsageError extends Error {}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") return { command: "help", options: {} };
  if (!(command in OPTIONS)) throw new UsageError(`unknown command: ${command}`);
  const allowed = OPTIONS[command];
  const options = {};
  for (let i = 0; i < rest.length; i++) {
    let arg = rest[i];
    let value;
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
  return { command, options };
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
    if (err.code === "EEXIST") {
      ctx.err(`${SPEC_FILE} already exists; nothing was changed.`);
      return EXIT.BLOCKED;
    }
    throw err;
  }
  ctx.out(`Created ${SPEC_FILE}.`);
  ctx.out("Required: version, project.name, project.url (the live deployed URL), at least one claim and one test.");
  ctx.out("Claims: id (CLM-001...) and text. Tests: id, title, claims, and steps.");
  ctx.out('Each step has a name and either "do" (an action) or "expect_text" (exact visible text). Every test needs an expect_text step.');
  ctx.out("Next: edit it, then run greenlight generate.");
  return EXIT.OK;
}

async function loadOrReport(ctx) {
  try {
    return await loadProject(ctx.cwd);
  } catch (err) {
    if (err instanceof SpecError) {
      ctx.err(err.message);
      return null;
    }
    if (err.code === "ENOENT") {
      ctx.err(`${SPEC_FILE} not found. Run greenlight init to create one.`);
      return null;
    }
    throw err;
  }
}

async function cmdGenerate(ctx) {
  if (!(await loadOrReport(ctx))) return EXIT.BLOCKED;
  const r = await writeGenerated(ctx.cwd);
  for (const g of r.project.rendered) {
    const state = r.written.includes(g.file) ? "wrote    " : "unchanged";
    ctx.out(`${state} ${path.posix.join(".greenlight/tests", g.file)}  [${g.claims.join(", ")}]`);
  }
  for (const f of r.unexpected) ctx.out(`unexpected ${path.posix.join(".greenlight/tests", f)} (not in ${SPEC_FILE}; remove it)`);
  ctx.out(`Specification hash: ${r.hash}`);
  ctx.out("Not approved. Review the files above, then run greenlight approve yourself at your terminal.");
  return r.unexpected.length ? EXIT.BLOCKED : EXIT.OK;
}

async function cmdApprove(ctx) {
  const r = await ctx.deps.approve({ root: ctx.cwd, env: ctx.env, stdin: ctx.stdin, stdout: ctx.stdout });
  return r.approved ? EXIT.OK : EXIT.BLOCKED;
}

async function cmdStatus(ctx) {
  const s = await checkApproval(ctx.cwd);
  if (s.status === "spec_invalid") {
    ctx.out("Specification: INVALID");
    for (const r of s.reasons) ctx.out(`  - ${r}`);
    return EXIT.BLOCKED;
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
  return s.status === "approved" && gen.clean && rec.status !== "changed" && rec.status !== "stale" ? EXIT.OK : EXIT.BLOCKED;
}

async function previousFailures(cwd) {
  try {
    const r = JSON.parse(await readFile(path.join(cwd, REPORTS_DIR, "latest.json"), "utf8"));
    return { tests: (r.failures ?? []).filter((f) => f.type === "app_failure").map((f) => ({ file: f.test.file, status: "app_failure" })) };
  } catch {
    return null;
  }
}

async function cmdVerify(ctx) {
  const o = ctx.options;
  const say = ctx.out;

  // 1. Valid, approved specification.
  const approval = await checkApproval(ctx.cwd);
  if (approval.status === "spec_invalid") {
    ctx.err(`Specification invalid:\n  - ${approval.reasons.join("\n  - ")}`);
    return EXIT.BLOCKED;
  }
  if (approval.status !== "approved") {
    ctx.err(`Tests are not approved (${approval.status}${approval.reasons?.length ? `: ${approval.reasons.join(", ")}` : ""}).`);
    ctx.err("Run greenlight generate, review the tests, then greenlight approve at your own terminal.");
    return EXIT.BLOCKED;
  }
  const project = approval.project;
  const testFiles = project.rendered.map((r) => r.file);
  const testsDir = path.join(ctx.cwd, TESTS_DIR);
  say(`Approved tests: ${testFiles.length} (hash ${approval.approvedHash.slice(0, 12)}…)`);

  // 2. Recording cache must not have been changed behind our back.
  const recordings = await checkRecordings({ root: ctx.cwd, testsDir, testFiles, approvedHash: approval.approvedHash });
  if (recordings.status === "changed" || recordings.status === "stale") {
    ctx.err(`Recording cache ${recordings.status}: ${[...(recordings.changed ?? []), ...(recordings.added ?? []), ...(recordings.removed ?? [])].join(", ") || "recorded for a different approval"}.`);
    ctx.err("Kane will not run on recordings Greenlight did not record for these approved tests. Delete .greenlight/tests/output-*/ to record afresh.");
    return EXIT.BLOCKED;
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
  if (ctx.signal.aborted) return EXIT.INTERRUPTED;
  try {
    requireReady(deployment);
  } catch {
    ctx.err(`Deployment not ready: ${deployment.state} (${deployment.reasons.join(", ")}). Kane was not run.`);
    if (deployment.deployedCommit && deployment.expectedCommit) {
      ctx.err(`  live commit ${deployment.deployedCommit.slice(0, 12)}, expected ${deployment.expectedCommit.slice(0, 12)}`);
    }
    return EXIT.COULDNT_VERIFY;
  }
  say(`Deployment ready: commit ${deployment.deployedCommit.slice(0, 12)} (${deployment.environment})`);

  // 4. Credits: estimate, limits, confirmation.
  const before = await ctx.deps.readBalance();
  const plan = await planFromRecordings({ testsDir, files: testFiles, previousEvaluation: await previousFailures(ctx.cwd) });
  const estimate = estimateRun(plan);
  const policy = { maxPerRun: o["max-credits"] ?? DEFAULTS.maxCredits, minReserve: o.reserve ?? DEFAULTS.reserve };
  let auth = authorizeRun({ estimate, balance: before, policy, runKind: "iteration" });
  say(`Credits: estimate ${estimate.credits} (${estimate.authoredTests} fresh recording(s), ${estimate.liveFailingSteps} known failing step(s)); balance ${before.ok ? before.balance : "unknown"}; cap ${policy.maxPerRun}; reserve ${policy.minReserve}`);
  if (auth.requiresConfirmation && auth.reasons.length === 1 && auth.reasons[0] === "confirmation_required") {
    const a = await askHuman(ctx, `This run records ${estimate.authoredTests} test(s) afresh and is estimated to use ${estimate.credits} credits. Type "yes" to spend them: `);
    if (!a.ok) {
      ctx.err(`Confirmation needed for fresh recording, and it can only come from a person at an interactive terminal (${a.reason}). Kane was not run.`);
      return EXIT.BLOCKED;
    }
    if (a.answer.trim().toLowerCase() !== "yes") {
      ctx.err("Not confirmed. Kane was not run.");
      return EXIT.BLOCKED;
    }
    auth = authorizeRun({ estimate, balance: before, policy, runKind: "iteration", confirmed: true });
  }
  if (!auth.allowed) {
    ctx.err(`Credit check refused the run: ${auth.reasons.join(", ")}. Kane was not run.`);
    return EXIT.BLOCKED;
  }
  if (ctx.signal.aborted) return EXIT.INTERRUPTED;

  // 5. Kane.
  const runId = `gl-${ctx.deps.now().toISOString().replace(/[-:]/g, "").replace(/\..*$/, "")}-${deployment.deployedCommit.slice(0, 8)}`;
  say(`Running Kane (run ${runId}) …`);
  const runResult = await ctx.deps.runKane({
    args: buildTestrunArgs({ testFiles, startUrl: url, runName: runId }),
    cwd: testsDir,
    timeoutMs: (o["kane-timeout-minutes"] ?? DEFAULTS.kaneTimeoutMinutes) * 60_000,
    abortSignal: ctx.signal,
  });

  // 6. Classify, collect evidence, account credits, report.
  const evaluation = evaluateRun(runResult, toApprovedTests(project.rendered));
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
    now: ctx.deps.now,
  });
  const after = await ctx.deps.readBalance();
  const usage = await actualUsage({ runResult });
  const credits = reconcileUsage({ before, after, usage, estimate: estimate.credits });

  if (evaluation.run.usable && recordings.status === "no_baseline") {
    await saveRecordingsBaseline({ root: ctx.cwd, testsDir, testFiles, approvedHash: approval.approvedHash, now: ctx.deps.now });
  } else if (recordings.status === "unchanged") {
    const now = await checkRecordings({ root: ctx.cwd, testsDir, testFiles, approvedHash: approval.approvedHash });
    if (now.status === "changed") ctx.err(`Warning: Kane changed recordings during this run: ${[...now.changed, ...now.added, ...now.removed].join(", ")}`);
  }

  say(`Evidence: ${collected.manifest.evidence.status}${collected.manifest.evidence.sha256 ? ` (sha256 ${collected.manifest.evidence.sha256.slice(0, 16)}…)` : ""}`);
  say(`Credits used: ${credits.spent ?? "unknown"} (${credits.status}${credits.reasons.length ? `: ${credits.reasons.join(", ")}` : ""})`);

  const report = await buildFailureReport({
    evaluation,
    catalog: catalogFromSpec(project.spec),
    manifest: collected.manifest,
    runDir: collected.runDir,
    deployment,
    now: ctx.deps.now,
  });
  for (const c of evaluation.claims) say(`  ${c.status.padEnd(14)} ${c.id}`);
  if (runResult.aborted) {
    ctx.err("Interrupted: Kane was stopped. Results from this run are not trusted.");
    if (report) await writeFailureReport({ root: ctx.cwd, report });
    return EXIT.INTERRUPTED;
  }
  if (!report) {
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

const COMMANDS = { init: cmdInit, generate: cmdGenerate, approve: cmdApprove, status: cmdStatus, verify: cmdVerify };

/**
 * Run the CLI. Never calls process.exit; returns the exit code.
 * @param {string[]} argv
 * @param {object} [io]  cwd, env, stdin, stdout, stderr, signal, deps
 */
export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;
  const secrets = [];
  const clean = (s) => redactText(String(s), secrets);
  const ctx = {
    cwd: io.cwd ?? process.cwd(),
    env,
    stdin: io.stdin ?? process.stdin,
    stdout,
    signal: io.signal ?? new AbortController().signal,
    out: (s) => stdout.write(`${clean(s)}\n`),
    err: (s) => stderr.write(`${clean(s)}\n`),
  };
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    if (err instanceof UsageError) {
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
    return await COMMANDS[parsed.command](ctx);
  } catch (err) {
    if (ctx.signal.aborted) return EXIT.INTERRUPTED;
    ctx.err(`greenlight: ${err?.message ?? err}`);
    return EXIT.COULDNT_VERIFY;
  }
}
