// The web platform: Sign in with Google (normal users) and Sign in with Vercel (administrators),
// the session-scoped user API (projects, tests, approval link, estimate, certification request,
// tokens), signed Google approvals, the MCP endpoint and the admin API. Google, Vercel and GitHub
// are local fakes; Supabase is the PGlite fake; Kane must never run. No network, no credits.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { generateKeyPairSync, createHash, sign as cryptoSign } from "node:crypto";
import { loadConfig, createServerContext, startServer, SupabaseStore, createSupabaseClient } from "../../src/server/index.js";
import { GOOGLE_TOKEN_URL, VERCEL_TOKEN_URL, VERCEL_ISSUER } from "../../src/server/approval-web.js";
import { googleAccount, verifyBrowserApproval, browserApprovalRequired } from "../../src/server/approval-policy.js";
import { createFakeSupabase } from "./fake-supabase.js";

const KEY = `sb_secret_${"p".repeat(22)}_platform1`;
const BASE = "https://greenlight.example.com";
const GOOGLE_ID = "123-test.apps.googleusercontent.com";
const GOOGLE_SECRET = "google-client-secret-value";
const VERCEL_ID = "cl_greenlight_test";
const ADMIN_SUB = "vercel_admin_1";
const SIGNING_KEY = `approval-signing-key-${"q".repeat(40)}`;
const HEAD = "a".repeat(40);
const E2E = readFileSync(new URL("../fixtures/spec/e2e/greenlight.yaml", import.meta.url), "utf8");
const temps = [];
const closers = [];
after(async () => {
  for (const c of closers) await c();
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

const idp = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWKS = { keys: [{ ...idp.publicKey.export({ format: "jwk" }), kid: "g1", alg: "RS256", use: "sig" }] };
const b64u = (x) => Buffer.from(JSON.stringify(x)).toString("base64url");
const jwt = (claims) => {
  const head = b64u({ alg: "RS256", kid: "g1", typ: "JWT" });
  const body = b64u(claims);
  return `${head}.${body}.${cryptoSign("RSA-SHA256", Buffer.from(`${head}.${body}`), idp.privateKey).toString("base64url")}`;
};
const nowS = () => Math.floor(Date.now() / 1000);

/** Google, Vercel and GitHub token/API fakes behind one fetch. */
function fakes() {
  const state = { codes: new Map(), github: new Map(), githubCalls: 0 };
  const fetchImpl = async (url, init = {}) => {
    const u = String(url);
    if (u === GOOGLE_TOKEN_URL || u === VERCEL_TOKEN_URL) {
      const p = new URLSearchParams(init.body);
      const entry = state.codes.get(p.get("code"));
      const pkceOk = entry && createHash("sha256").update(p.get("code_verifier") ?? "").digest("base64url") === entry.challenge;
      if (u === GOOGLE_TOKEN_URL) {
        if (!pkceOk || p.get("client_secret") !== GOOGLE_SECRET || p.get("client_id") !== GOOGLE_ID || p.get("redirect_uri") !== `${BASE}/api/auth/google/callback`) return new Response("{}", { status: 400 });
        return new Response(JSON.stringify({ id_token: jwt({ iss: "https://accounts.google.com", aud: GOOGLE_ID, sub: entry.sub, nonce: entry.nonce, iat: nowS(), exp: nowS() + 300, email: entry.email, email_verified: true, name: "Dev Person" }) }), { status: 200 });
      }
      if (!pkceOk || p.get("client_assertion") !== "deployment-oidc-token") return new Response("{}", { status: 400 });
      return new Response(JSON.stringify({ id_token: jwt({ iss: VERCEL_ISSUER, aud: VERCEL_ID, sub: entry.sub, nonce: entry.nonce, iat: nowS(), exp: nowS() + 300, preferred_username: "admin" }) }), { status: 200 });
    }
    if (u.startsWith("https://api.github.com/repos/")) {
      state.githubCalls += 1;
      const m = /^https:\/\/api\.github\.com\/repos\/([^/]+)\/([^/]+)(?:\/branches\/(.+))?$/.exec(u);
      const repo = state.github.get(`${m[1]}/${m[2]}`);
      if (!repo) return new Response('{"message":"Not Found"}', { status: 404 });
      if (!m[3]) return new Response(JSON.stringify({ full_name: `${m[1]}/${m[2]}`, private: false, default_branch: "main", html_url: `https://github.com/${m[1]}/${m[2]}` }), { status: 200 });
      if (decodeURIComponent(m[3]) !== "main") return new Response("{}", { status: 404 });
      return new Response(JSON.stringify({ name: "main", commit: { sha: repo.head, html_url: "https://github.com/x", commit: { message: "Ship it\n\nbody", author: { name: "Dev", date: "2026-11-20T10:00:00Z" } } } }), { status: 200 });
    }
    if (u === "https://shop.example.com/greenlight.json") return new Response(JSON.stringify({ commit: HEAD, environment: "production" }), { status: 200, headers: { "content-type": "application/json" } });
    throw new Error(`unexpected fetch ${u}`);
  };
  return { state, fetchImpl, getJwks: async () => JWKS };
}

async function setup() {
  const fake = await createFakeSupabase({ serviceRoleKey: KEY });
  closers.push(() => fake.close());
  const admin = createSupabaseClient({ url: fake.url, serviceRoleKey: KEY, fetchImpl: fake.fetch });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "gl-platform-"));
  temps.push(workDir);
  const config = loadConfig({
    SUPABASE_URL: fake.url,
    SUPABASE_SERVICE_ROLE_KEY: KEY,
    GREENLIGHT_WORK_DIR: workDir,
    GREENLIGHT_PORT: "0",
    GREENLIGHT_PUBLIC_BASE_URL: BASE,
    GREENLIGHT_GOOGLE_CLIENT_ID: GOOGLE_ID,
    GREENLIGHT_GOOGLE_CLIENT_SECRET: GOOGLE_SECRET,
    GREENLIGHT_VERCEL_APP_CLIENT_ID: VERCEL_ID,
    GREENLIGHT_APPROVERS: JSON.stringify([{ vercelSub: ADMIN_SUB, account: "xdgram", user: "admin" }]),
    GREENLIGHT_APPROVAL_SIGNING_KEY: SIGNING_KEY,
  });
  await admin.rpc("greenlight_ensure_account", { p_slug: "xdgram" });
  await admin.rpc("greenlight_create_user", { p_account: "xdgram", p_name: "admin", p_role: "owner" });
  const f = fakes();
  const store = new SupabaseStore({ url: fake.url, serviceRoleKey: KEY, fetchImpl: fake.fetch, workRoot: workDir });
  const deps = {
    runKane: async () => {
      throw new Error("Kane must not run here");
    },
    readBalance: async () => ({ ok: true, balance: 1000 }),
    validator: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
    verifyLiveDeployment: async () => {
      throw new Error("not used");
    },
    now: () => new Date(),
  };
  const ctx = await createServerContext({ config, deps, store });
  const server = await startServer({ config, ...ctx, now: deps.now, approvalDeps: { fetchImpl: f.fetchImpl, getJwks: f.getJwks, getGoogleJwks: f.getJwks, appDeps: { checkHost: async () => {} } } });
  closers.push(() => new Promise((r) => server.close(r)));
  return { fake, admin, url: `http://127.0.0.1:${server.address().port}`, f, config, store };
}

