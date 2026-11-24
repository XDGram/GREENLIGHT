// JSON for the Greenlight web app (/app), for a person signed in with Google (role "user") or an
// administrator signed in with Vercel (role "admin").
//
// The app never holds an API token. Every request is authorised by the signed, HttpOnly session
// cookie (src/server/approval-web.js) and is scoped to that session's Greenlight account: another
// account's project is "not found". Every write must be same-origin JSON.
//
// What this API can NOT do, by design:
//   - approve tests: approval happens only on the server-rendered /approve pages (two typed
//     hashes, CSRF tokens, signed write-once record);
//   - certify without an explicit spend confirmation: POST .../certifications needs confirmSpend,
//     and the job re-checks approval, the deployed commit and the credit cap before Kane runs;
//   - publish anything: public records exist only for certification runs that really ran.
//
//   GET  /app/api/session                         who is signed in, role, features
//   POST /app/api/logout
//   GET  /app/api/projects                        the account's projects
//   POST /app/api/projects                        add a project (name, live URL, GitHub URL, branch, ...)
//   GET  /app/api/projects/:id                    versions, claims, tests, estimate, jobs, records, details
//   POST /app/api/projects/:id/details            edit repository, branch, description, credentials
//   POST /app/api/projects/:id/repository-check   GitHub: repository and branch head
//   POST /app/api/projects/:id/deployment-check   live /greenlight.json: deployed commit
//   POST /app/api/projects/:id/draft              AI: claims and tests from the description (not saved)
//   POST /app/api/projects/:id/preview            structured tests -> greenlight.yaml, hash, estimate
//   POST /app/api/projects/:id/versions           save a new immutable test version (pending approval)
//   POST /app/api/projects/:id/certifications     start a verification run {version, commit, confirmSpend}
//   GET  /app/api/jobs/:id                        job progress
//   GET  /app/api/projects/:id/records/:rid       one run: claims, tests, failures, evidence files
//   GET  /app/api/projects/:id/records/:rid/files/<name>   one evidence file (hash re-checked)
//   GET  /app/api/projects/:id/records/:rid/integrity      re-download and re-hash all evidence
//   GET  /app/api/tokens                          API tokens (Claude Code, MCP)
//   POST /app/api/tokens                          create one {role: agent|owner, label} (shown once)
//   POST /app/api/tokens/:id/revoke
//   GET  /app/api/integrations                    Claude API, Claude Code, MCP status
//   /app/api/admin/*                              administrators only (src/server/admin-api.js)

import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { GreenlightError, errorBody, ERRORS } from "../cli/errors.js";
import { projectFromText, toApprovedTests } from "../spec/generate.js";
import { SpecError } from "../spec/schema.js";
import { catalogFromSpec } from "../report/failure-report.js";
import { estimateRun } from "../credits/estimate.js";
import { isLocalOrPrivateHost } from "../deploy/host.js";
import { TestrunStream, assessCompleteness } from "../kane/testrun-stream.js";
import { evaluateRun } from "../verify/classify.js";
import { SCHEMAS, verifyRecordIntegrity } from "./models.js";
import { browserApprovalRequired, verifyBrowserApproval, signApproval, isGuestAccount } from "./approval-policy.js";
import { buildApproval, selfHash, WEB_IDENTITY_PROVIDERS } from "./models.js";
import { prepareCertification } from "./certify.js";
import { buildSpecYaml, USER_LIMITS, GUEST_LIMITS } from "./guest-spec.js";
import { draftTests } from "./guest-ai.js";
import { parseRepoUrl, checkBranch, checkRepository, checkCommit, probeDeployment, inspectRepository } from "./repo.js";
import { readLiveApp } from "./browse.js";
import { analyzeProject, requirementsFrom, reviseTests } from "./understand.js";
import { handleFixApi } from "./fix-centre.js";
import { createAgentRequest } from "./agent-requests.js";
import { handleAdminApi } from "./admin-api.js";
import { claimsFromText, cleanClaim, checkCost, maxClaims, checkSpecYaml } from "./simple-check.js";

export const APP_API_PREFIX = "/app/api/";
const PROJECT = /^\/app\/api\/projects\/(prj_[0-9a-f]{32})(?:\/(details|repository-check|deployment-check|draft|preview|versions|certifications|understand|fixes))?$/;
const APPROVE = /^\/app\/api\/projects\/(prj_[0-9a-f]{32})\/versions\/([1-9][0-9]{0,5})\/approve$/;
const RECORD = /^\/app\/api\/projects\/(prj_[0-9a-f]{32})\/records\/(vr_[0-9a-f]{32})(?:\/(integrity)|\/files\/([A-Za-z0-9._/-]{1,300}))?$/;
const JOB = /^\/app\/api\/jobs\/(job_[0-9a-f]{32})$/;
const TOKEN = /^\/app\/api\/tokens\/([0-9a-f]{16})\/revoke$/;

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

export async function readJson(req, maxBytes = 256 * 1024) {
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) throw new GreenlightError("invalid_request", "Send JSON.");
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > maxBytes) throw new GreenlightError("payload_too_large", "Request too large.");
    chunks.push(c);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v;
  } catch {
    throw new GreenlightError("invalid_request", "Invalid JSON.");
  }
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

const testsOf = (spec) => catalogFromSpec(spec).tests;

function versionView(config, project, v, a) {
  let spec = null;
  try {
    spec = projectFromText(v.specText).spec;
  } catch {
    spec = null; // a stored spec that no longer parses is shown without tests or estimate
  }
  const catalog = spec ? testsOf(spec) : null;
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
    url: spec?.project?.url ?? null,
    claims: v.claims.map((c) => ({ id: c.id, text: c.text })),
    tests: (catalog ?? v.tests.map((t) => ({ file: t.file, title: null, claims: t.claims, steps: [] }))).map((t) => {
      const stored = v.tests.find((x) => x.file === t.file);
      return { file: t.file, title: t.title, claims: t.claims, sha256: stored?.sha256 ?? null, steps: t.steps.map((s) => ({ name: s.name, kind: s.kind, text: s.text })) };
    }),
    estimate: spec ? estimateFor(spec, config) : null,
  };
}

export const jobView = (j) => ({ id: j.id, projectId: j.projectId, version: j.version, status: j.status, outcome: j.outcome ?? null, requestedBy: j.requestedBy ?? null, commit: j.request?.commit ?? null, commitSource: j.request?.commitSource ?? null, tests: j.request?.tests ?? null, confirmSpend: j.request?.confirmSpend ?? null, createdAt: j.createdAt, startedAt: j.startedAt ?? null, finishedAt: j.finishedAt ?? null, recordId: j.recordId ?? null, error: j.error ? { code: j.error.code ?? null, message: j.error.message ?? null } : null });

