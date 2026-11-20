// Read-only JSON for the Greenlight web app (/app), for a person signed in with Vercel.
//
// The app never holds an API token. Every request is authorised by the same signed, HttpOnly
// session cookie the approval pages use (Sign in with Vercel, GREENLIGHT_APPROVERS), and is
// scoped to that session's Greenlight account: another account's project is "not found".
// Nothing here writes: approving still happens only on the server-rendered /approve pages
// (two typed hashes, CSRF tokens, write-once storage), and certification still needs the API.
//
//   GET  /app/api/session                 who is signed in, and until when
//   GET  /app/api/projects                the account's projects with their current state
//   GET  /app/api/projects/:projectId     one project: versions, claims, tests, estimate, jobs, records
//   POST /app/api/logout                  end the session (same-origin only)

import { GreenlightError } from "../cli/errors.js";
import { projectFromText } from "../spec/generate.js";
import { catalogFromSpec } from "../report/failure-report.js";
import { estimateRun } from "../credits/estimate.js";
import { verifyRecordIntegrity } from "./models.js";
import { browserApprovalRequired, verifyBrowserApproval } from "./approval-policy.js";

export const APP_API_PREFIX = "/app/api/";
const PROJECT = /^\/app\/api\/projects\/(prj_[0-9a-f]{32})$/;

export function sendJson(res, status, body, headers = {}) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "same-origin");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(status === 204 ? undefined : JSON.stringify(body));
}

const approvalLink = (projectId, version) => `/approve/${projectId}/${version}`;

function estimateFor(spec, config) {
  const catalog = catalogFromSpec(spec);
  const plan = { tests: catalog.tests.map((t) => ({ file: t.file, author: true, steps: t.steps.length })) };
  const e = estimateRun(plan, config.rates ? { rates: config.rates } : {});
  return { credits: e.credits, runOverhead: e.runOverhead, breakdown: e.breakdown.map((b) => ({ file: b.file, steps: b.steps, credits: b.credits })), cap: config.maxCreditsPerRun ?? null };
}

function approvalView(config, project, v, a) {
  if (!a) return null;
  const b = verifyBrowserApproval(config, a, v.approvedTestHash, project.account);
  return {
    approvedBy: a.approvedBy,
    approvedAt: a.approvedAt,
    method: a.method,
    channel: a.channel ?? null,
    identity: a.identity ? { provider: a.identity.provider, username: a.identity.username ?? null } : null,
    recordSha256: a.recordSha256 ?? null,
    signed: Boolean(a.signature),
    browserApprovalRequired: browserApprovalRequired(config, project.account),
    verified: b.ok,
    verificationReason: b.reason ?? null,
  };
}

function versionView(config, project, v, a) {
  let spec = null;
  try {
    spec = projectFromText(v.specText).spec;
  } catch {
    spec = null; // a stored spec that no longer parses is shown without tests or estimate
  }
  const catalog = spec ? catalogFromSpec(spec) : null;
  return {
    version: v.version,
    approvedTestHash: v.approvedTestHash,
    specFileSha256: v.specFileSha256 ?? null,
    submittedBy: v.submittedBy,
    submittedAt: v.submittedAt,
    status: a ? "approved" : "pending_approval",
    approval: approvalView(config, project, v, a),
    approveUrl: a ? null : approvalLink(project.id, v.version),
    description: spec?.project?.description ?? null,
    claims: v.claims.map((c) => ({ id: c.id, text: c.text })),
    tests: (catalog?.tests ?? v.tests.map((t) => ({ file: t.file, title: null, claims: t.claims, steps: [] }))).map((t) => {
      const stored = v.tests.find((x) => x.file === t.file);
      return { file: t.file, title: t.title, claims: t.claims, sha256: stored?.sha256 ?? null, steps: t.steps.map((s) => ({ name: s.name, kind: s.kind, text: s.text })) };
    }),
    estimate: spec ? estimateFor(spec, config) : null,
  };
}

const jobView = (j) => ({ id: j.id, version: j.version, status: j.status, outcome: j.outcome ?? null, requestedBy: j.requestedBy ?? null, createdAt: j.createdAt, startedAt: j.startedAt ?? null, finishedAt: j.finishedAt ?? null, recordId: j.recordId ?? null, error: j.error ? { code: j.error.code ?? null, message: j.error.message ?? null } : null });

function recordView(r, config) {
  const base = config.publicBaseUrl ? config.publicBaseUrl.replace(/\/+$/, "") : "";
  return {
    id: r.id,
    testVersion: r.testVersion,
    status: r.status,
    certified: r.certified === true,
    notCertifiedBecause: r.notCertifiedBecause ?? [],
    deployment: r.deployment ? { url: r.deployment.url, commit: r.deployment.commit, environment: r.deployment.environment } : null,
    claims: (r.claims ?? []).map((c) => ({ id: c.id, text: c.text, status: c.status })),
    startedAt: r.execution?.startedAt ?? null,
    endedAt: r.execution?.endedAt ?? null,
    credits: r.credits ? { actual: r.credits.actualSpend ?? null, estimate: r.credits.estimate ?? null } : null,
    evidenceStatus: r.evidence?.status ?? null,
    integrity: verifyRecordIntegrity(r).ok,
    publicUrl: `${base}/v1/public/records/${r.id}`,
  };
}

