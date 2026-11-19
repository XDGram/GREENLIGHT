// Local human approval of the generated tests.
//
// `approve()` records the approved-test hash in .greenlight/approval.json, but
// only for a human at an interactive terminal:
//   - refused when an AI agent or CI environment is detected (Claude Code sets
//     CLAUDECODE and CLAUDE_CODE_ENTRYPOINT; AI_AGENT, CI are also checked),
//   - refused unless stdin and stdout are both TTYs,
//   - refused unless the generated tests on disk are exactly what the spec produces,
//   - the person must type the first 12 characters of the hash shown to them.
// Nothing else writes approval.json: not the generator, not checkApproval, not
// generated tests. These are local guardrails, not security: the Greenlight
// server will be the authority (Phase 2).
//
// `checkApproval()` recomputes the hash from greenlight.yaml and the files on
// disk every time. Any difference invalidates the approval.

import path from "node:path";
import os from "node:os";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createInterface } from "node:readline";
import { loadProject, checkGenerated, GENERATOR_VERSION, SPEC_FILE } from "./generate.js";
import { SpecError } from "./schema.js";
import { sha256Bytes, canonicalJson } from "../evidence/hash.js";

export const APPROVAL_FILE = path.join(".greenlight", "approval.json");
export const APPROVAL_SCHEMA = "greenlight.approval/v1";
export const CONFIRM_CHARS = 12;

const AGENT_MARKERS = ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "AI_AGENT", "CI", "GITHUB_ACTIONS", "GREENLIGHT_AGENT"];

/** Environment variables that show an agent or automation, not a person, is running this. */
export function detectAgentEnvironment(env = process.env) {
  return AGENT_MARKERS.filter((k) => env[k] !== undefined && env[k] !== "" && env[k] !== "0" && env[k] !== "false");
}

export function approvalRecordHash(record) {
  const { recordSha256, ...rest } = record;
  return sha256Bytes(canonicalJson(rest));
}

async function readApproval(root) {
  let text;
  try {
    text = await readFile(path.join(root, APPROVAL_FILE), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { exists: false };
    throw err;
  }
  try {
    return { exists: true, record: JSON.parse(text) };
  } catch {
    return { exists: true, record: null };
  }
}

/**
 * Current approval status. Never writes anything.
 * status: approved | not_approved | invalidated | approval_corrupt | spec_invalid
 */
export async function checkApproval(root) {
  let project;
  try {
    project = await loadProject(root);
  } catch (err) {
    if (err instanceof SpecError) return { status: "spec_invalid", reasons: err.errors, currentHash: null, approvedHash: null };
    if (err.code === "ENOENT") return { status: "spec_invalid", reasons: [`${SPEC_FILE} not found`], currentHash: null, approvedHash: null };
    throw err;
  }
  const generated = await checkGenerated(project);
  const a = await readApproval(root);
  const base = { currentHash: project.hash, generated, project };
  if (!a.exists) return { ...base, status: "not_approved", reasons: ["no approval recorded"], approvedHash: null };
  const rec = a.record;
  if (!rec || rec.schema !== APPROVAL_SCHEMA || typeof rec.approvedHash !== "string" || approvalRecordHash(rec) !== rec.recordSha256) {
    return { ...base, status: "approval_corrupt", reasons: ["approval record unreadable or altered"], approvedHash: rec?.approvedHash ?? null };
  }

  const reasons = [];
  if (rec.approvedHash !== project.hash) {
    if (rec.generator !== GENERATOR_VERSION) reasons.push("generator_changed");
    const approvedFiles = new Map((rec.tests ?? []).map((t) => [t.file, t.sha256]));
    const changedTests = project.rendered.filter((r) => approvedFiles.get(r.file) !== r.sha256).map((r) => r.file);
    const removedTests = [...approvedFiles.keys()].filter((f) => !project.rendered.some((r) => r.file === f));
    if (changedTests.length || removedTests.length) reasons.push("spec_changed_tests");
    else reasons.push("spec_changed");
    for (const f of changedTests) reasons.push(`changed:${f}`);
    for (const f of removedTests) reasons.push(`removed:${f}`);
  }
  if (generated.modified.length) reasons.push("generated_tests_modified", ...generated.modified.map((f) => `modified:${f}`));
  if (generated.missing.length) reasons.push("generated_tests_missing", ...generated.missing.map((f) => `missing:${f}`));
  if (generated.unexpected.length) reasons.push("unexpected_test_files", ...generated.unexpected.map((f) => `unexpected:${f}`));

  return { ...base, status: reasons.length ? "invalidated" : "approved", reasons, approvedHash: rec.approvedHash, record: rec };
}

function ask(stdin, stdout, question) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: stdin, output: stdout, terminal: false });
    let answered = false;
    rl.question(question, (answer) => {
      answered = true;
      rl.close();
      resolve(answer);
    });
    rl.on("close", () => {
      if (!answered) resolve(null);
    });
  });
}

