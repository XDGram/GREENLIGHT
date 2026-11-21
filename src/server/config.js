// Server configuration, from the environment only (no config files with secrets).
//
// Production persistence (required by bin/greenlight-server.js):
//   SUPABASE_URL                     https://<project-ref>.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY        server-side secret: sb_secret_... (or legacy service_role JWT);
//                                    never logged, never sent to clients. A publishable/anon key is refused.
//   SUPABASE_PUBLISHABLE_KEY         NOT used by the server (public, no Greenlight access); only the
//                                    live denial tests read it
//   GREENLIGHT_EVIDENCE_BUCKET       private Storage bucket, default greenlight-evidence
//   GREENLIGHT_WORK_DIR              local scratch for Kane workspaces, default <tmp>/greenlight-work
// Tests / migration source only:
//   GREENLIGHT_DATA_DIR              absolute path of a file-backed store (never production)
//
//   GREENLIGHT_API_TOKENS            optional bootstrap tokens (Supabase deployments keep tokens in
//                                    greenlight.api_tokens instead), JSON array, stored HASHED:
//                                    [{"name":"dev","role":"owner","account":"acme","sha256":"<hex of token>"}]
//                                    roles: owner (approve, certify) | agent (propose versions, read)
//   GREENLIGHT_PORT                  default 8787
//   GREENLIGHT_HOST                  default 127.0.0.1 (put a TLS proxy in front for public use)
//   GREENLIGHT_PUBLIC_BASE_URL       base for public record URLs, e.g. https://greenlight.example.com
//   GREENLIGHT_MAX_CONCURRENT_JOBS   default 1 (Kane runs one browser; credits are real money)
//   GREENLIGHT_MAX_QUEUED_JOBS       default 5
//   GREENLIGHT_MAX_CREDITS_PER_RUN   server-wide cap per certification run, default 150
//   GREENLIGHT_CREDIT_RESERVE        credits that must remain after a run, default 500
//   GREENLIGHT_RATE_LIMIT_PER_MINUTE requests per token (or per IP when anonymous), default 60
//   GREENLIGHT_KANE_TIMEOUT_MINUTES  default 30 (25 in sandbox mode)
//   GREENLIGHT_DEPLOY_TIMEOUT_SECONDS default 600 (300 in sandbox mode)
//   GREENLIGHT_SANDBOX_TIMEOUT_MINUTES sandbox mode: sandbox lifetime, default 45 (Vercel Hobby's maximum)
//   GREENLIGHT_SANDBOX_MAX_MINUTES   sandbox mode: the plan's limit, default 45 (Hobby); Pro allows 1440
//   GREENLIGHT_VERCEL_APP_CLIENT_ID  enables browser approval (Sign in with Vercel) at /approve/...
//   GREENLIGHT_APPROVERS             JSON [{"vercelSub","account","user"}]: who may approve, as which owner
//   GREENLIGHT_VERCEL_APP_CLIENT_SECRET optional secret; default is the deployment's OIDC client assertion
//   GREENLIGHT_APPROVAL_SIGNING_KEY  required with browser approval: secret (>= 32 chars) that signs approval records
//   GREENLIGHT_BROWSER_APPROVAL_ACCOUNTS accounts that need a signed browser approval to certify, default "xdgram"
//                                    (plus every account in GREENLIGHT_APPROVERS); owner-token approvals refused
//   GREENLIGHT_KANE_BIN              Kane CLI binary, default kane-cli
//   GREENLIGHT_KANE_REMOTE           "hyper": Kane runs the browser on TestMu HyperExecute (--remote hyper)
//   GREENLIGHT_EXECUTION             "local" (default: jobs run in this process) | "sandbox" (each job
//                                    runs in its own Vercel Sandbox; the API can then run on Vercel
//                                    Functions). Sandbox mode needs GREENLIGHT_KANE_REMOTE=hyper and
//                                    GREENLIGHT_KANE_USERNAME / GREENLIGHT_KANE_ACCESS_KEY (secrets).