export function recordView(r, config) {
  const base = config.publicBaseUrl ? config.publicBaseUrl.replace(/\/+$/, "") : "";
  return {
    id: r.id,
    testVersion: r.testVersion,
    approvedTestHash: r.approvedTestHash ?? null,
    status: r.status,
    certified: r.certified === true,
    notCertifiedBecause: r.notCertifiedBecause ?? [],
    deployment: r.deployment ? { url: r.deployment.url, commit: r.deployment.commit, environment: r.deployment.environment } : null,
    claims: (r.claims ?? []).map((c) => ({ id: c.id, text: c.text, status: c.status })),
    startedAt: r.execution?.startedAt ?? null,
    endedAt: r.execution?.endedAt ?? null,
    credits: r.credits ? { actual: r.credits.actualSpend ?? null, estimate: r.credits.estimate ?? null } : null,
    evidenceStatus: r.evidence?.status ?? null,
    recordSha256: r.recordSha256 ?? null,
    integrity: verifyRecordIntegrity(r).ok,
    // Public records exist for certified runs only; other runs stay private history.
    publicUrl: r.certified === true ? `${base}/v1/public/records/${r.id}` : null,
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

/** Editable project details as the app sees them: credentials are never returned. */
function detailsView(d) {
  if (!d) return null;
  return {
    description: d.description ?? null,
    purpose: d.purpose ?? null,
    repository: d.repository ?? null,
    branch: d.branch ?? null,
    repositoryCheck: d.repositoryCheck ?? null,
    understanding: d.understanding
      ? { inspectedAt: d.understanding.inspectedAt ?? null, repository: d.understanding.repository ?? null, app: d.understanding.app ?? null, screenshot: d.understanding.screenshot ?? null, analysis: d.understanding.analysis ?? null, analyzedAt: d.understanding.analyzedAt ?? null, answers: d.understanding.answers ?? {} }
      : null,
    hasCredentials: Boolean(d.credentials),
    credentialsUpdatedAt: d.credentials?.updatedAt ?? null,
    updatedAt: d.updatedAt ?? null,
  };
}

/** One project with its versions (claims, tests, estimate, approval), jobs and records. */
export async function projectDetail(config, store, project, { publicView = false } = {}) {
  const jobs = await projectJobs(store, [project.id]);
  const versions = [];
  for (const v of (await store.listVersions(project.id)).sort((x, y) => y.version - x.version)) {
    const view = versionView(config, project, v, await store.getApproval(project.id, v.version));
    if (publicView) {
      view.approveUrl = null;
      if (view.approval) view.approval = { ...view.approval, identity: null, recordSha256: null };
    }
    versions.push(view);
  }
  const records = (await store.listRecords(project.id)).map((r) => recordView(r, config)).sort((x, y) => String(y.startedAt ?? "").localeCompare(String(x.startedAt ?? "")));
  let details = null;
  if (!publicView && typeof store.getProjectDetails === "function") {
    try {
      details = detailsView(await store.getProjectDetails(project.id));
    } catch {
      details = null; // details table not migrated yet
    }
  }
  return {
    project: { id: project.id, name: project.name, url: project.url, createdAt: project.createdAt, createdBy: project.createdBy },
    details,
    versions,
    jobs: jobs.map(jobView),
    records,
  };
}

// ---------------------------------------------------------------- helpers

function liveUrl(v) {
  let u;
  try {
    u = new URL(String(v ?? "").trim());
  } catch {
    throw new GreenlightError("invalid_request", "Live URL: enter the full address, starting with https://");
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash) throw new GreenlightError("invalid_request", "Live URL: http(s), without a username, password, query or fragment.");
  if (isLocalOrPrivateHost(u.hostname)) throw new GreenlightError("url_not_allowed", "Live URL: use the app's public address; localhost and private addresses are never tested.");
  return u.href;
}

const text = (v, max, field, { required = false } = {}) => {
  const t = typeof v === "string" ? v.trim() : "";
  if (!t) {
    if (required) throw new GreenlightError("invalid_request", `${field} is required.`);
    return null;
  }
  if (t.length > max) throw new GreenlightError("invalid_request", `${field} is longer than ${max} characters.`);
  return t;
};

/** AES-256-GCM with a key derived from the server's Supabase key: stored encrypted, never returned. */
function sealCredentials(config, creds, now) {
  const username = text(creds?.username, 200, "Test username");
  const password = typeof creds?.password === "string" ? creds.password : "";
  const notes = text(creds?.notes, 500, "Credential notes");
  if (!username && !password && !notes) return null;
  if (password.length > 500) throw new GreenlightError("invalid_request", "Test password is too long.");
  const key = createHmac("sha256", String(config.supabase?.serviceRoleKey ?? "")).update("greenlight-test-credentials-v1").digest();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(JSON.stringify({ username, password, notes }), "utf8"), c.final()]);
  return { alg: "A256GCM", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), ct: ct.toString("base64"), updatedAt: now.toISOString() };
}

function specFromBody(body, project) {
  if (typeof body.specText === "string") {
    if (body.specText.length > 200_000) throw new GreenlightError("invalid_request", "greenlight.yaml is too large (200 kB at most).");
    return body.specText;
  }
  const draft = body.draft && typeof body.draft === "object" ? body.draft : body;
  return buildSpecYaml({ ...draft, name: draft.name || project.name, url: draft.url || project.url }, USER_LIMITS);
}

function deriveOrProblems(specText) {
  try {
    return { derived: projectFromText(specText), problems: [] };
  } catch (err) {
    if (err instanceof SpecError) return { derived: null, problems: err.errors };
    return { derived: null, problems: [String(err?.message ?? err)] };
  }
}

export function previewOf(specText, config) {
  const { derived, problems } = deriveOrProblems(specText);
  if (!derived) return { ok: false, specText, problems };
  const estimate = estimateFor(derived.spec, config);
  const over = estimate.cap !== null && estimate.credits > estimate.cap;
  return {
    ok: true,
    specText,
    hash: derived.hash,
    claims: derived.spec.claims.map((c) => ({ id: c.id, text: c.text })),
    tests: testsOf(derived.spec).map((t) => ({ file: t.file, title: t.title, claims: t.claims, steps: t.steps.map((s) => ({ name: s.name, kind: s.kind, text: s.text })) })),
    estimate,
    problems: [],
    warnings: over ? [`Estimated ${estimate.credits} credits is over this server's limit of ${estimate.cap} per run; certification would be refused. Use fewer tests or steps.`] : [],
  };
}

/** Validate a greenlight.yaml and store it as the project's next immutable version (pending approval). */
export async function proposeVersion({ store, project, specText, by, now }) {
  const { derived, problems } = deriveOrProblems(specText);
  if (!derived) throw new GreenlightError("spec_invalid", "The tests don't follow Greenlight's rules yet.", { problems });
  return store.addVersion(project.id, {
    schema: SCHEMAS.testVersion,
    projectId: project.id,
    approvedTestHash: derived.hash,
    specText,
    specFileSha256: derived.specFileSha256,
    project: { name: derived.spec.project.name, url: derived.spec.project.url },
    claims: derived.spec.claims.map((c) => ({ id: c.id, text: c.text })),
    tests: derived.rendered.map((r) => ({ file: r.file, claims: r.claims, sha256: r.sha256, content: r.content })),
    submittedBy: by,
    submittedAt: now().toISOString(),
  });
}

/**
 * Per-test results re-derived from the run's stored, hash-checked Kane output (failure step and
 * Kane's own failure message). Null when the output is not available.
 */
