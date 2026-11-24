// Greenlight evidence collector (Phase 1, Step 3).
//
// After a Kane run, this:
//   1. finds the evidence pack from the completed run's execution ID
//      (<kane cwd>/.testmuai/evidence/<execution_id>.evidence),
//   2. checks it is a regular file and a structurally complete zip,
//   3. copies it into .greenlight/runs/<run-id>/evidence/ (private, 0600),
//   4. validates the copy with `kane-cli evidence validate --json`,
//      requiring valid: true and keeping every warning,
//   5. hashes the pack and Kane's stdout / stderr (SHA-256),
//   6. writes manifest.json and, last of all, the hash of the whole record.
//
// PRIVACY: evidence packs contain the Kane account's username and email, Test
// Manager share links and the start URL (which may carry a deployment bypass
// secret). Everything written here is local and private. Nothing in this module
// publishes, uploads or exposes a pack. Public certification (Phase 2) must use
// a separately produced, redacted summary.

import path from "node:path";
import { constants as fsc } from "node:fs";
import { redactText } from "../report/redact.js";
import { mkdir, writeFile, copyFile, rename, rm, lstat, chmod, readFile } from "node:fs/promises";
import { sha256File, sha256Bytes, canonicalJson } from "./hash.js";
import { checkZipStructure } from "./zip-check.js";
import { kaneEvidenceValidator, interpretValidation } from "./validate.js";
import { KANE_CLI_VERSION } from "../kane/runner.js";

export const MANIFEST_SCHEMA = "greenlight.run-manifest/v1";
export const MANIFEST_FILE = "manifest.json";
export const RECORD_HASH_FILE = "manifest.sha256";
export const STDOUT_FILE = "kane-stdout.ndjson";
export const STDERR_FILE = "kane-stderr.txt";
/** The tail of Kane's remote-execution log (HyperExecute), when Kane names one: why a dispatch failed. */
export const REMOTE_LOG_FILE = "kane-remote.log";
const REMOTE_LOG_TAIL = 32 * 1024;

/** Kane's remote session folder (remote_done.sessions_path): the grid's downloaded artifacts. */
export const REMOTE_ARTIFACTS_FILE = "kane-remote-artifacts.txt";
function remoteSessionsPath(stdout) {
  for (const line of String(stdout ?? "").split("\n")) {
    if (!line.includes('"remote_done"')) continue;
    try {
      const e = JSON.parse(line);
      if (e?.type === "remote_done" && typeof e.sessions_path === "string") return e.sessions_path;
    } catch {
      // not JSON
    }
  }
  return null;
}

/** A listing of the folder plus the tails of its small text files (logs), at most ~96 KB. */
async function describeFolder(root) {
  const { readdir, stat } = await import("node:fs/promises");
  const out = [];
  let budget = 96 * 1024;
  async function walk(dir, depth) {
    if (depth > 6 || budget <= 0) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full, depth + 1);
        continue;
      }
      if (!e.isFile()) continue;
      const st = await stat(full).catch(() => null);
      out.push(`# ${path.relative(root, full)} (${st?.size ?? "?"} bytes)`);
      if (st && /\.(log|txt|ndjson|json|yaml|yml|md|out|err)$/i.test(e.name) && budget > 0) {
        const raw = await readFile(full).catch(() => null);
        if (raw) {
          const take = Math.min(raw.length, 8 * 1024, budget);
          budget -= take;
          out.push(raw.subarray(raw.length - take).toString("utf8"), "");
        }
      }
    }
  }
  await walk(root, 0);
  return out.join("\n");
}

/** The log_path of Kane's remote_start event, if any. */
function remoteLogPath(stdout) {
  for (const line of String(stdout ?? "").split("\n")) {
    if (!line.includes('"remote_start"')) continue;
    try {
      const e = JSON.parse(line);
      if (e?.type === "remote_start" && typeof e.log_path === "string" && e.log_path.endsWith(".log")) return e.log_path;
    } catch {
      // not JSON
    }
  }
  return null;
}
export const EVIDENCE_DIR = "evidence";

