// Human approval in the browser, with an identity the server verifies itself.
//
// Identity: "Sign in with Vercel" (OAuth 2.0 authorization code + PKCE, OpenID Connect). The
// ID token is verified here against Vercel's published JWKS (signature, issuer
// https://vercel.com, audience = this app's client id, expiry, nonce). Nothing is taken from
// request headers or from which URL was used: a request is only as trusted as the session this
// server issued after verifying an ID token. Only a Vercel subject listed in GREENLIGHT_APPROVERS
// may approve, and only for its own Greenlight account.
//
// Approval: the person confirms two exact hashes, separately:
//   1. the test-specification hash, re-derived from the stored greenlight.yaml;
//   2. the server version's recorded hash.
// Both confirmations, with the verified identity and their timestamps, are stored in the
// version's single write-once server-owner approval record (covered by its recordSha256). The
// database refuses a second approval and any approval for another hash.
//
// Defences: signed HttpOnly __Host- cookies (HMAC keyed from the server's Supabase key), PKCE +
// state + nonce, per-session per-action CSRF tokens, Origin/Sec-Fetch-Site checks, short session
// lifetimes, write-once storage (replays and duplicates are refused), strict CSP, no caching.

import { createHmac, createHash, randomBytes, timingSafeEqual, createPublicKey, verify as cryptoVerify } from "node:crypto";
import { GreenlightError } from "../cli/errors.js";
import { projectFromText } from "../spec/generate.js";
import { buildApproval, selfHash, WEB_APPROVAL_CHANNEL } from "./models.js";
import { signApproval } from "./approval-policy.js";
import { APP_API_PREFIX, handleAppApi, sendJson } from "./app-api.js";

export const VERCEL_ISSUER = "https://vercel.com";
export const VERCEL_AUTHORIZE_URL = "https://vercel.com/oauth/authorize";
export const VERCEL_TOKEN_URL = "https://api.vercel.com/login/oauth/token";
export const VERCEL_JWKS_URL = "https://vercel.com/.well-known/jwks";
/**
 * The OAuth callback path. Vercel's project-based Authorization Callback URL for a Sign in with
 * Vercel app is <deployment domain>/api/auth/callback, so the callback lives exactly there. The
 * same value is sent as redirect_uri in the authorization request and in the token exchange.
 */
export const CALLBACK_PATH = "/api/auth/callback";

const OAUTH_COOKIE = "__Host-gl_oauth";
const SESSION_COOKIE = "__Host-gl_session";
const SPEC_COOKIE = "__Host-gl_spec";
const OAUTH_TTL_MS = 10 * 60_000;
const SESSION_TTL_MS = 15 * 60_000;
const SKEW_S = 60;
const PAGE = /^\/approve\/(prj_[0-9a-f]{32})\/([1-9][0-9]{0,8})$/;
const ACTION = /^\/approve\/(prj_[0-9a-f]{32})\/([1-9][0-9]{0,8})\/(test-specification|server-version)$/;
const HEX64 = /^[0-9a-f]{64}$/;
/** Where sign-in may return to besides an approval page: the web app (same-origin paths only). */
const APP_NEXT = /^\/app(?:\/[A-Za-z0-9_-]+){0,4}$/;

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const sha256b64u = (s) => createHash("sha256").update(s).digest("base64url");
const safeEq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// ---------------------------------------------------------------- signed values (cookies)

export function signValue(key, obj) {
  const body = b64u(JSON.stringify(obj));
  return `${body}.${createHmac("sha256", key).update(body).digest("base64url")}`;
}

export function verifyValue(key, value, nowMs) {
  const [body, mac, extra] = String(value ?? "").split(".");
  if (!body || !mac || extra !== undefined) return null;
  if (!safeEq(mac, createHmac("sha256", key).update(body).digest("base64url"))) return null;
  let obj;
  try {
    obj = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!obj || typeof obj !== "object" || typeof obj.exp !== "number" || obj.exp <= nowMs) return null;
  return obj;
}

function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

const cookie = (name, value, maxAgeS) => `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}`;

