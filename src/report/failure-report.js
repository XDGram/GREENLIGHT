// Structured failure reports (Phase 1, Step 7).
//
// Input: a Step 2 evaluation, the approved catalog (claims, tests and steps from
// the approved greenlight.yaml), and optionally the Step 3 run manifest and the
// Step 6 deployment result. Output: a versioned JSON report and a concise
// Markdown rendering for Claude Code. A passing project produces no report.
//
// Authority: the failure type (app_failure / couldnt_verify) comes only from
// the Step 2 classification. Expected results come from the approved spec.
// Kane's failure message is quoted as Kane's note; Kane's AI diagnosis
// (failure.yaml title / root cause) is shown, marked non-authoritative, and
// never changes anything.
//
// Privacy: evidence references are split. `public` holds only pack-relative
// entry names, the execution id and the pack hash. `private` holds local file
// paths (evidence pack, Kane session log); toPublicReport() removes them.

import path from "node:path";
import { mkdir, writeFile, rename } from "node:fs/promises";
import { openZip } from "./zip-read.js";
import { redactText, redactUrl, redactPublicDeep } from "./redact.js";

export const REPORT_SCHEMA = "greenlight.failure-report/v1";
export const FAILURE_TYPE = Object.freeze({ APP_FAILURE: "app_failure", COULDNT_VERIFY: "couldnt_verify" });
export const REPORTS_DIR = path.join(".greenlight", "reports");

/** Approved catalog from a Step 5 normalised spec. */
export function catalogFromSpec(spec) {
  return {
    claims: spec.claims.map((c) => ({ id: c.id, text: c.text })),
    tests: spec.tests.map((t) => ({
      file: `${t.id}_test.md`,
      title: t.title,
      claims: [...t.claims],
      steps: t.steps.map((s) => ({ name: s.name, kind: s.kind, text: s.text })),
    })),
  };
}

/**
 * Find the pack folder for a test. Kane's event test_id equals the folder name
 * only for freshly authored runs; on replays it is a UUID while the folder keeps
 * its authored name (verified in Run 2). The folder's result.yaml records the
 * run's session_id and the test's UUID test_id, so match on those next.
 */