async function testResults(store, record, version) {
  if (typeof store.getRunFile !== "function" || !record.execution?.runId) return null;
  try {
    // The run manifest is stored as a hash-checked file (the run row holds only its hash).
    const manifest = JSON.parse((await store.getRunFile(record.execution.runId, "manifest.json")).bytes.toString("utf8"));
    const run = { manifest };
    const { bytes } = await store.getRunFile(record.execution.runId, "kane-stdout.ndjson");
    const stream = new TestrunStream();
    for (const line of bytes.toString("utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        stream.apply(JSON.parse(line));
      } catch {
        // non-JSON lines are ignored, as during the run
      }
    }
    const snap = stream.snapshot();
    const k = run.manifest?.kane ?? {};
    const derived = projectFromText(version.specText);
    const runResult = { exitCode: k.exitCode ?? null, timedOut: k.timedOut === true, aborted: false, stream: snap, completeness: assessCompleteness(snap, { exitCode: k.exitCode ?? null, signal: null, timedOut: k.timedOut === true, versionMismatch: false, spawnError: null }) };
    const evaluation = evaluateRun(runResult, toApprovedTests(derived.rendered));
    const catalog = new Map(testsOf(derived.spec).map((t) => [t.file, t]));
    // The status of each test is the one recorded at run time (run manifest); the stored Kane
    // output only adds the failure step and message.
    const recorded = new Map((run.manifest?.result?.tests ?? []).map((t) => [t.file, t.status]));
    return evaluation.tests.map((t) => {
      const status = recorded.get(t.file) ?? t.status;
      const c = catalog.get(t.file);
      const idx = t.kane?.failureStepIndex ?? null;
      const step = Number.isInteger(idx) && idx >= 1 ? c?.steps[idx - 1] ?? null : null;
      return {
        file: t.file,
        title: c?.title ?? null,
        claims: t.claims,
        status,
        reasons: status === "passed" ? [] : t.reasons ?? [],
        durationS: t.kane?.durationS ?? null,
        failureMessage: status === "passed" ? null : t.kane?.failureMessage ?? null,
        failedStep: step && status !== "passed" ? { index: idx, name: step.name, kind: step.kind, text: step.text } : null,
        steps: c ? c.steps.map((s) => ({ name: s.name, kind: s.kind, text: s.text })) : [],
      };
    });
  } catch {
    return null;
  }
}

const CONTENT_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", json: "application/json", ndjson: "application/x-ndjson", txt: "text/plain", md: "text/plain", log: "text/plain", zip: "application/zip", gz: "application/gzip" };

// ---------------------------------------------------------------- handler

/**
 * Best effort: record what happened in the append-only activity log (admin_events) for the
 * administrator. Never blocks or fails the request; never includes secrets.
 */
export async function activity(store, actor, action, target, detail = {}) {
  if (typeof store?.adminEvent !== "function") return;
  try {
    await store.adminEvent(String(actor).slice(0, 200), action, target ?? null, detail);
  } catch {
    // the log is informational
  }
}
const actorOf = (s) => `${s.account}${s.email ? ` (${s.email})` : ""}`;

/** Optional: an operator-configured AI key on the server. Without it, AI work goes to the developer's agent. */
export const serverAi = (config, ai = {}) => Boolean(config.ai?.apiKey) || Boolean(ai.client);

/** Credits for one run of the given tests (all approved tests when none are chosen). */
export function runEstimate(spec, config, tests = null) {
  const catalog = catalogFromSpec(spec);
  const chosen = tests?.length ? catalog.tests.filter((t) => tests.includes(t.file)) : catalog.tests;
  const e = estimateRun({ tests: chosen.map((t) => ({ file: t.file, author: true, steps: t.steps.length })) }, config.rates ? { rates: config.rates } : {});
  return e.credits;
}

/** Guests' real Kane runs: on with guest mode, a job runner and the approval signing key. */
export const guestRunsEnabled = (config) => Boolean(config.guest) && Boolean(config.approvalSigningKey);

async function agentConnected(store, s) {
  try {
    return (await store.listAccountTokens(s.account)).some((t) => t.role === "agent" && !t.revokedAt);
  } catch {
    return false;
  }
}

async function guestPaused(store) {
  try {
    return (await store.getSettings())?.["guest.checks_paused"] === true;
  } catch {
    return false;
  }
}

async function guestRunState(store, config, s) {
  const g = config.guest;
  let usage = { usedByYou: 0, usedToday: 0 };
  try {
    usage = await store.guestRunUsage(s.account);
  } catch {
    // Database without the usage table: count this visitor's runs from their jobs.
    try {
      usage = { usedByYou: await guestJobsUsed(store, s.account), usedToday: 0, creditsToday: 0 };
    } catch {
      // unknown: the run itself is checked again when it is submitted
    }
  }
  return {
    enabled: guestRunsEnabled(config),
    paused: await guestPaused(store),
    perGuest: g?.realRunsPerGuest ?? 0,
    perDay: g?.realRunsPerDay ?? 0,
    leftForYou: Math.max(0, (g?.realRunsPerGuest ?? 0) - usage.usedByYou),
    leftToday: Math.max(0, (g?.realRunsPerDay ?? 0) - usage.usedToday),
    maxCreditsPerRun: g?.maxCreditsPerRun ?? null,
    dailyCredits: g?.dailyCredits ?? null,
    creditsLeftToday: Math.max(0, (g?.dailyCredits ?? 0) - Number(usage.creditsToday ?? 0)),
  };
}

/**
 * Record a signed in-app approval of exactly this version by the signed-in person (guest, Google
 * or administrator session). The same write-once, server-signed record the approval pages write,
 * with both confirmations made by one explicit click; guest accounts can never certify with it.
 */
async function approveInApp({ config, store, s, project, v, now }) {
  const provider = WEB_IDENTITY_PROVIDERS[s.provider] ? s.provider : null;
  if (!provider) throw new GreenlightError("forbidden", "This session cannot approve tests.");
  if (!config.approvalSigningKey) throw new GreenlightError("server_not_configured", "Approvals are not available on this server.");
  const derived = projectFromText(v.specText);
  if (derived.hash !== v.approvedTestHash) throw new GreenlightError("approval_hash_mismatch", "The stored tests do not match their recorded version.");
  const at = now();
  const record = buildApproval({
    projectId: project.id,
    version: v,
    approvedBy: s.user,
    now: at,
    extra: {
      channel: WEB_IDENTITY_PROVIDERS[provider].channel,
      identity:
        provider === "guest"
          ? { provider: "guest", issuer: WEB_IDENTITY_PROVIDERS.guest.issuer, subject: s.sub, username: null, email: null, name: "Guest", authenticatedAt: null }
          : { provider, issuer: WEB_IDENTITY_PROVIDERS[provider].issuer, subject: s.sub, username: s.username ?? null, email: s.email ?? null, name: s.name ?? null, authenticatedAt: s.authAt ?? null },
      confirmations: {
        testSpecification: { hash: derived.hash, specFileSha256: derived.specFileSha256, confirmedAt: at.toISOString() },
        serverVersion: { hash: v.approvedTestHash, confirmedAt: at.toISOString() },
      },
    },
  });
  record.signature = signApproval(config.approvalSigningKey, record);
  record.recordSha256 = selfHash(record);
  await store.putApproval(project.id, v.version, record);
  return record;
}

/**
 * Kane credits already committed on this server. A finished run counts the larger of its recorded
 * estimate and actual spend, unless Kane never started it (no execution id: nothing was spent, so
 * only its recorded actual spend counts). Plus the confirmed ceiling of every queued or running job.
 * Reads existing tables only.
 */
export async function committedCredits(store) {
  const records = await store.adminList("records", 1000);
  const done = (records ?? []).reduce((n, r) => {
    const actual = Number(r.credits?.actualSpend ?? 0) || 0;
    const estimate = Number(r.credits?.estimate ?? 0) || 0;
    return n + (r.evidenceStatus === "no_execution_id" ? actual : Math.max(actual, estimate));
  }, 0);
  const open = await store.listJobs({ statuses: ["queued", "running"] });
  const pending = (open ?? []).reduce((n, j) => n + (Number.isFinite(j.request?.confirmSpend) ? j.request.confirmSpend : 0), 0);
  return Math.ceil(done + pending);
}