// ---------------------------------------------------------------- ID token verification

/** JWKS fetched from Vercel and cached; refetched once when a token names an unknown key. */
export function createJwksCache({ fetchImpl = (...a) => globalThis.fetch(...a), url = VERCEL_JWKS_URL, ttlMs = 10 * 60_000, now = () => Date.now() } = {}) {
  let cached = null;
  let at = 0;
  return async ({ force = false } = {}) => {
    if (cached && !force && now() - at < ttlMs) return cached;
    const res = await fetchImpl(url, { headers: { accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`JWKS fetch failed (HTTP ${res.status})`);
    const jwks = await res.json();
    if (!Array.isArray(jwks?.keys)) throw new Error("JWKS has no keys");
    cached = jwks;
    at = now();
    return cached;
  };
}

/**
 * Verify a Vercel ID token. Returns its claims or throws. Only RS256 and ES256 are accepted
 * ("none" and HMAC algorithms are refused, so a token cannot be signed with a public key).
 */
export async function verifyVercelIdToken(idToken, { clientId, nonce, nowMs, getJwks }) {
  const parts = String(idToken ?? "").split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  let header;
  let claims;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("malformed token");
  }
  if (!["RS256", "ES256"].includes(header?.alg)) throw new Error(`algorithm not accepted: ${header?.alg}`);
  let jwks = await getJwks();
  let jwk = jwks.keys.find((k) => k.kid === header.kid);
  if (!jwk) {
    jwks = await getJwks({ force: true });
    jwk = jwks.keys.find((k) => k.kid === header.kid);
  }
  if (!jwk) throw new Error("unknown signing key");
  if ((header.alg === "RS256" && jwk.kty !== "RSA") || (header.alg === "ES256" && jwk.kty !== "EC")) throw new Error("key type does not match the algorithm");
  const publicKey = createPublicKey({ key: jwk, format: "jwk" });
  const data = Buffer.from(`${parts[0]}.${parts[1]}`);
  const sig = Buffer.from(parts[2], "base64url");
  const ok = header.alg === "RS256" ? cryptoVerify("RSA-SHA256", data, publicKey, sig) : cryptoVerify("SHA256", data, { key: publicKey, dsaEncoding: "ieee-p1363" }, sig);
  if (!ok) throw new Error("bad signature");
  const nowS = Math.floor(nowMs / 1000);
  if (claims.iss !== VERCEL_ISSUER) throw new Error("wrong issuer");
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId)) throw new Error("wrong audience");
  if (typeof claims.exp !== "number" || claims.exp + SKEW_S < nowS) throw new Error("expired");
  if (typeof claims.iat === "number" && claims.iat - SKEW_S > nowS) throw new Error("issued in the future");
  if (typeof claims.nbf === "number" && claims.nbf - SKEW_S > nowS) throw new Error("not yet valid");
  if (!nonce || !safeEq(claims.nonce ?? "", nonce)) throw new Error("nonce mismatch");
  if (typeof claims.sub !== "string" || !claims.sub) throw new Error("no subject");
  return claims;
}

// ---------------------------------------------------------------- HTML

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function send(res, status, html, headers = {}) {
  res.statusCode = status;
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.setHeader("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  res.setHeader("x-frame-options", "DENY");
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "same-origin");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Greenlight approval</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:0 auto;padding:16px;color:#111;background:#fff}pre{background:#f4f4f4;padding:12px;overflow-x:auto;white-space:pre-wrap;word-break:break-word}code{word-break:break-all}.box{border:1px solid #ccc;border-radius:6px;padding:12px;margin:16px 0}.ok{color:#05620c}.bad{color:#a00}input[type=text]{width:100%;font:13px monospace;padding:6px;box-sizing:border-box}button{margin-top:8px;padding:8px 14px}</style></head><body>${html}</body></html>`);
}

function redirect(res, location, headers = {}) {
  res.statusCode = 302;
  res.setHeader("location", location);
  res.setHeader("cache-control", "no-store");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end();
}