const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const EXECUTION_ID = /^[A-Za-z0-9][A-Za-z0-9-]{7,63}$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;
const GIT_COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** Evidence outcomes. Only "stored" means a validated pack is on disk. */
export const EVIDENCE_STATUS = Object.freeze({
  STORED: "stored",
  NO_EXECUTION_ID: "no_execution_id",
  EXECUTION_ID_MISMATCH: "execution_id_mismatch",
  INVALID_EXECUTION_ID: "invalid_execution_id",
  MISSING: "missing",
  NOT_A_REGULAR_FILE: "not_a_regular_file",
  CORRUPTED: "corrupted",
  COPY_MISMATCH: "copy_mismatch",
  INVALID: "invalid",
  NOT_FOUND_BY_VALIDATOR: "not_found_by_validator",
  VALIDATION_OUTPUT_UNREADABLE: "validation_output_unreadable",
  VALIDATION_UNAVAILABLE: "validation_unavailable",
  CHANGED_DURING_VALIDATION: "changed_during_validation",
});

/**
 * Record the start URL without its query string or fragment, which can carry
 * secrets (e.g. a deployment-protection bypass token). The full URL is kept
 * only as a hash.
 */
export function describeStartUrl(startUrl) {
  if (startUrl === undefined || startUrl === null) return null;
  const u = new URL(startUrl);
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new TypeError(`startUrl must be http(s): ${startUrl}`);
  const hadSecretsRemoved = Boolean(u.search || u.hash || u.username || u.password);
  return {
    origin: u.origin,
    path: u.pathname,
    redacted: `${u.origin}${u.pathname}${u.search ? "?REDACTED" : ""}`,
    queryOrFragmentRemoved: hadSecretsRemoved,
    sha256: sha256Bytes(startUrl),
  };
}

/** Hash of the record: canonical JSON of the manifest without its own hash. */
export function recordHash(manifest) {
  const { recordSha256, ...rest } = manifest;
  return sha256Bytes(canonicalJson(rest));
}

function validateInputs({ runId, approvedTestHash, deployedCommit, runResult }) {
  if (typeof runId !== "string" || !RUN_ID.test(runId)) throw new TypeError(`invalid runId: ${runId}`);
  if (typeof approvedTestHash !== "string" || !SHA256_HEX.test(approvedTestHash)) {
    throw new TypeError("approvedTestHash must be a lowercase SHA-256 hex string");
  }
  if (typeof deployedCommit !== "string" || !GIT_COMMIT.test(deployedCommit)) {
    throw new TypeError("deployedCommit must be a full lowercase git commit hash");
  }
  if (!runResult || typeof runResult !== "object") throw new TypeError("runResult is required");
}

async function writePrivate(filePath, data) {
  await writeFile(filePath, data, { mode: 0o600, flag: "wx" });
  await chmod(filePath, 0o600);
}

/**
 * Locate, validate, copy and hash the evidence for one Kane run, and write the
 * run record.
 *
 * @param {object} p
 * @param {string} p.runId                  Greenlight run id (directory name)
 * @param {import("../kane/runner.js").KaneRunResult} p.runResult
 * @param {string} p.kaneCwd                Directory Kane ran in (holds .testmuai/evidence/)
 * @param {string} p.projectRoot            Greenlight project root (holds .greenlight/)
 * @param {string} p.approvedTestHash
 * @param {string} p.deployedCommit
 * @param {string} [p.startUrl]
 * @param {(packPath: string) => Promise<object>} [p.validator]  default: kaneEvidenceValidator()
 * @param {object} [p.evaluation]           Step 2 evaluateRun() output, summarised into the record
 * @param {{method: string, certifiable: boolean}} [p.approval]  how the tests were approved
 * @param {object} [p.credits]            credits/usage.js creditRecord(): actual spend from the balance difference
 * @param {object[]} [p.warnings]         run warnings, e.g. recording_not_retained
 * @param {"iteration"|"certification"} [p.runKind]  only the server's certification runs may say "certification"
 * @param {number} [p.attempt]              1, or 2 for the one infrastructure retry
 * @param {string|null} [p.previousRunId]   the attempt this one retried
 * @param {() => Date} [p.now]
 */
