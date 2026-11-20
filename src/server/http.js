// Greenlight HTTP API (v1). JSON in, JSON out, stable error codes.
// See docs/API.md for the full contract.
//
// Authenticated (Authorization: Bearer <token>; token scoped to one account):
//   GET  /v1/health                                         (no auth) liveness
//   POST /v1/sandbox/finished                               (signed by the job's sandbox) sandbox mode only
//   GET  /v1/ready                                          (no auth) readiness: database + evidence bucket, 503 if not ready
//   POST /v1/projects                                       propose   {name, url}
//   GET  /v1/projects                                       read
//   GET  /v1/projects/:projectId                            read
//   POST /v1/projects/:projectId/versions                   propose   {specText}
//   GET  /v1/projects/:projectId/versions                   read
//   GET  /v1/projects/:projectId/versions/:n                read      (includes test contents for review)
//   POST /v1/projects/:projectId/versions/:n/approval       approve   {confirmHash}   (owner only)
//   POST /v1/projects/:projectId/certifications             certify   {version, commit, confirmSpend, url?, environment?, approvedTestHash?}
//   GET  /v1/jobs/:jobId                                    read
//   GET  /v1/projects/:projectId/records                    read      (full records, all runs, passed or not)
//   GET  /v1/projects/:projectId/records/:recordId/evidence read      (re-downloads and re-hashes stored evidence)
// Public (no auth, rate limited per IP):
//   GET  /v1/public/records/:recordId                       redacted public verification record
//
// Every error body: {"error": {"code", "message", "action", "details"?}}.

import http from "node:http";
import { createApprovalWeb } from "./approval-web.js";
import { GreenlightError, errorBody, httpFor } from "../cli/errors.js";
import { SpecError } from "../spec/schema.js";
import { projectFromText } from "../spec/generate.js";
import { isLocalOrPrivateHost } from "../deploy/host.js";
import { resolvePrincipal, can } from "./config.js";
import { SCHEMAS, buildApproval, publicRecord, verifyRecordIntegrity } from "./models.js";
import { prepareCertification } from "./certify.js";
import { browserApprovalRequired, verifyBrowserApproval } from "./approval-policy.js";

const json = (res, status, body, extraHeaders = {}) => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extraHeaders,
  });
  res.end(text);
};

const fail = (res, code, message, details) => json(res, httpFor(code), { error: errorBody(code, message, details) });

/** Fixed-window rate limiter keyed by principal or client IP. */
export class RateLimiter {
  constructor({ perMinute, now = () => Date.now() }) {
    this.perMinute = perMinute;
    this.now = now;
    this.windows = new Map();
  }
  take(key) {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || t - w.start >= 60_000) {
      this.windows.set(key, { start: t, count: 1 });
      if (this.windows.size > 10_000) for (const [k, v] of this.windows) if (t - v.start >= 60_000) this.windows.delete(k);
      return { ok: true };
    }
    w.count += 1;
    return w.count <= this.perMinute ? { ok: true } : { ok: false, retryAfterS: Math.ceil((w.start + 60_000 - t) / 1000) };
  }
}

async function readBody(req, maxBytes) {
  const type = String(req.headers["content-type"] ?? "");
  if (!/^application\/json\b/i.test(type)) throw new GreenlightError("invalid_request", "Content-Type must be application/json.");
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > maxBytes) throw new GreenlightError("payload_too_large", `Request body over ${maxBytes} bytes.`);
    chunks.push(c);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw new GreenlightError("invalid_request", "Body is not valid JSON.");
  }
  if (body === null || typeof body !== "object" || Array.isArray(body)) throw new GreenlightError("invalid_request", "Body must be a JSON object.");
  return body;
}

const versionView = (v, { withContent = false } = {}) => ({
  schema: SCHEMAS.testVersion,
  projectId: v.projectId,
  version: v.version,
  approvedTestHash: v.approvedTestHash,
  project: v.project,
  claims: v.claims,
  tests: v.tests.map((t) => ({ file: t.file, claims: t.claims, sha256: t.sha256, ...(withContent ? { content: t.content } : {}) })),
  submittedBy: v.submittedBy,
  submittedAt: v.submittedAt,
});

