// Failure report tests. Built from the real Run 1 / Run 2 Kane output, Step 2
// classification, Step 3 manifests over the sanitised evidence packs, and
// fabricated cases. No Kane, credits, network or deployments.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, copyFile, writeFile, readFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { evaluateRun } from "../../src/verify/classify.js";
import { collectEvidence } from "../../src/evidence/index.js";
import { parseSpec } from "../../src/spec/schema.js";
import {
  buildFailureReport,
  renderMarkdown,
  toPublicReport,
  writeFailureReport,
  catalogFromSpec,
  redactText,
  redactUrl,
  openZip,
  ZipReadError,
  REPORT_SCHEMA,
} from "../../src/report/index.js";
import { runFromFixture, fabricatedRun, APPROVED_SMOKE } from "../verify/helpers.js";

const FIX = (p) => fileURLToPath(new URL(`../fixtures/kane/${p}`, import.meta.url));
const EXEC = { "run1-authored": "553326c5-1953-485e-89e4-308bd415c7b4", "run2-replay": "412b9281-8d80-4ea2-a6ef-7d2f348f21b2" };
const PREVIEW = "https://gl-test-93mjujacr-timeb7208-5361s-projects.vercel.app";
const NOW = () => new Date("2026-11-19T12:00:00.000Z");
const VALID = async () => ({ exitCode: 0, stdout: '{"valid":true,"status":"finalized","diagnostics":[]}', stderr: "" });

/** Approved catalog matching the tests Kane actually ran in Runs 1 and 2. */
const CATALOG = {
  claims: [
    { id: "CLM-001", text: "Users can add items to the cart." },
    { id: "CLM-002", text: "Users can subscribe to the newsletter." },
    { id: "CLM-003", text: "The About page is reachable from the home page." },
  ],
  tests: [
    { file: "cart_test.md", title: "Add two items", claims: ["CLM-001"], steps: [
      { name: "Open the app", kind: "do", text: "Open the start page." },
      { name: "Add two items", kind: "do", text: 'Click the "Add item" button two times.' },
      { name: "Check the cart count", kind: "expect_text", text: "Items in cart: 2" },
    ] },
    { file: "subscribe_test.md", title: "Subscribe to the newsletter", claims: ["CLM-002"], steps: [
      { name: "Open the app", kind: "do", text: "Open the start page." },
      { name: "Subscribe", kind: "do", text: 'Type "smoke@example.com" into the Email field and click the "Subscribe" button.' },
      { name: "Check the confirmation", kind: "expect_text", text: "Thanks for subscribing, smoke@example.com!" },
    ] },
    { file: "about_nav_test.md", title: "Reach the About page", claims: ["CLM-003"], steps: [
      { name: "Open the app", kind: "do", text: "Open the start page." },
      { name: "Go to About", kind: "do", text: 'Click the "About this app" link.' },
      { name: "Check the About page", kind: "expect_text", text: "This is a throwaway app for testing Kane CLI." },
    ] },
  ],
};

const temps = [];
after(() => Promise.all(temps.map((d) => rm(d, { recursive: true, force: true }))));

/** Run a fixture through Steps 2 and 3, optionally with a different pack file. */
async function fromFixture(dir, { packFile = FIX(`${dir}/pack.sanitized.evidence`), runOpts } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "gl-report-"));
  temps.push(root);
  const store = path.join(root, "kane", ".testmuai", "evidence");
  await mkdir(store, { recursive: true });
  if (packFile) await copyFile(packFile, path.join(store, `${EXEC[dir]}.evidence`));
  const runResult = { ...runFromFixture(dir, runOpts), stdout: "", stderr: "" };
  const evaluation = evaluateRun(runResult, APPROVED_SMOKE);
  const collected = await collectEvidence({
    runId: "gl-run-1", runResult, kaneCwd: path.join(root, "kane"), projectRoot: root,
    approvedTestHash: "a".repeat(64), deployedCommit: "dc6150b46a46a85efb4255113f0eddc5370621c8", validator: VALID, now: NOW,
  });
  return { root, evaluation, manifest: collected.manifest, runDir: collected.runDir };
}

const report = (x, extra = {}) => buildFailureReport({ evaluation: x.evaluation, catalog: CATALOG, manifest: x.manifest, runDir: x.runDir, now: NOW, ...extra });

