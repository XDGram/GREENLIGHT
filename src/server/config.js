// Server configuration, from the environment only (no config files with secrets).
//
//   GREENLIGHT_DATA_DIR              absolute path for all server data (required)
//   GREENLIGHT_API_TOKENS            JSON array of tokens, stored HASHED:
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

export const sha256Hex = (s) => createHash("sha256").update(String(s)).digest("hex");

export function loadConfig(env = process.env) {
  const dataDir = env.GREENLIGHT_DATA_DIR;
  if (!dataDir || !path.isAbsolute(dataDir)) throw new Error("GREENLIGHT_DATA_DIR must be an absolute path");
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
    dataDir,
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

/** Resolve a bearer token to its principal (constant-time comparison of hashes). */
export function authenticate(config, authorizationHeader) {
  const m = /^Bearer\s+(\S{16,512})$/.exec(String(authorizationHeader ?? ""));
  if (!m) return null;
  const digest = Buffer.from(sha256Hex(m[1]), "hex");
  for (const t of config.tokens) {
    const want = Buffer.from(t.sha256, "hex");
    if (want.length === digest.length && timingSafeEqual(want, digest)) return { name: t.name, role: t.role, account: t.account };
  }
  return null;
}

export const can = (principal, permission) => Boolean(principal && PERMISSIONS[principal.role]?.has(permission));