import path from "node:path";
import os from "node:os";
import { createHash, timingSafeEqual } from "node:crypto";
import { isLocalOrPrivateHost } from "../deploy/host.js";

/** Sandbox time reserved for installing Kane, logging in, and uploading evidence. */
export const SANDBOX_OVERHEAD_MS = 10 * 60_000;

export const ROLES = Object.freeze({ OWNER: "owner", AGENT: "agent" });
const PERMISSIONS = Object.freeze({
  owner: new Set(["read", "propose", "approve", "certify"]),
  agent: new Set(["read", "propose"]),
});

const num = (v, d, { min = 0 } = {}) => {
  if (v === undefined || v === "") return d;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) throw new Error(`invalid number: ${v}`);
  return n;
};

/**
 * The server key must be a server-side key: a secret key (sb_secret_...) or a legacy
 * service_role JWT. A publishable key (sb_publishable_...) or an anon JWT is public, has no
 * access to Greenlight, and is refused here so it is never mistaken for the secret.
 * Error messages never contain the key.
 */
export function assertServerKey(key) {
  const k = String(key ?? "");
  if (k.startsWith("sb_publishable_")) throw new Error("SUPABASE_SERVICE_ROLE_KEY holds a publishable key (sb_publishable_...); the server needs the project's secret key (sb_secret_...)");
  if (k.startsWith("sb_") && !k.startsWith("sb_secret_")) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not a Supabase secret key (sb_secret_...)");
  if (/^eyJ[\w-]*\.[\w-]+\.[\w-]*$/.test(k)) {
    let role = null;
    try {
      role = JSON.parse(Buffer.from(k.split(".")[1], "base64url").toString("utf8")).role ?? null;
    } catch {
      /* not decodable */
    }
    if (role !== "service_role") throw new Error(`SUPABASE_SERVICE_ROLE_KEY is a JWT for role ${role ?? "unknown"}; the server needs the secret key (sb_secret_...) or the service_role key`);
  }
}

/**
 * Sandbox mode: GREENLIGHT_PUBLIC_BASE_URL is where each sandbox reports its finished job, so it
 * must be the public production origin: https, a public host, no credentials, query or fragment.
 */
export function assertPublicBaseUrl(value) {
  let u;
  try {
    u = new URL(String(value ?? ""));
  } catch {
    throw new Error("sandbox execution needs GREENLIGHT_PUBLIC_BASE_URL (https production URL), where sandboxes report finished jobs");
  }
  if (u.protocol !== "https:") throw new Error("GREENLIGHT_PUBLIC_BASE_URL must use https");
  if (u.username || u.password || u.search || u.hash) throw new Error("GREENLIGHT_PUBLIC_BASE_URL must not contain credentials, a query or a fragment");
  if (isLocalOrPrivateHost(u.hostname)) throw new Error("GREENLIGHT_PUBLIC_BASE_URL must be a public host (sandboxes reach it over the internet)");
}

export const sha256Hex = (s) => createHash("sha256").update(String(s)).digest("hex");