// ---------------------------------------------------------------- passing / app failures

test("a passing run produces no failure report", async () => {
  const run = fabricatedRun({ members: [{ file: "cart_test.md", tags: ["clm-001"], status: "passed" }], exitCode: 0 });
  const evaluation = evaluateRun(run, { tests: [{ file: "cart_test.md", claims: ["CLM-001"] }] });
  assert.equal(evaluation.project.status, "passed");
  assert.equal(await buildFailureReport({ evaluation, catalog: CATALOG }), null);
  assert.equal(renderMarkdown(null), "");
  assert.equal(toPublicReport(null), null);
});

test("Run 1: the subscribe app failure, with expected text from the approved spec and evidence references", async () => {
  const x = await fromFixture("run1-authored");
  const r = await report(x, { deployment: { url: `${PREVIEW}/`, deployedCommit: "dc6150b46a46a85efb4255113f0eddc5370621c8", expectedCommit: "dc6150b46a46a85efb4255113f0eddc5370621c8", state: "ready" } });
  assert.equal(r.schema, REPORT_SCHEMA);
  assert.equal(r.generatedAt, "2026-11-19T12:00:00.000Z");
  assert.equal(r.kind, "app_failure");
  assert.equal(r.runId, "gl-run-1");
  assert.equal(r.executionId, EXEC["run1-authored"]);
  assert.deepEqual(r.project, { status: "failed", failingClaims: ["CLM-002"], unverifiedClaims: [] });
  assert.deepEqual(r.counts, { appFailures: 1, couldntVerify: 0 });
  assert.equal(r.failures.length, 1, "passing tests are not reported");

  const f = r.failures[0];
  assert.equal(f.type, "app_failure");
  assert.deepEqual(f.claims, [{ id: "CLM-002", text: "Users can subscribe to the newsletter.", status: "failed" }]);
  assert.deepEqual(f.test, { file: "subscribe_test.md", title: "Subscribe to the newsletter" });
  assert.deepEqual(f.failedStep, { index: 3, name: "Check the confirmation", kind: "expect_text", expected: { exactText: "Thanks for subscribing, smoke@example.com!" } });
  assert.equal(f.actual.kaneStatus, "failed");
  assert.match(f.actual.kaneMessage, /^Final verification failed/);
  assert.equal(f.actual.pageUrl, `${PREVIEW}/`);
  assert.deepEqual(f.kane.aiDiagnosis, { title: "Agent misread newsletter failure as subscription confirmation", authoritative: false });
  assert.equal(f.evidence.public.failureRecord, "tests/subscribe-3fdbe54d/steps/7-2-1/failure.yaml");
  assert.equal(f.evidence.public.screenshot, null);
  assert.equal(f.evidence.public.packSha256, x.manifest.evidence.sha256);
  assert.ok(f.evidence.private.packPath.startsWith(x.runDir));
  assert.deepEqual(f.evidenceProblems, ["screenshot_missing"], "the sanitised pack has no screenshots");
});

