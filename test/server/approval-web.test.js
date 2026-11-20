// Browser approval with Sign in with Vercel: identity verification, the approval page, CSRF and
// replay defences, write-once recording, and `greenlight publish` accepting only a verified
// browser approval of exactly the local tests. The Vercel identity provider is a local fake with
// its own signing keys; Supabase is the PGlite fake; Kane is a fake. No network, no Kane, no credits.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { generateKeyPairSync, createHash, sign as cryptoSign } from "node:crypto";
import { loadConfig, createServerContext, startServer, SupabaseStore, createSupabaseClient, sha256Hex } from "../../src/server/index.js";
import { webApprovalValidFor, WEB_APPROVAL_CHANNEL, buildApproval } from "../../src/server/models.js";
import { verifyVercelIdToken, signValue, VERCEL_TOKEN_URL, VERCEL_ISSUER } from "../../src/server/approval-web.js";
import { main, EXIT } from "../../src/cli/main.js";
import { writeGenerated, loadProject, approveRelayed } from "../../src/spec/index.js";
import { createFakeSupabase } from "./fake-supabase.js";
import { fabricatedRun } from "../verify/helpers.js";
import { zipOf } from "../report/zip-helper.js";

const E2E = readFileSync(new URL("../fixtures/spec/e2e/greenlight.yaml", import.meta.url), "utf8");
const KEY = `sb_secret_${"w".repeat(22)}_webappr1`;
const BASE = "https://greenlight.example.com";
const CLIENT_ID = "cl_greenlight_test";
const SUB = "vercel_user_owner_1";
const OTHER_SUB = "vercel_user_stranger";
const OWNER_TOKEN = "owner-token-web-approval-0123456789";
const OTHER_TOKEN = "other-token-web-approval-0123456789";
const COMMIT = "dc6150b46a46a85efb4255113f0eddc5370621c8";
const SIGNING_KEY = `approval-signing-key-${"z".repeat(40)}`;
const EXEC_ID = "0a1b2c3d-0000-4000-8000-0000000000cc";
const temps = [];
const closers = [];
after(async () => {
  for (const c of closers) await c();
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

// ---------------------------------------------------------------- fake Vercel identity provider

const idp = generateKeyPairSync("rsa", { modulusLength: 2048 });
const attacker = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWKS = { keys: [{ ...idp.publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] };
const b64u = (x) => Buffer.from(typeof x === "string" ? x : JSON.stringify(x)).toString("base64url");
function jwt(claims, { key = idp.privateKey, kid = "k1", alg = "RS256" } = {}) {
  const head = b64u({ alg, kid, typ: "JWT" });
  const body = b64u(claims);
  const sig = alg === "none" ? "" : cryptoSign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url");
  return `${head}.${body}.${sig}`;
}
const nowS = () => Math.floor(Date.now() / 1000);
const goodClaims = (nonce, over = {}) => ({ iss: VERCEL_ISSUER, aud: CLIENT_ID, sub: SUB, nonce, iat: nowS(), exp: nowS() + 300, preferred_username: "sadiqyusuf1775", email: "owner@example.com", name: "Owner", ...over });

/** Token endpoint fake: checks PKCE and client authentication, then issues `mint(nonce)`. */
function fakeVercel() {
  const state = { calls: [], mint: (nonce) => jwt(goodClaims(nonce)), challenges: new Map(), status: 200 };
  const fetchImpl = async (url, init = {}) => {
    if (String(url) === VERCEL_TOKEN_URL) {
      const p = new URLSearchParams(init.body);
      state.calls.push(Object.fromEntries(p));
      const entry = state.challenges.get(p.get("code"));
      const pkceOk = entry && createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url") === entry.challenge;
      const authOk = p.get("client_assertion_type") === "urn:vercel:params:oauth:client-assertion-type:oidc-bearer" && p.get("client_assertion") === "deployment-oidc-token";
      if (state.status !== 200 || !pkceOk || !authOk || p.get("client_id") !== CLIENT_ID || p.get("redirect_uri") !== `${BASE}/approve/callback`) {
        return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
      }
      return new Response(JSON.stringify({ id_token: state.mint(entry.nonce), access_token: "x" }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };
  return { state, fetchImpl, getJwks: async () => JWKS };
}

// ---------------------------------------------------------------- server harness

async function setup({ approvers = [{ vercelSub: SUB, account: "acme", user: "dev" }], webEnabled = true, kane } = {}) {
  const fake = await createFakeSupabase({ serviceRoleKey: KEY });
  closers.push(() => fake.close());
  const admin = createSupabaseClient({ url: fake.url, serviceRoleKey: KEY, fetchImpl: fake.fetch });
  for (const a of ["acme", "other"]) await admin.rpc("greenlight_ensure_account", { p_slug: a });
  await admin.rpc("greenlight_create_user", { p_account: "acme", p_name: "dev", p_role: "owner" });
  await admin.rpc("greenlight_create_user", { p_account: "other", p_name: "eve", p_role: "owner" });
  await admin.rpc("greenlight_add_token", { p_account: "acme", p_user: "dev", p_token_sha256: sha256Hex(OWNER_TOKEN), p_label: "t" });
  await admin.rpc("greenlight_add_token", { p_account: "other", p_user: "eve", p_token_sha256: sha256Hex(OTHER_TOKEN), p_label: "t" });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "gl-web-"));
  temps.push(workDir);
  const env = { SUPABASE_URL: fake.url, SUPABASE_SERVICE_ROLE_KEY: KEY, GREENLIGHT_WORK_DIR: workDir, GREENLIGHT_PORT: "0", GREENLIGHT_PUBLIC_BASE_URL: BASE };
  if (webEnabled) Object.assign(env, { GREENLIGHT_VERCEL_APP_CLIENT_ID: CLIENT_ID, GREENLIGHT_APPROVERS: JSON.stringify(approvers), GREENLIGHT_APPROVAL_SIGNING_KEY: SIGNING_KEY });
  const config = loadConfig(env);
  const vercel = fakeVercel();
  const store = new SupabaseStore({ url: fake.url, serviceRoleKey: KEY, fetchImpl: fake.fetch, workRoot: workDir });
  const balances = [11076.5779, 10999.9376];
  const deps = {
    runKane: kane ?? (async () => { throw new Error("Kane must not run here"); }),
    readBalance: async () => ({ ok: true, balance: balances.length > 1 ? balances.shift() : balances[0] }),
    validator: async () => ({ exitCode: 0, stdout: '{"valid":true,"status":"finalized","diagnostics":[]}', stderr: "" }),
    verifyLiveDeployment: async (o) => ({ state: "ready", reasons: [], safeToRunKane: true, url: o.url, deployedCommit: o.expectedCommit, expectedCommit: o.expectedCommit, environment: "preview" }),
    now: () => new Date(),
  };
  const ctx = await createServerContext({ config, deps, store });
  const server = await startServer({ config, ...ctx, now: deps.now, approvalDeps: { fetchImpl: vercel.fetchImpl, getJwks: vercel.getJwks } });
  closers.push(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const api = async (method, p, body, token = OWNER_TOKEN) => {
    const r = await fetch(url + p, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, body: await r.json() };
  };
  return { fake, admin, url, api, vercel, store, ctx };
}

/** A browser: cookie jar, no automatic redirects. */
function browser(h) {
  const jar = new Map();
  const go = async (method, p, { form, headers = {} } = {}) => {
    const r = await fetch(h.url + p, {
      method,
      redirect: "manual",
      headers: {
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(form ? { "content-type": "application/x-www-form-urlencoded", origin: BASE, "sec-fetch-site": "same-origin" } : {}),
        ...headers,
      },
      body: form ? new URLSearchParams(form).toString() : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(";");
      const i = kv.indexOf("=");
      const [k, v] = [kv.slice(0, i), kv.slice(i + 1)];
      if (/max-age=0/i.test(attrs.join(";")) || v === "") jar.delete(k);
      else jar.set(k, v);
    }
    return { status: r.status, location: r.headers.get("location"), text: await r.text(), headers: r.headers, setCookie: r.headers.getSetCookie() };
  };
  /** Full sign-in: page -> login -> Vercel authorize (fake) -> callback. */
  const signIn = async (pagePath, { callbackHeaders = { "x-vercel-oidc-token": "deployment-oidc-token" } } = {}) => {
    const first = await go("GET", pagePath);
    assert.equal(first.status, 302);
    const login = await go("GET", first.location);
    assert.equal(login.status, 302);
    const auth = new URL(login.location);
    const q = Object.fromEntries(auth.searchParams);
    const code = `code-${Math.random().toString(36).slice(2)}`;
    h.vercel.state.challenges.set(code, { challenge: q.code_challenge, nonce: q.nonce });
    const cb = await go("GET", `/approve/callback?code=${code}&state=${encodeURIComponent(q.state)}`, { headers: callbackHeaders });
    return { first, login, auth, q, cb, code };
  };
  return { go, signIn, jar };
}

async function proposal(h, spec = E2E) {
  const p = await h.api("POST", "/v1/projects", { name: "Shop", url: "https://gl-test.vercel.app/" });
  const v = await h.api("POST", `/v1/projects/${p.body.id}/versions`, { specText: spec });
  return { projectId: p.body.id, version: v.body.version, hash: v.body.approvedTestHash, pagePath: `/approve/${p.body.id}/${v.body.version}` };
}

const csrfOf = (html, action) => new RegExp(`/${action}"><input type="hidden" name="csrf" value="([^"]+)"`).exec(html)?.[1];

// ---------------------------------------------------------------- tests

test("config: browser approval needs Supabase, an https public URL and a valid approver list; the client secret never serialises", () => {
  const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY, GREENLIGHT_PUBLIC_BASE_URL: BASE, GREENLIGHT_VERCEL_APP_CLIENT_ID: CLIENT_ID, GREENLIGHT_APPROVERS: JSON.stringify([{ vercelSub: SUB, account: "acme", user: "dev" }]), GREENLIGHT_VERCEL_APP_CLIENT_SECRET: "app-secret-value", GREENLIGHT_APPROVAL_SIGNING_KEY: SIGNING_KEY };
  const c = loadConfig(env);
  assert.deepEqual([c.webApproval.clientId, c.webApproval.approvers[0].vercelSub, c.webApproval.clientSecret], [CLIENT_ID, SUB, "app-secret-value"]);
  assert.ok(!JSON.stringify(c).includes("app-secret-value"));
  assert.ok(!JSON.stringify(c).includes(SIGNING_KEY), "the signing key never serialises");
  assert.equal(c.approvalSigningKey, SIGNING_KEY);
  assert.deepEqual(c.browserApprovalAccounts, ["acme", "xdgram"], "xdgram by default, plus every approver's account");
  for (const bad of [undefined, "", "short-key"]) assert.throws(() => loadConfig({ ...env, GREENLIGHT_APPROVAL_SIGNING_KEY: bad }), /GREENLIGHT_APPROVAL_SIGNING_KEY/);
  assert.throws(() => loadConfig({ ...env, GREENLIGHT_BROWSER_APPROVAL_ACCOUNTS: "Bad Slug" }), /GREENLIGHT_BROWSER_APPROVAL_ACCOUNTS/);
  for (const bad of ["", "[]", "{}", '[{"vercelSub":"","account":"acme","user":"dev"}]', '[{"vercelSub":"s","account":"Bad Slug","user":"dev"}]', "not json"]) {
    assert.throws(() => loadConfig({ ...env, GREENLIGHT_APPROVERS: bad }), /GREENLIGHT_APPROVERS/, bad);
  }
  assert.throws(() => loadConfig({ ...env, GREENLIGHT_PUBLIC_BASE_URL: "http://greenlight.example.com" }), /GREENLIGHT_PUBLIC_BASE_URL/);
  assert.throws(() => loadConfig({ GREENLIGHT_DATA_DIR: os.tmpdir(), GREENLIGHT_VERCEL_APP_CLIENT_ID: CLIENT_ID, GREENLIGHT_APPROVERS: env.GREENLIGHT_APPROVERS, GREENLIGHT_PUBLIC_BASE_URL: BASE }), /needs Supabase/);
  assert.equal(loadConfig({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY }).webApproval, null, "off unless configured");
});

test("ID token verification: only a correctly signed, unexpired Vercel token for this app and this sign-in is accepted", async () => {
  const opts = { clientId: CLIENT_ID, nonce: "n1", nowMs: Date.now(), getJwks: async () => JWKS };
  assert.equal((await verifyVercelIdToken(jwt(goodClaims("n1")), opts)).sub, SUB);
  const refused = [
    ["signed by another key", jwt(goodClaims("n1"), { key: attacker.privateKey })],
    ["unknown key id", jwt(goodClaims("n1"), { kid: "nope" })],
    ["alg none", jwt(goodClaims("n1"), { alg: "none" })],
    ["HS256", `${b64u({ alg: "HS256", kid: "k1" })}.${b64u(goodClaims("n1"))}.AAAA`],
    ["other issuer", jwt(goodClaims("n1", { iss: "https://evil.example" }))],
    ["other audience", jwt(goodClaims("n1", { aud: "someone-else" }))],
    ["expired", jwt(goodClaims("n1", { exp: nowS() - 3600 }))],
    ["issued in the future", jwt(goodClaims("n1", { iat: nowS() + 3600 }))],
    ["other sign-in's nonce", jwt(goodClaims("n2"))],
    ["no nonce", jwt(goodClaims(undefined))],
    ["tampered payload", (() => { const [hd, , sg] = jwt(goodClaims("n1")).split("."); return `${hd}.${b64u(goodClaims("n1", { sub: "admin" }))}.${sg}`; })()],
    ["malformed", "abc.def"],
  ];
  for (const [why, tok] of refused) await assert.rejects(verifyVercelIdToken(tok, opts), Error, why);
});

test("full browser approval: verified identity, complete review page, two separate exact-hash confirmations, one write-once human record", async () => {
  const h = await setup();
  const { projectId, hash, pagePath } = await proposal(h);
  const b = browser(h);
  const { auth, q, cb } = await b.signIn(pagePath);
  // Sign-in request: PKCE S256, state, nonce, this app, the configured public callback (not the Host header).
  assert.equal(auth.origin + auth.pathname, "https://vercel.com/oauth/authorize");
  assert.deepEqual([q.client_id, q.redirect_uri, q.response_type, q.code_challenge_method, q.scope], [CLIENT_ID, `${BASE}/approve/callback`, "code", "S256", "openid email profile"]);
  assert.ok(q.state.length >= 40 && q.nonce.length >= 40 && q.code_challenge.length >= 40);
  assert.deepEqual([cb.status, cb.location], [302, pagePath]);
  assert.ok(cb.setCookie.some((c) => /^__Host-gl_session=.+; Path=\/; Secure; HttpOnly; SameSite=Lax/.test(c)));

  const page = await b.go("GET", pagePath);
  assert.equal(page.status, 200);
  for (const want of ["Greenlight Test App", "Throwaway app with a working cart and a deliberately broken newsletter.", "CLM-001", "Users can add items to the cart.", "cart-add-two_test.md", "newsletter-subscribe_test.md", "expect_text: &quot;Items in cart: 2&quot;", hash, "sadiqyusuf1775", "Approve test specification"]) assert.ok(page.text.includes(want), want);
  assert.match(page.headers.get("content-security-policy"), /default-src 'none'.*frame-ancestors 'none'/);
  assert.equal(page.headers.get("cache-control"), "no-store");
  assert.ok(!page.text.includes("Approve server version</button>"), "the server version cannot be approved before the test specification");

  // 1. Test specification.
  const spec = await b.go("POST", `${pagePath}/test-specification`, { form: { csrf: csrfOf(page.text, "test-specification"), confirmHash: hash } });
  assert.equal(spec.status, 302);
  assert.equal(await h.store.getApproval(projectId, 1), null, "nothing is recorded until both hashes are confirmed");
  const page2 = await b.go("GET", pagePath);
  assert.match(page2.text, /Confirmed at /);
  // 2. Server version.
  const done = await b.go("POST", `${pagePath}/server-version`, { form: { csrf: csrfOf(page2.text, "server-version"), confirmHash: hash } });
  assert.equal(done.status, 201, done.text);

  const rec = await h.store.getApproval(projectId, 1);
  assert.deepEqual([rec.method, rec.certifiable, rec.approvedBy, rec.channel, rec.approvedTestHash], ["server-owner", true, "dev", WEB_APPROVAL_CHANNEL, hash]);
  assert.deepEqual([rec.identity.provider, rec.identity.issuer, rec.identity.subject, rec.identity.username], ["vercel", VERCEL_ISSUER, SUB, "sadiqyusuf1775"]);
  assert.deepEqual([rec.confirmations.testSpecification.hash, rec.confirmations.serverVersion.hash], [hash, hash]);
  assert.ok(Date.parse(rec.confirmations.testSpecification.confirmedAt) <= Date.parse(rec.confirmations.serverVersion.confirmedAt));
  assert.equal(webApprovalValidFor(rec, hash), true);
  assert.equal((await h.api("GET", `/v1/projects/${projectId}/versions/1`)).body.status, "approved");

  // Replay and duplicates: write-once.
  const replay = await b.go("POST", `${pagePath}/server-version`, { form: { csrf: csrfOf(page2.text, "server-version"), confirmHash: hash } });
  assert.equal(replay.status, 409);
  assert.deepEqual(await h.store.getApproval(projectId, 1), rec, "unchanged");
  assert.equal((await h.api("POST", `/v1/projects/${projectId}/versions/1/approval`, { confirmHash: hash })).body.error.code, "forbidden", "owner-token approvals are refused for this account");
  // Signed with the server-only key, verified by the server.
  assert.equal(rec.signature.alg, "HMAC-SHA256");
  assert.ok(!JSON.stringify(rec).includes(SIGNING_KEY));
  const view = await h.api("GET", `/v1/projects/${projectId}/versions/1`);
  assert.deepEqual(view.body.approvalVerification, { browserApprovalRequired: true, browserApproval: true, reason: null });
});

test("identity cannot be spoofed: no session, forged headers, tampered cookies, failed sign-ins and strangers get nothing", async () => {
  const h = await setup();
  const { projectId, hash, pagePath } = await proposal(h);
  const anon = browser(h);
  const spoof = { "x-vercel-id": "x", "x-vercel-sso-user": SUB, "x-forwarded-user": SUB, "x-vercel-oidc-token": "deployment-oidc-token", "x-forwarded-host": "greenlight-api-timeb7208-5361s-projects.vercel.app", authorization: `Bearer ${OWNER_TOKEN}` };
  const r1 = await anon.go("GET", pagePath, { headers: spoof });
  assert.deepEqual([r1.status, r1.location], [302, `/approve/login?next=${encodeURIComponent(pagePath)}`], "headers and API tokens never stand in for a sign-in");
  assert.equal((await anon.go("POST", `${pagePath}/server-version`, { form: { csrf: "x", confirmHash: hash }, headers: spoof })).status, 401);

  // A session cookie signed with any other key, or edited, is ignored.
  const forged = signValue(Buffer.from("not-the-server-key"), { kind: "session", sid: "s", sub: SUB, account: "acme", user: "dev", exp: Date.now() + 60_000 });
  assert.equal((await anon.go("GET", pagePath, { headers: { cookie: `__Host-gl_session=${forged}` } })).status, 302);

  // Callback without the sign-in's state cookie, or with another state.
  assert.equal((await anon.go("GET", "/approve/callback?code=c&state=s")).status, 400);
  const b = browser(h);
  const first = await b.go("GET", pagePath);
  const login = await b.go("GET", first.location);
  const q = Object.fromEntries(new URL(login.location).searchParams);
  h.vercel.state.challenges.set("c1", { challenge: q.code_challenge, nonce: q.nonce });
  assert.equal((await b.go("GET", "/approve/callback?code=c1&state=WRONG", { headers: { "x-vercel-oidc-token": "deployment-oidc-token" } })).status, 400);

  // Forged ID tokens from the token endpoint are refused (signature, audience, nonce).
  for (const mint of [(n) => jwt(goodClaims(n), { key: attacker.privateKey }), (n) => jwt(goodClaims(n, { aud: "other-app" })), () => jwt(goodClaims("replayed-nonce"))]) {
    h.vercel.state.mint = mint;
    const s = await browser(h).signIn(pagePath);
    assert.equal(s.cb.status, 401);
    assert.ok(!s.cb.setCookie.some((c) => c.startsWith("__Host-gl_session=") && !/Max-Age=0/.test(c)));
  }
  // Without the deployment's OIDC client assertion, Vercel refuses the code exchange.
  h.vercel.state.mint = (n) => jwt(goodClaims(n));
  assert.equal((await browser(h).signIn(pagePath, { callbackHeaders: { "x-vercel-oidc-token": "forged" } })).cb.status, 401);
  // A verified Vercel user who is not an approver.
  h.vercel.state.mint = (n) => jwt(goodClaims(n, { sub: OTHER_SUB }));
  const stranger = await browser(h).signIn(pagePath);
  assert.equal(stranger.cb.status, 403);
  assert.match(stranger.cb.text, /Not an authorised approver/);
  assert.equal(await h.store.getApproval(projectId, 1), null);
});

test("CSRF, origin, hash and ordering checks; sessions and confirmations are bound to one person, project and hash", async () => {
  const h = await setup();
  const { projectId, hash, pagePath } = await proposal(h);
  const b = browser(h);
  await b.signIn(pagePath);
  const page = await b.go("GET", pagePath);
  const csrf = csrfOf(page.text, "test-specification");
  const post = (p, form, headers) => b.go("POST", p, { form, headers });
  assert.equal((await post(`${pagePath}/test-specification`, { csrf, confirmHash: hash }, { origin: "https://evil.example" })).status, 403, "cross-origin");
  assert.equal((await post(`${pagePath}/test-specification`, { csrf, confirmHash: hash }, { origin: "" })).status, 403, "no Origin");
  assert.equal((await post(`${pagePath}/test-specification`, { csrf, confirmHash: hash }, { "sec-fetch-site": "cross-site" })).status, 403, "Sec-Fetch-Site");
  assert.equal((await post(`${pagePath}/test-specification`, { confirmHash: hash })).status, 403, "missing CSRF token");
  assert.equal((await post(`${pagePath}/test-specification`, { csrf: csrfOf(page.text, "test-specification").slice(1), confirmHash: hash })).status, 403, "wrong CSRF token");
  assert.equal((await post(`${pagePath}/test-specification`, { csrf, confirmHash: hash.slice(0, 12) })).status, 422, "partial hash");
  assert.equal((await post(`${pagePath}/test-specification`, { csrf, confirmHash: "0".repeat(64) })).status, 422, "wrong hash");
  assert.equal((await post(`${pagePath}/test-specification`, { csrf, confirmHash: hash.toUpperCase() })).status, 422, "exact hash only");
  const notForm = await b.go("POST", `${pagePath}/test-specification`, { headers: { "content-type": "application/json", origin: BASE }, form: undefined });
  assert.equal(notForm.status, 400, "form submissions only");
  // Server version before the test specification.
  assert.equal((await post(`${pagePath}/server-version`, { csrf: "anything", confirmHash: hash })).status, 403);

  // Another person's session cannot use this CSRF token or this person's confirmation.
  await post(`${pagePath}/test-specification`, { csrf, confirmHash: hash });
  const specCookie = b.jar.get("__Host-gl_spec");
  assert.ok(specCookie);
  const other = browser(h);
  await other.signIn(pagePath);
  other.jar.set("__Host-gl_spec", specCookie);
  const otherPage = await other.go("GET", pagePath);
  assert.ok(!otherPage.text.includes("Approve server version</button>"), "a confirmation from another session does not count");
  assert.equal((await other.go("POST", `${pagePath}/test-specification`, { form: { csrf, confirmHash: hash } })).status, 403, "CSRF token is per session");
  assert.equal(await h.store.getApproval(projectId, 1), null);

  // Another account's project is invisible.
  const foreign = await h.api("POST", "/v1/projects", { name: "Theirs", url: "https://b.example.com/" }, OTHER_TOKEN);
  await h.api("POST", `/v1/projects/${foreign.body.id}/versions`, { specText: E2E }, OTHER_TOKEN);
  assert.equal((await b.go("GET", `/approve/${foreign.body.id}/1`)).status, 404);
  for (const bad of [`/approve/prj_123/1`, `/approve/${projectId}/0`, `/approve/${projectId}/1/delete`, `/approve/${projectId}/1/server-version`, "/approve"]) {
    assert.equal((await b.go("GET", bad)).status, 404, bad);
  }
});

test("an approval is bound to its immutable version and hash: a changed specification is a new, unapproved version", async () => {
  const h = await setup();
  const { projectId, hash, pagePath } = await proposal(h);
  const b = browser(h);
  await b.signIn(pagePath);
  let page = await b.go("GET", pagePath);
  await b.go("POST", `${pagePath}/test-specification`, { form: { csrf: csrfOf(page.text, "test-specification"), confirmHash: hash } });
  page = await b.go("GET", pagePath);
  assert.equal((await b.go("POST", `${pagePath}/server-version`, { form: { csrf: csrfOf(page.text, "server-version"), confirmHash: hash } })).status, 201);
  const v2 = await h.api("POST", `/v1/projects/${projectId}/versions`, { specText: E2E.replace("Items in cart: 2", "Items in cart: 3") });
  assert.notEqual(v2.body.approvedTestHash, hash);
  const list = (await h.api("GET", `/v1/projects/${projectId}/versions`)).body.versions;
  assert.deepEqual(list.map((x) => x.status), ["approved", "pending_approval"]);
  // The version-1 confirmation cannot be used for version 2, and the database refuses a mismatched record.
  const p2 = await b.go("GET", `/approve/${projectId}/2`);
  assert.ok(!p2.text.includes("Approve server version</button>"));
  const v2doc = await h.store.getVersion(projectId, 2);
  const forged = buildApproval({ projectId, version: { ...v2doc, approvedTestHash: hash }, approvedBy: "dev", now: new Date() });
  await assert.rejects(h.store.putApproval(projectId, 2, forged), (e) => e.code === "approval_hash_mismatch");
  assert.equal(webApprovalValidFor({ ...(await h.store.getApproval(projectId, 1)), approvedBy: "mallory" }, hash), false, "an edited record fails its hash");
});

test("browser approval is off unless configured; the token API is unchanged", async () => {
  const h = await setup({ webEnabled: false });
  const { projectId, hash, pagePath } = await proposal(h);
  assert.equal((await browser(h).go("GET", pagePath)).status, 404);
  assert.equal((await browser(h).go("GET", "/approve/login?next=x")).status, 404);
  const a = await h.api("POST", `/v1/projects/${projectId}/versions/1/approval`, { confirmHash: hash });
  assert.deepEqual([a.status, a.body.method, a.body.channel], [201, "server-owner", undefined]);
  assert.equal(webApprovalValidFor(a.body, hash), false, "a token approval is not a browser approval");
});

// ---------------------------------------------------------------- publish

async function repo({ relayed = false, spec = E2E } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "gl-web-repo-"));
  temps.push(root);
  await writeFile(path.join(root, "greenlight.yaml"), spec);
  await writeGenerated(root);
  const h = (await loadProject(root)).hash;
  if (relayed) assert.equal((await approveRelayed({ root, env: { GREENLIGHT_RELAYED_APPROVAL: "1" }, hash: h })).approved, true);
  return root;
}
const git = async (args) => {
  const k = args.join(" ");
  if (k.startsWith("status")) return { code: 0, stdout: "" };
  if (k === "rev-parse HEAD" || k === "rev-parse @{u}") return { code: 0, stdout: `${COMMIT}\n` };
  if (k.startsWith("symbolic-ref")) return { code: 0, stdout: "main\n" };
  if (k.startsWith("rev-parse --abbrev-ref")) return { code: 0, stdout: "origin/main\n" };
  throw new Error(k);
};
async function publish(h, root, projectId) {
  let out = "";
  let err = "";
  const o = new PassThrough();
  o.on("data", (c) => (out += c));
  const e = new PassThrough();
  e.on("data", (c) => (err += c));
  const stdin = new PassThrough();
  stdin.end();
  const code = await main(["publish", "--json", "--project", projectId, "--version", "1", "--confirm-spend", "100"], {
    cwd: root,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, GREENLIGHT_API_URL: h.url, GREENLIGHT_API_TOKEN: OWNER_TOKEN },
    stdin,
    stdout: o,
    stderr: e,
    deps: { fetch: (...a) => fetch(...a), sleep: async () => {}, runGit: git },
  });
  return { code, json: JSON.parse(out), err };
}
function passingKane() {
  return async (opts) => {
    const store = path.join(opts.cwd, ".testmuai", "evidence");
    await mkdir(store, { recursive: true });
    await writeFile(path.join(store, `${EXEC_ID}.evidence`), zipOf({ "run.yaml": "status: finalized\n" }));
    const run = fabricatedRun({ members: [["cart-add-two_test.md", "passed"], ["newsletter-subscribe_test.md", "passed"]].map(([file, status], i) => ({ file, tags: [`clm-00${i + 1}`], status, mode: "authored" })) });
    run.stream.done.executionId = EXEC_ID;
    run.stream.summary.executionId = EXEC_ID;
    run.stream.summary.evidenceId = EXEC_ID;
    return { ...run, stdout: "{}\n", stderr: "", aborted: false };
  };
}

test("publish accepts the verified browser approval only for exactly the local tests; token approvals and relayed approvals do not stand in", async () => {
  // A token (non-browser) approval and no local approval: refused before any job.
  const t = await setup({ webEnabled: false });
  const tp = await proposal(t);
  await t.api("POST", `/v1/projects/${tp.projectId}/versions/1/approval`, { confirmHash: tp.hash });
  const noBrowser = await publish(t, await repo(), tp.projectId);
  assert.deepEqual([noBrowser.code, noBrowser.json.error.code], [EXIT.BLOCKED, "tests_not_approved"]);

  // Browser approval of exactly these tests: publish runs one fresh server-side certification.
  const h = await setup({ kane: passingKane() });
  const { projectId, hash, pagePath } = await proposal(h);
  const b = browser(h);
  await b.signIn(pagePath);
  let page = await b.go("GET", pagePath);
  await b.go("POST", `${pagePath}/test-specification`, { form: { csrf: csrfOf(page.text, "test-specification"), confirmHash: hash } });
  page = await b.go("GET", pagePath);
  assert.equal((await b.go("POST", `${pagePath}/server-version`, { form: { csrf: csrfOf(page.text, "server-version"), confirmHash: hash } })).status, 201);

  const changed = await publish(h, await repo({ spec: E2E.replace("Items in cart: 2", "Items in cart: 4") }), projectId);
  assert.equal(changed.json.error.code, "approval_hash_mismatch", "a changed local specification is not covered");
  const relayed = await publish(h, await repo({ relayed: true }), projectId);
  assert.equal(relayed.json.error.code, "approval_not_certifiable", "a relayed local approval is never accepted");

  const ok = await publish(h, await repo(), projectId);
  assert.equal(ok.code, EXIT.OK, ok.err);
  assert.match(ok.err + JSON.stringify(ok.json), /Approved in the browser by dev \(Vercel subject vercel_user_owner_1\)/);
  assert.equal(ok.json.data.record.certified, true);
});

// ---------------------------------------------------------------- server-side enforcement and signatures

import { signApproval, approvalSignatureValid, keyIdOf } from "../../src/server/approval-policy.js";
import { selfHash } from "../../src/server/models.js";

const AGENT_TOKEN = "agent-token-web-approval-0123456789";

/** A browser-approval record built outside the page (as an attacker with database access would). */
async function forgedRecord(h, projectId, hash, { key = null, mutate = (r) => r } = {}) {
  const v = await h.store.getVersion(projectId, 1);
  const t = new Date();
  const r = buildApproval({
    projectId, version: v, approvedBy: "dev", now: t,
    extra: {
      channel: WEB_APPROVAL_CHANNEL,
      identity: { provider: "vercel", issuer: VERCEL_ISSUER, subject: SUB, username: "sadiqyusuf1775", email: null, name: null, authenticatedAt: t.toISOString() },
      confirmations: { testSpecification: { hash, specFileSha256: v.specFileSha256, confirmedAt: t.toISOString() }, serverVersion: { hash, confirmedAt: t.toISOString() } },
    },
  });
  if (key) r.signature = signApproval(key, r);
  mutate(r);
  r.recordSha256 = selfHash(r);
  return r;
}

test("xdgram (and every approver's account) needs a signed browser approval: owner-token approvals cannot certify it", async () => {
  const h = await setup({ approvers: [{ vercelSub: SUB, account: "xdgram", user: "dev" }] });
  // The default policy covers xdgram even before any approver is listed for it.
  assert.ok(loadConfig({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY }).browserApprovalAccounts.includes("xdgram"));
  await h.admin.rpc("greenlight_ensure_account", { p_slug: "xdgram" });
  await h.admin.rpc("greenlight_create_user", { p_account: "xdgram", p_name: "dev", p_role: "owner" });
  const xTok = "owner-token-xdgram-0123456789abcdef";
  await h.admin.rpc("greenlight_add_token", { p_account: "xdgram", p_user: "dev", p_token_sha256: sha256Hex(xTok), p_label: "t" });
  const p = await h.api("POST", "/v1/projects", { name: "X", url: "https://gl-test.vercel.app/" }, xTok);
  const v = await h.api("POST", `/v1/projects/${p.body.id}/versions`, { specText: E2E }, xTok);
  // The token route is refused for this account.
  const a = await h.api("POST", `/v1/projects/${p.body.id}/versions/1/approval`, { confirmHash: v.body.approvedTestHash }, xTok);
  assert.deepEqual([a.status, a.body.error.code], [403, "forbidden"]);
  // Even a token-style approval written straight into the database does not certify.
  await h.store.putApproval(p.body.id, 1, buildApproval({ projectId: p.body.id, version: await h.store.getVersion(p.body.id, 1), approvedBy: "dev", now: new Date() }));
  const c = await h.api("POST", `/v1/projects/${p.body.id}/certifications`, { version: 1, commit: COMMIT, confirmSpend: 100 }, xTok);
  assert.deepEqual([c.status, c.body.error.code, c.body.error.details.reason], [403, "approval_not_certifiable", "not_a_browser_approval"]);
  assert.equal((await h.api("GET", `/v1/projects/${p.body.id}/versions/1`, undefined, xTok)).body.approvalVerification.browserApproval, false);
});

test("agent tokens can propose but never approve or certify", async () => {
  const h = await setup({ webEnabled: false });
  await h.admin.rpc("greenlight_create_user", { p_account: "acme", p_name: "claude", p_role: "agent" });
  await h.admin.rpc("greenlight_add_token", { p_account: "acme", p_user: "claude", p_token_sha256: sha256Hex(AGENT_TOKEN), p_label: "submit" });
  const p = await h.api("POST", "/v1/projects", { name: "A", url: "https://gl-test.vercel.app/" }, AGENT_TOKEN);
  assert.equal(p.status, 201);
  const v = await h.api("POST", `/v1/projects/${p.body.id}/versions`, { specText: E2E }, AGENT_TOKEN);
  assert.equal(v.status, 201);
  const a = await h.api("POST", `/v1/projects/${p.body.id}/versions/1/approval`, { confirmHash: v.body.approvedTestHash }, AGENT_TOKEN);
  assert.deepEqual([a.status, a.body.error.code], [403, "forbidden"]);
  await h.api("POST", `/v1/projects/${p.body.id}/versions/1/approval`, { confirmHash: v.body.approvedTestHash }); // owner (acme allows tokens here)
  const c = await h.api("POST", `/v1/projects/${p.body.id}/certifications`, { version: 1, commit: COMMIT, confirmSpend: 100 }, AGENT_TOKEN);
  assert.deepEqual([c.status, c.body.error.code], [403, "forbidden"]);
});

test("forged, unsigned, re-signed, modified and mismatched browser records are rejected by certification and publish", async () => {
  const cases = [
    ["unsigned", { key: null }, "unsigned"],
    ["signed with another key", { key: `attacker-key-${"q".repeat(40)}` }, "signature_invalid"],
    ["signature value altered", { key: SIGNING_KEY, mutate: (r) => { r.signature.value = r.signature.value.replace(/^./, (c) => (c === "0" ? "1" : "0")); } }, "signature_invalid"],
    ["identity changed after signing", { key: SIGNING_KEY, mutate: (r) => { r.identity.subject = OTHER_SUB; } }, "signature_invalid"],
    ["confirmation hash changed after signing", { key: SIGNING_KEY, mutate: (r) => { r.confirmations.testSpecification.confirmedAt = new Date(0).toISOString(); } }, "signature_invalid"],
    ["signed, but by someone who is not this account's approver", { key: SIGNING_KEY, mutate: (r) => { r.identity.subject = OTHER_SUB; r.signature = signApproval(SIGNING_KEY, r); } }, "not_an_approver_of_this_account"],
  ];
  for (const [why, opts, reason] of cases) {
    const h = await setup({ kane: async () => { throw new Error("Kane must not run"); } });
    const { projectId, hash } = await proposal(h);
    await h.store.putApproval(projectId, 1, await forgedRecord(h, projectId, hash, opts));
    const c = await h.api("POST", `/v1/projects/${projectId}/certifications`, { version: 1, commit: COMMIT, confirmSpend: 100 });
    assert.deepEqual([c.body.error?.code, c.body.error?.details?.reason], ["approval_not_certifiable", reason], why);
    const view = await h.api("GET", `/v1/projects/${projectId}/versions/1`);
    assert.equal(view.body.approvalVerification.browserApproval, false, why);
    const pub = await publish(h, await repo(), projectId);
    assert.equal(pub.json.error.code, "tests_not_approved", `${why}: publish refuses`);
  }
  // A record whose self-hash no longer matches is refused too (modified without re-sealing).
  const h = await setup();
  const { projectId, hash } = await proposal(h);
  const r = await forgedRecord(h, projectId, hash, { key: SIGNING_KEY });
  r.approvedBy = "mallory";
  await h.store.putApproval(projectId, 1, r);
  assert.equal((await h.api("POST", `/v1/projects/${projectId}/certifications`, { version: 1, commit: COMMIT, confirmSpend: 100 })).body.error.code, "approval_not_certifiable");
  // Signature primitives.
  const good = await forgedRecord(h, projectId, hash, { key: SIGNING_KEY });
  assert.equal(approvalSignatureValid(SIGNING_KEY, good), true);
  assert.equal(approvalSignatureValid(`other-${SIGNING_KEY}`, good), false);
  assert.equal(good.signature.keyId, keyIdOf(SIGNING_KEY));
  assert.ok(!good.signature.keyId.includes(SIGNING_KEY.slice(0, 8)));
});