export function loadConfig(env = process.env) {
  let supabase = null;
  if (env.SUPABASE_URL || env.SUPABASE_SERVICE_ROLE_KEY) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("set both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    let u;
    try {
      u = new URL(env.SUPABASE_URL);
    } catch {
      throw new Error("SUPABASE_URL is not a valid URL");
    }
    if (u.protocol !== "https:") throw new Error("SUPABASE_URL must use https");
    assertServerKey(env.SUPABASE_SERVICE_ROLE_KEY);
    const bucket = env.GREENLIGHT_EVIDENCE_BUCKET || "greenlight-evidence";
    if (!/^[a-z0-9][a-z0-9_-]{1,62}$/.test(bucket)) throw new Error("GREENLIGHT_EVIDENCE_BUCKET is not a valid bucket name");
    supabase = { url: u.href.replace(/\/+$/, ""), bucket };
    // Non-enumerable: JSON.stringify(config), logs and error dumps never contain the key.
    Object.defineProperty(supabase, "serviceRoleKey", { value: env.SUPABASE_SERVICE_ROLE_KEY, enumerable: false });
    Object.freeze(supabase);
  }
  const dataDir = env.GREENLIGHT_DATA_DIR || null;
  if (dataDir && !path.isAbsolute(dataDir)) throw new Error("GREENLIGHT_DATA_DIR must be an absolute path");
  if (!supabase && !dataDir) throw new Error("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (production persistence)");
  const workDir = env.GREENLIGHT_WORK_DIR || path.join(os.tmpdir(), "greenlight-work");
  if (!path.isAbsolute(workDir)) throw new Error("GREENLIGHT_WORK_DIR must be an absolute path");
  let tokens = [];
  if (env.GREENLIGHT_API_TOKENS) {
    try {
      tokens = JSON.parse(env.GREENLIGHT_API_TOKENS);
    } catch {
      throw new Error("GREENLIGHT_API_TOKENS must be a JSON array");
    }
  }
  if (!Array.isArray(tokens)) throw new Error("GREENLIGHT_API_TOKENS must be a JSON array");
  for (const t of tokens) {
    if (!t || typeof t.name !== "string" || !t.name || !Object.values(ROLES).includes(t.role) || typeof t.account !== "string" || !t.account || !/^[0-9a-f]{64}$/.test(t.sha256 ?? "")) {
      throw new Error("each API token needs name, role (owner|agent), account and sha256 (hex SHA-256 of the token; never the token itself)");
    }
  }
  const kaneRemote = env.GREENLIGHT_KANE_REMOTE || null;
  if (kaneRemote !== null && kaneRemote !== "hyper") throw new Error('GREENLIGHT_KANE_REMOTE must be "hyper" (TestMu HyperExecute) or unset');
  const execution = env.GREENLIGHT_EXECUTION || "local";
  if (!["local", "sandbox"].includes(execution)) throw new Error('GREENLIGHT_EXECUTION must be "local" or "sandbox"');
  if (execution === "sandbox") {
    if (!supabase) throw new Error("sandbox execution needs Supabase persistence");
    if (kaneRemote !== "hyper") throw new Error("sandbox execution needs GREENLIGHT_KANE_REMOTE=hyper (no Chrome in the sandbox)");
    if (!env.GREENLIGHT_KANE_USERNAME || !env.GREENLIGHT_KANE_ACCESS_KEY) throw new Error("sandbox execution needs GREENLIGHT_KANE_USERNAME and GREENLIGHT_KANE_ACCESS_KEY");
    // The sandbox reports "job settled" to this URL so the API can stop it (no Vercel credential inside).
    assertPublicBaseUrl(env.GREENLIGHT_PUBLIC_BASE_URL);
  }
  // Sandbox mode defaults fit Vercel Hobby: a sandbox lives at most 45 minutes there. The whole
  // job (setup + deployment wait + Kane + evidence upload) must fit inside the sandbox.
  const sandbox = execution === "sandbox";
  const kaneTimeoutMs = num(env.GREENLIGHT_KANE_TIMEOUT_MINUTES, sandbox ? 25 : 30, { min: 1 }) * 60_000;
  const deployTimeoutMs = num(env.GREENLIGHT_DEPLOY_TIMEOUT_SECONDS, sandbox ? 300 : 600) * 1000;
  const sandboxTimeoutMs = sandbox ? num(env.GREENLIGHT_SANDBOX_TIMEOUT_MINUTES, 45, { min: 1 }) * 60_000 : null;
  if (sandbox) {
    const maxMs = num(env.GREENLIGHT_SANDBOX_MAX_MINUTES, 45, { min: 1 }) * 60_000; // plan limit: Hobby 45, Pro 1440
    if (sandboxTimeoutMs > maxMs) throw new Error(`GREENLIGHT_SANDBOX_TIMEOUT_MINUTES exceeds the plan's sandbox limit (${maxMs / 60_000} min; set GREENLIGHT_SANDBOX_MAX_MINUTES for another plan)`);
    const needMs = SANDBOX_OVERHEAD_MS + deployTimeoutMs + kaneTimeoutMs;
    if (needMs > sandboxTimeoutMs) throw new Error(`a job can take ${Math.ceil(needMs / 60_000)} min (setup and upload ${SANDBOX_OVERHEAD_MS / 60_000} + deployment wait + Kane timeout), more than the sandbox's ${sandboxTimeoutMs / 60_000} min; lower GREENLIGHT_KANE_TIMEOUT_MINUTES or GREENLIGHT_DEPLOY_TIMEOUT_SECONDS`);
  }
  // Browser approval with Sign in with Vercel (src/server/approval-web.js): enabled by a Vercel app
  // client id; only the listed Vercel subjects may approve, each for its own Greenlight owner.
  let webApproval = null;
  if (env.GREENLIGHT_VERCEL_APP_CLIENT_ID) {
    if (!supabase) throw new Error("browser approval needs Supabase persistence");
    assertPublicBaseUrl(env.GREENLIGHT_PUBLIC_BASE_URL);
    let approvers;
    try {
      approvers = JSON.parse(env.GREENLIGHT_APPROVERS ?? "");
    } catch {
      throw new Error("GREENLIGHT_APPROVERS must be a JSON array of {vercelSub, account, user}");
    }
    if (!Array.isArray(approvers) || !approvers.length || approvers.some((a) => !a || typeof a.vercelSub !== "string" || !a.vercelSub || typeof a.account !== "string" || !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(a.account) || typeof a.user !== "string" || !a.user)) {
      throw new Error("GREENLIGHT_APPROVERS must be a JSON array of {vercelSub, account, user}");
    }
    if (typeof env.GREENLIGHT_APPROVAL_SIGNING_KEY !== "string" || env.GREENLIGHT_APPROVAL_SIGNING_KEY.length < 32) {
      throw new Error("browser approval needs GREENLIGHT_APPROVAL_SIGNING_KEY (a random secret of at least 32 characters, server-side only)");
    }
    webApproval = { clientId: String(env.GREENLIGHT_VERCEL_APP_CLIENT_ID), approvers: Object.freeze(approvers.map((a) => Object.freeze({ vercelSub: a.vercelSub, account: a.account, user: a.user }))) };
    // Optional: a client secret instead of the deployment's OIDC client assertion. Never serialised.
    Object.defineProperty(webApproval, "clientSecret", { value: env.GREENLIGHT_VERCEL_APP_CLIENT_SECRET || null, enumerable: false });
    Object.freeze(webApproval);
  }
  // Claude API (AI-drafted claims and tests). The key is non-enumerable: never serialised or logged.
  const ai = { model: env.GREENLIGHT_AI_MODEL || env.GREENLIGHT_GUEST_AI_MODEL || "claude-opus-5-5" };
  // Values pasted into a dashboard often carry a trailing newline: trim secrets and ids.
  const clean = (v) => (typeof v === "string" ? v.trim() : "") || null;
  Object.defineProperty(ai, "apiKey", { value: clean(env.ANTHROPIC_API_KEY), enumerable: false });
  Object.freeze(ai);
  // Normal users: Sign in with Google (OpenID Connect, src/server/approval-web.js). Each Google
  // identity gets its own account (g-<hash>) and must approve its tests in the browser.
  let google = null;
  if (clean(env.GREENLIGHT_GOOGLE_CLIENT_ID)) {
    if (!supabase) throw new Error("Sign in with Google needs Supabase persistence");
    assertPublicBaseUrl(env.GREENLIGHT_PUBLIC_BASE_URL);
    if (!clean(env.GREENLIGHT_GOOGLE_CLIENT_SECRET)) throw new Error("Sign in with Google needs GREENLIGHT_GOOGLE_CLIENT_SECRET (server-side only)");
    if (typeof env.GREENLIGHT_APPROVAL_SIGNING_KEY !== "string" || env.GREENLIGHT_APPROVAL_SIGNING_KEY.length < 32) {
      throw new Error("Sign in with Google needs GREENLIGHT_APPROVAL_SIGNING_KEY (a random secret of at least 32 characters, server-side only)");
    }
    google = { clientId: clean(env.GREENLIGHT_GOOGLE_CLIENT_ID) };
    Object.defineProperty(google, "clientSecret", { value: clean(env.GREENLIGHT_GOOGLE_CLIENT_SECRET), enumerable: false });
    Object.freeze(google);
  }
  // Accounts whose certifications need a signed browser approval (owner-token approvals refused).
  // Fail closed: if browser approval is not configured, these accounts cannot be approved at all.
  const listed = (env.GREENLIGHT_BROWSER_APPROVAL_ACCOUNTS ?? "xdgram").split(",").map((x) => x.trim()).filter(Boolean);
  if (listed.some((a) => !/^[a-z0-9][a-z0-9_-]{0,62}$/.test(a))) throw new Error("GREENLIGHT_BROWSER_APPROVAL_ACCOUNTS must be a comma-separated list of account slugs");
  const browserApprovalAccounts = Object.freeze([...new Set([...listed, ...(webApproval?.approvers.map((a) => a.account) ?? [])])].sort());
  // Guest demo mode (GREENLIGHT_GUEST_MODE=on): no sign-up, a signed browser cookie, its own
  // tables, and hard limits on real runs. Needs Supabase (limits are enforced in the database).
  let guest = null;
  if (env.GREENLIGHT_GUEST_MODE === "on") {
    if (!supabase) throw new Error("guest mode needs Supabase (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY)");
    if (!env.GREENLIGHT_PUBLIC_BASE_URL || !/^https:\/\//.test(env.GREENLIGHT_PUBLIC_BASE_URL)) throw new Error("guest mode needs GREENLIGHT_PUBLIC_BASE_URL (https)");
    const sample = env.GREENLIGHT_GUEST_SAMPLE_PROJECT || null;
    if (sample && !/^prj_[0-9a-f]{32}$/.test(sample)) throw new Error("GREENLIGHT_GUEST_SAMPLE_PROJECT must be a project id (prj_...)");
    guest = {
      // Demo checks read the live page over HTTP; they never run Kane or spend credits.
      runsPerGuest: num(env.GREENLIGHT_GUEST_RUNS_PER_GUEST, 10),
      runsPerDay: num(env.GREENLIGHT_GUEST_RUNS_PER_DAY, 500),
      maxCreditsPerRun: Math.min(num(env.GREENLIGHT_GUEST_MAX_CREDITS_PER_RUN, 150), num(env.GREENLIGHT_MAX_CREDITS_PER_RUN, 150)),
      projectsPerGuest: num(env.GREENLIGHT_GUEST_PROJECTS_PER_GUEST, 5, { min: 1 }),
      aiPerGuest: num(env.GREENLIGHT_GUEST_AI_PER_GUEST, 8),
      sessionsPerIpHour: num(env.GREENLIGHT_GUEST_SESSIONS_PER_IP_HOUR, 20, { min: 1 }),
      sampleProjectId: sample,
      aiModel: env.GREENLIGHT_GUEST_AI_MODEL || "claude-opus-5-5",
    };
    // The Anthropic API key (AI test generation): non-enumerable, never serialised or logged.
    Object.defineProperty(guest, "anthropicApiKey", { value: env.ANTHROPIC_API_KEY || null, enumerable: false });
    Object.freeze(guest);
  }
  const cfg = {
    store: supabase ? "supabase" : "file",
    guest,
    google,
    ai,
    webApproval,
    browserApprovalAccounts,
    supabase,
    dataDir,
    workDir,
    tokens: Object.freeze(tokens.map((t) => Object.freeze({ name: t.name, role: t.role, account: t.account, sha256: t.sha256 }))),
    port: num(env.GREENLIGHT_PORT, 8787),
    host: env.GREENLIGHT_HOST || "127.0.0.1",
    publicBaseUrl: env.GREENLIGHT_PUBLIC_BASE_URL || null,
    maxConcurrentJobs: num(env.GREENLIGHT_MAX_CONCURRENT_JOBS, 1, { min: 1 }),
    maxQueuedJobs: num(env.GREENLIGHT_MAX_QUEUED_JOBS, 5),
    maxCreditsPerRun: num(env.GREENLIGHT_MAX_CREDITS_PER_RUN, 150),
    reserve: num(env.GREENLIGHT_CREDIT_RESERVE, 500),
    rateLimitPerMinute: num(env.GREENLIGHT_RATE_LIMIT_PER_MINUTE, 60, { min: 1 }),
    kaneTimeoutMs,
    deployTimeoutMs,
    sandboxTimeoutMs,
    deployIntervalMs: 10_000,
    kaneBin: env.GREENLIGHT_KANE_BIN || "kane-cli",
    kaneRemote,
    execution,
    maxBodyBytes: 256 * 1024,
  };
  // Approval signing key: non-enumerable, never serialised, logged or sent to clients.
  if (webApproval || google) Object.defineProperty(cfg, "approvalSigningKey", { value: env.GREENLIGHT_APPROVAL_SIGNING_KEY, enumerable: false });
  // Kane credentials (sandbox mode): non-enumerable like the Supabase key, never logged or serialised.
  if (execution === "sandbox") {
    Object.defineProperty(cfg, "kaneCredentials", { value: Object.freeze({ username: env.GREENLIGHT_KANE_USERNAME, accessKey: env.GREENLIGHT_KANE_ACCESS_KEY }), enumerable: false });
  }
  return Object.freeze(cfg);
}

/** SHA-256 hex of a well-formed bearer token, or null. */
export function bearerDigest(authorizationHeader) {
  const m = /^Bearer\s+(\S{16,512})$/.exec(String(authorizationHeader ?? ""));
  return m ? sha256Hex(m[1]) : null;
}

/**
 * Resolve a bearer token to its principal: bootstrap tokens from the environment
 * (constant-time comparison of hashes), then the store's token table (Supabase).
 * The account always comes from the token, never from the request.
 */
export async function resolvePrincipal(config, store, authorizationHeader) {
  const fromEnv = authenticate(config, authorizationHeader);
  if (fromEnv) return fromEnv;
  const digest = bearerDigest(authorizationHeader);
  if (!digest || typeof store?.authenticate !== "function") return null;
  const p = await store.authenticate(digest);
  return p && Object.values(ROLES).includes(p.role) && typeof p.account === "string" && typeof p.name === "string" ? { name: p.name, role: p.role, account: p.account } : null;
}

/** Resolve a bearer token against GREENLIGHT_API_TOKENS (constant-time comparison of hashes). */
export function authenticate(config, authorizationHeader) {
  const hex = bearerDigest(authorizationHeader);
  if (!hex) return null;
  const digest = Buffer.from(hex, "hex");
  for (const t of config.tokens) {
    const want = Buffer.from(t.sha256, "hex");
    if (want.length === digest.length && timingSafeEqual(want, digest)) return { name: t.name, role: t.role, account: t.account };
  }
  return null;
}

export const can = (principal, permission) => Boolean(principal && PERMISSIONS[principal.role]?.has(permission));