/** Refuse a run that would take this server past its total credit cap (fails closed). */
async function checkTotalCap(store, config, credits) {
  const cap = config.totalCreditCap ?? 0;
  if (!cap) return null;
  if (typeof store.adminList !== "function") return null; // local development store
  let used;
  try {
    used = await committedCredits(store);
  } catch {
    throw new GreenlightError("credit_cap_reached", "Kane runs are paused: the server could not confirm its credit cap right now.");
  }
  if (used + credits > cap) {
    throw new GreenlightError("credit_cap_reached", `This run needs about ${Math.ceil(credits)} credits, but only ${Math.max(0, cap - used)} of this server's ${cap}-credit Kane budget is left.`, { cap, used, left: Math.max(0, cap - used) });
  }
  return { cap, used, left: cap - used };
}

/** Jobs a visitor has started that count as a real run (not those refused before Kane started). */
const PRE_KANE = new Set(["deployment_not_ready", "url_not_allowed", "credit_check_refused", "balance_unavailable", "confirmation_required", "approval_not_certifiable", "credit_cap_reached", "sandbox_setup_failed"]);
/** A job that failed before Kane started: refused up front, a sandbox that never got Kane going, or one interrupted before it started. */
const failedBeforeKane = (j) => j.status === "failed" && !j.recordId && (PRE_KANE.has(j.error?.code ?? "") || (j.error?.code === "interrupted" && !j.startedAt));
async function guestJobsUsed(store, account) {
  const projects = await store.listProjects(account);
  const jobs = await projectJobs(store, projects.map((p) => p.id));
  return jobs.filter((j) => !failedBeforeKane(j)).length;
}

/**
 * The commit a run is recorded against when the person does not type one: the live site's
 * /greenlight.json when it has one, otherwise the public branch head, recorded as unconfirmed.
 */
async function serverCommit({ store, project, config, fetchImpl, checkHost, now }) {
  const live = await probeDeployment({ url: project.url, fetchImpl, ...(checkHost ? { checkHost } : {}), now });
  if (live.status === "ok") return { commit: live.commit, commitSource: "live_site" };
  const d = await store.getProjectDetails(project.id).catch(() => null);
  const repo = d?.repository ? parseRepoUrl(d.repository) : null;
  const rc = repo ? await checkRepository({ owner: repo.owner, repo: repo.repo, branch: d.branch ?? "main", fetchImpl, now, token: config.githubToken }) : null;
  if (rc?.status !== "ok") {
    throw new GreenlightError("deployment_not_ready", "Greenlight can't tell which commit is live: the site doesn't publish /greenlight.json and the repository's latest commit can't be read (it may be private). Add /greenlight.json to the site, or make the repository public, then try again.");
  }
  return { commit: rc.head.sha, commitSource: "branch_head" };
}

/**
 * Check everything that can be checked before spending, then queue one verification run of an
 * approved version. Guests: the server picks the commit, the confirmation must cover the
 * estimate, and the run is reserved atomically against the per-visitor and daily limits.
 * @returns {Promise<object>} the queued job
 */
async function submitVerification({ config, store, s, project, body, jobs, fetchImpl, checkHost, now, log, autoCommit = false }) {
  if (!jobs) throw new GreenlightError("server_not_configured", "Verification runs are not available on this server.");
  if (!Number.isInteger(body.version) || body.version < 1) throw new GreenlightError("invalid_request", "Choose the approved test version to verify.");
  if (body.confirmSpend !== undefined && (!Number.isFinite(body.confirmSpend) || body.confirmSpend <= 0)) throw new GreenlightError("invalid_request", "confirmSpend must be a positive number of credits.");
  const request = {
    commit: typeof body.commit === "string" ? body.commit.trim().toLowerCase() : body.commit,
    confirmSpend: body.confirmSpend,
    approvedTestHash: typeof body.approvedTestHash === "string" ? body.approvedTestHash : undefined,
  };
  if (body.environment !== undefined) {
    if (!["preview", "production"].includes(body.environment)) throw new GreenlightError("invalid_request", "environment must be preview or production.");
    request.environment = body.environment;
  }
  if (request.approvedTestHash === undefined) delete request.approvedTestHash;
  let reservation = null;
  if (s.role === "guest" || isGuestAccount(project.account)) {
    if (!guestRunsEnabled(config)) throw new GreenlightError("server_not_configured", "Real browser runs are not available for guests on this server.");
    if (await guestPaused(store)) throw new GreenlightError("guest_limit_reached", "Real browser runs are paused by the administrator right now.");
    if (request.confirmSpend !== undefined) request.confirmSpend = Math.min(request.confirmSpend, config.guest.maxCreditsPerRun);
    // The server decides the commit for guests, never a typed value.
    Object.assign(request, await serverCommit({ store, project, config, fetchImpl, checkHost, now }));
    if (Array.isArray(body.tests) && body.tests.length) {
      if (body.tests.length > 50 || !body.tests.every((t) => typeof t === "string" && /^[a-z0-9-]+_test\.md$/.test(t))) throw new GreenlightError("invalid_request", "tests: a list of test files from the approved version.");
      request.tests = [...new Set(body.tests)];
    }
    const { derived } = await prepareCertification({ store, project, versionNo: body.version, request, config });
    // The cost of exactly this run, shown to the person before they confirm; their confirmation
    // must cover it, and it must fit the per-run ceiling and today's shared budget.
    const est = runEstimate(derived.spec, config, request.tests);
    if (!Number.isFinite(body.confirmSpend) || body.confirmSpend < est) {
      throw new GreenlightError("confirmation_required", `This run is estimated at ${est} credits; confirm that amount to start it.`, { estimate: est });
    }
    request.confirmSpend = Math.min(Math.ceil(est), config.guest.maxCreditsPerRun);
    await checkTotalCap(store, config, request.confirmSpend);
    reservation = (
      await store.reserveGuestRun(project.account, { credits: Math.ceil(est), perAccount: config.guest.realRunsPerGuest, perDay: config.guest.realRunsPerDay, dailyCredits: config.guest.dailyCredits, maxPerRun: config.guest.maxCreditsPerRun })
    ).reservation;
    if (reservation === null && (await guestJobsUsed(store, project.account)) >= config.guest.realRunsPerGuest) {
      // Database without reservations: the per-visitor limit is counted from the visitor's jobs.
      throw new GreenlightError("guest_limit_reached", "You have used your free Kane run on this browser.");
    }
  } else {
    if (autoCommit) Object.assign(request, await serverCommit({ store, project, config, fetchImpl, checkHost, now }));
    // Everything that can be checked before spending (the job checks it all again).
    await prepareCertification({ store, project, versionNo: body.version, request, config });
    await checkTotalCap(store, config, Number.isFinite(request.confirmSpend) ? request.confirmSpend : config.maxCreditsPerRun);
  }
  let job;
  try {
    job = await jobs.submit({ projectId: project.id, version: body.version, request, requestedBy: s.user });
  } catch (err) {
    if (reservation !== null) await store.releaseGuestRun(reservation).catch(() => {});
    throw err;
  }
  if (reservation !== null) await store.attachGuestRun(reservation, job.id).catch(() => {});
  log({ event: "certification_requested", account: s.account, projectId: project.id, version: body.version, jobId: job.id, confirmSpend: request.confirmSpend });
  await activity(store, actorOf(s), "verification.requested", project.id, { version: body.version, jobId: job.id, commit: request.commit, confirmSpend: request.confirmSpend });
  return job;
}