async function projectJobs(store, projectIds) {
  const ids = new Set(projectIds);
  const all = await store.listJobs();
  return all.filter((j) => ids.has(j.projectId)).sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
}

async function summary(config, store, project, jobs) {
  const versions = await store.listVersions(project.id);
  const latest = versions.reduce((m, v) => (!m || v.version > m.version ? v : m), null);
  const approval = latest ? await store.getApproval(project.id, latest.version) : null;
  const records = (await store.listRecords(project.id)).sort((x, y) => String(y.execution?.startedAt ?? "").localeCompare(String(x.execution?.startedAt ?? "")));
  const pending = [];
  for (const v of versions) if (!(await store.getApproval(project.id, v.version))) pending.push({ version: v.version, approveUrl: approvalLink(project.id, v.version), submittedAt: v.submittedAt, submittedBy: v.submittedBy });
  const last = records[0] ?? null;
  return {
    id: project.id,
    name: project.name,
    url: project.url,
    createdAt: project.createdAt,
    createdBy: project.createdBy,
    versions: versions.length,
    latestVersion: latest ? { version: latest.version, status: approval ? "approved" : "pending_approval", submittedAt: latest.submittedAt, claims: latest.claims.length, tests: latest.tests.length, approvedAt: approval?.approvedAt ?? null, approvedBy: approval?.approvedBy ?? null } : null,
    pendingApprovals: pending,
    lastRecord: last ? recordView(last, config) : null,
    records: records.length,
    certified: records.some((r) => r.certified === true),
    activeJob: jobs.filter((j) => j.projectId === project.id && (j.status === "queued" || j.status === "running")).map(jobView)[0] ?? null,
  };
}

/**
 * Handle an /app/api/ request for a verified session `s` (null when signed out).
 * @returns {Promise<void>}
 */
export async function handleAppApi({ req, res, url, s, store, config, sameOrigin, clearSessionCookie }) {
  const path = url.pathname;
  try {
    if (path === "/app/api/logout") {
      if (req.method !== "POST") return sendJson(res, 405, { error: { code: "method_not_allowed", message: "Use POST." } }, { allow: "POST" });
      if (!sameOrigin(req)) return sendJson(res, 403, { error: { code: "forbidden", message: "Cross-site request." } });
      return sendJson(res, 204, null, { "set-cookie": clearSessionCookie });
    }
    if (req.method !== "GET") return sendJson(res, 405, { error: { code: "method_not_allowed", message: "Read-only." } }, { allow: "GET" });
    if (!s) return sendJson(res, 401, { error: { code: "sign_in_required", message: "Sign in with Vercel to continue." }, loginUrl: "/approve/login?next=%2Fapp" });

    if (path === "/app/api/session") {
      return sendJson(res, 200, { user: s.user, account: s.account, username: s.username ?? null, name: s.name ?? null, authenticatedAt: s.authAt ?? null, expiresAt: new Date(s.exp).toISOString(), maxCreditsPerRun: config.maxCreditsPerRun ?? null });
    }
    if (path === "/app/api/projects") {
      const projects = await store.listProjects(s.account);
      const jobs = await projectJobs(store, projects.map((p) => p.id));
      const out = [];
      for (const p of projects) out.push(await summary(config, store, p, jobs));
      out.sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
      return sendJson(res, 200, { projects: out });
    }
    const m = PROJECT.exec(path);
    if (m) {
      const project = await store.getProject(m[1], s.account); // other accounts: not_found
      const jobs = await projectJobs(store, [project.id]);
      const versions = [];
      for (const v of (await store.listVersions(project.id)).sort((x, y) => y.version - x.version)) versions.push(versionView(config, project, v, await store.getApproval(project.id, v.version)));
      const records = (await store.listRecords(project.id)).map((r) => recordView(r, config)).sort((x, y) => String(y.startedAt ?? "").localeCompare(String(x.startedAt ?? "")));
      return sendJson(res, 200, {
        project: { id: project.id, name: project.name, url: project.url, createdAt: project.createdAt, createdBy: project.createdBy },
        versions,
        jobs: jobs.map(jobView),
        records,
      });
    }
    return sendJson(res, 404, { error: { code: "not_found", message: "Not found." } });
  } catch (err) {
    if (err instanceof GreenlightError && err.code === "not_found") return sendJson(res, 404, { error: { code: "not_found", message: "Not found." } });
    throw err;
  }
}
