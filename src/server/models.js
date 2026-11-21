// Data models shared by the server, the API and the CLI publish client.
// Each persisted object carries a `schema` string; changing a shape means a new
// schema version, never a silent change.
//
// Project              greenlight.project/v1
//   { id, name, url, account, createdBy, createdAt }
// TestVersion          greenlight.test-version/v1
//   { projectId, version, approvedTestHash, specText, specFileSha256, generator,
//     project: {name, url}, claims: [{id, text}], tests: [{file, claims, sha256, content}],
//     submittedBy, submittedAt }
// Approval             greenlight.server-approval/v1
//   { projectId, version, approvedTestHash, approvedBy, approvedAt, method: "server-owner",
//     certifiable: true, recordSha256 }
// Job                  greenlight.job/v1
//   { id, kind: "certification", projectId, version, status, request, createdAt,
//     startedAt, finishedAt, recordId, error }   status: queued|running|succeeded|failed
// VerificationRecord   greenlight.verification-record/v1   (permanent, one per run)
//   see buildVerificationRecord()
//
// Certification rule (brief §11): only a VerificationRecord whose run was the
// server's own fresh certification run, from a human (owner) approval stored on
// the server for exactly that approved-test hash, with a usable run, stored and
// validated evidence and every claim passed, has certified: true. Nothing else
// (local runs, relayed approvals, iteration reports) can ever produce one.

import { sha256Bytes, canonicalJson } from "../evidence/hash.js";
import { redactPublicDeep } from "../report/redact.js";
import { KANE_CAPABILITIES } from "../kane/capabilities.js";

export const SCHEMAS = Object.freeze({
  project: "greenlight.project/v1",
  testVersion: "greenlight.test-version/v1",
  approval: "greenlight.server-approval/v1",
  job: "greenlight.job/v1",
  record: "greenlight.verification-record/v1",
  publicRecord: "greenlight.public-verification/v1",
});

export const SERVER_APPROVAL_METHOD = "server-owner";
/** Server approvals given in the browser after Sign in with Vercel (src/server/approval-web.js). */
export const WEB_APPROVAL_CHANNEL = "web-sign-in-with-vercel";
export const GOOGLE_APPROVAL_CHANNEL = "web-sign-in-with-google";
/** Browser sign-in providers whose approvals the server accepts: channel and ID-token issuer. */
export const WEB_IDENTITY_PROVIDERS = Object.freeze({
  vercel: Object.freeze({ channel: WEB_APPROVAL_CHANNEL, issuer: "https://vercel.com" }),
  google: Object.freeze({ channel: GOOGLE_APPROVAL_CHANNEL, issuer: "https://accounts.google.com" }),
  // A guest (no sign-up) approving their own tests in the app: identity is the server's own signed
  // guest session. Guest accounts can never certify; this only lets their own tests run.
  guest: Object.freeze({ channel: "web-guest-session", issuer: "greenlight-guest" }),
});
export const JOB_STATUS = Object.freeze({ QUEUED: "queued", RUNNING: "running", SUCCEEDED: "succeeded", FAILED: "failed" });

/** Hash of a JSON object without its own `recordSha256`. */
export function selfHash(obj) {
  const { recordSha256, ...rest } = obj;
  return sha256Bytes(canonicalJson(rest));
}

export function buildApproval({ projectId, version, approvedBy, now, extra = {} }) {
  const a = {
    ...extra,
    schema: SCHEMAS.approval,
    projectId,
    version: version.version,
    approvedTestHash: version.approvedTestHash,
    approvedBy,
    approvedAt: now.toISOString(),
    method: SERVER_APPROVAL_METHOD,
    certifiable: true,
  };
  a.recordSha256 = selfHash(a);
  return a;
}

/** Is this server approval intact, human (owner) and for exactly this hash? */
export function approvalValidFor(approval, approvedTestHash) {
  return Boolean(
    approval &&
      approval.schema === SCHEMAS.approval &&
      approval.method === SERVER_APPROVAL_METHOD &&
      approval.certifiable === true &&
      approval.approvedTestHash === approvedTestHash &&
      selfHash(approval) === approval.recordSha256,
  );
}

/**
 * A server approval given in the browser by a verified human (Sign in with Vercel or Google), with both
 * exact hashes confirmed separately, test specification first. Intact and for exactly `hash`.
 */
export function webApprovalValidFor(approval, hash) {
  const id = approval?.identity;
  const c = approval?.confirmations;
  const t = Date.parse(c?.testSpecification?.confirmedAt ?? "");
  const v = Date.parse(c?.serverVersion?.confirmedAt ?? "");
  return Boolean(
    approvalValidFor(approval, hash) &&
      Object.hasOwn(WEB_IDENTITY_PROVIDERS, id?.provider ?? "") &&
      approval.channel === WEB_IDENTITY_PROVIDERS[id.provider].channel &&
      id.issuer === WEB_IDENTITY_PROVIDERS[id.provider].issuer && typeof id.subject === "string" && id.subject.length > 0 &&
      c?.testSpecification?.hash === hash && c?.serverVersion?.hash === hash &&
      Number.isFinite(t) && Number.isFinite(v) && t <= v,
  );
}