/** Per-run ceiling and claim limit for the one-page check. */
function checkLimits(config, s) {
  const guest = s.role === "guest";
  const ceiling = guest ? config.guest?.maxCreditsPerRun ?? 0 : config.maxCreditsPerRun ?? 150;
  const L = guest ? GUEST_LIMITS : USER_LIMITS;
  const max = maxClaims(ceiling, config, Math.min(L.tests, L.claims));
  return { ceiling, maxClaims: max, costs: Array.from({ length: max }, (_, i) => checkCost(i + 1, config)), limits: L };
}

/** The repository's README text, or null when GitHub can't show it. */
async function readmeOf(repo, { fetchImpl, now, config }) {
  try {
    const r = await inspectRepository({ owner: repo.owner, repo: repo.repo, branch: repo.branch ?? "main", fetchImpl, now, token: config.githubToken });
    return r?.readme ?? null;
  } catch {
    return null;
  }
}

/** The repository with its branch: main, or the default branch GitHub reports. */
async function repoWithBranch(input, { fetchImpl, now, config }) {
  const repo = parseRepoUrl(input);
  let check = await checkRepository({ owner: repo.owner, repo: repo.repo, branch: "main", fetchImpl, now, token: config.githubToken });
  let branch = "main";
  if (check.status === "branch_not_found" && check.repo?.defaultBranch && check.repo.defaultBranch !== "main") {
    branch = checkBranch(check.repo.defaultBranch);
    check = await checkRepository({ owner: repo.owner, repo: repo.repo, branch, fetchImpl, now, token: config.githubToken });
  }
  return { ...repo, branch, check };
}

const aiUse = new Map();
/** A soft per-account hourly limit on AI calls (per server instance). Guests get fewer. */
function takeAi(s, now) {
  const limit = s.role === "guest" ? 12 : 30;
  const t = now().getTime();
  const u = aiUse.get(s.account);
  if (!u || t - u.start > 3600_000) aiUse.set(s.account, { start: t, count: 1 });
  else if (++u.count > limit) throw new GreenlightError("rate_limited", "AI limit reached for this hour; you can still edit everything yourself.");
} // account -> {start, count}: a soft hourly limit per server instance

/**
 * Handle an /app/api/ request for a verified session `s` (null when signed out).
 */