/**
 * @param {object} p
 * @param {ReturnType<import("./config.js").loadConfig>} p.config
 * @param {import("./store.js").FileStore} p.store
 * @param {import("./jobs.js").JobRunner} p.jobs
 * @param {() => Date} p.now
 */
export function createApp({ config, store, jobs, now = () => new Date(), log = () => {}, runtime = null, approvalDeps = {} }) {
  const limiter = new RateLimiter({ perMinute: config.rateLimitPerMinute });
  const approvalWeb = createApprovalWeb({ config, store, now, log, ...approvalDeps });

  const routes = [
    ["GET", /^\/v1\/health$/, null, async () => [200, { ok: true, schema: "greenlight.health/v1" }]],

    // Sandbox mode: a job's sandbox reports that its job is settled (signed for that job); the API
    // then stops the sandbox with its own Vercel credentials. Not available in local execution.
    ["POST", /^\/v1\/sandbox\/finished$/, null, async ({ body }) => {
      if (typeof jobs.onSandboxFinished !== "function") throw new GreenlightError("not_found", "No such endpoint.");
      return [200, await jobs.onSandboxFinished({ jobId: body.jobId, signature: body.signature })];
    }],

    // Readiness: database API and private evidence bucket reachable with the server key.
    // Codes only; never URLs, keys, bucket paths or error text.
    ["GET", /^\/v1\/ready$/, null, async () => {
      let h;
      try {
        h = await store.health();
      } catch {
        h = { ok: false, database: "unreachable", storage: "unreachable" };
      }
      // runtime: Kane CLI + Chrome, checked once at startup (absent in tests that do not run Kane).
      const rt = runtime ? { kane: runtime.kane, chrome: runtime.chrome } : {};
      const ok = Boolean(h.ok) && (!runtime || runtime.ok);
      return [ok ? 200 : 503, { schema: "greenlight.ready/v1", ok, store: store.kind ?? h.store ?? null, database: h.database, storage: h.storage, ...rt }];
    }],

    ["POST", /^\/v1\/projects$/, "propose", async ({ principal, body }) => {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name || name.length > 200 || /[\r\n]/.test(name)) throw new GreenlightError("invalid_request", "name: required single-line text, at most 200 characters.");
      let u;
      try {
        u = new URL(String(body.url));
      } catch {
        throw new GreenlightError("invalid_request", "url: a valid http(s) URL is required.");
      }
      if (!/^https?:$/.test(u.protocol) || u.username || u.password || u.search || u.hash) throw new GreenlightError("invalid_request", "url: http(s), without credentials, query or fragment.");
      if (isLocalOrPrivateHost(u.hostname)) throw new GreenlightError("url_not_allowed", "url: must be a public deployed URL, not localhost or a private address.");
      const project = await store.createProject({ name, url: u.href, account: principal.account, createdBy: principal.name, now: now() });
      return [201, project];
    }],

    ["GET", /^\/v1\/projects$/, "read", async ({ principal }) => [200, { projects: await store.listProjects(principal.account) }]],

    ["GET", /^\/v1\/projects\/([^/]+)$/, "read", async ({ principal, m }) => [200, await store.getProject(m[1], principal.account)]],

    ["POST", /^\/v1\/projects\/([^/]+)\/versions$/, "propose", async ({ principal, m, body }) => {
      const project = await store.getProject(m[1], principal.account);
      if (typeof body.specText !== "string" || body.specText.length > 200_000) throw new GreenlightError("invalid_request", "specText: the greenlight.yaml text is required (at most 200 kB).");
      let derived;
      try {
        derived = projectFromText(body.specText);
      } catch (err) {
        if (err instanceof SpecError) throw new GreenlightError("spec_invalid", "greenlight.yaml is invalid.", { problems: err.errors });
        throw err;
      }
      const v = await store.addVersion(project.id, {
        schema: SCHEMAS.testVersion,
        projectId: project.id,
        approvedTestHash: derived.hash,
        specText: body.specText,
        specFileSha256: derived.specFileSha256,
        project: { name: derived.spec.project.name, url: derived.spec.project.url },
        claims: derived.spec.claims.map((c) => ({ id: c.id, text: c.text })),
        tests: derived.rendered.map((r) => ({ file: r.file, claims: r.claims, sha256: r.sha256, content: r.content })),
        submittedBy: principal.name,
        submittedAt: now().toISOString(),
      });
      return [201, { ...versionView(v), approval: null, status: "pending_approval" }];
    }],

    ["GET", /^\/v1\/projects\/([^/]+)\/versions$/, "read", async ({ principal, m }) => {
      const project = await store.getProject(m[1], principal.account);
      const versions = await store.listVersions(project.id);
      const out = [];
      for (const v of versions) {
        const a = await store.getApproval(project.id, v.version);
        out.push({ ...versionView(v), status: a ? "approved" : "pending_approval", approval: a ? { approvedAt: a.approvedAt, method: a.method } : null });
      }
      return [200, { versions: out }];
    }],

    ["GET", /^\/v1\/projects\/([^/]+)\/versions\/([^/]+)$/, "read", async ({ principal, m }) => {
      const project = await store.getProject(m[1], principal.account);
      const v = await store.getVersion(project.id, m[2]);
      const a = await store.getApproval(project.id, v.version);
      // The server's own verification (it alone holds the signing key); clients rely on this.
      const b = a ? verifyBrowserApproval(config, a, v.approvedTestHash, project.account) : { ok: false, reason: "no_approval" };
      const approvalVerification = { browserApprovalRequired: browserApprovalRequired(config, project.account), browserApproval: b.ok, reason: b.reason };
      return [200, { ...versionView(v, { withContent: true }), specText: v.specText, status: a ? "approved" : "pending_approval", approval: a, approvalVerification }];
    }],

    // Human approval: an owner token, and the full hash typed back (as at the terminal).
    ["POST", /^\/v1\/projects\/([^/]+)\/versions\/([^/]+)\/approval$/, "approve", async ({ principal, m, body }) => {
      const project = await store.getProject(m[1], principal.account);
      if (browserApprovalRequired(config, project.account)) {
        throw new GreenlightError("forbidden", "This account requires a signed browser approval (Sign in with Vercel); owner-token approvals are refused.");
      }
      const v = await store.getVersion(project.id, m[2]);
      if (typeof body.confirmHash !== "string" || body.confirmHash !== v.approvedTestHash) {
        throw new GreenlightError("approval_hash_mismatch", "confirmHash must be the full approved-test hash of this version, as shown to the person approving.");
      }
      if (projectFromText(v.specText).hash !== v.approvedTestHash) throw new GreenlightError("approval_hash_mismatch", "Stored tests do not match their recorded hash.");
      const approval = buildApproval({ projectId: project.id, version: v, approvedBy: principal.name, now: now() });
      await store.putApproval(project.id, v.version, approval);
      return [201, approval];
    }],

    ["POST", /^\/v1\/projects\/([^/]+)\/certifications$/, "certify", async ({ principal, m, body }) => {
      const project = await store.getProject(m[1], principal.account);
      const request = {
        commit: typeof body.commit === "string" ? body.commit.trim().toLowerCase() : body.commit,
        confirmSpend: body.confirmSpend,
        url: body.url,
        environment: body.environment,
        approvedTestHash: body.approvedTestHash,
      };
      if (request.url !== undefined) {
        let u;
        try {
          u = new URL(String(request.url));
        } catch {
          throw new GreenlightError("invalid_request", "url must be a valid http(s) URL.");
        }
        if (!/^https?:$/.test(u.protocol)) throw new GreenlightError("invalid_request", "url must be http(s).");
        if (isLocalOrPrivateHost(u.hostname)) throw new GreenlightError("url_not_allowed", "url must be a public deployed URL.");
      }
      if (request.environment !== undefined && !["preview", "production"].includes(request.environment)) throw new GreenlightError("invalid_request", "environment must be preview or production.");
      if (!Number.isInteger(body.version) || body.version < 1) throw new GreenlightError("invalid_request", "version: the approved test version number is required.");
      // Fail fast on everything that can be checked without spending (the job re-checks).
      await prepareCertification({ store, project, versionNo: body.version, request, config });
      const job = await jobs.submit({ projectId: project.id, version: body.version, request, requestedBy: principal.name });
      return [202, job];
    }],

    ["GET", /^\/v1\/jobs\/([^/]+)$/, "read", async ({ principal, m }) => {
      const job = await store.getJob(m[1]);
      await store.getProject(job.projectId, principal.account); // scoping: 404 for other accounts
      await jobs.onJobRead?.(job); // sandbox mode: stop a finished job's sandbox
      return [200, job];
    }],

    ["GET", /^\/v1\/projects\/([^/]+)\/records$/, "read", async ({ principal, m }) => {
      const project = await store.getProject(m[1], principal.account);
      const records = await store.listRecords(project.id);
      return [200, { records: records.map((r) => ({ ...r, integrity: verifyRecordIntegrity(r) })) }];
    }],

    // Re-download the record's stored evidence and re-check every SHA-256. No storage paths are returned.
    ["GET", /^\/v1\/projects\/([^/]+)\/records\/([^/]+)\/evidence$/, "read", async ({ principal, m }) => {
      const project = await store.getProject(m[1], principal.account);
      const record = await store.getRecord(m[2]);
      if (record.projectId !== project.id) throw new GreenlightError("not_found", "No such verification record.");
      const ev = await store.verifyRunEvidence(record.execution.runId);
      return [200, { schema: "greenlight.evidence-integrity/v1", recordId: record.id, runId: ev.runId, ok: ev.ok, problems: ev.problems, files: ev.files, evidencePackSha256: record.evidence.packSha256, record: verifyRecordIntegrity(record) }];
    }],

    ["GET", /^\/v1\/public\/records\/([^/]+)$/, null, async ({ m }) => {
      const r = await store.getRecord(m[1]);
      if (!verifyRecordIntegrity(r).ok) throw new GreenlightError("run_record_invalid", "This record failed its integrity check.");
      return [200, publicRecord(r, { publicBaseUrl: config.publicBaseUrl })];
    }],
  ];

  return async function handle(req, res) {
    const started = Date.now();
    let url;
    try {
      url = new URL(req.url, "http://greenlight.invalid");
    } catch {
      return fail(res, "invalid_request", "Bad request URL.");
    }
    let principal;
    try {
      principal = await resolvePrincipal(config, store, req.headers.authorization);
    } catch {
      log({ event: "auth_backend_error", path: url.pathname });
      return fail(res, "internal_error", "Authentication is temporarily unavailable.");
    }
    const key = principal ? `p:${principal.account}:${principal.name}` : `ip:${req.socket?.remoteAddress ?? "unknown"}`;
    const rl = limiter.take(key);
    if (!rl.ok) {
      res.setHeader("retry-after", String(rl.retryAfterS));
      return fail(res, "rate_limited", "Too many requests.");
    }
    // Browser approval pages (HTML, own session); everything else is the JSON API below.
    if (await approvalWeb(req, res, url)) {
      log({ event: "request", method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started, principal: null });
      return;
    }
    const match = routes.find(([method, re]) => re.test(url.pathname) && method === req.method);
    if (!match) {
      const pathExists = routes.some(([, re]) => re.test(url.pathname));
      return fail(res, pathExists ? "invalid_request" : "not_found", pathExists ? `Method ${req.method} not allowed here.` : "No such endpoint.");
    }
    const [, re, permission, fn] = match;
    try {
      if (permission) {
        if (!principal) throw new GreenlightError("unauthorized", "A valid API token is required.");
        if (!can(principal, permission)) throw new GreenlightError("forbidden", `Role ${principal.role} may not ${permission}.`);
      }
      const body = req.method === "POST" ? await readBody(req, config.maxBodyBytes) : {};
      const [status, payload] = await fn({ principal, m: re.exec(url.pathname), body, url });
      json(res, status, payload);
    } catch (err) {
      if (err instanceof GreenlightError) fail(res, err.code, err.message, err.details);
      else {
        log({ event: "request_error", path: url.pathname, error: String(err?.stack ?? err) });
        fail(res, "internal_error", "Internal error.");
      }
    } finally {
      log({ event: "request", method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started, principal: principal?.name ?? null });
    }
  };
}

/** Start an HTTP server (bin/greenlight-server.js). */
export function startServer({ config, store, jobs, now, log, runtime, approvalDeps }) {
  const server = http.createServer(createApp({ config, store, jobs, now, log, runtime, approvalDeps }));
  server.requestTimeout = 30_000;
  server.headersTimeout = 15_000;
  return new Promise((resolve) => server.listen(config.port, config.host, () => resolve(server)));
}