function findPackTestDir(pack, kane) {
  const allDirs = new Set(pack.names.filter((n) => /^tests\/[^/]+\//.test(n)).map((n) => n.split("/")[1]));
  if (kane.testId && allDirs.has(kane.testId)) return kane.testId;
  const dirs = [...allDirs].filter((d) => pack.has(`tests/${d}/result.yaml`));
  const field = (text, key) => new RegExp(`^\\s*${key}:\\s*['"]?([A-Za-z0-9-]+)['"]?\\s*$`, "m").exec(text)?.[1] ?? null;
  const records = dirs.map((d) => {
    let text = "";
    try {
      text = pack.readText(`tests/${d}/result.yaml`) ?? "";
    } catch {
      /* unreadable record: cannot match */
    }
    return { dir: d, sessionId: field(text, "session_id"), testId: field(text, "test_id") };
  });
  const bySession = kane.sessionId ? records.filter((r) => r.sessionId === kane.sessionId) : [];
  if (bySession.length === 1) return bySession[0].dir;
  const byTest = kane.testId ? records.filter((r) => r.testId === kane.testId) : [];
  if (byTest.length === 1) return byTest[0].dir;
  return null;
}

function stepEvidence(pack, testId, stepIndex) {
  // Kane pack layout: tests/<testId>/steps/<ordinal>-<group>-<sub>/, where
  // group = (1-based test.md step index) - 1.
  const prefix = `tests/${testId}/steps/`;
  const group = stepIndex - 1;
  const dirs = new Map();
  for (const n of pack.names) {
    if (!n.startsWith(prefix)) continue;
    const dir = n.slice(prefix.length).split("/")[0];
    const m = /^(\d+)-(\d+)-(\d+)$/.exec(dir);
    if (m && Number(m[2]) === group) dirs.set(dir, Number(m[1]));
  }
  if (dirs.size === 0) return null;
  const ordered = [...dirs.keys()].sort((a, b) => dirs.get(a) - dirs.get(b));
  const withFailure = ordered.find((d) => pack.has(`${prefix}${d}/failure.yaml`));
  const dir = withFailure ?? ordered.at(-1);
  const base = `${prefix}${dir}/`;
  const first = (...names) => names.map((x) => base + x).find((x) => pack.has(x)) ?? null;
  return {
    dir: base,
    screenshot: first("screenshot.jpg", "screenshot.png"),
    annotated: first("annotated.png", "annotated.jpg"),
    failureRecord: pack.has(`${base}failure.yaml`) ? `${base}failure.yaml` : null,
    stepJson: pack.has(`${base}step.json`) ? `${base}step.json` : null,
  };
}

async function readEvidence({ manifest, runDir, kane, stepIndex, problems }) {
  const ev = manifest?.evidence;
  const publicRef = { executionId: ev?.executionId ?? null, packSha256: ev?.sha256 ?? null, screenshot: null, annotated: null, failureRecord: null };
  const privateRef = { packPath: null, sessionLog: kane?.logPath ?? null };
  const extracted = { pageUrl: null, aiDiagnosis: null };

  if (!manifest) {
    problems.push("no_run_manifest");
    return { publicRef, privateRef, extracted };
  }
  if (ev?.status !== "stored" || !ev.file) {
    problems.push(`evidence_${ev?.status ?? "unknown"}`);
    return { publicRef, privateRef, extracted };
  }
  privateRef.packPath = runDir ? path.join(runDir, ev.file) : null;
  if (!privateRef.packPath) {
    problems.push("evidence_path_unknown");
    return { publicRef, privateRef, extracted };
  }
  if (!kane?.testId && !kane?.sessionId) {
    problems.push("kane_test_id_missing");
    return { publicRef, privateRef, extracted };
  }
  let pack;
  try {
    pack = await openZip(privateRef.packPath);
  } catch {
    problems.push("evidence_pack_unreadable");
    return { publicRef, privateRef, extracted };
  }
  const packTestDir = findPackTestDir(pack, kane);
  if (!packTestDir) {
    problems.push("test_not_in_evidence_pack");
    return { publicRef, privateRef, extracted };
  }
  if (!Number.isInteger(stepIndex) || stepIndex < 1) {
    problems.push("failed_step_unknown");
    return { publicRef, privateRef, extracted };
  }
  const s = stepEvidence(pack, packTestDir, stepIndex);
  if (!s) {
    problems.push("failed_step_not_in_evidence_pack");
    return { publicRef, privateRef, extracted };
  }
  publicRef.screenshot = s.screenshot;
  publicRef.annotated = s.annotated;
  publicRef.failureRecord = s.failureRecord;
  if (!s.screenshot) problems.push("screenshot_missing");
  try {
    if (s.stepJson) {
      const j = JSON.parse(pack.readText(s.stepJson));
      if (typeof j?.url === "string") extracted.pageUrl = redactUrl(j.url);
    }
  } catch {
    problems.push("step_record_malformed");
  }
  try {
    if (s.failureRecord) {
      const title = /^title:\s*(.+)$/m.exec(pack.readText(s.failureRecord) ?? "")?.[1]?.trim();
      if (title) extracted.aiDiagnosis = title.replace(/^['"]|['"]$/g, "");
    }
  } catch {
    problems.push("failure_record_unreadable");
  }
  return { publicRef, privateRef, extracted };
}

/**
 * Build the failure report, or return null when the project passed (unless
 * `always` is set: then a passing run gets a report too, with no failures, so its
 * credit record and warnings are persisted in latest.json).
 *
 * @param {object} p
 * @param {object} p.evaluation      Step 2 evaluateRun() result
 * @param {{claims: {id, text}[], tests: {file, title, claims, steps: {name, kind, text}[]}[]}} p.catalog  approved catalog
 * @param {object} [p.manifest]      Step 3 run manifest
 * @param {string} [p.runDir]        directory holding the manifest (for local evidence paths)
 * @param {object} [p.deployment]    Step 6 verifyDeployment() result
 * @param {string[]} [p.secrets]     exact strings to redact everywhere
 * @param {object} [p.credits]       credits/usage.js creditRecord() (defaults to manifest.credits)
 * @param {object[]} [p.warnings]    run warnings (defaults to manifest.warnings)
 * @param {object[]} [p.attempts]   every attempt of this verification ({runId, project, actualSpend}); >1 after a retry
 * @param {boolean} [p.always]       also build a report for a passing run
 * @param {() => Date} [p.now]
 */
export async function buildFailureReport({ evaluation, catalog, manifest, runDir, deployment, secrets = [], credits, warnings, attempts, always = false, now = () => new Date() }) {
  if (!evaluation?.project || !Array.isArray(evaluation.tests)) throw new TypeError("evaluation must be a Step 2 evaluateRun() result");
  if (!catalog || !Array.isArray(catalog.claims) || !Array.isArray(catalog.tests)) throw new TypeError("catalog with claims and tests is required");
  if (evaluation.project.status === "passed" && !always) return null;

  const red = (t) => redactText(t, secrets);
  const claimText = new Map(catalog.claims.map((c) => [c.id, c.text]));
  const approvedTests = new Map(catalog.tests.map((t) => [t.file, t]));
  const claimStatus = new Map((evaluation.claims ?? []).map((c) => [c.id, c.status]));
  const ignored = [];

  const failures = [];
  for (const t of evaluation.tests) {
    if (t.status === "passed") continue;
    const approved = approvedTests.get(t.file);
    if (!approved) {
      ignored.push(t.file);
      continue;
    }
    const claims = t.claims.filter((c) => claimText.has(c));
    const problems = [];
    const stepIndex = t.kane?.failureStepIndex ?? null;
    const step = Number.isInteger(stepIndex) && stepIndex >= 1 ? approved.steps[stepIndex - 1] ?? null : null;
    if (t.status === "app_failure" && stepIndex !== null && !step) problems.push("failed_step_not_in_approved_test");
    const { publicRef, privateRef, extracted } =
      t.status === "app_failure" ? await readEvidence({ manifest, runDir, kane: t.kane, stepIndex, problems }) : { publicRef: null, privateRef: null, extracted: {} };

    failures.push({
      type: t.status === "app_failure" ? FAILURE_TYPE.APP_FAILURE : FAILURE_TYPE.COULDNT_VERIFY,
      claims: claims.map((id) => ({ id, text: claimText.get(id), status: claimStatus.get(id) ?? null })),
      test: { file: t.file, title: approved.title },
      failedStep: step
        ? {
            index: stepIndex,
            name: step.name,
            kind: step.kind,
            expected: step.kind === "expect_text" ? { exactText: step.text } : { action: step.text },
          }
        : null,
      actual: {
        kaneStatus: t.kane?.status ?? null,
        kaneMessage: red(t.kane?.failureMessage ?? null),
        pageUrl: extracted.pageUrl ?? null,
      },
      reasons: t.status === "couldnt_verify" ? t.reasons.map(red) : [],
      kane: {
        mode: t.kane?.mode ?? null,
        notes: t.kane?.failureMessage ? [red(t.kane.failureMessage)] : [],
        aiDiagnosis: extracted.aiDiagnosis ? { title: red(extracted.aiDiagnosis), authoritative: false } : null,
      },
      evidence: publicRef ? { public: publicRef, private: privateRef } : null,
      evidenceProblems: problems,
    });
  }

  const order = { app_failure: 0, couldnt_verify: 1 };
  failures.sort((a, b) => order[a.type] - order[b.type] || a.test.file.localeCompare(b.test.file));
  const appFailures = failures.filter((f) => f.type === FAILURE_TYPE.APP_FAILURE).length;
  const unverified = failures.length - appFailures;

  return {
    schema: REPORT_SCHEMA,
    generatedAt: now().toISOString(),
    runId: manifest?.runId ?? null,
    runKind: manifest?.runKind ?? "iteration",
    // A developer-side report is never a certification (brief §11).
    certification: false,
    attempts: attempts ?? (manifest?.runId ? [{ runId: manifest.runId, project: evaluation.project.status, actualSpend: credits?.actualSpend ?? manifest?.credits?.actualSpend ?? null }] : []),
    executionId: manifest?.evidence?.executionId ?? manifest?.kane?.executionId ?? null,
    kind: failures.length === 0 ? "passed" : appFailures && unverified ? "mixed" : appFailures ? FAILURE_TYPE.APP_FAILURE : FAILURE_TYPE.COULDNT_VERIFY,
    project: {
      status: evaluation.project.status,
      failingClaims: evaluation.project.failingClaims.filter((c) => claimText.has(c)),
      unverifiedClaims: evaluation.project.unverifiedClaims.filter((c) => claimText.has(c)),
    },
    run: { usable: evaluation.run?.usable ?? null, reasons: (evaluation.run?.reasons ?? []).map(red) },
    deployment: deployment
      ? { url: redactUrl(deployment.url ?? ""), commit: deployment.deployedCommit ?? null, expectedCommit: deployment.expectedCommit ?? null, state: deployment.state ?? null }
      : null,
    counts: { appFailures, couldntVerify: unverified },
    // Actual spend is the balance difference (null if a balance was unknown), never an estimate.
    credits: credits ?? manifest?.credits ?? null,
    warnings: (warnings ?? manifest?.warnings ?? []).map((w) => ({ ...w, message: red(w.message ?? "") })),
    failures,
    ignoredUnapprovedTests: [...new Set([...ignored, ...(evaluation.unapprovedTestsRun ?? [])])].sort(),
  };
}

/**
 * Copy of the report safe to share: no private evidence references, no local
 * filesystem paths, no email addresses, no credit balances (account data); every
 * string passes the public redaction rules.
 */
export function toPublicReport(report) {
  if (!report) return null;
  const { balanceBefore, balanceAfter, ...creditsPublic } = report.credits ?? {};
  return redactPublicDeep({
    ...report,
    credits: report.credits ? creditsPublic : null,
    failures: report.failures.map((f) => ({ ...f, evidence: f.evidence ? { public: f.evidence.public } : null })),
  });
}

const q = (s) => `"${s}"`;

/** Concise Markdown for Claude Code. */
export function renderMarkdown(report) {
  if (!report) return "";
  const L = [];
  L.push(`# Greenlight: ${report.kind === "passed" ? "verified" : report.kind === "couldnt_verify" ? "could not verify" : "verification failed"}`);
  const meta = [report.runId && `run ${report.runId}`, report.deployment?.commit && `commit ${report.deployment.commit.slice(0, 12)}`, report.deployment?.url, report.generatedAt].filter(Boolean);
  L.push(meta.join(" · "));
  L.push("");
  L.push(`Project: **${report.project.status}**. ${report.counts.appFailures} app failure(s), ${report.counts.couldntVerify} could not be verified.`);
  if (report.run.usable === false) L.push(`Run problem: ${report.run.reasons.join(", ")}. Results from this run are not trusted.`);
  if ((report.attempts ?? []).length > 1) L.push(`Attempts: ${report.attempts.map((a) => `${a.runId} (${a.project})`).join(" -> ")}; infrastructure failures are retried once.`);

  const apps = report.failures.filter((f) => f.type === "app_failure");
  const cvs = report.failures.filter((f) => f.type === "couldnt_verify");
  if (apps.length) {
    L.push("", "## App failures: fix the application code");
    for (const f of apps) {
      L.push("", `### ${f.claims.map((c) => `${c.id} ${c.text}`).join(" · ")}`);
      L.push(`- Test: \`${f.test.file}\` (${f.test.title})`);
      if (f.failedStep) {
        const exp = f.failedStep.expected.exactText !== undefined ? `page must show the exact text ${q(f.failedStep.expected.exactText)}` : `action: ${f.failedStep.expected.action}`;
        L.push(`- Failed step ${f.failedStep.index} ${q(f.failedStep.name)}: ${exp}`);
      } else L.push("- Failed step: unknown");
      if (f.actual.kaneMessage) L.push(`- Kane: ${f.actual.kaneMessage}`);
      if (f.actual.pageUrl) L.push(`- Page: ${f.actual.pageUrl}`);
      if (f.evidence?.public?.screenshot) {
        L.push(`- Screenshot: \`${f.evidence.public.screenshot}\` inside the evidence pack${f.evidence.private?.packPath ? ` \`${f.evidence.private.packPath}\`` : ""}`);
      }
      if (f.kane.aiDiagnosis) L.push(`- Kane's AI diagnosis (context only, not authoritative): ${f.kane.aiDiagnosis.title}`);
      if (f.evidenceProblems.length) L.push(`- Evidence: ${f.evidenceProblems.join(", ")}`);
    }
  }
  if (cvs.length) {
    L.push("", "## Could not verify: not a code failure; do not change application code for these");
    for (const f of cvs) {
      L.push(`- \`${f.test.file}\` (${f.claims.map((c) => c.id).join(", ")}): ${f.reasons.join(", ") || "unknown"}`);
    }
  }
  if (report.ignoredUnapprovedTests.length) L.push("", `Ignored (not approved): ${report.ignoredUnapprovedTests.join(", ")}`);
  const warnings = report.warnings ?? [];
  if (warnings.length) {
    L.push("", "## Warnings");
    for (const w of warnings) L.push(`- \`${w.code}\`: ${w.message}`);
  }
  if (report.credits) L.push("", `Credits: ${renderCredits(report.credits)}`);
  L.push("", "Pass/fail comes from Kane's test results and the approved tests only. Do not edit approved tests to make them pass; propose a change for human approval instead.");
  return L.join("\n") + "\n";
}

/** One line describing a creditRecord(); the discrepancy is always shown when known. */
export function renderCredits(c) {
  const n = (v) => (v === null || v === undefined ? "unknown" : String(v));
  const parts = [
    `actual ${c.actualSpend === null ? "unknown (a balance could not be read; no estimate or log total is used instead)" : `${c.actualSpend} (balance ${n(c.balanceBefore)} -> ${n(c.balanceAfter)})`}`,
    `Kane-reported ${n(c.kaneReportedSpend)} (lower bound)`,
    `unaccounted by Kane ${n(c.discrepancy)}`,
    `estimate ${n(c.estimate)}`,
  ];
  return `${parts.join(" · ")} — ${c.status}${c.reasons?.length ? `: ${c.reasons.join(", ")}` : ""}`;
}

/** Write latest.json / latest.md (and a public copy) under .greenlight/reports/. */
export async function writeFailureReport({ root, report }) {
  const dir = path.join(root, REPORTS_DIR);
  await mkdir(dir, { recursive: true });
  const files = {
    json: path.join(dir, "latest.json"),
    md: path.join(dir, "latest.md"),
    publicJson: path.join(dir, "latest.public.json"),
  };
  const put = async (file, content) => {
    await writeFile(`${file}.tmp`, content);
    await rename(`${file}.tmp`, file);
  };
  await put(files.json, JSON.stringify(report, null, 2) + "\n");
  await put(files.md, renderMarkdown(report));
  await put(files.publicJson, JSON.stringify(toPublicReport(report), null, 2) + "\n");
  return files;
}