export async function handleAppApi({ req, res, url, s, store, config, sameOrigin, clearSessionCookie, jobs = null, now = () => new Date(), log = () => {}, fetchImpl = (...a) => globalThis.fetch(...a), ai = {}, checkHost, launch }) {
  const path = url.pathname;
  const isPost = req.method === "POST";
  try {
    if (path === "/app/api/logout") {
      if (!isPost) return sendJson(res, 405, { error: { code: "method_not_allowed", message: "Use POST." } }, { allow: "POST" });
      if (!sameOrigin(req)) return sendJson(res, 403, { error: { code: "forbidden", message: "Cross-site request." } });
      return sendJson(res, 204, null, { "set-cookie": clearSessionCookie });
    }
    if (req.method !== "GET" && !isPost) return sendJson(res, 405, { error: { code: "method_not_allowed", message: "Use GET or POST." } }, { allow: "GET, POST" });
    if (isPost && !sameOrigin(req)) return sendJson(res, 403, { error: { code: "forbidden", message: "Cross-site request." } });
    if (!s) {
      return sendJson(res, 401, {
        error: { code: "sign_in_required", message: "Sign in to continue." },
        loginUrl: config.google ? "/api/auth/google/login?next=%2Fapp" : "/approve/login?next=%2Fapp",
        google: Boolean(config.google),
      });
    }

    if (path.startsWith("/app/api/admin/")) {
      if (s.role !== "admin") return sendJson(res, 403, { error: { code: "forbidden", message: "Administrators only." } });
      return await handleAdminApi({ req, res, url, s, store, config, jobs, now, log, sendJson, readJson });
    }

    if (path === "/app/api/session" && !isPost) {
      return sendJson(res, 200, {
        provider: s.provider,
        role: s.role,
        user: s.user,
        account: s.account,
        username: s.username ?? null,
        email: s.email ?? null,
        name: s.name ?? null,
        picture: s.picture ?? null,
        authenticatedAt: s.authAt ?? null,
        expiresAt: new Date(s.exp).toISOString(),
        maxCreditsPerRun: config.maxCreditsPerRun ?? null,
        features: {
          // AI help comes from the developer's connected coding agent, or (optional) a server key.
          ai: true,
          aiMode: serverAi(config, ai) ? "server" : "agent",
          agentConnected: await agentConnected(store, s),
          google: Boolean(config.google),
          certification: Boolean(jobs) && (s.role !== "guest" || guestRunsEnabled(config)),
          admin: s.role === "admin",
        },
        ...(s.role === "guest" ? { guestRuns: await guestRunState(store, config, s) } : {}),
      });
    }

    if (path === "/app/api/projects" && !isPost) {
      const projects = await store.listProjects(s.account);
      const pj = await projectJobs(store, projects.map((p) => p.id));
      const out = [];
      for (const p of projects) out.push(await summary(config, store, p, pj));
      out.sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)));
      return sendJson(res, 200, { projects: out });
    }

    if (path === "/app/api/projects" && isPost) {
      const body = await readJson(req);
      const name = text(body.name, 120, "Project name", { required: true });
      if (/[\r\n]/.test(name)) throw new GreenlightError("invalid_request", "Project name must be one line.");
      const appUrl = liveUrl(body.url);
      const repo = parseRepoUrl(body.repository);
      const branch = checkBranch(body.branch);
      const description = text(body.description, 1000, "Description");
      const purpose = text(body.purpose, 4000, "What the app should do", { required: true });
      if (s.role === "guest" && (await store.listProjects(s.account)).length >= (config.guest?.projectsPerGuest ?? 5)) {
        throw new GreenlightError("guest_limit_reached", `Guests can keep up to ${config.guest?.projectsPerGuest ?? 5} projects.`);
      }
      if (purpose.length < 20) throw new GreenlightError("invalid_request", "Describe what the app should do in a sentence or two (at least 20 characters).");
      const at = now();
      const repositoryCheck = await checkRepository({ owner: repo.owner, repo: repo.repo, branch, fetchImpl, now, token: config.githubToken });
      const project = await store.createProject({ name, url: appUrl, account: s.account, createdBy: s.user, now: at });
      const doc = { description, purpose, repository: repo.url, branch, repositoryCheck, credentials: sealCredentials(config, body.credentials, at) };
      await store.putProjectDetails(project.id, s.account, doc, s.user);
      log({ event: "project_created", account: s.account, projectId: project.id });
      await activity(store, actorOf(s), "project.created", project.id, { name, repositoryCheck: repositoryCheck.status });
      return sendJson(res, 201, await projectDetail(config, store, project));
    }

    const jm = JOB.exec(path);
    if (jm && !isPost) {
      const job = await store.getJob(jm[1]);
      await store.getProject(job.projectId, s.account); // scoping: 404 for other accounts
      await jobs?.onJobRead?.(job);
      return sendJson(res, 200, { job: jobView(job) });
    }

    const rm = RECORD.exec(path);
    if (rm && !isPost) {
      const [, projectId, recordId, integrity, fileName] = rm;
      const project = await store.getProject(projectId, s.account);
      const record = await store.getRecord(recordId);
      if (record.projectId !== project.id) throw new GreenlightError("not_found", "No such run.");
      if (integrity) {
        const ev = await store.verifyRunEvidence(record.execution.runId);
        return sendJson(res, 200, { ok: ev.ok, problems: ev.problems, files: ev.files, record: verifyRecordIntegrity(record).ok, checkedAt: now().toISOString() });
      }
      if (fileName) {
        if (fileName.split("/").some((p) => !p || p === "." || p === "..")) throw new GreenlightError("not_found", "No such evidence file.");
        const f = await store.getRunFile(record.execution.runId, fileName);
        const ext = fileName.split(".").pop().toLowerCase();
        const type = CONTENT_TYPES[ext] ?? "application/octet-stream";
        const inline = type.startsWith("image/");
        res.statusCode = 200;
        res.setHeader("content-type", type);
        res.setHeader("cache-control", "private, no-store");
        res.setHeader("content-security-policy", "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox");
        res.setHeader("x-content-type-options", "nosniff");
        res.setHeader("content-disposition", `${inline ? "inline" : "attachment"}; filename="${fileName.split("/").pop().replace(/[^A-Za-z0-9._-]/g, "_")}"`);
        res.setHeader("x-greenlight-sha256", f.sha256);
        res.end(f.bytes);
        return;
      }
      const version = await store.getVersion(project.id, record.testVersion);
      let files = [];
      try {
        const run = await store.getRun(record.execution.runId);
        files = run.files.map((f) => ({ name: f.name, bytes: f.bytes, sha256: f.sha256, kind: /\.(png|jpe?g|webp)$/i.test(f.name) ? "image" : f.name === "kane-stdout.ndjson" ? "log" : f.name === "kane-stderr.txt" || f.name === "kane-remote.log" ? "log" : f.name === "manifest.json" ? "manifest" : "file" }));
      } catch {
        files = [];
      }
      return sendJson(res, 200, {
        record: recordView(record, config),
        approval: record.approval ?? null,
        execution: record.execution ?? null,
        evidence: record.evidence ?? null,
        credits: record.credits ?? null,
        claims: (record.claims ?? []).map((c) => ({ id: c.id, text: c.text, status: c.status, tests: c.tests ?? [] })),
        tests: await testResults(store, record, version),
        files,
      });
    }

    if (path.startsWith("/app/api/fixes")) {
      return await handleFixApi({
        req, res, url, s, store, config, jobs, now, log, ai, sendJson, readJson, activity, actorOf,
        getTestResults: (record, version) => testResults(store, record, version),
        queueAgent: serverAi(config, ai) ? null : async (fix, kind, extra = {}) => createAgentRequest({ store, s, project: await store.getProject(fix.projectId, s.account), fix, kind, ...extra }),
      });
    }

    // Requests waiting for (or answered by) the developer's coding agent.
    if (path === "/app/api/agent-requests" && !isPost) {
      const projectId = url.searchParams.get("projectId");
      return sendJson(res, 200, { requests: await store.agentRequestList(s.account, { projectId: projectId && /^prj_[0-9a-f]{32}$/.test(projectId) ? projectId : null }) });
    }
    const arm = /^\/app\/api\/agent-requests\/(ar_[0-9a-f]{32})(\/cancel)?$/.exec(path);
    if (arm) {
      if (arm[2] && isPost) return sendJson(res, 200, { request: await store.agentRequestCancel(arm[1], s.account) });
      if (!arm[2] && !isPost) {
        const r = await store.agentRequestGet(arm[1], s.account);
        delete r.input; // the browser needs status and result, not the full context sent to the agent
        return sendJson(res, 200, { request: r });
      }
    }

    // ------------------------------------------------ the one-page check
    if (path === "/app/api/checks/claims" && isPost) {
      // Step 1: what will be tested. Free: reads the notes, or the README when none were pasted.
      const body = await readJson(req);
      liveUrl(body.url);
      const repo = parseRepoUrl(body.repository);
      let notes = text(body.notes, 20000, "README or notes");
      let source = notes ? "notes" : "none";
      if (!notes) {
        const r = await repoWithBranch(repo.url, { fetchImpl, now, config });
        notes = await readmeOf(r, { fetchImpl, now, config });
        if (notes) source = "readme";
      }
      const lim = checkLimits(config, s);
      let budget = null;
      try {
        budget = config.totalCreditCap ? { cap: config.totalCreditCap, left: Math.max(0, config.totalCreditCap - (await committedCredits(store))) } : null;
      } catch {
        budget = config.totalCreditCap ? { cap: config.totalCreditCap, left: 0 } : null;
      }
      return sendJson(res, 200, { claims: claimsFromText(notes ?? ""), source, maxClaims: lim.maxClaims, costs: lim.costs, ceiling: lim.ceiling, guestRuns: s.role === "guest" ? await guestRunState(store, config, s) : null, budget });
    }

    if (path === "/app/api/checks" && isPost) {
      // Step 2: one click. Creates the project, writes one Kane test per claim, records the
      // person's approval of exactly those tests and starts the run they confirmed the cost of.
      if (!jobs) throw new GreenlightError("server_not_configured", "Kane runs are not available on this server.");
      const body = await readJson(req);
      const appUrl = liveUrl(body.url);
      const claims = (Array.isArray(body.claims) ? body.claims : []).map(cleanClaim);
      if (!claims.length) throw new GreenlightError("invalid_request", "Choose at least one claim to test.");
      const lim = checkLimits(config, s);
      if (!lim.maxClaims) throw new GreenlightError("server_not_configured", "The per-run credit limit on this server is too low for a test.");
      if (claims.length > lim.maxClaims) throw new GreenlightError("invalid_request", `One run can test up to ${lim.maxClaims} claims here; untick the rest.`);
      const cost = checkCost(claims.length, config);
      if (body.confirm !== true || !Number.isFinite(body.confirmSpend) || body.confirmSpend < cost) {
        throw new GreenlightError("confirmation_required", `This run is estimated at ${cost} credits; confirm that amount to start it.`, { estimate: cost });
      }
      if (s.role === "guest") {
        if (!guestRunsEnabled(config)) throw new GreenlightError("server_not_configured", "Kane runs are not available for visitors on this server.");
        if (await guestPaused(store)) throw new GreenlightError("guest_limit_reached", "Kane runs are paused by the administrator right now.");
        const st = await guestRunState(store, config, s);
        if (st.leftForYou < 1) throw new GreenlightError("guest_limit_reached", "You have used your free Kane run. Sign in to run more.");
        if (st.leftToday < 1 || st.creditsLeftToday < cost) throw new GreenlightError("guest_limit_reached", "Today's free Kane runs are used up. Try again tomorrow, or sign in.");
        if ((await store.listProjects(s.account)).length >= (config.guest?.projectsPerGuest ?? 5)) throw new GreenlightError("guest_limit_reached", `Visitors can keep up to ${config.guest?.projectsPerGuest ?? 5} apps.`);
      }
      await checkTotalCap(store, config, cost); // before anything is stored
      const repo = await repoWithBranch(body.repository, { fetchImpl, now, config });
      const name = (repo.check?.repo?.fullName ?? `${repo.owner}/${repo.repo}`).slice(0, 120);
      let specText;
      try {
        specText = checkSpecYaml({ name, url: appUrl, claims, limits: lim.limits });
        projectFromText(specText);
      } catch (err) {
        if (err instanceof SpecError) throw new GreenlightError("invalid_request", "A claim can't be turned into a test.", { problems: err.errors });
        throw err;
      }
      const notes = text(body.notes, 20000, "README or notes");
      const at = now();
      const project = await store.createProject({ name, url: appUrl, account: s.account, createdBy: s.user, now: at });
      await store.putProjectDetails(project.id, s.account, { description: null, purpose: notes ?? claims.join("\n"), repository: repo.url, branch: repo.branch, repositoryCheck: repo.check, credentials: null, flow: "check" }, s.user);
      const v = await proposeVersion({ store, project, specText, by: s.user, now });
      await approveInApp({ config, store, s, project, v, now });
      await activity(store, actorOf(s), "check.started", project.id, { claims: claims.length, version: v.version, hash: v.approvedTestHash, provider: s.provider });
      const job = await submitVerification({ config, store, s, project, body: { version: v.version, confirmSpend: cost, approvedTestHash: v.approvedTestHash }, jobs, fetchImpl, checkHost, now, log, autoCommit: true });
      return sendJson(res, 202, { projectId: project.id, job: jobView(job), estimate: cost });
    }

    const am = APPROVE.exec(path);
    if (am && isPost) {
      // In-app approval is for guests; signed-in accounts approve on the /approve pages.
      if (s.role !== "guest") throw new GreenlightError("forbidden", "Approve on the approval page.");
      const project = await store.getProject(am[1], s.account);
      const v = await store.getVersion(project.id, Number(am[2]));
      const body = await readJson(req);
      if (body.confirm !== true || body.approvedTestHash !== v.approvedTestHash) {
        throw new GreenlightError("approval_hash_mismatch", "These tests changed since you reviewed them; review the current tests and approve again.");
      }
      if (await store.getApproval(project.id, v.version)) throw new GreenlightError("conflict", "This test plan is already approved.");
      await approveInApp({ config, store, s, project, v, now });
      await activity(store, actorOf(s), "tests.approved", project.id, { version: v.version, hash: v.approvedTestHash, provider: "guest" });
      return sendJson(res, 200, await projectDetail(config, store, project));
    }

    const m = PROJECT.exec(path);
    if (m) {
      const [, projectId, action] = m;
      const project = await store.getProject(projectId, s.account); // other accounts: not_found
      if (!action && !isPost) return sendJson(res, 200, await projectDetail(config, store, project));
      if (action === "fixes" && !isPost) return sendJson(res, 200, { fixes: await store.fixList(s.account, project.id) });
      if (!isPost) throw new GreenlightError("not_found", "Not found.");
      const body = await readJson(req);

      if (action === "details") {
        const old = (await store.getProjectDetails(project.id).catch(() => null)) ?? {};
        const doc = { ...old };
        delete doc.updatedAt;
        delete doc.updatedBy;
        if (body.description !== undefined) doc.description = text(body.description, 1000, "Description");
        if (body.purpose !== undefined) doc.purpose = text(body.purpose, 4000, "What the app should do", { required: true });
        if (body.repository !== undefined || body.branch !== undefined) {
          const repo = parseRepoUrl(body.repository ?? old.repository);
          doc.repository = repo.url;
          doc.branch = checkBranch(body.branch ?? old.branch);
          doc.repositoryCheck = await checkRepository({ owner: repo.owner, repo: repo.repo, branch: doc.branch, fetchImpl, now, token: config.githubToken });
        }
        if (body.clearCredentials === true) doc.credentials = null;
        else if (body.credentials !== undefined) doc.credentials = sealCredentials(config, body.credentials, now()) ?? old.credentials ?? null;
        await store.putProjectDetails(project.id, s.account, doc, s.user);
        await activity(store, actorOf(s), "project.details_changed", project.id, { fields: Object.keys(body).filter((k) => k !== "credentials").concat(body.credentials !== undefined ? ["credentials"] : []) });
        return sendJson(res, 200, await projectDetail(config, store, project));
      }

      if (action === "repository-check") {
        const d = await store.getProjectDetails(project.id).catch(() => null);
        if (!d?.repository) throw new GreenlightError("invalid_request", "Add the project's GitHub repository first.");
        const repo = parseRepoUrl(d.repository);
        const check = await checkRepository({ owner: repo.owner, repo: repo.repo, branch: d.branch ?? "main", fetchImpl, now, token: config.githubToken });
        const doc = { ...d, repositoryCheck: check };
        delete doc.updatedAt;
        delete doc.updatedBy;
        await store.putProjectDetails(project.id, s.account, doc, s.user);
        return sendJson(res, 200, { repositoryCheck: check });
      }

      if (action === "deployment-check") {
        const target = typeof body.url === "string" && body.url ? liveUrl(body.url) : project.url;
        const deployment = await probeDeployment({ url: target, fetchImpl, ...(checkHost ? { checkHost } : {}), now });
        // Is the deployed commit part of the project's repository? Only claimed when GitHub confirms it.
        let inRepository = null;
        const d = await store.getProjectDetails(project.id).catch(() => null);
        if (deployment.commit && d?.repository) {
          const repo = parseRepoUrl(d.repository);
          inRepository = { repository: repo.url, ...(await checkCommit({ owner: repo.owner, repo: repo.repo, sha: deployment.commit, fetchImpl, now, token: config.githubToken })) };
        }
        return sendJson(res, 200, { deployment, inRepository });
      }

      if (action === "draft") {
        const d = await store.getProjectDetails(project.id).catch(() => null);
        if (!serverAi(config, ai)) {
          // No AI on the server: ask the developer's connected coding agent.
          const revising = typeof body.instruction === "string" && body.instruction.trim() && body.current && typeof body.current === "object";
          const req = await createAgentRequest({
            store,
            s,
            project,
            details: d,
            kind: revising ? "revise_plan" : "draft_plan",
            current: revising ? { claims: body.current.claims, tests: body.current.tests } : undefined,
            instruction: revising ? text(body.instruction, 1500, "Request", { required: true }) : undefined,
          });
          return sendJson(res, 202, { agentRequest: req });
        }
        takeAi(s, now);
        // Revise: the developer asks Claude to change the current plan.
        if (typeof body.instruction === "string" && body.instruction.trim() && body.current && typeof body.current === "object") {
          const instruction = text(body.instruction, 1500, "Request", { required: true });
          const pageText = d?.understanding?.app?.pages?.[0]?.text ?? null;
          const revised = await reviseTests({ config, client: ai.client, project, current: body.current, instruction, pageText, log });
          const structured = { name: project.name, url: project.url, description: revised.description ?? d?.description ?? null, claims: revised.claims ?? [], tests: revised.tests ?? [] };
          let check;
          try {
            check = previewOf(buildSpecYaml(structured, USER_LIMITS), config);
          } catch (err) {
            check = { ok: false, problems: [err instanceof GreenlightError ? err.message : "The revision could not be turned into tests."] };
          }
          return sendJson(res, 200, { draft: structured, notes: revised.notes ?? null, pageRead: Boolean(pageText), check, revised: true });
        }
        const requirements = text(body.requirements, 6000, "Requirements") ?? (d ? requirementsFrom(d) : null);
        if (!requirements || requirements.length < 20) throw new GreenlightError("invalid_request", "Describe what the app should do (at least 20 characters).");
        const { draft, pageRead } = await draftTests({ name: project.name, url: project.url, requirements, config, client: ai.client, fetchImpl: ai.fetchImpl, checkHost: ai.checkHost, maxTests: 5, log });
        const structured = { name: project.name, url: project.url, description: draft.description ?? d?.description ?? null, claims: draft.claims ?? [], tests: draft.tests ?? [] };
        let check;
        try {
          check = previewOf(buildSpecYaml(structured, USER_LIMITS), config);
        } catch (err) {
          check = { ok: false, problems: [err instanceof GreenlightError ? err.message : "The draft could not be turned into tests."] };
        }
        return sendJson(res, 200, { draft: structured, notes: draft.notes ?? null, pageRead, check });
      }

      if (action === "understand") {
        const d = (await store.getProjectDetails(project.id).catch(() => null)) ?? {};
        const doc = { ...d };
        delete doc.updatedAt;
        delete doc.updatedBy;
        const u = { ...(d.understanding ?? {}) };
        const step = body.step;
        if (step === "inspect") {
          const repo = d.repository ? parseRepoUrl(d.repository) : null;
          const [repository, app] = await Promise.all([
            repo ? inspectRepository({ owner: repo.owner, repo: repo.repo, branch: d.branch ?? "main", fetchImpl, now, token: config.githubToken }) : Promise.resolve({ status: "not_readable", reason: "No repository URL was given." }),
            readLiveApp({ url: project.url, now, ...(launch ? { launch } : {}), ...(checkHost ? { checkHost } : {}) }),
          ]);
          u.inspectedAt = now().toISOString();
          u.repository = repository;
          u.app = app.status === "ok" ? { status: "ok", checkedAt: app.checkedAt, pages: app.pages } : { status: app.status, checkedAt: app.checkedAt, reason: app.reason };
          u.screenshot = app.screenshot ?? null;
          u.analysis = null;
          u.analyzedAt = null;
        } else if (step === "analyze") {
          if (!u.inspectedAt) throw new GreenlightError("invalid_request", "Inspect the app first.");
          if (!serverAi(config, ai)) return sendJson(res, 202, { agentRequest: await createAgentRequest({ store, s, project, details: d, kind: "understand" }) });
          takeAi(s, now);
          u.analysis = await analyzeProject({ config, client: ai.client, project, details: d, inspection: u, log });
          u.analyzedAt = now().toISOString();
        } else if (step === "answers") {
          const answers = body.answers && typeof body.answers === "object" ? body.answers : {};
          u.answers = Object.fromEntries(Object.entries(answers).slice(0, 8).map(([k, v]) => [String(k).slice(0, 40), String(v ?? "").slice(0, 1000)]));
        } else {
          throw new GreenlightError("invalid_request", "step must be inspect, analyze or answers.");
        }
        doc.understanding = u;
        await store.putProjectDetails(project.id, s.account, doc, s.user);
        return sendJson(res, 200, await projectDetail(config, store, project));
      }

      if (action === "preview") {
        let specText;
        try {
          specText = specFromBody(body, project);
        } catch (err) {
          if (err instanceof GreenlightError) return sendJson(res, 200, { ok: false, problems: [err.message] });
          throw err;
        }
        return sendJson(res, 200, previewOf(specText, config));
      }

      if (action === "versions") {
        const v = await proposeVersion({ store, project, specText: specFromBody(body, project), by: s.user, now });
        log({ event: "version_proposed", account: s.account, projectId: project.id, version: v.version });
        await activity(store, actorOf(s), "version.proposed", project.id, { version: v.version, hash: v.approvedTestHash });
        return sendJson(res, 201, { version: versionView(config, project, v, null) });
      }

      if (action === "certifications") {
        const job = await submitVerification({ config, store, s, project, body, jobs, fetchImpl, checkHost, now, log });
        return sendJson(res, 202, { job: jobView(job) });
      }
      throw new GreenlightError("not_found", "Not found.");
    }

    if (path === "/app/api/tokens" && !isPost) {
      return sendJson(res, 200, { tokens: await store.listAccountTokens(s.account) });
    }
    if (path === "/app/api/tokens" && isPost) {
      const body = await readJson(req);
      const role = body.role === "owner" ? "owner" : body.role === "agent" ? "agent" : null;
      if (!role) throw new GreenlightError("invalid_request", "role must be agent (Claude Code, MCP) or owner.");
      if (role === "owner" && s.role === "guest") throw new GreenlightError("forbidden", "Guests can create agent tokens only.");
      const label = text(body.label, 80, "Label", { required: true });
      const token = `gl_${randomBytes(32).toString("base64url")}`;
      const sha = createHash("sha256").update(token).digest("hex");
      const t = await store.issueToken(s.account, role, sha, label);
      log({ event: "token_issued", account: s.account, role, id: t.id });
      await activity(store, actorOf(s), "token.issued", t.id, { role, label });
      return sendJson(res, 201, { token, ...t, note: "Copy this token now. Greenlight stores only its SHA-256 and cannot show it again." });
    }
    const tm = TOKEN.exec(path);
    if (tm && isPost) {
      await store.revokeAccountToken(s.account, tm[1]);
      log({ event: "token_revoked", account: s.account, id: tm[1] });
      await activity(store, actorOf(s), "token.revoked", tm[1]);
      return sendJson(res, 200, { revoked: tm[1] });
    }

    if (path === "/app/api/integrations" && !isPost) {
      const base = config.publicBaseUrl ? config.publicBaseUrl.replace(/\/+$/, "") : "";
      let tokens = [];
      try {
        tokens = (await store.listAccountTokens(s.account)).filter((t) => !t.revokedAt);
      } catch {
        tokens = [];
      }
      return sendJson(res, 200, {
        claudeApi: { configured: Boolean(config.ai?.apiKey), model: config.ai?.model ?? null, usedFor: "Drafting claims and browser tests from your description. You review and edit everything before approving." },
        claudeCode: {
          apiUrl: base,
          // The CLI and Stop hook are installed from this server's own source, pinned to the
          // deployed commit (Vercel system variables). Null when the server can't tell.
          install: process.env.VERCEL_GIT_REPO_OWNER && process.env.VERCEL_GIT_REPO_SLUG && /^[0-9a-f]{40}$/.test(process.env.VERCEL_GIT_COMMIT_SHA ?? "")
            ? `github:${process.env.VERCEL_GIT_REPO_OWNER}/${process.env.VERCEL_GIT_REPO_SLUG}#${process.env.VERCEL_GIT_COMMIT_SHA}`
            : null,
          skillFiles: ["/app/downloads/greenlight/SKILL.md", "/app/downloads/greenlight/references/greenlight-yaml.md", "/app/downloads/greenlight/references/examples.md"],
          activeAgentTokens: tokens.filter((t) => t.role === "agent").length,
        },
        mcp: { url: `${base}/mcp`, transport: "streamable-http", auth: "bearer", activeTokens: tokens.length },
      });
    }

    return sendJson(res, 404, { error: { code: "not_found", message: "Not found." } });
  } catch (err) {
    if (err instanceof GreenlightError) {
      const status = ERRORS[err.code]?.http ?? 400;
      return sendJson(res, status === 200 ? 400 : status, { error: errorBody(err.code, err.message, err.details) });
    }
    throw err;
  }
}