test("Kane's AI diagnosis cannot change classification: same verdict whatever the label says", async () => {
  const x = await fromFixture("run1-authored");
  const base = await report(x);
  // Rewrite the pack's failure.yaml title to claim it was not an app bug.
  const pack = path.join(x.runDir, x.manifest.evidence.file);
  const z = await openZip(pack);
  assert.ok(z.readText("tests/subscribe-3fdbe54d/steps/7-2-1/failure.yaml").includes("title: Agent misread"));
  // A diagnosis can only ever be displayed: the type comes from Step 2.
  const relabelled = structuredClone(x.evaluation);
  relabelled.tests.find((t) => t.file === "subscribe_test.md").kane.failureMessage = "bug verdict: automation_bug/agent_misstep (not an app bug)";
  const r = await report({ ...x, evaluation: relabelled });
  assert.equal(r.failures[0].type, "app_failure");
  assert.equal(r.kind, base.kind);
  assert.deepEqual(r.project, base.project);
  assert.match(renderMarkdown(r), /## App failures: fix the application code/);
  assert.match(renderMarkdown(r), /AI diagnosis \(context only, not authoritative\)/);
});

test("Run 2 (replay): Kane's UUID test_id is mapped to the pack's authored folder via result.yaml", async () => {
  const x = await fromFixture("run2-replay");
  const r = await report(x);
  const f = r.failures[0];
  assert.equal(f.type, "app_failure");
  assert.equal(f.kane.mode, "replay");
  assert.equal(x.evaluation.tests.find((t) => t.file === "subscribe_test.md").kane.testId, "b6abdfc4-583c-49b8-9e76-d145cd3c1f6d", "not the folder name");
  assert.equal(f.failedStep.expected.exactText, "Thanks for subscribing, smoke@example.com!");
  assert.equal(f.evidence.public.failureRecord, "tests/subscribe-3fdbe54d/steps/6-2-2/failure.yaml");
  assert.equal(f.actual.pageUrl, `${PREVIEW}/`);
  assert.deepEqual(f.evidenceProblems, ["screenshot_missing"]);
});

test("a pack folder holding the test but not the failed step is flagged, not fatal", async () => {
  const x = await fromFixture("run2-replay");
  const ev = structuredClone(x.evaluation);
  ev.tests.find((t) => t.file === "subscribe_test.md").kane.failureStepIndex = 3;
  const { zipOf } = await import("./zip-helper.js");
  await writeFile(path.join(x.runDir, x.manifest.evidence.file), zipOf({
    "tests/subscribe-3fdbe54d/result.yaml": "external_id:\n  session_id: 8d5ad336-e950-4e18-8e17-8e4884afa60a\n",
    "tests/subscribe-3fdbe54d/steps/1-0-1/step.json": "{}",
  }));
  assert.deepEqual((await report({ ...x, evaluation: ev })).failures[0].evidenceProblems, ["failed_step_not_in_evidence_pack"]);
});

test("multiple failures and a partial claim", async () => {
  const run = fabricatedRun({
    members: [
      { file: "cart_test.md", tags: ["clm-001"], status: "failed" },
      { file: "subscribe_test.md", tags: ["clm-002"], status: "failed" },
      { file: "about_nav_test.md", tags: ["clm-003", "clm-001"], status: "passed" },
    ],
    exitCode: 1,
  });
  const approved = { tests: [
    { file: "cart_test.md", claims: ["CLM-001"] },
    { file: "subscribe_test.md", claims: ["CLM-002"] },
    { file: "about_nav_test.md", claims: ["CLM-003", "CLM-001"] },
  ] };
  const evaluation = evaluateRun(run, approved);
  const r = await buildFailureReport({ evaluation, catalog: CATALOG, now: NOW });
  assert.deepEqual(r.failures.map((f) => [f.type, f.test.file]), [["app_failure", "cart_test.md"], ["app_failure", "subscribe_test.md"]]);
  assert.equal(r.failures[0].claims[0].status, "partial", "CLM-001: one test failed, one passed");
  assert.deepEqual(r.project.failingClaims, ["CLM-001", "CLM-002"]);
  assert.equal(r.failures[0].failedStep.name, "Add two items", "fabricated step_index 2");
  assert.deepEqual(r.failures[0].evidenceProblems, ["no_run_manifest"]);
  const md = renderMarkdown(r);
  assert.equal((md.match(/^### /gm) ?? []).length, 2);
});

// ---------------------------------------------------------------- couldnt_verify

test("infrastructure failure: an incomplete run reports couldnt_verify for every test, separately from app failures", async () => {
  const x = await fromFixture("run1-authored", { runOpts: { lines: 5 } });
  const r = await report(x);
  assert.equal(r.kind, "couldnt_verify");
  assert.equal(r.project.status, "couldnt_verify");
  assert.equal(r.run.usable, false);
  assert.ok(r.run.reasons.includes("missing_completion_event"));
  assert.equal(r.failures.length, 3);
  assert.ok(r.failures.every((f) => f.type === "couldnt_verify" && f.evidence === null && f.failedStep === null));
  assert.deepEqual(r.failures.find((f) => f.test.file === "about_nav_test.md").reasons, ["run_not_usable"]);
  const md = renderMarkdown(r);
  assert.match(md, /# Greenlight: could not verify/);
  assert.match(md, /do not change application code for these/);
  assert.match(md, /Results from this run are not trusted/);
  assert.equal(md.includes("## App failures"), false);
});

test("mixed report: app failure plus an unverifiable (broken) test", async () => {
  const run = fabricatedRun({
    members: [
      { file: "cart_test.md", tags: ["clm-001"], status: "broken" },
      { file: "subscribe_test.md", tags: ["clm-002"], status: "failed" },
    ],
    exitCode: 1,
  });
  const evaluation = evaluateRun(run, { tests: [{ file: "cart_test.md", claims: ["CLM-001"] }, { file: "subscribe_test.md", claims: ["CLM-002"] }] });
  const r = await buildFailureReport({ evaluation, catalog: CATALOG, now: NOW });
  assert.equal(r.kind, "mixed");
  assert.deepEqual(r.failures.map((f) => f.type), ["app_failure", "couldnt_verify"], "app failures first");
  assert.deepEqual(r.failures[1].reasons, ["kane_status_broken"]);
  assert.deepEqual(r.project.unverifiedClaims, ["CLM-001"]);
});

// ---------------------------------------------------------------- evidence problems

test("missing, invalid and corrupted evidence are reported per failure, never fatal", async () => {
  const missing = await fromFixture("run1-authored", { packFile: null });
  assert.deepEqual((await report(missing)).failures[0].evidenceProblems, ["evidence_missing"]);

  const x = await fromFixture("run1-authored");
  await writeFile(path.join(x.runDir, x.manifest.evidence.file), "corrupted after collection");
  assert.deepEqual((await report(x)).failures[0].evidenceProblems, ["evidence_pack_unreadable"]);

  const noKaneTest = await fromFixture("run1-authored");
  const ev = structuredClone(noKaneTest.evaluation);
  const k = ev.tests.find((t) => t.file === "subscribe_test.md").kane;
  k.testId = "not-in-pack";
  k.sessionId = "00000000-0000-0000-0000-000000000000";
  assert.deepEqual((await report({ ...noKaneTest, evaluation: ev })).failures[0].evidenceProblems, ["test_not_in_evidence_pack"]);

  const byName = structuredClone(noKaneTest.evaluation);
  byName.tests.find((t) => t.file === "subscribe_test.md").kane.sessionId = "00000000-0000-0000-0000-000000000000";
  assert.equal((await report({ ...noKaneTest, evaluation: byName })).failures[0].evidence.public.failureRecord,
    "tests/subscribe-3fdbe54d/steps/7-2-1/failure.yaml", "authored runs match on the folder name alone");

  const noIds = structuredClone(noKaneTest.evaluation);
  Object.assign(noIds.tests.find((t) => t.file === "subscribe_test.md").kane, { testId: null, sessionId: null });
  assert.deepEqual((await report({ ...noKaneTest, evaluation: noIds })).failures[0].evidenceProblems, ["kane_test_id_missing"]);

  const noStep = structuredClone(noKaneTest.evaluation);
  noStep.tests.find((t) => t.file === "subscribe_test.md").kane.failureStepIndex = null;
  const r = await report({ ...noKaneTest, evaluation: noStep });
  assert.equal(r.failures[0].failedStep, null);
  assert.deepEqual(r.failures[0].evidenceProblems, ["failed_step_unknown"]);
  assert.match(renderMarkdown(r), /Failed step: unknown/);

  const outOfRange = structuredClone(noKaneTest.evaluation);
  outOfRange.tests.find((t) => t.file === "subscribe_test.md").kane.failureStepIndex = 9;
  assert.ok((await report({ ...noKaneTest, evaluation: outOfRange })).failures[0].evidenceProblems.includes("failed_step_not_in_approved_test"));

  const withoutDir = await report({ ...x, runDir: undefined });
  assert.deepEqual(withoutDir.failures[0].evidenceProblems, ["evidence_path_unknown"]);
});

test("malformed step records inside a pack are flagged", async () => {
  const x = await fromFixture("run1-authored");
  // Build a tiny pack: a step.json that is not JSON, and no failure.yaml.
  const { zipOf } = await import("./zip-helper.js");
  const pack = path.join(x.runDir, x.manifest.evidence.file);
  await writeFile(pack, zipOf({ "tests/subscribe-3fdbe54d/steps/7-2-1/step.json": "{not json", "tests/subscribe-3fdbe54d/steps/7-2-1/screenshot.jpg": "jpg" }));
  const f = (await report(x)).failures[0];
  assert.deepEqual(f.evidenceProblems, ["step_record_malformed"]);
  assert.equal(f.evidence.public.screenshot, "tests/subscribe-3fdbe54d/steps/7-2-1/screenshot.jpg");
  assert.equal(f.kane.aiDiagnosis, null);
});

test("malformed inputs are rejected clearly", async () => {
  await assert.rejects(buildFailureReport({ evaluation: {}, catalog: CATALOG }), /evaluation/);
  await assert.rejects(buildFailureReport({ evaluation: evaluateRun(runFromFixture("run1-authored"), APPROVED_SMOKE), catalog: {} }), /catalog/);
  const z = path.join(await mkdtemp(path.join(os.tmpdir(), "gl-report-")), "x.zip");
  temps.push(path.dirname(z));
  await writeFile(z, "PK not really");
  await assert.rejects(openZip(z), ZipReadError);
});

// ---------------------------------------------------------------- approval scope

test("only approved claims and tests are reported; unapproved tests are listed by name only", async () => {
  const run = fabricatedRun({
    members: [
      { file: "subscribe_test.md", tags: ["clm-002"], status: "failed" },
      { file: "rogue_test.md", tags: ["clm-099"], status: "failed" },
    ],
    exitCode: 1,
  });
  const evaluation = evaluateRun(run, { tests: [{ file: "subscribe_test.md", claims: ["CLM-002"] }] });
  const r = await buildFailureReport({ evaluation, catalog: CATALOG, now: NOW });
  assert.deepEqual(r.failures.map((f) => f.test.file), ["subscribe_test.md"]);
  assert.deepEqual(r.ignoredUnapprovedTests, ["rogue_test.md"]);
  assert.equal(JSON.stringify(r).includes("CLM-099"), false);

  // A test classified by Step 2 but missing from the approved catalog is not reported either.
  const narrow = { claims: CATALOG.claims, tests: CATALOG.tests.filter((t) => t.file !== "subscribe_test.md") };
  const r2 = await buildFailureReport({ evaluation, catalog: narrow, now: NOW });
  assert.deepEqual(r2.failures, []);
  assert.deepEqual(r2.ignoredUnapprovedTests, ["rogue_test.md", "subscribe_test.md"]);
});

test("catalogFromSpec feeds the report from an approved greenlight.yaml", async () => {
  const spec = parseSpec(readFileSync(new URL("../fixtures/spec/smoke/greenlight.yaml", import.meta.url), "utf8"));
  const catalog = catalogFromSpec(spec);
  assert.deepEqual(catalog.tests.map((t) => t.file), ["cart-add-two_test.md", "newsletter-subscribe_test.md", "cart-then-about_test.md"]);
  const run = fabricatedRun({ members: [{ file: "newsletter-subscribe_test.md", tags: ["clm-002"], status: "failed" }], exitCode: 1 });
  run.stream.members[0].attempts[0].end.failure.step_index = 3;
  run.stream.members[0].final = { ...run.stream.members[0].final, failure: { message: "Final verification failed", step_index: 3 } };
  const evaluation = evaluateRun(run, { tests: [{ file: "newsletter-subscribe_test.md", claims: ["CLM-002"] }] });
  const r = await buildFailureReport({ evaluation, catalog, now: NOW });
  assert.equal(r.failures[0].failedStep.expected.exactText, "Thanks for subscribing, smoke@example.com!");
});

// ---------------------------------------------------------------- redaction and privacy

test("secrets in Kane messages, deployment URLs and extra secrets are redacted everywhere", async () => {
  const x = await fromFixture("run1-authored");
  const ev = structuredClone(x.evaluation);
  ev.tests.find((t) => t.file === "subscribe_test.md").kane.failureMessage =
    "Failed at https://bob:pw123@app.example.com/x?x-vercel-protection-bypass=BYPASS999#frag with Authorization: Bearer abcdefghijklmnop token=tok_ABCDEF123 user sadiqyusuf1775 jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
  const r = await report({ ...x, evaluation: ev }, {
    deployment: { url: `${PREVIEW}/?x-vercel-protection-bypass=BYPASS999`, deployedCommit: "dc6150b46a46a85efb4255113f0eddc5370621c8", state: "ready" },
    secrets: ["sadiqyusuf1775"],
  });
  const all = JSON.stringify(r) + renderMarkdown(r);
  for (const s of ["BYPASS999", "pw123", "bob:", "#frag", "abcdefghijklmnop", "tok_ABCDEF123", "sadiqyusuf1775", "eyJhbGciOiJIUzI1NiJ9"]) {
    assert.equal(all.includes(s), false, `${s} leaked`);
  }
  assert.match(r.failures[0].actual.kaneMessage, /https:\/\/app\.example\.com\/x\?REDACTED/);
  assert.equal(r.deployment.url, `${PREVIEW}/?REDACTED`);
});

test("redaction helpers", () => {
  assert.equal(redactUrl("https://u:p@h.example.com/a?b=1#c"), "https://h.example.com/a?REDACTED");
  assert.equal(redactUrl("nope"), "REDACTED_URL");
  assert.equal(redactText("see https://h.example.com/a?k=v."), "see https://h.example.com/a?REDACTED.");
  assert.equal(redactText("api_key: abc123def"), "api_key: REDACTED");
  assert.equal(redactText('password="hunter22"'), 'password="REDACTED"');
  assert.equal(redactText("ghp_abcdefghijklmnopqrstuv1234"), "REDACTED_TOKEN");
  assert.equal(redactText("AKIAABCDEFGHIJKLMNOP"), "REDACTED_TOKEN");
  assert.equal(redactText("Items in cart: 2"), "Items in cart: 2", "ordinary text untouched");
  assert.equal(redactText(null), null);
});

test("public report keeps pack-relative references and drops every local path", async () => {
  const x = await fromFixture("run1-authored");
  const r = await report(x);
  const pub = toPublicReport(r);
  const text = JSON.stringify(pub);
  assert.equal(text.includes(x.root), false);
  assert.equal(text.includes("/root/.testmuai"), false);
  assert.equal(text.includes("packPath"), false);
  assert.equal(pub.failures[0].evidence.public.failureRecord, "tests/subscribe-3fdbe54d/steps/7-2-1/failure.yaml");
  assert.ok(r.failures[0].evidence.private, "the private report still has them");
});

test("writeFailureReport writes JSON, Markdown and a public copy", async () => {
  const x = await fromFixture("run1-authored");
  const r = await report(x);
  const files = await writeFailureReport({ root: x.root, report: r });
  assert.deepEqual(JSON.parse(await readFile(files.json, "utf8")), r);
  assert.equal(await readFile(files.md, "utf8"), renderMarkdown(r));
  assert.equal((await readFile(files.publicJson, "utf8")).includes(x.root), false);
  assert.ok(files.json.includes(path.join(".greenlight", "reports")));
});

test("Markdown is concise and complete for Claude Code", async () => {
  const x = await fromFixture("run1-authored");
  const md = renderMarkdown(await report(x, { deployment: { url: `${PREVIEW}/`, deployedCommit: "dc6150b46a46a85efb4255113f0eddc5370621c8", state: "ready" } }));
  assert.match(md, /^# Greenlight: verification failed\nrun gl-run-1 · commit dc6150b46a46 · https:\/\/gl-test-93mjujacr/);
  assert.match(md, /### CLM-002 Users can subscribe to the newsletter\./);
  assert.match(md, /- Failed step 3 "Check the confirmation": page must show the exact text "Thanks for subscribing, smoke@example\.com!"/);
  assert.match(md, /Do not edit approved tests to make them pass/);
  assert.ok(md.split("\n").length < 25);
});

test("real packs (with screenshots), only when GREENLIGHT_REAL_EVIDENCE_DIR is set", { skip: !process.env.GREENLIGHT_REAL_EVIDENCE_DIR }, async () => {
  const x = await fromFixture("run1-authored", { packFile: path.join(process.env.GREENLIGHT_REAL_EVIDENCE_DIR, `${EXEC["run1-authored"]}.evidence`) });
  const f = (await report(x)).failures[0];
  assert.equal(f.evidence.public.screenshot, "tests/subscribe-3fdbe54d/steps/7-2-1/screenshot.jpg");
  assert.deepEqual(f.evidenceProblems, []);
});