function browser(h) {
  const jar = new Map();
  const go = async (method, p, { json, form, headers = {} } = {}) => {
    const r = await fetch(h.url + p, {
      method,
      redirect: "manual",
      headers: {
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(json ? { "content-type": "application/json" } : {}),
        ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
        ...(method === "POST" ? { origin: BASE, "sec-fetch-site": "same-origin" } : {}),
        ...headers,
      },
      body: json ? JSON.stringify(json) : form ? new URLSearchParams(form).toString() : undefined,
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv, ...attrs] = c.split(";");
      const i = kv.indexOf("=");
      if (/max-age=0/i.test(attrs.join(";")) || kv.slice(i + 1) === "") jar.delete(kv.slice(0, i));
      else jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const text = await r.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: r.status, location: r.headers.get("location"), text, body, headers: r.headers };
  };
  const googleSignIn = async (sub, email = "dev@example.com") => {
    const login = await go("GET", "/api/auth/google/login?next=%2Fapp");
    assert.equal(login.status, 302);
    const q = Object.fromEntries(new URL(login.location).searchParams);
    assert.equal(new URL(login.location).origin, "https://accounts.google.com");
    assert.deepEqual([q.client_id, q.code_challenge_method, q.redirect_uri], [GOOGLE_ID, "S256", `${BASE}/api/auth/google/callback`]);
    const code = `code-${Math.random().toString(36).slice(2)}`;
    h.f.state.codes.set(code, { challenge: q.code_challenge, nonce: q.nonce, sub, email });
    return go("GET", `/api/auth/google/callback?code=${code}&state=${encodeURIComponent(q.state)}`);
  };
  const vercelSignIn = async (sub) => {
    const login = await go("GET", "/approve/login?next=%2Fapp");
    const q = Object.fromEntries(new URL(login.location).searchParams);
    const code = `code-${Math.random().toString(36).slice(2)}`;
    h.f.state.codes.set(code, { challenge: q.code_challenge, nonce: q.nonce, sub });
    return go("GET", `/api/auth/callback?code=${code}&state=${encodeURIComponent(q.state)}`, { headers: { "x-vercel-oidc-token": "deployment-oidc-token" } });
  };
  return { go, jar, googleSignIn, vercelSignIn };
}