export async function collectEvidence({
  runId,
  runResult,
  kaneCwd,
  projectRoot,
  approvedTestHash,
  deployedCommit,
  startUrl,
  validator = kaneEvidenceValidator(),
  evaluation,
  approval,
  credits,
  warnings,
  runKind = "iteration",
  attempt = 1,
  previousRunId = null,
  now = () => new Date(),
}) {
  if (runKind !== "iteration" && runKind !== "certification") throw new TypeError(`invalid runKind: ${runKind}`);
  validateInputs({ runId, approvedTestHash, deployedCommit, runResult });
  const startUrlInfo = describeStartUrl(startUrl);

  const runsRoot = path.join(projectRoot, ".greenlight", "runs");
  const runDir = path.join(runsRoot, runId);
  await mkdir(runsRoot, { recursive: true, mode: 0o700 });
  await mkdir(runDir, { mode: 0o700 }); // throws EEXIST: never overwrite a run record
  await chmod(runDir, 0o700);

  // Kane's raw output, stored and hashed exactly as captured.
  const stdoutBytes = Buffer.from(runResult.stdout ?? "", "utf8");
  const stderrBytes = Buffer.from(runResult.stderr ?? "", "utf8");
  await writePrivate(path.join(runDir, STDOUT_FILE), stdoutBytes);
  await writePrivate(path.join(runDir, STDERR_FILE), stderrBytes);
  const remoteLog = remoteLogPath(runResult.stdout);
  if (remoteLog) {
    try {
      const raw = await readFile(remoteLog);
      const tail = raw.subarray(Math.max(0, raw.length - REMOTE_LOG_TAIL)).toString("utf8");
      await writePrivate(path.join(runDir, REMOTE_LOG_FILE), Buffer.from(redactText(tail), "utf8"));
    } catch {
      // the log is diagnostic only; a run never fails for want of it
    }
  }
  const sessions = remoteSessionsPath(runResult.stdout);
  if (sessions) {
    try {
      const text = await describeFolder(sessions);
      if (text) await writePrivate(path.join(runDir, REMOTE_ARTIFACTS_FILE), Buffer.from(redactText(text), "utf8"));
    } catch {
      // diagnostic only
    }
  }

  const evidence = await collectPack({ runResult, kaneCwd, runDir, validator });

  const manifest = {
    schema: MANIFEST_SCHEMA,
    private: true,
    publication: "never_publish_raw_evidence_or_this_record",
    runId,
    // "iteration" records are developer-side and can never be certifications (brief §11).
    runKind,
    certification: false,
    attempt,
    previousRunId,
    createdAt: now().toISOString(),
    approvedTestHash,
    deployedCommit,
    startUrl: startUrlInfo,
    kane: {
      pinnedVersion: KANE_CLI_VERSION,
      reportedVersion: runResult.stream?.streamStart?.cliVersion ?? null,
      executionId: runResult.stream?.done?.executionId ?? null,
      exitCode: runResult.exitCode ?? null,
      timedOut: Boolean(runResult.timedOut),
      startedAt: runResult.startedAt ?? null,
      endedAt: runResult.endedAt ?? null,
      streamComplete: runResult.completeness?.complete ?? false,
      streamIncompleteReasons: runResult.completeness?.reasons ?? [],
      // Why Kane stopped, when it reported errors (e.g. it failed before any test started).
      errors: kaneErrorSummary(runResult),
    },
    outputs: {
      stdout: { file: STDOUT_FILE, sha256: sha256Bytes(stdoutBytes), bytes: stdoutBytes.length },
      stderr: { file: STDERR_FILE, sha256: sha256Bytes(stderrBytes), bytes: stderrBytes.length },
    },
    evidence,
    result: evaluation ? summariseEvaluation(evaluation) : null,
    // How the tests were approved. A relayed approval is never certifiable.
    approval: approval ? { method: approval.method ?? null, certifiable: approval.certifiable === true } : null,
    // Balance before/after and the actual spend (balance difference), Kane's logged spend and the estimate.
    credits: credits ?? null,
    warnings: Array.isArray(warnings) ? warnings : [],
  };
  manifest.recordSha256 = recordHash(manifest); // last: after every other hash is set

  await writePrivate(path.join(runDir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + "\n");
  await writePrivate(path.join(runDir, RECORD_HASH_FILE), `${manifest.recordSha256}  ${MANIFEST_FILE}\n`);

  return { ok: evidence.status === EVIDENCE_STATUS.STORED, runDir, manifest };
}

async function collectPack({ runResult, kaneCwd, runDir, validator }) {
  const base = {
    status: null,
    executionId: null,
    source: null,
    file: null,
    sha256: null,
    bytes: null,
    zipCheck: null,
    validation: null,
  };
  const done = runResult.stream?.done;
  const executionId = done?.executionId ?? null;
  if (!executionId) return { ...base, status: EVIDENCE_STATUS.NO_EXECUTION_ID };
  if (!EXECUTION_ID.test(executionId)) return { ...base, executionId, status: EVIDENCE_STATUS.INVALID_EXECUTION_ID };
  const summaryEvidenceId = runResult.stream?.summary?.evidenceId;
  if (summaryEvidenceId && summaryEvidenceId !== executionId) {
    return { ...base, executionId, status: EVIDENCE_STATUS.EXECUTION_ID_MISMATCH };
  }

  // Local runs write <id>.evidence; with --remote Kane copies the grid's pack to execution-<id>.evidence.
  let source = path.join(kaneCwd, ".testmuai", "evidence", `${executionId}.evidence`);
  const remoteSource = path.join(kaneCwd, ".testmuai", "evidence", `execution-${executionId}.evidence`);
  if (!(await lstat(source).then(() => true, () => false)) && (await lstat(remoteSource).then(() => true, () => false))) source = remoteSource;
  const rec = { ...base, executionId, source };

  let st;
  try {
    st = await lstat(source);
  } catch (err) {
    if (err.code === "ENOENT") return { ...rec, status: EVIDENCE_STATUS.MISSING };
    throw err;
  }
  if (!st.isFile()) return { ...rec, status: EVIDENCE_STATUS.NOT_A_REGULAR_FILE };

  const zipCheck = await checkZipStructure(source);
  if (!zipCheck.ok) return { ...rec, zipCheck, status: EVIDENCE_STATUS.CORRUPTED };

  const evidenceDir = path.join(runDir, EVIDENCE_DIR);
  await mkdir(evidenceDir, { mode: 0o700 });
  const finalName = `${executionId}.evidence`;
  const finalPath = path.join(evidenceDir, finalName);
  const partialPath = `${finalPath}.partial`;

  const sourceHash = await sha256File(source);
  await copyFile(source, partialPath, fsc.COPYFILE_EXCL);
  await chmod(partialPath, 0o600);
  const copyHash = await sha256File(partialPath);
  if (copyHash.sha256 !== sourceHash.sha256 || copyHash.bytes !== sourceHash.bytes) {
    await rm(partialPath, { force: true });
    return { ...rec, zipCheck, status: EVIDENCE_STATUS.COPY_MISMATCH };
  }

  // Validate our private copy, so what we validate is exactly what we keep.
  let validation;
  try {
    validation = interpretValidation(await validator(partialPath));
  } catch (err) {
    validation = interpretValidation({ spawnError: err?.message ?? String(err) });
  }
  const withValidation = { ...rec, zipCheck, sha256: copyHash.sha256, bytes: copyHash.bytes, validation };

  if (validation.outcome !== "valid") {
    await rm(partialPath, { force: true });
    return { ...withValidation, status: validation.outcome };
  }

  const afterHash = await sha256File(partialPath);
  if (afterHash.sha256 !== copyHash.sha256) {
    await rm(partialPath, { force: true });
    return { ...withValidation, status: EVIDENCE_STATUS.CHANGED_DURING_VALIDATION };
  }

  await rename(partialPath, finalPath);
  return { ...withValidation, status: EVIDENCE_STATUS.STORED, file: path.posix.join(EVIDENCE_DIR, finalName) };
}

function summariseEvaluation(e) {
  return {
    project: e.project?.status ?? null,
    runUsable: e.run?.usable ?? null,
    claims: (e.claims ?? []).map((c) => ({ id: c.id, status: c.status })),
    tests: (e.tests ?? []).map((t) => ({ file: t.file, status: t.status })),
  };
}

/**
 * Re-check a stored run record: the record hash, and every file hash it lists.
 * @returns {Promise<{ok: boolean, problems: string[], manifest: object|null}>}
 */
export async function verifyRunRecord(runDir) {
  const problems = [];
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(runDir, MANIFEST_FILE), "utf8"));
  } catch {
    return { ok: false, problems: ["manifest_unreadable"], manifest: null };
  }
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) return { ok: false, problems: ["manifest_unreadable"], manifest: null };
  if (manifest.schema !== MANIFEST_SCHEMA) problems.push("unknown_schema");
  if (recordHash(manifest) !== manifest.recordSha256) problems.push("record_hash_mismatch");
  try {
    const side = (await readFile(path.join(runDir, RECORD_HASH_FILE), "utf8")).split(/\s+/)[0];
    if (side !== manifest.recordSha256) problems.push("record_hash_file_mismatch");
  } catch {
    problems.push("record_hash_file_missing");
  }

  const checkFile = async (label, rel, expected, expectedBytes) => {
    if (typeof rel !== "string" || rel === "" || path.isAbsolute(rel) || typeof expected !== "string") return problems.push(`${label}_reference_invalid`);
    const full = path.join(runDir, rel);
    const relative = path.relative(runDir, full);
    if (relative.startsWith("..") || path.isAbsolute(relative)) return problems.push(`${label}_path_outside_run`);
    try {
      const st = await lstat(full); // a symlink could point anywhere: never followed
      if (!st.isFile()) return problems.push(`${label}_not_a_file`);
      const h = await sha256File(full);
      if (h.sha256 !== expected) problems.push(`${label}_hash_mismatch`);
      if (expectedBytes !== undefined && h.bytes !== expectedBytes) problems.push(`${label}_size_mismatch`);
    } catch {
      problems.push(`${label}_missing`);
    }
  };
  await checkFile("stdout", manifest.outputs?.stdout?.file, manifest.outputs?.stdout?.sha256, manifest.outputs?.stdout?.bytes);
  await checkFile("stderr", manifest.outputs?.stderr?.file, manifest.outputs?.stderr?.sha256, manifest.outputs?.stderr?.bytes);
  if (manifest.evidence?.status === EVIDENCE_STATUS.STORED) {
    await checkFile("evidence", manifest.evidence.file, manifest.evidence.sha256, manifest.evidence.bytes);
  }
  return { ok: problems.length === 0, problems, manifest };
}

/** Kane's own error events, short and with secrets and URL queries removed: at most 5, 300 chars each. */
export function kaneErrorSummary(runResult) {
  const events = Array.isArray(runResult?.stream?.errors) ? runResult.stream.errors : [];
  const clean = (v) =>
    String(v ?? "")
      .replace(/(https?:\/\/[^\s?#"']+)[?#][^\s"']*/g, "$1")
      .replace(/\b(LT_[A-Za-z0-9]{8,}|eyJ[A-Za-z0-9_-]{10,}[.][A-Za-z0-9._-]+|sb_secret_[A-Za-z0-9_]+)/g, "[redacted]")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 300);
  return events.slice(0, 5).map((e) => ({
    code: clean(e?.code ?? e?.error_code ?? e?.kind ?? "") || null,
    message: clean(e?.message ?? e?.error ?? e?.detail ?? e?.reason ?? JSON.stringify(e)) || null,
  }));
}
