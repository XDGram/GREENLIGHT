// Generator, approved-test hash, approval gate and recording integrity.
// Kane is never executed.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, mkdir, readFile, writeFile, rm, readdir, symlink, unlink } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  parseSpec,
  renderAll,
  bundleHash,
  writeGenerated,
  loadProject,
  toApprovedTests,
  approve,
  checkApproval,
  detectAgentEnvironment,
  approvalRecordHash,
  saveRecordingsBaseline,
  checkRecordings,
  snapshotRecordings,
  APPROVAL_FILE,
} from "../../src/spec/index.js";
import { classifyTests } from "../../src/verify/classify.js";
import { fabricatedRun } from "../verify/helpers.js";

const SAMPLE_PATH = fileURLToPath(new URL("../fixtures/spec/smoke/greenlight.yaml", import.meta.url));
const SAMPLE = readFileSync(SAMPLE_PATH, "utf8");
const EXPECTED_DIR = fileURLToPath(new URL("../fixtures/spec/smoke/expected/", import.meta.url));
const SAMPLE_HASH = "07bc6327dd53f62ecf79d8312c30342786a1bdac8211d71786a46a72fcc139d0";
const BIN = fileURLToPath(new URL("../../bin/greenlight.js", import.meta.url));
const HUMAN_ENV = { PATH: process.env.PATH, HOME: process.env.HOME };

const temps = [];
after(() => Promise.all(temps.map((d) => rm(d, { recursive: true, force: true }))));
async function project(specText = SAMPLE) {
  const root = await mkdtemp(path.join(os.tmpdir(), "gl-spec-"));
  temps.push(root);
  await writeFile(path.join(root, "greenlight.yaml"), specText);
  return root;
}

/** Fake interactive terminal that answers the confirmation prompt. */
function terminal(answer, { tty = true } = {}) {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  stdin.isTTY = tty;
  stdout.isTTY = tty;
  let output = "";
  stdout.on("data", (c) => (output += c));
  if (answer !== null) stdin.end(`${answer}\n`);
  else stdin.end();
  return { stdin, stdout, output: () => output };
}
const humanApprove = (root, answer, extra = {}) => {
  const t = terminal(answer, extra);
  return approve({ root, env: HUMAN_ENV, stdin: t.stdin, stdout: t.stdout, now: () => new Date("2026-11-19T12:00:00Z"), approver: () => "dev", ...extra.opts })
    .then((r) => ({ ...r, output: t.output() }));
};
async function approvedProject() {
  const root = await project();
  await writeGenerated(root);
  const r = await humanApprove(root, SAMPLE_HASH.slice(0, 12));
  assert.equal(r.approved, true, r.output);
  return root;
}
const testsDir = (root) => path.join(root, ".greenlight", "tests");

// ---------------------------------------------------------------- generation

test("generated tests match the reviewed golden files byte for byte", async () => {
  const root = await project();
  const r = await writeGenerated(root);
  assert.deepEqual(r.written, ["cart-add-two_test.md", "cart-then-about_test.md", "newsletter-subscribe_test.md"]);
  for (const f of r.written) {
    assert.equal(await readFile(path.join(testsDir(root), f), "utf8"), readFileSync(path.join(EXPECTED_DIR, f), "utf8"), f);
  }
  const again = await writeGenerated(root);
  assert.deepEqual(again.written, [], "second run writes nothing");
  assert.equal(again.unchanged.length, 3);
});

