// Guest demo (/app/api/guest/*) on the real migrations (PGlite) with the real store, HTTP server
// and the demo check. Kane, balances, DNS, the app's start page and the AI are fakes. No network,
// Kane or credits; the tests assert that guests never reach Kane.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { loadConfig, createServerContext, startServer, sha256Hex, SupabaseStore, createSupabaseClient } from "../../src/server/index.js";
import { buildSpecYaml } from "../../src/server/guest-spec.js";
import { visibleText } from "../../src/server/guest-ai.js";
import { checkAgainstPage } from "../../src/server/guest-check.js";
import { projectFromText } from "../../src/spec/generate.js";
import { fabricatedRun } from "../verify/helpers.js";
import { createFakeSupabase } from "./fake-supabase.js";

const E2E = readFileSync(new URL("../fixtures/spec/e2e/greenlight.yaml", import.meta.url), "utf8");
const BASE = "https://greenlight.example.com";
const OWNER = "owner-token-guest-0123456789abcdef";
const temps = [];
const closers = [];
after(async () => {
  for (const c of closers) await c();
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

const FORM = {
  name: "Watchdog",
  url: "https://watchdog.example.com/",
  description: "Flags scam links.",
  claims: [{ id: "a", text: "A phishing link is rated Dangerous." }, { id: "b", text: "The threat memory page explains verification." }],
  tests: [
    { title: "Check a phishing link", claims: ["a"], steps: [{ name: "Open", kind: "do", text: "Open the start page." }, { name: "Check", kind: "do", text: "Click \"uniswap.lc\", then click \"Check a link\"." }, { name: "Verdict", kind: "expect_text", text: "Dangerous" }] },
    { title: "Threat memory", claims: ["b"], steps: [{ name: "Open", kind: "do", text: "Click \"Threat memory\" in the top menu." }, { name: "Rule", kind: "expect_text", text: "Only Reppo-verified threats block other users." }] },
  ],
};

const START_PAGE = "<html><body><h1>Watchdog</h1><p>Paste a link and click Check a link.</p><nav>Threat memory</nav></body></html>";

async function setup({ env = {}, kaneStatus = "passed", ai, page = START_PAGE } = {}) {
  const fake = await createFakeSupabase();
  closers.push(() => fake.close());
  const admin = createSupabaseClient({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: fake.fetch });
  await admin.rpc("greenlight_ensure_account", { p_slug: "acme" });
  await admin.rpc("greenlight_create_user", { p_account: "acme", p_name: "dev", p_role: "owner" });
  await admin.rpc("greenlight_add_token", { p_account: "acme", p_user: "dev", p_token_sha256: sha256Hex(OWNER), p_label: "t" });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "gl-guest-"));
  temps.push(workDir);
  const config = loadConfig({ SUPABASE_URL: fake.url, SUPABASE_SERVICE_ROLE_KEY: fake.serviceRoleKey, GREENLIGHT_WORK_DIR: workDir, GREENLIGHT_PORT: "0", GREENLIGHT_PUBLIC_BASE_URL: BASE, GREENLIGHT_GUEST_MODE: "on", ...env });
  const kaneCalls = [];
  const deps = {
    runKane: async (opts) => {
      kaneCalls.push(opts);
      const files = opts.args.filter((a) => a.endsWith("_test.md"));
      return { ...fabricatedRun({ members: files.map((file, i) => ({ file, tags: [`clm-00${i + 1}`], status: kaneStatus, mode: "authored" })) }), stdout: "{}\n", stderr: "", aborted: false };
    },
    readBalance: async () => ({ ok: true, balance: 5000 }),
    validator: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
    verifyLiveDeployment: async () => {
      throw new Error("not used");
    },
    checkHost: async () => {},
    now: () => new Date(),
  };
  const store = new SupabaseStore({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: fake.fetch, workRoot: workDir });
  const ctx = await createServerContext({ config, deps, store });
  const pageFetches = [];
  const check = {
    checkHost: async () => {},
    fetchImpl: async (u) => {
      pageFetches.push(String(u));
      if (page === null) return new Response("nope", { status: 500 });
      return new Response(page, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    },
  };
  const server = await startServer({ config, ...ctx, now: deps.now, guestDeps: { ...(ai ? { ai } : {}), check } });
  closers.push(() => new Promise((r) => server.close(r)));
  const url = `http://127.0.0.1:${server.address().port}`;
  return { fake, admin, url, ctx, kaneCalls, store, pageFetches };
}

/** A browser: one cookie jar, same-origin headers on writes. */
function browser(h, { ip = "203.0.113.7" } = {}) {
  const jar = new Map();
  const go = async (method, p, body, headers = {}) => {
    const res = await fetch(h.url + p, {
      method,
      headers: {
        "x-real-ip": ip,
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(method === "POST" ? { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    return { status: res.status, body: await res.json(), headers: res.headers };
  };
  return { go, jar };
}

test("specs from the form are written safely and follow the normal rules", () => {
  const yaml = buildSpecYaml({ ...FORM, name: 'Evil" url: "http://127.0.0.1/', description: "x: [1, 2] # not a comment" });
  const d = projectFromText(yaml);
  assert.equal(d.spec.project.url, "https://watchdog.example.com/", "input cannot change the document's structure");
  assert.equal(d.spec.project.name, 'Evil" url: "http://127.0.0.1/');
  assert.equal(d.spec.project.description, "x: [1, 2] # not a comment");
  assert.deepEqual(d.spec.claims.map((c) => c.id), ["CLM-001", "CLM-002"]);
  assert.deepEqual(d.spec.tests.map((t) => t.claims), [["CLM-001"], ["CLM-002"]]);
  assert.throws(() => buildSpecYaml({ ...FORM, url: "http://localhost:3000/" }), /public address/);
  assert.throws(() => buildSpecYaml({ ...FORM, tests: [] }), /at least one test/);
  assert.equal(visibleText("<html><script>var x='<b>hidden</b>'</script><h1>Hello &amp; welcome</h1><p>Check a link</p></html>"), "Hello & welcome\nCheck a link");
});

test("guest mode is off by default and needs Supabase and an https public URL", async () => {
  assert.equal(loadConfig({ GREENLIGHT_DATA_DIR: os.tmpdir() }).guest, null);
  assert.throws(() => loadConfig({ GREENLIGHT_DATA_DIR: os.tmpdir(), GREENLIGHT_GUEST_MODE: "on" }), /needs Supabase/);
  const c = loadConfig({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "sb_secret_xxxxxxxxxxxxxxxxxxxxxxxx", GREENLIGHT_PUBLIC_BASE_URL: BASE, GREENLIGHT_GUEST_MODE: "on", ANTHROPIC_API_KEY: "sk-ant-test-secret" });
  assert.deepEqual([c.guest.runsPerGuest, c.guest.runsPerDay, c.guest.maxCreditsPerRun], [10, 500, 150]);
  assert.ok(!JSON.stringify(c).includes("sk-ant-test-secret"), "the Anthropic key never serialises");
});

test("a guest starts without signing up, is remembered, and keeps to their own data", async () => {
  const h = await setup();
  const b = browser(h);
  assert.equal((await b.go("GET", "/app/api/guest/me")).body.guest, null);
  assert.equal((await b.go("GET", "/app/api/guest/projects")).status, 401, "no guest yet");
  assert.equal((await b.go("POST", "/app/api/guest/start", {}, { origin: "https://evil.example" })).status, 403, "cross-site");
  assert.equal((await b.go("POST", "/app/api/guest/start", {}, { origin: "null" })).status, 403, "Origin null");
  const s = await b.go("POST", "/app/api/guest/start", {});
  assert.equal(s.status, 201);
  assert.match(s.headers.get("set-cookie"), /^__Host-gl_guest=[^;]+; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
  const me = await b.go("GET", "/app/api/guest/me");
  assert.equal(me.body.guest.id, s.body.guest.id, "remembered by the cookie");
  assert.deepEqual([me.body.limits.runsLeft, me.body.limits.runsLeftToday, me.body.limits.demoCheck], [10, 500, true]);
  assert.equal((await b.go("POST", "/app/api/guest/start", {})).body.guest.id, s.body.guest.id, "starting again keeps the same guest");

  // A forged or edited cookie is ignored.
  const forged = browser(h);
  forged.jar.set("__Host-gl_guest", b.jar.get("__Host-gl_guest").replace(/.$/, (c) => (c === "A" ? "B" : "A")));
  assert.equal((await forged.go("GET", "/app/api/guest/me")).body.guest, null);

  // Preview: problems are reported, not thrown; the demo's credit cap is enforced.
  const bad = await b.go("POST", "/app/api/guest/preview", { ...FORM, tests: [{ title: "x", claims: ["a"], steps: [{ name: "s", kind: "do", text: "Verify the page shows Dangerous." }] }] });
  assert.equal(bad.body.ok, false);
  assert.ok(bad.body.problems.some((p) => /verification|expect_text/.test(p)), JSON.stringify(bad.body.problems));
  const big = { ...FORM, tests: [0, 1, 2, 3].map((i) => ({ ...FORM.tests[i % 2], title: `t${i}` })) };
  const over = await b.go("POST", "/app/api/guest/preview", big);
  assert.equal(over.body.ok, false);
  assert.match(over.body.problems.join(" "), /credits/);
  const ok = await b.go("POST", "/app/api/guest/preview", FORM);
  assert.equal(ok.body.ok, true);
  assert.equal(ok.body.estimate.credits, 37 + 37 + 20);

  const created = await b.go("POST", "/app/api/guest/projects", FORM);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  assert.match(id, /^gpj_[0-9a-f]{32}$/);
  assert.equal(created.body.approvedTestHash, ok.body.hash);
  assert.equal((await b.go("GET", "/app/api/guest/projects")).body.projects.length, 1);

  // Another guest sees nothing of it.
  const other = browser(h, { ip: "198.51.100.9" });
  await other.go("POST", "/app/api/guest/start", {});
  assert.equal((await other.go("GET", "/app/api/guest/projects")).body.projects.length, 0);
  assert.equal((await other.go("GET", `/app/api/guest/projects/${id}`)).status, 404);
  assert.equal((await other.go("POST", `/app/api/guest/projects/${id}/approve`, { confirmHash: ok.body.hash })).status, 404);

  // Approving: the exact hash, once.
  assert.equal((await b.go("POST", `/app/api/guest/projects/${id}/runs`, {})).body.error.code, "approval_hash_mismatch", "approve first");
  assert.equal((await b.go("POST", `/app/api/guest/projects/${id}/approve`, { confirmHash: ok.body.hash.slice(0, 12) })).status, 409);
  assert.equal((await b.go("POST", `/app/api/guest/projects/${id}/approve`, { confirmHash: "0".repeat(64) })).status, 409);
  const ap = await b.go("POST", `/app/api/guest/projects/${id}/approve`, { confirmHash: ok.body.hash });
  assert.equal(ap.status, 200);
  assert.ok(ap.body.project.approvedAt);
  assert.equal((await b.go("POST", `/app/api/guest/projects/${id}/approve`, { confirmHash: ok.body.hash })).status, 409, "write-once");

  // A demo check: the start page is read over HTTP; Kane never runs and nothing is spent.
  const r = await b.go("POST", `/app/api/guest/projects/${id}/runs`, {});
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const detail = await b.go("GET", `/app/api/guest/projects/${id}`);
  const run = detail.body.project.runs[0];
  assert.equal(run.status, "succeeded", JSON.stringify(run.error));
  assert.equal(run.result.kind, "demo_check");
  // Both tests interact (click) before their expected text, so nothing can be checked without a browser.
  assert.equal(run.result.status, "couldnt_verify");
  assert.deepEqual(run.result.tests.map((t) => t.status), ["not_checked", "not_checked"]);
  assert.deepEqual(run.result.tests[0].steps.map((x) => x.result), ["start_page_loaded", "action_not_performed", "not_checked"]);
  assert.deepEqual([run.result.page.read, run.result.credits], [true, { estimate: 0, actual: 0 }]);
  assert.deepEqual([run.result.certified, run.result.notCertifiedBecause], [false, ["guest_demo_check"]]);
  assert.equal(h.kaneCalls.length, 0, "Kane is never run for guests");
  assert.deepEqual(h.pageFetches, ["https://watchdog.example.com/"]);
  for (const t of ["jobs", "runs", "certification_records", "approvals"]) assert.deepEqual(await h.fake.sql(`select count(*)::int as n from greenlight.${t}`), [{ n: 0 }], `${t} untouched`);
  assert.equal((await b.go("GET", "/app/api/guest/me")).body.limits.runsLeft, 9);
});

test("demo check: expected texts before any interaction are checked against the start page", () => {
  const yaml = buildSpecYaml({
    ...FORM,
    tests: [
      { title: "Home", claims: ["a"], steps: [{ name: "Open", kind: "do", text: "Open the start page." }, { name: "Heading", kind: "expect_text", text: "Watchdog" }] },
      { title: "Missing", claims: ["b"], steps: [{ name: "Open", kind: "do", text: "Go to the start page." }, { name: "Text", kind: "expect_text", text: "Only Reppo-verified threats block other users." }] },
    ],
  });
  const spec = projectFromText(yaml).spec;
  const r = checkAgainstPage(spec, "Watchdog\nPaste a link");
  assert.deepEqual(r.tests.map((t) => t.status), ["passed", "failed"]);
  assert.deepEqual(r.claims.map((c) => c.status), ["passed", "failed"]);
  assert.equal(r.status, "failed");
  const unread = checkAgainstPage(spec, null);
  assert.deepEqual([unread.status, unread.tests.map((t) => t.status)], ["couldnt_verify", ["not_checked", "not_checked"]]);
});

test("limits: demo checks per day across guests, an unreadable page, the admin pause, new sessions per network", async () => {
  const h = await setup({ env: { GREENLIGHT_GUEST_RUNS_PER_DAY: "2", GREENLIGHT_GUEST_SESSIONS_PER_IP_HOUR: "3" }, page: null });
  const guests = [];
  for (let i = 0; i < 3; i++) {
    const b = browser(h, { ip: `198.51.100.${i + 1}` });
    await b.go("POST", "/app/api/guest/start", {});
    const p = await b.go("POST", "/app/api/guest/projects", FORM);
    await b.go("POST", `/app/api/guest/projects/${p.body.id}/approve`, { confirmHash: p.body.approvedTestHash });
    guests.push({ b, id: p.body.id });
  }
  // The administrator can pause demo checks; nothing runs and nothing counts.
  await h.admin.rpc("greenlight_set_setting", { p_key: "guest.checks_paused", p_value: true, p_by: "test" });
  const paused = await guests[0].b.go("POST", `/app/api/guest/projects/${guests[0].id}/runs`, {});
  assert.deepEqual([paused.status, paused.body.error.code], [429, "guest_limit_reached"]);
  assert.equal((await guests[0].b.go("GET", "/app/api/guest/me")).body.limits.paused, true);
  await h.admin.rpc("greenlight_set_setting", { p_key: "guest.checks_paused", p_value: false, p_by: "test" });

  // A start page that cannot be read: the check completes and says nothing could be checked.
  assert.equal((await guests[0].b.go("POST", `/app/api/guest/projects/${guests[0].id}/runs`, {})).status, 202);
  const unread = (await guests[0].b.go("GET", `/app/api/guest/projects/${guests[0].id}`)).body.project.runs[0];
  assert.deepEqual([unread.status, unread.result.page.read, unread.result.status], ["succeeded", false, "couldnt_verify"]);

  assert.equal((await guests[1].b.go("POST", `/app/api/guest/projects/${guests[1].id}/runs`, {})).status, 202);
  const third = await guests[2].b.go("POST", `/app/api/guest/projects/${guests[2].id}/runs`, {});
  assert.deepEqual([third.status, third.body.error.code], [429, "guest_limit_reached"], "daily cap across guests");
  assert.equal(h.kaneCalls.length, 0);

  // New sessions per network address per hour.
  const ip = "192.0.2.50";
  for (let i = 0; i < 3; i++) assert.equal((await browser(h, { ip }).go("POST", "/app/api/guest/start", {})).status, 201);
  const blocked = await browser(h, { ip }).go("POST", "/app/api/guest/start", {});
  assert.deepEqual([blocked.status, blocked.body.error.code], [429, "guest_limit_reached"]);
});

test("the sample project is readable by guests without approval identities; AI drafts are checked and limited", async () => {
  const drafts = [];
  const fakeClient = {
    beta: {
      messages: {
        create: async (req) => {
          drafts.push(req);
          return {
            stop_reason: "end_turn",
            content: [{ type: "text", text: JSON.stringify({ name: "Watchdog", description: "Scam checker", claims: FORM.claims, tests: FORM.tests, notes: "All texts were on the page." }) }],
          };
        },
      },
    },
  };
  const page = async () => new Response("<html><h1>Repère une arnaque</h1><button>Check a link</button></html>", { headers: { "content-type": "text/html" } });
  const h = await setup({ env: { GREENLIGHT_GUEST_AI_PER_GUEST: "1" }, ai: { client: fakeClient, fetchImpl: page, checkHost: async () => {} } });
  // A real project, approved by its owner, as the sample.
  const api = async (method, p, body) => (await fetch(h.url + p, { method, headers: { authorization: `Bearer ${OWNER}`, "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  const p = await api("POST", "/v1/projects", { name: "Shop", url: "https://gl-test.vercel.app/" });
  const v = await api("POST", `/v1/projects/${p.id}/versions`, { specText: E2E });
  await api("POST", `/v1/projects/${p.id}/versions/1/approval`, { confirmHash: v.approvedTestHash });

  const h2 = { ...h };
  const b = browser(h2);
  const noSample = await b.go("GET", "/app/api/guest/sample");
  assert.equal(noSample.status, 404, "no sample configured");

  await b.go("POST", "/app/api/guest/start", {});
  const d = await b.go("POST", "/app/api/guest/draft", { name: "Watchdog", url: "https://watchdog.example.com/", requirements: "Users paste a link and see whether it is dangerous." });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.check.ok, true, JSON.stringify(d.body.check));
  assert.equal(d.body.pageRead, true);
  assert.equal(drafts[0].model, "claude-opus-5-5");
  assert.deepEqual(drafts[0].output_config.format.type, "json_schema");
  assert.equal(drafts[0].fallbacks, "default");
  assert.match(drafts[0].messages[0].content, /<start_page_text>\nRepère une arnaque\nCheck a link\n<\/start_page_text>/);
  assert.ok(!drafts[0].system.includes("Users paste a link"), "requirements never go into the system prompt");
  const limited = await b.go("POST", "/app/api/guest/draft", { name: "W", url: "https://watchdog.example.com/", requirements: "Users paste a link and see whether it is dangerous." });
  assert.deepEqual([limited.status, limited.body.error.code], [429, "guest_limit_reached"]);
});

test("sample project view hides approval identities", async () => {
  const fake = await createFakeSupabase();
  closers.push(() => fake.close());
  const admin = createSupabaseClient({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: fake.fetch });
  await admin.rpc("greenlight_ensure_account", { p_slug: "acme" });
  await admin.rpc("greenlight_create_user", { p_account: "acme", p_name: "dev", p_role: "owner" });
  await admin.rpc("greenlight_add_token", { p_account: "acme", p_user: "dev", p_token_sha256: sha256Hex(OWNER), p_label: "t" });
  const store = new SupabaseStore({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: fake.fetch, workRoot: os.tmpdir() });
  const project = await store.createProject({ name: "Shop", url: "https://gl-test.vercel.app/", account: "acme", createdBy: "dev", now: new Date() });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "gl-guest-s-"));
  temps.push(workDir);
  const config = loadConfig({ SUPABASE_URL: fake.url, SUPABASE_SERVICE_ROLE_KEY: fake.serviceRoleKey, GREENLIGHT_WORK_DIR: workDir, GREENLIGHT_PORT: "0", GREENLIGHT_PUBLIC_BASE_URL: BASE, GREENLIGHT_GUEST_MODE: "on", GREENLIGHT_GUEST_SAMPLE_PROJECT: project.id });
  const ctx = await createServerContext({ config, store, deps: { now: () => new Date(), readBalance: async () => ({ ok: true, balance: 0 }) } });
  const server = await startServer({ config, ...ctx, now: () => new Date() });
  closers.push(() => new Promise((r) => server.close(r)));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/app/api/guest/sample`);
  const body = await r.json();
  assert.equal(r.status, 200, JSON.stringify(body));
  assert.equal(body.project.id, project.id);
  assert.deepEqual(body.versions, []);
});

test("guest routes answer 404 when guest mode is off", async () => {
  const fake = await createFakeSupabase();
  closers.push(() => fake.close());
  const workDir = await mkdtemp(path.join(os.tmpdir(), "gl-guest-off-"));
  temps.push(workDir);
  const config = loadConfig({ SUPABASE_URL: fake.url, SUPABASE_SERVICE_ROLE_KEY: fake.serviceRoleKey, GREENLIGHT_WORK_DIR: workDir, GREENLIGHT_PORT: "0", GREENLIGHT_PUBLIC_BASE_URL: BASE });
  const store = new SupabaseStore({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: fake.fetch, workRoot: workDir });
  const ctx = await createServerContext({ config, store, deps: { now: () => new Date() } });
  const server = await startServer({ config, ...ctx, now: () => new Date() });
  closers.push(() => new Promise((r) => server.close(r)));
  const r = await fetch(`http://127.0.0.1:${server.address().port}/app/api/guest/me`);
  assert.equal(r.status, 404);
});