/**
 * The permanent verification record for one server certification run.
 * `certified` is computed here and only here.
 */
export function buildVerificationRecord({ id, project, version, approval, deployment, evaluation, manifest, credits, startedAt, endedAt, now, certifiable = true, testsRun = null }) {
  const evidenceStored = manifest?.evidence?.status === "stored";
  const runUsable = evaluation.run?.usable === true;
  const status = evaluation.project.status; // passed | failed | couldnt_verify
  const claimText = new Map(version.claims.map((c) => [c.id, c.text]));
  // A guest verification (or a run of only some tests) is never a certification.
  const certified = certifiable && !testsRun && status === "passed" && runUsable && evidenceStored && manifest?.runKind === "certification" && approvalValidFor(approval, version.approvedTestHash);
  const record = {
    schema: SCHEMAS.record,
    id,
    projectId: project.id,
    project: { name: project.name, url: project.url },
    testVersion: version.version,
    approvedTestHash: version.approvedTestHash,
    approval: { method: approval.method, approvedAt: approval.approvedAt, recordSha256: approval.recordSha256 },
    requirements: version.claims.map((c) => ({ id: c.id, text: c.text })),
    deployment: { url: deployment.url, commit: deployment.deployedCommit, environment: deployment.environment, ...(deployment.commitSource ? { commitSource: deployment.commitSource } : {}) },
    status,
    certified,
    notCertifiedBecause: certified
      ? []
      : [
          ...(status !== "passed" ? [`status_${status}`] : []),
          ...(runUsable ? [] : ["run_not_usable"]),
          ...(evidenceStored ? [] : [`evidence_${manifest?.evidence?.status ?? "missing"}`]),
          ...(certifiable ? [] : ["guest_verification"]),
          ...(testsRun ? ["partial_rerun"] : []),
        ],
    ...(testsRun ? { testsRun } : {}),
    claims: evaluation.claims.map((c) => ({ id: c.id, text: claimText.get(c.id) ?? null, status: c.status, tests: c.tests })),
    execution: {
      runId: manifest?.runId ?? null,
      runKind: manifest?.runKind ?? null,
      startedAt,
      endedAt,
      kane: {
        version: manifest?.kane?.reportedVersion ?? null,
        pinnedVersion: KANE_CAPABILITIES.version,
        executionId: manifest?.kane?.executionId ?? null,
        exitCode: manifest?.kane?.exitCode ?? null,
        localModeOnly: true,
      },
      freshAuthoring: true, // every certification run starts from an empty workspace
    },
    evidence: {
      status: manifest?.evidence?.status ?? null,
      packSha256: manifest?.evidence?.sha256 ?? null,
      packBytes: manifest?.evidence?.bytes ?? null,
      validation: manifest?.evidence?.validation?.outcome ?? null,
      kaneStdoutSha256: manifest?.outputs?.stdout?.sha256 ?? null,
      runManifestSha256: manifest?.recordSha256 ?? null,
    },
    credits: credits ? { actualSpend: credits.actualSpend, kaneReportedSpend: credits.kaneReportedSpend, estimate: credits.estimate, status: credits.status } : null,
    createdAt: now.toISOString(),
  };
  record.recordSha256 = selfHash(record);
  return record;
}

/** Public view: no account, no approver identity, no local paths or secrets. */
export function publicRecord(record, { publicBaseUrl } = {}) {
  const { projectId, approval, credits, ...rest } = record;
  const view = {
    ...rest,
    schema: SCHEMAS.publicRecord,
    recordSchema: record.schema,
    approval: { method: approval.method, approvedAt: approval.approvedAt },
    publicUrl: publicBaseUrl ? `${publicBaseUrl.replace(/\/+$/, "")}/v1/public/records/${record.id}` : null,
    integrity: { recordSha256: record.recordSha256, algorithm: "sha256 of canonical JSON of the stored record without recordSha256" },
  };
  const out = redactPublicDeep(view);
  // Anyone holding this public document can recompute publicSha256 over it (canonical
  // JSON of the document without publicSha256) and compare it with the server's copy.
  out.publicSha256 = publicHash(out);
  return out;
}

export function publicHash(doc) {
  const { publicSha256, ...rest } = doc;
  return sha256Bytes(canonicalJson(rest));
}

/** Re-check a stored record's own hash (anyone can do this from the stored JSON). */
export function verifyRecordIntegrity(record) {
  return { ok: Boolean(record) && selfHash(record) === record.recordSha256, recordSha256: record?.recordSha256 ?? null, computed: record ? selfHash(record) : null };
}