test("generated files: claim tags, exact-text assertions, no absolute URLs in steps", () => {
  const rendered = renderAll(parseSpec(SAMPLE));
  const about = rendered.find((r) => r.file === "cart-then-about_test.md");
  assert.deepEqual(about.claims, ["CLM-001", "CLM-003"]);
  assert.match(about.content, /^tags: \[clm-001, clm-003\]$/m);
  assert.match(about.content, /^url: https:\/\/gl-test-93mjujacr-timeb7208-5361s-projects\.vercel\.app\/$/m);
  assert.match(about.content, /^Verify the page shows the exact text "Items in cart: 1"\.$/m);
  const body = about.content.split("\n## ").slice(1).join("\n");
  assert.equal(/https?:\/\//.test(body), false);
  for (const r of rendered) {
    assert.ok(/^---\nmode: (testing|action)\nurl: .+\ntags: \[.+\]\nmax_steps: \d+\n---\n/.test(r.content), r.file);
    assert.ok(r.content.includes("Verify the page shows the exact text"), r.file);
  }
});

test("the approved list feeds Step 2's classifier", () => {
  const approved = toApprovedTests(renderAll(parseSpec(SAMPLE)));
  assert.deepEqual(approved.tests.find((t) => t.file === "cart-then-about_test.md").claims, ["CLM-001", "CLM-003"]);
  const run = fabricatedRun({
    members: [
      { file: "cart-add-two_test.md", tags: ["clm-001"], status: "passed" },
      { file: "newsletter-subscribe_test.md", tags: ["clm-002"], status: "failed" },
      { file: "cart-then-about_test.md", tags: ["clm-001", "clm-003"], status: "passed" },
    ],
    exitCode: 1,
  });
  const r = classifyTests(run, approved);
  assert.deepEqual(r.tests.map((t) => [t.file, t.status]), [
    ["cart-add-two_test.md", "passed"],
    ["cart-then-about_test.md", "passed"],
    ["newsletter-subscribe_test.md", "app_failure"],
  ]);
});

// ---------------------------------------------------------------- hash

test("hash is pinned and stable across runs", async () => {
  const spec = parseSpec(SAMPLE);
  assert.equal(bundleHash(spec, renderAll(spec)), SAMPLE_HASH);
  assert.equal((await loadProject(await project())).hash, SAMPLE_HASH);
});

test("comments, blank lines, quoting style and key order do not change the hash", () => {
  const reformatted = SAMPLE.replace(/#.*$/gm, "")
    .replace(/\n\n+/g, "\n")
    .replace("name: Greenlight Test App", 'name: "Greenlight Test App"')
    .replace("  - id: CLM-002\n    text: Users can subscribe to the newsletter.", "  - text: Users can subscribe to the newsletter.\n    id: CLM-002");
  assert.notEqual(reformatted, SAMPLE);
  const s = parseSpec(reformatted);
  assert.equal(bundleHash(s, renderAll(s)), SAMPLE_HASH);
});

test("every meaningful change changes the hash", () => {
  const changes = [
    ["claim text", "Users can add items to the cart.", "Users can add many items to the cart."],
    ["expected text", '"Items in cart: 2"', '"Items in cart: 3"'],
    ["step action", "Click the \"Add item\" button two times.", "Click the \"Add item\" button twice."],
    ["project URL", "projects.vercel.app/", "projects.vercel.app/app/"],
    ["max_steps", "max_steps: 20", "max_steps: 21"],
    ["project name", "name: Greenlight Test App", "name: Greenlight Test App 2"],
    ["requirement", "The cart shows how many items have been added.", "The cart shows the item count."],
  ];
  const seen = new Set([SAMPLE_HASH]);
  for (const [label, from, to] of changes) {
    assert.ok(SAMPLE.includes(from), label);
    const s = parseSpec(SAMPLE.replace(from, to));
    const h = bundleHash(s, renderAll(s));
    assert.ok(!seen.has(h), `${label} did not change the hash`);
    seen.add(h);
  }
});

// ---------------------------------------------------------------- approval gate

test("a person at a terminal who types the hash prefix approves; the record is self-hashed", async () => {
  const root = await project();
  await writeGenerated(root);
  const r = await humanApprove(root, SAMPLE_HASH.slice(0, 12));
  assert.equal(r.approved, true);
  assert.match(r.output, /Approved-test hash: 07bc6327/);
  assert.match(r.output, /CLM-002  Users can subscribe to the newsletter\./);
  const rec = JSON.parse(await readFile(path.join(root, APPROVAL_FILE), "utf8"));
  assert.equal(rec.approvedHash, SAMPLE_HASH);
  assert.equal(rec.approvedBy, "dev");
  assert.equal(rec.method, "local-terminal-confirmation");
  assert.deepEqual(rec.claims, ["CLM-001", "CLM-002", "CLM-003"]);
  assert.equal(rec.tests.length, 3);
  assert.equal(rec.recordSha256, approvalRecordHash(rec));
  const s = await checkApproval(root);
  assert.equal(s.status, "approved", s.reasons.join(","));
});

test("approval is refused in an AI agent or CI environment, before anything is shown", async () => {
  const root = await project();
  await writeGenerated(root);
  for (const marker of ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "AI_AGENT", "CI", "GITHUB_ACTIONS"]) {
    const r = await humanApprove(root, SAMPLE_HASH.slice(0, 12), { opts: { env: { ...HUMAN_ENV, [marker]: "1" } } });
    assert.equal(r.approved, false);
    assert.equal(r.reason, "agent_or_ci_environment");
    assert.equal(r.output.includes(SAMPLE_HASH), false, "the hash is not even shown to an agent");
  }
  assert.equal(existsSync(path.join(root, APPROVAL_FILE)), false);
  assert.deepEqual(detectAgentEnvironment({ CI: "false", AI_AGENT: "", CLAUDECODE: "0" }), []);
});

test("this very process (an AI agent's shell) cannot approve via the CLI", async () => {
  const root = await project();
  await writeGenerated(root);
  const r = spawnSync(process.execPath, [BIN, "approve"], { cwd: root, env: { ...process.env, CLAUDECODE: "1" }, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Approval refused: this looks like an AI agent or CI/);
  const r2 = spawnSync(process.execPath, [BIN, "approve"], { cwd: root, env: HUMAN_ENV, encoding: "utf8" });
  assert.equal(r2.status, 1);
  assert.match(r2.stdout, /needs an interactive terminal/, "piped stdin is refused even without agent markers");
  assert.equal(existsSync(path.join(root, APPROVAL_FILE)), false);
});

test("approval is refused without a TTY, with a wrong or missing answer, or with stale tests", async () => {
  const root = await project();
  await writeGenerated(root);
  assert.equal((await humanApprove(root, SAMPLE_HASH.slice(0, 12), { tty: false })).reason, "not_interactive");
  assert.equal((await humanApprove(root, "000000000000")).reason, "confirmation_mismatch");
  assert.equal((await humanApprove(root, SAMPLE_HASH.slice(0, 11))).reason, "confirmation_mismatch");
  assert.equal((await humanApprove(root, "yes")).reason, "confirmation_mismatch");
  assert.equal((await humanApprove(root, null)).reason, "confirmation_mismatch");
  await writeFile(path.join(testsDir(root), "cart-add-two_test.md"), "edited by hand\n");
  assert.equal((await humanApprove(root, SAMPLE_HASH.slice(0, 12))).reason, "generated_tests_out_of_date");
  assert.equal(existsSync(path.join(root, APPROVAL_FILE)), false);

  const fresh = await project();
  assert.equal((await humanApprove(fresh, SAMPLE_HASH.slice(0, 12))).reason, "generated_tests_out_of_date", "not generated yet");
  const bad = await project("version: 1\n");
  assert.equal((await humanApprove(bad, "x")).reason, "spec_invalid");
});

test("generating and checking never create an approval", async () => {
  const root = await project();
  await writeGenerated(root);
  await checkApproval(root);
  await writeGenerated(root);
  assert.equal(existsSync(path.join(root, APPROVAL_FILE)), false);
  assert.equal((await checkApproval(root)).status, "not_approved");
  const r = spawnSync(process.execPath, [BIN, "generate"], { cwd: root, env: HUMAN_ENV, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /approved-test hash \(not yet approved\): 07bc6327/);
  assert.equal(existsSync(path.join(root, APPROVAL_FILE)), false);
});

// ---------------------------------------------------------------- invalidation

test("changing an approved test in the spec invalidates the approval", async () => {
  const root = await approvedProject();
  await writeFile(path.join(root, "greenlight.yaml"), SAMPLE.replace('"Items in cart: 2"', '"Items in cart: 3"'));
  let s = await checkApproval(root);
  assert.equal(s.status, "invalidated");
  assert.ok(s.reasons.includes("spec_changed_tests"));
  assert.ok(s.reasons.includes("changed:cart-add-two_test.md"));
  assert.ok(s.reasons.includes("generated_tests_modified"), "files on disk are now out of date too");
  await writeGenerated(root);
  s = await checkApproval(root);
  assert.equal(s.status, "invalidated", "regenerating does not re-approve");
  assert.deepEqual(s.reasons, ["spec_changed_tests", "changed:cart-add-two_test.md"]);
  assert.notEqual(s.currentHash, s.approvedHash);
});

test("a spec change that alters no test file (claim text elsewhere) still invalidates", async () => {
  const root = await approvedProject();
  await writeFile(path.join(root, "greenlight.yaml"), SAMPLE.replace("The cart shows how many items have been added.", "Different requirement."));
  const s = await checkApproval(root);
  assert.equal(s.status, "invalidated");
  assert.deepEqual(s.reasons, ["spec_changed"]);
});

test("comment-only edits keep the approval", async () => {
  const root = await approvedProject();
  await writeFile(path.join(root, "greenlight.yaml"), `# reviewed again on Friday\n${SAMPLE}`);
  assert.equal((await checkApproval(root)).status, "approved");
});

test("editing, deleting or adding generated test files invalidates the approval", async () => {
  const root = await approvedProject();
  const f = path.join(testsDir(root), "newsletter-subscribe_test.md");
  const original = await readFile(f, "utf8");

  await writeFile(f, original.replace("Thanks for subscribing", "Subscription failed"));
  let s = await checkApproval(root);
  assert.equal(s.status, "invalidated");
  assert.deepEqual(s.reasons, ["generated_tests_modified", "modified:newsletter-subscribe_test.md"]);

  await unlink(f);
  s = await checkApproval(root);
  assert.deepEqual(s.reasons, ["generated_tests_missing", "missing:newsletter-subscribe_test.md"]);

  await writeFile(f, original);
  assert.equal((await checkApproval(root)).status, "approved", "restoring the exact content restores it");

  await writeFile(path.join(testsDir(root), "sneaky_test.md"), "---\nmode: testing\n---\n## x\nClick.\n");
  s = await checkApproval(root);
  assert.deepEqual(s.reasons, ["unexpected_test_files", "unexpected:sneaky_test.md"]);
});

test("removing a test from the spec invalidates, naming the removed file", async () => {
  const root = await approvedProject();
  const withoutAbout = SAMPLE.slice(0, SAMPLE.indexOf("  - id: cart-then-about")).replace("  - id: CLM-003\n    text: The About page is reachable from the home page.\n", "");
  await writeFile(path.join(root, "greenlight.yaml"), withoutAbout);
  const s = await checkApproval(root);
  assert.equal(s.status, "invalidated");
  assert.ok(s.reasons.includes("removed:cart-then-about_test.md"), s.reasons.join(","));
  assert.ok(s.reasons.includes("unexpected_test_files"));
});

test("a tampered or unreadable approval record is reported as corrupt", async () => {
  const root = await approvedProject();
  const file = path.join(root, APPROVAL_FILE);
  const rec = JSON.parse(await readFile(file, "utf8"));

  await writeFile(file, JSON.stringify({ ...rec, approvedBy: "claude" }));
  assert.equal((await checkApproval(root)).status, "approval_corrupt");

  // Forging a matching approvedHash without the record hash also fails.
  const forged = { ...rec, approvedHash: "f".repeat(64) };
  await writeFile(file, JSON.stringify(forged));
  assert.equal((await checkApproval(root)).status, "approval_corrupt");

  await writeFile(file, "{not json");
  assert.equal((await checkApproval(root)).status, "approval_corrupt");
});

test("an invalid or missing spec is reported, not thrown", async () => {
  const root = await approvedProject();
  await writeFile(path.join(root, "greenlight.yaml"), "version: 1\n");
  const s = await checkApproval(root);
  assert.equal(s.status, "spec_invalid");
  assert.ok(s.reasons.length > 0);
  await rm(path.join(root, "greenlight.yaml"));
  assert.deepEqual((await checkApproval(root)).reasons, ["greenlight.yaml not found"]);
});

test("CLI status reports approval and invalidation", async () => {
  const root = await approvedProject();
  let r = spawnSync(process.execPath, [BIN, "status"], { cwd: root, env: HUMAN_ENV, encoding: "utf8" });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /status: approved/);
  await writeFile(path.join(testsDir(root), "cart-add-two_test.md"), "x");
  r = spawnSync(process.execPath, [BIN, "status"], { cwd: root, env: HUMAN_ENV, encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stdout, /status: invalidated\n.*\n.*\n  - generated_tests_modified/);
  r = spawnSync(process.execPath, [BIN, "bogus"], { cwd: root, env: HUMAN_ENV, encoding: "utf8" });
  assert.equal(r.status, 2);
});

// ---------------------------------------------------------------- recording cache

async function fakeRecording(root, stem, steps = { "steps/1.json": "a", "steps/2.json": "b" }) {
  const dir = path.join(testsDir(root), `output-${stem}`, ".internal");
  await mkdir(path.join(dir, "steps"), { recursive: true });
  for (const [f, c] of Object.entries(steps)) await writeFile(path.join(dir, f), c);
  await writeFile(path.join(dir, "execution.json"), "{}");
  await writeFile(path.join(dir, "meta.json"), '{"executions":[]}');
  await writeFile(path.join(testsDir(root), `output-${stem}`, "Result.md"), "# result\n");
}

test("recording cache: baseline, ignored files, changes, additions and removals", async () => {
  const root = await approvedProject();
  const files = ["cart-add-two_test.md", "cart-then-about_test.md", "newsletter-subscribe_test.md"];
  await fakeRecording(root, "cart-add-two");
  await fakeRecording(root, "newsletter-subscribe");
  const args = { root, testsDir: testsDir(root), testFiles: files, approvedHash: SAMPLE_HASH };

  assert.equal((await checkRecordings(args)).status, "no_baseline");
  const base = await saveRecordingsBaseline({ ...args, now: () => new Date("2026-11-19T12:00:00Z") });
  assert.deepEqual(base.notRecorded, ["cart-then-about_test.md"]);
  assert.ok(!Object.keys(base.files).some((k) => k.endsWith("meta.json") || k.endsWith("Result.md")));
  assert.equal((await checkRecordings(args)).status, "unchanged");

  // Kane appends run history to meta.json and rewrites Result.md on every run: ignored.
  const internal = path.join(testsDir(root), "output-cart-add-two", ".internal");
  await writeFile(path.join(internal, "meta.json"), '{"executions":[{"run_kind":"replay"}]}');
  await writeFile(path.join(testsDir(root), "output-cart-add-two", "Result.md"), "# result 2\n");
  assert.equal((await checkRecordings(args)).status, "unchanged");

  // A rewritten step (e.g. healing) is detected.
  await writeFile(path.join(internal, "steps", "2.json"), "healed");
  let c = await checkRecordings(args);
  assert.deepEqual([c.status, c.changed], ["changed", ["output-cart-add-two/.internal/steps/2.json"]]);

  await fakeRecording(root, "cart-then-about", { "steps/1.json": "z" });
  await rm(path.join(testsDir(root), "output-newsletter-subscribe"), { recursive: true });
  c = await checkRecordings(args);
  assert.ok(c.added.includes("output-cart-then-about/.internal/steps/1.json"));
  assert.ok(c.removed.includes("output-newsletter-subscribe/.internal/steps/1.json"));
});

test("recording cache is separate from approval, and goes stale when the approved hash changes", async () => {
  const root = await approvedProject();
  await fakeRecording(root, "cart-add-two");
  const files = ["cart-add-two_test.md"];
  await saveRecordingsBaseline({ root, testsDir: testsDir(root), testFiles: files, approvedHash: SAMPLE_HASH });

  await writeFile(path.join(testsDir(root), "output-cart-add-two", ".internal", "steps", "1.json"), "rewritten");
  assert.equal((await checkApproval(root)).status, "approved", "recordings do not affect approval");
  assert.equal((await checkRecordings({ root, testsDir: testsDir(root), testFiles: files, approvedHash: SAMPLE_HASH })).status, "changed");

  const stale = await checkRecordings({ root, testsDir: testsDir(root), testFiles: files, approvedHash: "b".repeat(64) });
  assert.equal(stale.status, "stale");
  assert.equal(stale.baselineApprovedHash, SAMPLE_HASH);
});

test("a symlink inside a recording is recorded as such, not followed", async () => {
  const root = await project();
  await fakeRecording(root, "cart-add-two");
  await symlink("/etc/hostname", path.join(testsDir(root), "output-cart-add-two", ".internal", "steps", "link.json"));
  const snap = await snapshotRecordings({ testsDir: testsDir(root), testFiles: ["cart-add-two_test.md"] });
  assert.equal(snap.files["output-cart-add-two/.internal/steps/link.json"], "symlink");
});

test("golden fixture directory contains exactly the generated files", async () => {
  assert.deepEqual((await readdir(EXPECTED_DIR)).sort(), ["cart-add-two_test.md", "cart-then-about_test.md", "newsletter-subscribe_test.md"]);
});