const csrfOf = (html, action) => new RegExp(`/${action}"><input type="hidden" name="csrf" value="([^"]+)"`).exec(html)?.[1];

const PROJECT = {
  name: "Shop",
  url: "https://shop.example.com/",
  repository: "https://github.com/acme/shop",
  branch: "main",
  description: "A small shop.",
  purpose: "Visitors can browse products, add them to a cart and see the cart total.",
  credentials: { username: "tester@example.com", password: "very-secret-password" },
};

test("config: Sign in with Google needs its secret and the signing key; neither serialises", () => {
  const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY, GREENLIGHT_PUBLIC_BASE_URL: BASE, GREENLIGHT_GOOGLE_CLIENT_ID: GOOGLE_ID, GREENLIGHT_GOOGLE_CLIENT_SECRET: GOOGLE_SECRET, GREENLIGHT_APPROVAL_SIGNING_KEY: SIGNING_KEY, ANTHROPIC_API_KEY: "sk-ant-platform-secret" };
  const c = loadConfig(env);
  assert.deepEqual([c.google.clientId, c.google.clientSecret, c.ai.apiKey], [GOOGLE_ID, GOOGLE_SECRET, "sk-ant-platform-secret"]);
  for (const secret of [GOOGLE_SECRET, SIGNING_KEY, "sk-ant-platform-secret"]) assert.ok(!JSON.stringify(c).includes(secret));
  assert.throws(() => loadConfig({ ...env, GREENLIGHT_GOOGLE_CLIENT_SECRET: "" }), /GREENLIGHT_GOOGLE_CLIENT_SECRET/);
  assert.throws(() => loadConfig({ ...env, GREENLIGHT_APPROVAL_SIGNING_KEY: "short" }), /GREENLIGHT_APPROVAL_SIGNING_KEY/);
  assert.equal(loadConfig({ GREENLIGHT_DATA_DIR: os.tmpdir() }).google, null);
  assert.ok(browserApprovalRequired(c, googleAccount("x")), "every Google account needs a signed browser approval");
});