async function readForm(req, maxBytes = 8 * 1024) {
  if (!/^application\/x-www-form-urlencoded\b/i.test(String(req.headers["content-type"] ?? ""))) throw new GreenlightError("invalid_request", "Form submissions only.");
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > maxBytes) throw new GreenlightError("payload_too_large", "Form too large.");
    chunks.push(c);
  }
  return Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString("utf8")));
}

// ---------------------------------------------------------------- handler

/**
 * @returns {(req, res, url) => Promise<boolean>} true when the request was an /approve request.
 */
export function createApprovalWeb({ config, store, now = () => new Date(), fetchImpl = (...a) => globalThis.fetch(...a), getJwks, log = () => {} }) {
  const web = config.webApproval;
  const base = config.publicBaseUrl ? config.publicBaseUrl.replace(/\/+$/, "") : null;
  const origin = base ? new URL(base).origin : null;
  const key = web ? createHmac("sha256", String(config.supabase?.serviceRoleKey ?? "")).update("greenlight-web-approval-v1").digest() : null;
  const jwks = getJwks ?? createJwksCache({ fetchImpl, now: () => now().getTime() });
  const redirectUri = base ? `${base}${CALLBACK_PATH}` : null;

  const csrfFor = (sid, action, projectId, version, hash) => createHmac("sha256", key).update(`csrf|${sid}|${action}|${projectId}|${version}|${hash}`).digest("base64url");

  function session(req) {
    const s = verifyValue(key, parseCookies(req.headers.cookie)[SESSION_COOKIE], now().getTime());
    return s && s.kind === "session" ? s : null;
  }

  function sameOrigin(req) {
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin") return false;
    return safeEq(req.headers.origin ?? "", origin);
  }

  async function login(req, res, url) {
    const next = url.searchParams.get("next") ?? "";
    if (!PAGE.test(next) && !APP_NEXT.test(next)) return send(res, 400, "<h1>Bad request</h1><p>Unknown approval page.</p>");
    const state = b64u(randomBytes(32));
    const nonce = b64u(randomBytes(32));
    const verifier = b64u(randomBytes(48));
    const value = signValue(key, { kind: "oauth", state, nonce, verifier, next, exp: now().getTime() + OAUTH_TTL_MS });
    const q = new URLSearchParams({ client_id: web.clientId, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", code_challenge: sha256b64u(verifier), code_challenge_method: "S256", state, nonce });
    return redirect(res, `${VERCEL_AUTHORIZE_URL}?${q}`, { "set-cookie": cookie(OAUTH_COOKIE, value, OAUTH_TTL_MS / 1000) });
  }

  async function callback(req, res, url) {
    const clear = cookie(OAUTH_COOKIE, "", 0);
    const o = verifyValue(key, parseCookies(req.headers.cookie)[OAUTH_COOKIE], now().getTime());
    if (!o || o.kind !== "oauth" || !safeEq(url.searchParams.get("state") ?? "", o.state)) {
      return send(res, 400, "<h1>Sign-in expired or invalid</h1><p>Start again from the approval link.</p>", { "set-cookie": clear });
    }
    const code = url.searchParams.get("code");
    if (!code) return send(res, 400, "<h1>Sign-in was not completed</h1>", { "set-cookie": clear });
    // Client authentication: this deployment's Vercel OIDC token (a trusted issuer configured on
    // the Vercel app), or a client secret if one is set. A forged OIDC header only makes Vercel
    // refuse the exchange.
    const body = new URLSearchParams({ grant_type: "authorization_code", client_id: web.clientId, code, code_verifier: o.verifier, redirect_uri: redirectUri });
    const secret = web.clientSecret;
    const oidc = req.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN;
    if (secret) body.set("client_secret", secret);
    else if (oidc) {
      body.set("client_assertion_type", "urn:vercel:params:oauth:client-assertion-type:oidc-bearer");
      body.set("client_assertion", String(oidc));
    } else return send(res, 503, "<h1>Approval sign-in is not configured</h1>", { "set-cookie": clear });
    let claims;
    try {
      const r = await fetchImpl(VERCEL_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body: body.toString(), redirect: "error", signal: AbortSignal.timeout(15_000) });
      const t = await r.json().catch(() => null);
      if (!r.ok || typeof t?.id_token !== "string") throw new Error(`token exchange failed (HTTP ${r.status})`);
      claims = await verifyVercelIdToken(t.id_token, { clientId: web.clientId, nonce: o.nonce, nowMs: now().getTime(), getJwks: jwks });
    } catch (err) {
      log({ event: "approval_signin_failed", error: String(err?.message ?? err) });
      return send(res, 401, "<h1>Sign-in could not be verified</h1><p>Nothing was approved.</p>", { "set-cookie": clear });
    }
    const approver = web.approvers.find((a) => a.vercelSub === claims.sub);
    if (!approver) {
      log({ event: "approval_signin_not_approver", subject: claims.sub });
      return send(res, 403, `<h1>Not an authorised approver</h1><p>Signed in to Vercel as <b>${esc(claims.preferred_username ?? claims.email ?? "")}</b> (subject <code>${esc(claims.sub)}</code>). This identity may not approve Greenlight tests.</p>`, { "set-cookie": clear });
    }
    const s = {
      kind: "session",
      sid: b64u(randomBytes(24)),
      sub: claims.sub,
      account: approver.account,
      user: approver.user,
      username: typeof claims.preferred_username === "string" ? claims.preferred_username : null,
      email: typeof claims.email === "string" ? claims.email : null,
      name: typeof claims.name === "string" ? claims.name : null,
      authAt: now().toISOString(),
      exp: now().getTime() + SESSION_TTL_MS,
    };
    log({ event: "approval_signin", subject: claims.sub, user: approver.user });
    return redirect(res, o.next, { "set-cookie": [clear, cookie(SESSION_COOKIE, signValue(key, s), SESSION_TTL_MS / 1000)] });
  }

  async function load(s, projectId, n) {
    const project = await store.getProject(projectId, s.account); // other accounts: not_found
    const v = await store.getVersion(project.id, Number(n));
    const derived = projectFromText(v.specText);
    const approval = await store.getApproval(project.id, v.version);
    return { project, v, derived, approval };
  }

  function specConfirmation(req, s, projectId, n, hash) {
    const c = verifyValue(key, parseCookies(req.headers.cookie)[SPEC_COOKIE], now().getTime());
    return c && c.kind === "spec" && c.sid === s.sid && c.projectId === projectId && c.version === Number(n) && c.hash === hash ? c : null;
  }

  async function page(req, res, s, projectId, n, notice = "") {
    const { project, v, derived, approval } = await load(s, projectId, n);
    const specHash = derived.hash;
    const versionHash = v.approvedTestHash;
    const consistent = specHash === versionHash;
    const specOk = specConfirmation(req, s, project.id, n, specHash);
    const desc = derived.spec.project.description ?? "";
    const tests = v.tests
      .map((t) => `<div class="box"><b>${esc(t.file)}</b> — claims ${esc(t.claims.join(", "))}<br>sha256 <code>${esc(t.sha256)}</code><details><summary>Test content</summary><pre>${esc(t.content)}</pre></details></div>`)
      .join("");
    const claims = derived.spec.claims.map((c) => `<li><b>${esc(c.id)}</b>: ${esc(c.text)}</li>`).join("");
    let actions;
    if (approval) {
      actions = `<p class="ok"><b>Already approved</b> by ${esc(approval.approvedBy)} at ${esc(approval.approvedAt)}${approval.channel === WEB_APPROVAL_CHANNEL ? ` (Vercel subject <code>${esc(approval.identity?.subject)}</code>)` : ""}. Approvals are write-once.</p>`;
    } else if (!consistent) {
      actions = `<p class="bad"><b>Refused:</b> the stored specification does not produce the version's recorded hash. Nothing can be approved.</p>`;
    } else {
      actions = `<div class="box"><h3>1. Approve the test specification</h3><p>Hash re-derived from the greenlight.yaml above:</p><p><code>${esc(specHash)}</code></p>${
        specOk
          ? `<p class="ok">Confirmed at ${esc(specOk.confirmedAt)}.</p>`
          : `<form method="post" action="/approve/${esc(project.id)}/${esc(n)}/test-specification"><input type="hidden" name="csrf" value="${esc(csrfFor(s.sid, "test-specification", project.id, n, specHash))}"><label>Type the full test-specification hash to approve it:<input type="text" name="confirmHash" autocomplete="off" spellcheck="false" required></label><button type="submit">Approve test specification</button></form>`
      }</div><div class="box"><h3>2. Approve the server version</h3><p>Hash recorded for server version ${esc(n)}:</p><p><code>${esc(versionHash)}</code></p>${
        specOk
          ? `<form method="post" action="/approve/${esc(project.id)}/${esc(n)}/server-version"><input type="hidden" name="csrf" value="${esc(csrfFor(s.sid, "server-version", project.id, n, versionHash))}"><label>Type the full server-version hash to approve it:<input type="text" name="confirmHash" autocomplete="off" spellcheck="false" required></label><button type="submit">Approve server version</button></form>`
          : `<p>Approve the test specification first.</p>`
      }</div>`;
    }
    return send(res, 200, `<h1>Greenlight approval</h1><p>Signed in with Vercel as <b>${esc(s.username ?? s.email ?? s.sub)}</b> (Greenlight owner <b>${esc(s.user)}</b>, account ${esc(s.account)}). Session ends ${esc(new Date(s.exp).toISOString())}.</p>${notice}
<h2>${esc(project.name)}</h2><p>${esc(desc)}</p><p>Live URL: <code>${esc(derived.spec.project.url)}</code> · Server version ${esc(n)} · submitted by ${esc(v.submittedBy)} at ${esc(v.submittedAt)}</p>
<h3>Claims</h3><ul>${claims}</ul><h3>Tests</h3>${tests}<h3>greenlight.yaml</h3><pre>${esc(v.specText)}</pre>${actions}`);
  }

  async function act(req, res, s, projectId, n, action) {
    if (!sameOrigin(req)) return send(res, 403, "<h1>Refused</h1><p>Cross-site request.</p>");
    const form = await readForm(req);
    const { project, v, derived, approval } = await load(s, projectId, n);
    const back = `<p><a href="/approve/${esc(project.id)}/${esc(n)}">Back to the approval page</a></p>`;
    if (approval) return send(res, 409, `<h1>Already approved</h1><p>Approvals are write-once; nothing was changed.</p>${back}`);
    const specHash = derived.hash;
    if (specHash !== v.approvedTestHash) return send(res, 409, `<h1>Refused</h1><p>Stored specification and version hash differ.</p>${back}`);
    const expected = action === "test-specification" ? specHash : v.approvedTestHash;
    if (!safeEq(form.csrf ?? "", csrfFor(s.sid, action, project.id, n, expected))) return send(res, 403, `<h1>Refused</h1><p>Invalid or expired form. Reload the page.</p>${back}`);
    const typed = String(form.confirmHash ?? "").trim();
    if (!HEX64.test(typed) || !safeEq(typed, expected)) return send(res, 422, `<h1>Not approved</h1><p>The hash was not typed back exactly. Nothing changed.</p>${back}`);
    if (action === "test-specification") {
      const c = { kind: "spec", sid: s.sid, projectId: project.id, version: v.version, hash: specHash, specFileSha256: derived.specFileSha256, confirmedAt: now().toISOString(), exp: s.exp };
      log({ event: "approval_test_specification_confirmed", subject: s.sub, projectId: project.id, version: v.version });
      return redirect(res, `/approve/${project.id}/${n}`, { "set-cookie": cookie(SPEC_COOKIE, signValue(key, c), Math.max(1, Math.floor((s.exp - now().getTime()) / 1000))) });
    }
    const spec = specConfirmation(req, s, project.id, n, specHash);
    if (!spec) return send(res, 409, `<h1>Not approved</h1><p>Approve the test specification first (in this session).</p>${back}`);
    const confirmedAt = now();
    const record = buildApproval({
      projectId: project.id,
      version: v,
      approvedBy: s.user,
      now: confirmedAt,
      extra: {
        channel: WEB_APPROVAL_CHANNEL,
        identity: { provider: "vercel", issuer: VERCEL_ISSUER, subject: s.sub, username: s.username, email: s.email, name: s.name, authenticatedAt: s.authAt },
        confirmations: {
          testSpecification: { hash: spec.hash, specFileSha256: spec.specFileSha256, confirmedAt: spec.confirmedAt },
          serverVersion: { hash: v.approvedTestHash, confirmedAt: confirmedAt.toISOString() },
        },
      },
    });
    // Sign with the server-only key, then re-seal the self-hash over the signed record.
    record.signature = signApproval(config.approvalSigningKey, record);
    record.recordSha256 = selfHash(record);
    try {
      await store.putApproval(project.id, v.version, record);
    } catch (err) {
      if (err?.code === "conflict") return send(res, 409, `<h1>Already approved</h1><p>Approvals are write-once; nothing was changed.</p>${back}`);
      throw err;
    }
    log({ event: "approval_recorded", subject: s.sub, user: s.user, projectId: project.id, version: v.version, recordSha256: record.recordSha256 });
    return send(res, 201, `<h1 class="ok">Approved</h1><p>Server version ${esc(n)} of ${esc(project.name)} is approved by ${esc(s.user)} (Vercel subject <code>${esc(s.sub)}</code>).</p><p>Test specification: <code>${esc(spec.hash)}</code> at ${esc(spec.confirmedAt)}<br>Server version: <code>${esc(v.approvedTestHash)}</code> at ${esc(confirmedAt.toISOString())}</p><p>Record <code>${esc(record.recordSha256)}</code></p>`, { "set-cookie": cookie(SPEC_COOKIE, "", 0) });
  }

  return async function handle(req, res, url) {
    const isApp = url.pathname.startsWith(APP_API_PREFIX);
    if (!isApp && url.pathname !== CALLBACK_PATH && url.pathname !== "/approve" && !url.pathname.startsWith("/approve/")) return false;
    if (!web) {
      if (isApp) sendJson(res, 404, { error: { code: "not_found", message: "Web sign-in is not configured on this server." } });
      else send(res, 404, "<h1>Not found</h1>");
      return true;
    }
    if (isApp) {
      try {
        await handleAppApi({ req, res, url, s: session(req), store, config, sameOrigin, clearSessionCookie: cookie(SESSION_COOKIE, "", 0) });
      } catch (err) {
        log({ event: "app_api_error", path: url.pathname, error: String(err?.stack ?? err) });
        sendJson(res, 500, { error: { code: "internal_error", message: "Internal error." } });
      }
      return true;
    }
    try {
      if (req.method === "GET" && url.pathname === "/approve/login") await login(req, res, url);
      else if (req.method === "GET" && url.pathname === CALLBACK_PATH) await callback(req, res, url);
      else {
        const p = PAGE.exec(url.pathname);
        const a = ACTION.exec(url.pathname);
        if (!(p && req.method === "GET") && !(a && req.method === "POST")) {
          send(res, 404, "<h1>Not found</h1>");
          return true;
        }
        const s = session(req);
        if (!s) {
          if (p) redirect(res, `/approve/login?next=${encodeURIComponent(url.pathname)}`);
          else send(res, 401, "<h1>Sign in first</h1>");
          return true;
        }
        if (p) await page(req, res, s, p[1], p[2]);
        else await act(req, res, s, a[1], a[2], a[3]);
      }
    } catch (err) {
      if (err instanceof GreenlightError) {
        const status = { not_found: 404, payload_too_large: 413, invalid_request: 400 }[err.code] ?? 500;
        send(res, status, `<h1>${status === 404 ? "Not found" : "Request refused"}</h1>`);
      } else {
        log({ event: "approval_error", error: String(err?.stack ?? err) });
        send(res, 500, "<h1>Internal error</h1><p>Nothing was approved.</p>");
      }
    }
    return true;
  };
}
