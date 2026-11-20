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
//   GREENLIGHT_KANE_TIMEOUT_MINUTES  default 30
//   GREENLIGHT_DEPLOY_TIMEOUT_SECONDS default 600
//   GREENLIGHT_KANE_BIN              Kane CLI binary, default kane-cli

import path from "node:path";
import os from "node:os";
import { createHash, timingSafeEqual } from "node:crypto";

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
  return Object.freeze({
    store: supabase ? "supabase" : "file",
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
    kaneTimeoutMs: num(env.GREENLIGHT_KANE_TIMEOUT_MINUTES, 30, { min: 1 }) * 60_000,
    deployTimeoutMs: num(env.GREENLIGHT_DEPLOY_TIMEOUT_SECONDS, 600) * 1000,
    deployIntervalMs: 10_000,
    kaneBin: env.GREENLIGHT_KANE_BIN || "kane-cli",
    maxBodyBytes: 256 * 1024,
  });
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