test("a Google user signs in, adds a project, writes tests, approves them in the browser and is asked to confirm spending", async () => {
  const h = await setup();
  h.f.state.github.set("acme/shop", { head: HEAD });
  const b = browser(h);
  assert.equal((await b.go("GET", "/app/api/session")).status, 401);
  const cb = await b.googleSignIn("google-sub-1");
  assert.deepEqual([cb.status, cb.location], [302, "/app"]);
  const me = (await b.go("GET", "/app/api/session")).body;
  assert.deepEqual([me.provider, me.role, me.account, me.user, me.email], ["google", "user", googleAccount("google-sub-1"), "owner", "dev@example.com"]);
  assert.equal((await b.go("GET", "/app/api/admin/overview")).status, 403, "users never reach the admin API");

  // Signing in again is the same account.
  const again = browser(h);
  await again.googleSignIn("google-sub-1");
  assert.equal((await again.go("GET", "/app/api/session")).body.account, me.account);

  // Add a project: validation, repository check, encrypted credentials that are never returned.
  assert.equal((await b.go("POST", "/app/api/projects", { json: { ...PROJECT, url: "http://localhost:3000/" } })).status, 422);
  assert.equal((await b.go("POST", "/app/api/projects", { json: { ...PROJECT, repository: "https://gitlab.com/a/b" } })).status, 400);
  assert.equal((await b.go("POST", "/app/api/projects", { json: PROJECT, headers: { origin: "https://evil.example" } })).status, 403);
  const created = await b.go("POST", "/app/api/projects", { json: PROJECT });
  assert.equal(created.status, 201, created.text);
  assert.ok(!created.text.includes("very-secret-password") && !created.text.includes("tester@example.com"), "credentials are never returned");
  const projectId = created.body.project.id;
  const d = created.body.details;
  assert.deepEqual([d.repository, d.branch, d.repositoryCheck.status, d.repositoryCheck.head.sha, d.hasCredentials], ["https://github.com/acme/shop", "main", "ok", HEAD, true]);
  const stored = await h.fake.sql("select doc from greenlight.project_details");
  assert.ok(!JSON.stringify(stored).includes("very-secret-password"), "stored encrypted");

  // A private or missing repository is reported as such, without failing the project.
  const priv = await b.go("POST", "/app/api/projects", { json: { ...PROJECT, name: "Private", repository: "https://github.com/acme/secret" } });
  assert.equal(priv.body.details.repositoryCheck.status, "not_found_or_private");

  // Another Google user sees none of it.
  const other = browser(h);
  await other.googleSignIn("google-sub-2", "other@example.com");
  assert.equal((await other.go("GET", `/app/api/projects/${projectId}`)).status, 404);
  assert.equal((await other.go("GET", "/app/api/projects")).body.projects.length, 0);

  // Deployment: the live /greenlight.json commit.
  const dep = await b.go("POST", `/app/api/projects/${projectId}/deployment-check`, { json: {} });
  assert.deepEqual([dep.body.deployment.status, dep.body.deployment.commit], ["ok", HEAD]);

  // Tests: preview, then an immutable version pending approval.
  const draft = {
    claims: [{ id: "a", text: "The home page names the shop." }],
    tests: [{ title: "Home", claims: ["a"], steps: [{ name: "Open", kind: "do", text: "Open the start page." }, { name: "Name", kind: "expect_text", text: "Shop" }] }],
  };
  const pv = await b.go("POST", `/app/api/projects/${projectId}/preview`, { json: { draft } });
  assert.equal(pv.body.ok, true, pv.text);
  assert.equal(pv.body.estimate.credits, 37 + 20);
  const bad = await b.go("POST", `/app/api/projects/${projectId}/preview`, { json: { draft: { ...draft, tests: [] } } });
  assert.equal(bad.body.ok, false);
  const v = await b.go("POST", `/app/api/projects/${projectId}/versions`, { json: { draft } });
  assert.equal(v.status, 201, v.text);
  assert.deepEqual([v.body.version.version, v.body.version.status, v.body.version.approveUrl], [1, "pending_approval", `/approve/${projectId}/1`]);
  const hash = v.body.version.approvedTestHash;
  assert.equal(hash, pv.body.hash);

  // No certification before approval.
  const early = await b.go("POST", `/app/api/projects/${projectId}/certifications`, { json: { version: 1, commit: HEAD, confirmSpend: 60 } });
  assert.deepEqual([early.status, early.body.error.code], [403, "approval_not_certifiable"]);

  // Approval in the browser, signed in with Google: two typed hashes.
  const page = await b.go("GET", `/approve/${projectId}/1`);
  assert.equal(page.status, 200);
  assert.match(page.text, /Signed in with Google/);
  assert.equal((await b.go("POST", `/approve/${projectId}/1/test-specification`, { form: { csrf: csrfOf(page.text, "test-specification"), confirmHash: hash } })).status, 302);
  const page2 = await b.go("GET", `/approve/${projectId}/1`);
  const done = await b.go("POST", `/approve/${projectId}/1/server-version`, { form: { csrf: csrfOf(page2.text, "server-version"), confirmHash: hash } });
  assert.equal(done.status, 201, done.text);
  const detail = (await b.go("GET", `/app/api/projects/${projectId}`)).body;
  const ap = detail.versions[0].approval;
  assert.deepEqual([ap.identity.provider, ap.verified, ap.browserApprovalRequired, ap.channel], ["google", true, true, "web-sign-in-with-google"]);
  const record = await h.store.getApproval(projectId, 1);
  assert.equal(verifyBrowserApproval(h.config, record, hash, googleAccount("google-sub-2")).ok, false, "not valid for another account");

  // Certification asks for an explicit spend confirmation; nothing runs without it.
  const noSpend = await b.go("POST", `/app/api/projects/${projectId}/certifications`, { json: { version: 1, commit: HEAD } });
  assert.deepEqual([noSpend.status, noSpend.body.error.code], [409, "confirmation_required"]);
  assert.deepEqual(await h.fake.sql("select count(*)::int as n from greenlight.jobs"), [{ n: 0 }]);
});