/**
 * Interactive human approval.
 * @returns {Promise<{approved: boolean, reason: string|null, hash: string|null}>}
 */
export async function approve({
  root,
  env = process.env,
  stdin = process.stdin,
  stdout = process.stdout,
  now = () => new Date(),
  approver = () => os.userInfo().username,
}) {
  const say = (s) => stdout.write(`${s}\n`);
  const refuse = (reason, detail) => {
    say(`Approval refused: ${detail}`);
    return { approved: false, reason, hash: null };
  };

  const markers = detectAgentEnvironment(env);
  if (markers.length) {
    return refuse("agent_or_ci_environment", `this looks like an AI agent or CI (${markers.join(", ")} set). Only a person may approve tests, from their own terminal.`);
  }
  if (!stdin.isTTY || !stdout.isTTY) return refuse("not_interactive", "approval needs an interactive terminal.");

  let project;
  try {
    project = await loadProject(root);
  } catch (err) {
    if (err instanceof SpecError) return refuse("spec_invalid", err.message);
    throw err;
  }
  const generated = await checkGenerated(project);
  if (!generated.clean) {
    return refuse("generated_tests_out_of_date", `generated tests do not match ${SPEC_FILE} (missing: ${generated.missing.join(", ") || "none"}; modified: ${generated.modified.join(", ") || "none"}; unexpected: ${generated.unexpected.join(", ") || "none"}). Run "greenlight generate" first.`);
  }

  const { spec, rendered, hash } = project;
  say(`Project: ${spec.project.name}`);
  say(`URL:     ${spec.project.url}`);
  say("Claims:");
  for (const c of spec.claims) say(`  ${c.id}  ${c.text}`);
  say("Tests:");
  for (const r of rendered) say(`  ${r.file}  [${r.claims.join(", ")}]  sha256 ${r.sha256.slice(0, 16)}`);
  say(`Approved-test hash: ${hash}`);
  say("Read the generated tests in .greenlight/tests/ before approving.");
  const answer = await ask(stdin, stdout, `To approve, type the first ${CONFIRM_CHARS} characters of the hash: `);
  if (answer === null || answer.trim() !== hash.slice(0, CONFIRM_CHARS)) {
    return refuse("confirmation_mismatch", "the characters typed did not match. Nothing was approved.");
  }

  const record = {
    schema: APPROVAL_SCHEMA,
    approvedHash: hash,
    approvedAt: now().toISOString(),
    approvedBy: approver(),
    method: "local-terminal-confirmation",
    generator: GENERATOR_VERSION,
    specFile: SPEC_FILE,
    specFileSha256: project.specFileSha256,
    projectUrl: spec.project.url,
    claims: spec.claims.map((c) => c.id),
    tests: rendered.map((r) => ({ id: r.testId, file: r.file, claims: r.claims, sha256: r.sha256 })),
  };
  record.recordSha256 = approvalRecordHash(record);
  await mkdir(path.join(root, ".greenlight"), { recursive: true });
  const target = path.join(root, APPROVAL_FILE);
  await writeFile(`${target}.tmp`, JSON.stringify(record, null, 2) + "\n");
  await rename(`${target}.tmp`, target);
  say(`Approved. Hash ${hash} recorded in ${APPROVAL_FILE}.`);
  return { approved: true, reason: null, hash, record };
}