test("API tokens for Claude Code and MCP: shown once, scoped to the account, revocable; MCP never approves", async () => {
  const h = await setup();
  h.f.state.github.set("acme/shop", { head: HEAD });
  const b = browser(h);
  await b.googleSignIn("google-sub-mcp");
  const projectId = (await b.go("POST", "/app/api/projects", { json: PROJECT })).body.project.id;
  const t = await b.go("POST", "/app/api/tokens", { json: { role: "agent", label: "Claude Code" } });
  assert.equal(t.status, 201, t.text);
  assert.match(t.body.token, /^gl_[A-Za-z0-9_-]{43}$/);
  const list = (await b.go("GET", "/app/api/tokens")).body.tokens;
  assert.equal(list.length, 1);
  assert.ok(!JSON.stringify(list).includes(t.body.token), "the token itself is never listed");

  const mcp = async (body, token = t.body.token) => {
    const r = await fetch(`${h.url}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
    return { status: r.status, body: r.status === 202 ? null : await r.json() };
  };
  assert.equal((await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, null)).status, 401);
  const init = await mcp({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } });
  assert.deepEqual([init.body.result.protocolVersion, init.body.result.serverInfo.name], ["2025-06-18", "greenlight"]);
  assert.equal((await mcp({ jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const tools = (await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list" })).body.result.tools.map((x) => x.name);
  assert.ok(tools.includes("greenlight_propose_tests") && tools.includes("greenlight_get_project"));
  assert.ok(!tools.some((n) => /approve|certify|publish/.test(n)), "no tool approves, certifies or publishes");
  const listed = (await mcp({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "greenlight_list_projects", arguments: {} } })).body.result;
  assert.deepEqual(listed.structuredContent.projects.map((p) => p.id), [projectId]);
  const proposed = (await mcp({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "greenlight_propose_tests", arguments: { projectId, specText: E2E } } })).body.result;
  assert.equal(proposed.isError, false, JSON.stringify(proposed));
  assert.equal(proposed.structuredContent.approveUrl, `${BASE}/approve/${projectId}/1`);
  const badSpec = (await mcp({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "greenlight_propose_tests", arguments: { projectId, specText: "version: 1\n" } } })).body.result;
  assert.equal(badSpec.isError, true);

  // Another account's project is not visible through MCP.
  const other = browser(h);
  await other.googleSignIn("google-sub-other");
  const ot = (await other.go("POST", "/app/api/tokens", { json: { role: "agent", label: "x" } })).body.token;
  const hidden = (await mcp({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "greenlight_get_project", arguments: { projectId } } }, ot)).body.result;
  assert.equal(hidden.isError, true);

  // Revoked: refused.
  assert.equal((await b.go("POST", `/app/api/tokens/${list[0].id}/revoke`, { json: {} })).status, 200);
  assert.equal((await mcp({ jsonrpc: "2.0", id: 7, method: "tools/list" })).status, 401);
});

test("administrators sign in with Vercel; the admin API is theirs alone and records every change", async () => {
  const h = await setup();
  const a = browser(h);
  const cb = await a.vercelSignIn(ADMIN_SUB);
  assert.equal(cb.status, 302);
  const me = (await a.go("GET", "/app/api/session")).body;
  assert.deepEqual([me.provider, me.role, me.account], ["vercel", "admin", "xdgram"]);
  const ov = await a.go("GET", "/app/api/admin/overview");
  assert.equal(ov.status, 200, ov.text);
  assert.equal(typeof ov.body.overview.projects, "number");
  const health = (await a.go("GET", "/app/api/admin/health")).body;
  assert.deepEqual([health.configuration.signInWithGoogle, health.configuration.administratorSignIn], [true, true]);
  assert.ok(!JSON.stringify(health).includes(GOOGLE_SECRET) && !JSON.stringify(health).includes(SIGNING_KEY));
  for (const kind of ["users", "projects", "jobs", "records", "tokens", "events", "guests"]) assert.equal((await a.go("GET", `/app/api/admin/list/${kind}`)).status, 200, kind);
  assert.equal((await a.go("POST", "/app/api/admin/settings", { json: { key: "guest.checks_paused", value: true } })).status, 200);
  assert.equal((await a.go("POST", "/app/api/admin/settings", { json: { key: "anything.else", value: 1 } })).status, 400);
  assert.equal((await a.go("POST", "/app/api/admin/settings", { json: { key: "guest.checks_paused", value: "yes" } })).status, 400);
  const events = (await a.go("GET", "/app/api/admin/list/events")).body.items;
  assert.ok(events.some((e) => e.action === "setting.changed" && e.target === "guest.checks_paused"));

  // A Vercel identity that is not a configured approver gets no session at all.
  const stranger = browser(h);
  assert.equal((await stranger.vercelSignIn("vercel_someone_else")).status, 403);
  assert.equal((await stranger.go("GET", "/app/api/session")).status, 401);
});
