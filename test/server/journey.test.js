// The guest journey end to end on the real migrations (PGlite), the real server and job runner:
// submit an app, understand it (repository + live app + Claude), plan and approve tests in the app,
// a capped real run (fake Kane), the Fix Centre (explain, ask, propose, send), the coding agent's
// MCP handoff and a re-run that confirms the fix. GitHub, the browser, Claude and Kane are fakes.
// No network, no Kane, no credits.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { loadConfig, createServerContext, startServer, SupabaseStore, createSupabaseClient } from "../../src/server/index.js";
import { guestAccount } from "../../src/server/approval-policy.js";
import { createFakeSupabase } from "./fake-supabase.js";
import { fabricatedRun } from "../verify/helpers.js";
import { zipOf } from "../report/zip-helper.js";
import { TestrunStream } from "../../src/kane/testrun-stream.js";

const KEY = `sb_secret_${"j".repeat(22)}_journey01`;
const BASE = "https://greenlight.example.com";
const SIGNING_KEY = `journey-signing-key-${"k".repeat(40)}`;
const HEAD = "c".repeat(40);
const EXEC_ID = "0a1b2c3d-0000-4000-8000-0000000000dd";
const temps = [];
const closers = [];
after(async () => {
  for (const c of closers) await c();
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

const b64 = (s) => Buffer.from(s).toString("base64");
function github(state) {
  return async (url) => {
    const u = String(url);
    const J = (o, status = 200) => new Response(JSON.stringify(o), { status });
    if (!u.startsWith("https://api.github.com/repos/acme/shop")) {
      if (u === "https://shop.example.com/greenlight.json") return state.greenlightJson ? J({ commit: HEAD, environment: "production" }) : new Response("nf", { status: 404 });
      throw new Error(`unexpected fetch ${u}`);
    }
    const rest = u.slice("https://api.github.com/repos/acme/shop".length);
    if (rest === "") return J({ full_name: "acme/shop", private: false, default_branch: "main", html_url: "https://github.com/acme/shop", description: "A small shop", topics: [], language: "TypeScript" });
    if (rest === "/languages") return J({ TypeScript: 9000, CSS: 1000 });
    if (rest.startsWith("/git/trees/main")) return J({ truncated: false, tree: [{ path: "package.json", type: "blob" }, { path: "app", type: "tree" }, { path: "app/page.tsx", type: "blob" }, { path: "app/cart/page.tsx", type: "blob" }, { path: "README.md", type: "blob" }] });
    if (rest.startsWith("/contents/package.json")) return J({ encoding: "base64", content: b64(JSON.stringify({ name: "shop", scripts: { build: "next build" }, dependencies: { next: "15.0.0", react: "19.0.0" } })) });
    if (rest.startsWith("/readme")) return J({ encoding: "base64", content: b64("# Shop\nAdd products to a cart and see the total.") });
    if (rest === "/branches/main") return J({ commit: { sha: HEAD, html_url: "x", commit: { message: "ship", author: { name: "a", date: "2026-11-20T00:00:00Z" } } } });
    if (rest.startsWith("/commits/")) return J({ sha: HEAD, html_url: "x", commit: { message: "ship" } });
    return new Response("{}", { status: 404 });
  };
}

/** A minimal stand-in for a Playwright browser (the real reader is exercised in production). */
const fakeLaunch = (state) => async () => ({
  newContext: async () => ({
    route: async () => {},
    newPage: async () => {
      let current;
      return {
        goto: async (url) => {
          current = url;
          state.visited.push(url);
          return { status: () => 200 };
        },
        waitForLoadState: async () => {},
        url: () => current,
        evaluate: async () => ({ title: "Shop", text: "Shop · Add to cart · Cart total", headings: ["Shop"], links: [{ text: "Cart", href: "https://shop.example.com/cart" }], buttons: ["Add to cart"], forms: [], inputs: [] }),
        screenshot: async () => Buffer.from("jpeg"),
      };
    },
  }),
  close: async () => {},
});

const PLAN = {
  name: "Shop",
  description: "A small shop.",
  claims: [{ id: "c1", text: "The home page names the shop." }, { id: "c2", text: "The cart shows a total." }],
  tests: [
    { title: "Home", claims: ["c1"], steps: [{ name: "Open", kind: "do", text: "Open the start page." }, { name: "Name", kind: "expect_text", text: "Shop" }] },
    { title: "Cart", claims: ["c2"], steps: [{ name: "Open", kind: "do", text: "Open the start page." }, { name: "Cart", kind: "do", text: "Click \"Cart\"." }, { name: "Total", kind: "expect_text", text: "Cart total" }] },
  ],
  notes: "",
};

function fakeClaude(calls) {
  return {
    beta: {
      messages: {
        create: async (req) => {
          calls.push(req);
          const sys = req.system;
          const json = (o) => ({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(o) }] });
          if (sys.includes("understand a web application")) {
            return json({ summary: "A shop.", framework: "Next.js (package.json)", features: [{ name: "Cart", description: "See the cart total", source: "description_and_live_app", testable: true, why: "Visible on the page" }], mismatches: [], questions: [{ id: "q1", question: "Which flow matters most?", why: "Focus" }], limits: "Checkout needs payment." });
          }
          if (sys.includes("You write verification tests")) return json(PLAN);
          if (sys.includes("Explain this failure")) return json({ whatWeTested: "The cart total", whatHappened: "No total shown", whatShouldHaveHappened: "Cart total visible", likelyCause: "The total is not rendered", causeSupport: "plausible_guess", suggestedFix: "Render the total", otherPossibilities: ["The cart link"] });
          if (sys.includes("implementation proposal")) return json({ summary: "Render the cart total", steps: ["Add total"], whereToLook: ["app/cart/page.tsx"], risks: ["Layout"], howToVerify: "Re-run the Cart test", agentTask: "Render the cart total on /cart. Do not change the approved tests." });
          return { stop_reason: "end_turn", content: [{ type: "text", text: `Answer ${calls.length}` }] };
        },
      },
    },
  };
}

async function setup({ env = {}, ai = true } = {}) {
  const fake = await createFakeSupabase({ serviceRoleKey: KEY });
  closers.push(() => fake.close());
  const admin = createSupabaseClient({ url: fake.url, serviceRoleKey: KEY, fetchImpl: fake.fetch });
  const workDir = await mkdtemp(path.join(os.tmpdir(), "gl-journey-"));
  temps.push(workDir);
  const config = loadConfig({
    SUPABASE_URL: fake.url, SUPABASE_SERVICE_ROLE_KEY: KEY, GREENLIGHT_WORK_DIR: workDir, GREENLIGHT_PORT: "0", GREENLIGHT_PUBLIC_BASE_URL: BASE,
    GREENLIGHT_GUEST_MODE: "on", GREENLIGHT_APPROVAL_SIGNING_KEY: SIGNING_KEY, GREENLIGHT_GUEST_REAL_RUNS_PER_GUEST: "2", GREENLIGHT_GUEST_REAL_RUNS_PER_DAY: "3", GREENLIGHT_GUEST_DAILY_CREDITS: "300",
    ...env,
  });
  const state = { greenlightJson: true, visited: [], kane: new Map(), kaneCalls: [] };
  const calls = [];
  const tagOf = (file) => {
    const n = /^claim-(\d+)_/.exec(file);
    if (n) return `clm-${n[1].padStart(3, "0")}`;
    return file.startsWith("home") ? "clm-001" : "clm-002";
  };
  const deps = {
    runKane: async (opts) => {
      const files = opts.args.filter((a) => a.endsWith("_test.md"));
      state.kaneCalls.push(files);
      const store = path.join(opts.cwd, ".testmuai", "evidence");
      await mkdir(store, { recursive: true });
      await writeFile(path.join(store, `${EXEC_ID}.evidence`), zipOf({ "run.yaml": "status: finalized\n" }));
      // Kane's NDJSON output, captured as the stream is built (the Fix Centre reads it back).
      const lines = [];
      const apply = TestrunStream.prototype.apply;
      TestrunStream.prototype.apply = function (e) {
        lines.push(JSON.stringify(e));
        return apply.call(this, e);
      };
      let run;
      try {
        run = fabricatedRun({ members: files.map((file) => ({ file, tags: [tagOf(file)], status: state.kane.get(file) ?? "passed", mode: "authored", message: "Expected text “Cart total” was not visible." })) });
      } finally {
        TestrunStream.prototype.apply = apply;
      }
      run.stream.done.executionId = EXEC_ID;
      run.stream.summary.executionId = EXEC_ID;
      run.stream.summary.evidenceId = EXEC_ID;
      return { ...run, stdout: `${lines.join("\n")}\n`, stderr: "", aborted: false };
    },
    readBalance: async () => ({ ok: true, balance: 5000 }),
    validator: async () => ({ exitCode: 0, stdout: '{"valid":true,"status":"finalized","diagnostics":[]}', stderr: "" }),
    verifyLiveDeployment: async (o) => ({ state: "ready", reasons: [], safeToRunKane: true, url: o.url, deployedCommit: o.expectedCommit, expectedCommit: o.expectedCommit, environment: "production" }),
    now: () => new Date(),
  };
  const store = new SupabaseStore({ url: fake.url, serviceRoleKey: KEY, fetchImpl: fake.fetch, workRoot: workDir });
  const ctx = await createServerContext({ config, deps, store });
  const server = await startServer({ config, ...ctx, now: deps.now, approvalDeps: { fetchImpl: github(state), appDeps: { checkHost: async () => {}, launch: fakeLaunch(state), ...(ai ? { ai: { client: fakeClaude(calls) } } : {}) } } });
  closers.push(() => new Promise((r) => server.close(r)));
  return { fake, admin, url: `http://127.0.0.1:${server.address().port}`, state, calls, ctx, store };
}

function browser(h, ip = "203.0.113.5") {
  const jar = new Map();
  const go = async (method, p, json, headers = {}) => {
    const r = await fetch(h.url + p, {
      method,
      redirect: "manual",
      headers: {
        "x-real-ip": ip,
        ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
        ...(method === "POST" ? { "content-type": "application/json", origin: BASE, "sec-fetch-site": "same-origin" } : {}),
        ...headers,
      },
      body: json === undefined ? undefined : JSON.stringify(json),
    });
    for (const c of r.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      jar.set(kv.slice(0, i), kv.slice(i + 1));
    }
    const text = await r.text();
    let body = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { status: r.status, body, text };
  };
  return { go, jar };
}

const APP = { name: "Shop", url: "https://shop.example.com/", repository: "https://github.com/acme/shop", branch: "main", description: "A small shop.", purpose: "Visitors add products to a cart and see the cart total." };

test("a guest submits an app, Greenlight understands it, plans tests, runs them for real (capped, never certified), and the Fix Centre drives a fix to a confirmed re-run", async () => {
  const h = await setup();
  const g = browser(h);
  assert.equal((await g.go("GET", "/app/api/session")).status, 401, "nothing before the guest starts");
  const start = await g.go("POST", "/app/api/guest/start", {});
  assert.equal(start.status, 201);
  const me = (await g.go("GET", "/app/api/session")).body;
  assert.deepEqual([me.role, me.provider, me.account], ["guest", "guest", guestAccount(start.body.guest.id)]);
  assert.deepEqual([me.guestRuns.enabled, me.guestRuns.leftForYou, me.features.admin], [true, 2, false]);
  assert.equal((await g.go("GET", "/app/api/admin/overview")).status, 403);

  // Submit.
  const created = await g.go("POST", "/app/api/projects", APP);
  assert.equal(created.status, 201, created.text);
  const pid = created.body.project.id;

  // Understand: repository + live app, then Claude's comparison and questions, then answers.
  let d = (await g.go("POST", `/app/api/projects/${pid}/understand`, { step: "inspect" })).body.details.understanding;
  assert.equal(d.repository.status, "ok");
  assert.ok(d.repository.frameworks.some((f) => f.name === "Next.js"));
  assert.deepEqual(d.repository.read, ["repository details", "languages", "file list", "package.json", "README"]);
  assert.ok(d.repository.routes.includes("app/cart/page.tsx"));
  assert.equal(d.app.status, "ok");
  assert.equal(d.app.pages.length, 2, "the start page and one same-origin link");
  d = (await g.go("POST", `/app/api/projects/${pid}/understand`, { step: "analyze" })).body.details.understanding;
  assert.equal(d.analysis.features[0].name, "Cart");
  assert.match(h.calls.at(-1).messages[0].content, /<inspection>/, "facts go to Claude as data");
  d = (await g.go("POST", `/app/api/projects/${pid}/understand`, { step: "answers", answers: { q1: "The cart" } })).body.details.understanding;
  assert.equal(d.answers.q1, "The cart");

  // Plan: draft from description + understanding + answers; revise on request.
  const draft = await g.go("POST", `/app/api/projects/${pid}/draft`, {});
  assert.equal(draft.body.check.ok, true, draft.text);
  assert.match(h.calls.at(-1).messages[0].content, /Features found[\s\S]*Cart[\s\S]*Which flow matters most\?: The cart/);
  const revised = await g.go("POST", `/app/api/projects/${pid}/draft`, { instruction: "Also check the home page heading.", current: draft.body.draft });
  assert.equal(revised.body.revised, true);
  assert.match(h.calls.at(-1).messages[0].content, /<developer_request>\nAlso check the home page heading/);
  const v = await g.go("POST", `/app/api/projects/${pid}/versions`, { draft: draft.body.draft });
  assert.equal(v.status, 201);
  const hash = v.body.version.approvedTestHash;

  // No run before approval; in-app approval needs the exact plan the guest reviewed.
  assert.equal((await g.go("POST", `/app/api/projects/${pid}/certifications`, { version: 1, confirmSpend: 150 })).body.error.code, "approval_not_certifiable");
  assert.equal((await g.go("POST", `/app/api/projects/${pid}/versions/1/approve`, { confirm: true, approvedTestHash: "0".repeat(64) })).status, 409);
  const ap = await g.go("POST", `/app/api/projects/${pid}/versions/1/approve`, { confirm: true, approvedTestHash: hash });
  assert.equal(ap.status, 200, ap.text);
  assert.deepEqual([ap.body.versions[0].approval.identity.provider, ap.body.versions[0].approval.verified], ["guest", true]);

  // Real run: Kane (fake) runs both tests; the cart test fails. Never a certification.
  h.state.kane.set("cart_test.md", "failed");
  const run = await g.go("POST", `/app/api/projects/${pid}/certifications`, { version: 1, confirmSpend: 150, commit: "f".repeat(40) });
  assert.equal(run.status, 202, run.text);
  assert.deepEqual([run.body.job.commit, run.body.job.commitSource], [HEAD, "live_site"], "the server chose the commit, not the request");
  await h.ctx.jobs.idle();
  const detail = (await g.go("GET", `/app/api/projects/${pid}`)).body;
  const rec = detail.records[0];
  assert.deepEqual([rec.status, rec.certified, rec.publicUrl], ["failed", false, null]);
  assert.equal((await fetch(`${h.url}/v1/public/records/${rec.id}`)).status, 404, "guest runs never become public records");
  const runView = (await g.go("GET", `/app/api/projects/${pid}/records/${rec.id}`)).body;
  assert.ok(runView.record.notCertifiedBecause.includes("guest_verification"));
  const failing = runView.tests.find((t) => t.status !== "passed");
  assert.equal(failing.file, "cart_test.md");

  // Fix Centre: open with an explanation, ask with context retained, propose, send.
  const opened = await g.go("POST", "/app/api/fixes/open", { projectId: pid, recordId: rec.id, testFile: "cart_test.md" });
  assert.equal(opened.status, 201, opened.text);
  const fx = opened.body.fix;
  assert.deepEqual([fx.status, fx.explanation.causeSupport, fx.test.failedStep.index], ["open", "plausible_guess", 2]);
  assert.equal((await g.go("POST", "/app/api/fixes/open", { projectId: pid, recordId: rec.id, testFile: "home_test.md" })).status, 400, "a passing test has nothing to fix");
  await g.go("POST", `/app/api/fixes/${fx.id}/ask`, { message: "Why did this happen?" });
  const second = await g.go("POST", `/app/api/fixes/${fx.id}/ask`, { message: "Could another part be responsible?" });
  assert.equal(second.body.fix.messages.length, 4);
  const lastCall = h.calls.at(-1);
  assert.match(lastCall.messages[0].content, /<failure_context>[\s\S]*cart_test\.md/, "the failure context is in every turn");
  assert.ok(lastCall.messages.some((m) => m.content === "Why did this happen?"), "earlier questions are kept");
  const prop = await g.go("POST", `/app/api/fixes/${fx.id}/proposal`, {});
  assert.deepEqual([prop.body.fix.status, prop.body.fix.proposal.whereToLook[0]], ["task_ready", "app/cart/page.tsx"]);
  assert.equal((await g.go("POST", `/app/api/fixes/${fx.id}/send`, {})).body.fix.status, "sent_to_agent");

  // The developer's coding agent: an agent token (guests: agent only), MCP pull and report.
  assert.equal((await g.go("POST", "/app/api/tokens", { role: "owner", label: "x" })).status, 403);
  const tok = (await g.go("POST", "/app/api/tokens", { role: "agent", label: "Claude Code" })).body.token;
  const mcp = async (name, args) => {
    const r = await fetch(`${h.url}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    return (await r.json()).result;
  };
  assert.equal((await mcp("greenlight_list_fix_tasks", {})).structuredContent.tasks[0].fixId, fx.id);
  const task = (await mcp("greenlight_get_fix_task", { fixId: fx.id })).structuredContent;
  assert.match(task.task, /Do not change the approved tests/);
  assert.equal((await g.go("GET", `/app/api/fixes/${fx.id}`)).body.fix.status, "agent_working");
  assert.equal((await mcp("greenlight_report_fix", { fixId: fx.id, commit: "d".repeat(40), summary: "Rendered the total." })).isError, false);
  assert.equal((await g.go("GET", `/app/api/fixes/${fx.id}`)).body.fix.status, "agent_reported", "reported, not yet fixed");

  // Re-run only the failing test: it passes now, so the fix is confirmed.
  h.state.kane.set("cart_test.md", "passed");
  const rerun = await g.go("POST", `/app/api/projects/${pid}/certifications`, { version: 1, confirmSpend: 150, tests: ["cart_test.md"] });
  assert.equal(rerun.status, 202, rerun.text);
  await h.ctx.jobs.idle();
  assert.deepEqual(h.state.kaneCalls.at(-1), ["cart_test.md"], "only the chosen test ran");
  assert.equal((await g.go("GET", `/app/api/fixes/${fx.id}`)).body.fix.status, "fixed");

  // Caps: 2 runs per guest here; the third is refused before anything runs.
  const third = await g.go("POST", `/app/api/projects/${pid}/certifications`, { version: 1, confirmSpend: 150 });
  assert.deepEqual([third.status, third.body.error.code], [429, "guest_limit_reached"]);
  assert.equal(h.state.kaneCalls.length, 2);

  // Another guest sees none of it.
  const other = browser(h, "198.51.100.77");
  await other.go("POST", "/app/api/guest/start", {});
  assert.equal((await other.go("GET", `/app/api/projects/${pid}`)).status, 404);
  assert.equal((await other.go("GET", `/app/api/fixes/${fx.id}`)).status, 404);
  assert.equal((await other.go("GET", "/app/api/projects")).body.projects.length, 0);
});

test("guest runs: no commit can be established -> refused before Kane and not counted; the daily cap holds across guests; the admin pause stops runs", async () => {
  const h = await setup();
  const g = browser(h);
  await g.go("POST", "/app/api/guest/start", {});
  const pid = (await g.go("POST", "/app/api/projects", { ...APP, repository: "https://github.com/acme/private-app" })).body.project.id;
  const draft = (await g.go("POST", `/app/api/projects/${pid}/draft`, {})).body.draft;
  const hash = (await g.go("POST", `/app/api/projects/${pid}/versions`, { draft })).body.version.approvedTestHash;
  await g.go("POST", `/app/api/projects/${pid}/versions/1/approve`, { confirm: true, approvedTestHash: hash });
  h.state.greenlightJson = false;
  const r = await g.go("POST", `/app/api/projects/${pid}/certifications`, { version: 1, confirmSpend: 150 });
  assert.deepEqual([r.status, r.body.error.code], [409, "deployment_not_ready"]);
  assert.match(r.body.error.message, /can't tell which commit is live/);
  assert.equal((await g.go("GET", "/app/api/session")).body.guestRuns.leftForYou, 2, "a refused run is not counted");
  assert.equal(h.state.kaneCalls.length, 0);

  await h.admin.rpc("greenlight_set_setting", { p_key: "guest.checks_paused", p_value: true, p_by: "test" });
  h.state.greenlightJson = true;
  const paused = await g.go("POST", `/app/api/projects/${pid}/certifications`, { version: 1, confirmSpend: 150 });
  assert.deepEqual([paused.status, paused.body.error.code], [429, "guest_limit_reached"]);
  await h.admin.rpc("greenlight_set_setting", { p_key: "guest.checks_paused", p_value: false, p_by: "test" });

  // Daily cap (3) across guests: fill it with reservations from other guest accounts.
  for (let i = 0; i < 3; i++) {
    const acct = guestAccount(`gst_${String(i).repeat(32)}`);
    await h.admin.rpc("greenlight_guest_account", { p_slug: acct });
    await h.admin.rpc("greenlight_reserve_guest_run", { p_account: acct, p_credits: 50, p_per_account: 1, p_per_day: 3, p_daily_credits: 300, p_max_per_run: 100 });
  }
  const capped = await g.go("POST", `/app/api/projects/${pid}/certifications`, { version: 1, confirmSpend: 150 });
  assert.deepEqual([capped.status, capped.body.error.code], [429, "guest_limit_reached"]);
  assert.equal(h.state.kaneCalls.length, 0);
});

// ---------------------------------------------------------------- no server AI: the connected agent

async function startedGuest(h, ip) {
  const g = browser(h, ip);
  await g.go("POST", "/app/api/guest/start", {});
  const pid = (await g.go("POST", "/app/api/projects", APP)).body.project.id;
  return { g, pid };
}
async function agentFor(h, g) {
  const tok = (await g.go("POST", "/app/api/tokens", { role: "agent", label: "Claude Code" })).body.token;
  return async (name, args) => {
    const r = await fetch(`${h.url}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${tok}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
    return (await r.json()).result;
  };
}

test("without an AI key, Greenlight queues work for the developer's connected agent and validates what comes back", async () => {
  const h = await setup({ ai: false });
  const { g, pid } = await startedGuest(h);
  const me = (await g.go("GET", "/app/api/session")).body;
  assert.deepEqual([me.features.aiMode, me.features.agentConnected], ["agent", false]);
  const agent = await agentFor(h, g);
  assert.equal((await g.go("GET", "/app/api/session")).body.features.agentConnected, true);

  // Understand: the server inspects; the comparison is a request for the agent.
  await g.go("POST", `/app/api/projects/${pid}/understand`, { step: "inspect" });
  const q = await g.go("POST", `/app/api/projects/${pid}/understand`, { step: "analyze" });
  assert.equal(q.status, 202);
  const rid = q.body.agentRequest.id;
  assert.equal((await g.go("GET", `/app/api/agent-requests/${rid}`)).body.request.status, "queued");
  const listed = (await agent("greenlight_list_requests", {})).structuredContent.requests;
  assert.deepEqual(listed.map((r) => [r.requestId, r.kind]), [[rid, "understand"]]);
  // Submitting before taking it is refused; taking it returns the task, the data and the format.
  assert.equal((await agent("greenlight_submit_request", { requestId: rid, result: {} })).isError, true);
  const task = (await agent("greenlight_get_request", { requestId: rid })).structuredContent;
  assert.equal(task.kind, "understand");
  assert.equal(task.context.inspection.repository.repository.fullName, "acme/shop");
  assert.ok(task.outputSchema.required.includes("features"));
  // A malformed answer is rejected with the problems; the request stays open for a corrected one.
  const bad = await agent("greenlight_submit_request", { requestId: rid, result: { summary: "x" } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /features is required/);
  const analysis = { summary: "A shop.", framework: "Next.js", features: [{ name: "Cart", description: "Total", source: "repository", testable: true, why: "page" }], mismatches: [], questions: [], limits: "None." };
  assert.equal((await agent("greenlight_submit_request", { requestId: rid, result: analysis })).isError, false);
  const u = (await g.go("GET", `/app/api/projects/${pid}`)).body.details.understanding;
  assert.equal(u.analysis.features[0].name, "Cart");

  // Draft: the agent's plan is kept on the request with the rules check; nothing is saved.
  const dq = (await g.go("POST", `/app/api/projects/${pid}/draft`, {})).body.agentRequest;
  await agent("greenlight_get_request", { requestId: dq.id });
  const sub = await agent("greenlight_submit_request", { requestId: dq.id, result: PLAN });
  assert.match(sub.structuredContent.next, /waiting in Greenlight for the developer to review and approve/);
  const done = (await g.go("GET", `/app/api/agent-requests/${dq.id}`)).body.request;
  assert.deepEqual([done.status, done.result.check.ok, done.result.draft.tests.length], ["done", true, 2]);
  assert.equal(done.input, undefined, "the browser does not get the agent's context dump");
  assert.equal((await g.go("GET", `/app/api/projects/${pid}`)).body.versions.length, 0, "an agent's plan is never saved by itself");
  // Revise.
  const rq = (await g.go("POST", `/app/api/projects/${pid}/draft`, { instruction: "Drop the home test.", current: done.result.draft })).body.agentRequest;
  assert.equal(rq.kind, "revise_plan");
  const rtask = (await agent("greenlight_get_request", { requestId: rq.id })).structuredContent;
  assert.equal(rtask.context.developerRequest, "Drop the home test.");

  // Another guest's agent sees none of this.
  const other = await startedGuest(h, "198.51.100.12");
  const otherAgent = await agentFor(h, other.g);
  assert.deepEqual((await otherAgent("greenlight_list_requests", {})).structuredContent.requests, []);
  assert.equal((await otherAgent("greenlight_get_request", { requestId: rq.id })).isError, true);
  assert.equal((await other.g.go("GET", `/app/api/agent-requests/${rq.id}`)).status, 404);

  // The person can cancel a waiting request; an agent cannot answer it afterwards.
  const cq = (await g.go("POST", `/app/api/projects/${pid}/draft`, {})).body.agentRequest;
  assert.equal((await g.go("POST", `/app/api/agent-requests/${cq.id}/cancel`, {})).body.request.status, "cancelled");
  assert.equal((await agent("greenlight_get_request", { requestId: cq.id })).isError, true);
});

test("Fix Centre without an AI key: facts only, then the agent explains, answers and proposes", async () => {
  const h = await setup({ ai: false });
  const { g, pid } = await startedGuest(h);
  const agent = await agentFor(h, g);
  const draft = (await g.go("POST", `/app/api/projects/${pid}/preview`, { draft: PLAN })).body;
  assert.equal(draft.ok, true);
  const v = (await g.go("POST", `/app/api/projects/${pid}/versions`, { draft: PLAN })).body.version;
  await g.go("POST", `/app/api/projects/${pid}/versions/1/approve`, { confirm: true, approvedTestHash: v.approvedTestHash });
  h.state.kane.set("cart_test.md", "failed");
  assert.equal((await g.go("POST", `/app/api/projects/${pid}/certifications`, { version: 1, confirmSpend: 94 })).status, 202);
  await h.ctx.jobs.idle();
  const rec = (await g.go("GET", `/app/api/projects/${pid}`)).body.records[0];
  const fx = (await g.go("POST", "/app/api/fixes/open", { projectId: pid, recordId: rec.id, testFile: "cart_test.md" })).body.fix;
  assert.equal(fx.explanation.source, "facts_only", "without AI, only what the run showed");
  assert.equal(fx.explanation.causeSupport, "unknown");

  const ex = await g.go("POST", `/app/api/fixes/${fx.id}/explain`, {});
  assert.equal(ex.status, 202);
  await agent("greenlight_get_request", { requestId: ex.body.agentRequest.id });
  await agent("greenlight_submit_request", { requestId: ex.body.agentRequest.id, result: { whatWeTested: "t", whatHappened: "h", whatShouldHaveHappened: "s", likelyCause: "c", causeSupport: "supported_by_evidence", suggestedFix: "f", otherPossibilities: [] } });
  assert.equal((await g.go("GET", `/app/api/fixes/${fx.id}`)).body.fix.explanation.source, "agent");

  const ask = await g.go("POST", `/app/api/fixes/${fx.id}/ask`, { message: "Why?" });
  assert.equal(ask.status, 202);
  assert.deepEqual(ask.body.fix.messages.map((m) => m.role), ["user"], "the question is shown at once");
  const at = (await agent("greenlight_get_request", { requestId: ask.body.agentRequest.id })).structuredContent;
  assert.equal(at.context.question, "Why?");
  assert.equal(at.context.conversation.at(-1).content, "Why?", "the conversation so far goes with the question");
  await agent("greenlight_submit_request", { requestId: ask.body.agentRequest.id, result: { answer: "Because the total is not rendered." } });
  assert.deepEqual((await g.go("GET", `/app/api/fixes/${fx.id}`)).body.fix.messages.map((m) => m.role), ["user", "assistant"]);

  const pr = await g.go("POST", `/app/api/fixes/${fx.id}/proposal`, {});
  await agent("greenlight_get_request", { requestId: pr.body.agentRequest.id });
  await agent("greenlight_submit_request", { requestId: pr.body.agentRequest.id, result: { summary: "s", steps: ["a"], whereToLook: [], risks: [], howToVerify: "re-run", agentTask: "Render the total. Do not change the approved tests." } });
  const after = (await g.go("GET", `/app/api/fixes/${fx.id}`)).body.fix;
  assert.deepEqual([after.status, after.proposal.by], ["task_ready", "agent"]);
  // An agent still cannot mark it fixed or approve anything: only a passing run can.
  const tools = (await (await fetch(`${h.url}/mcp`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${(await g.go("POST", "/app/api/tokens", { role: "agent", label: "y" })).body.token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) })).json()).result.tools.map((t) => t.name);
  assert.ok(!tools.some((n) => /approve|certify|publish|mark_fixed/.test(n)));
});

test("guest credits: exact cost confirmed, strict per-run ceiling, shared daily budget, atomic under concurrency", async () => {
  const h = await setup({ env: { GREENLIGHT_GUEST_REAL_RUNS_PER_GUEST: "1", GREENLIGHT_GUEST_DAILY_CREDITS: "150", GREENLIGHT_GUEST_MAX_CREDITS_PER_RUN: "100" } });
  const approved = async (ip, plan = PLAN) => {
    const { g, pid } = await startedGuest(h, ip);
    const v = (await g.go("POST", `/app/api/projects/${pid}/versions`, { draft: plan })).body.version;
    await g.go("POST", `/app/api/projects/${pid}/versions/1/approve`, { confirm: true, approvedTestHash: v.approvedTestHash });
    return { g, pid, v };
  };
  const a = await approved("198.51.100.21");
  assert.equal(a.v.estimate.credits, 94);
  const me = (await a.g.go("GET", "/app/api/session")).body.guestRuns;
  assert.deepEqual([me.maxCreditsPerRun, me.dailyCredits, me.creditsLeftToday, me.leftForYou], [100, 150, 150, 1]);
  // The confirmation must cover the estimate.
  const low = await a.g.go("POST", `/app/api/projects/${a.pid}/certifications`, { version: 1, confirmSpend: 50 });
  assert.deepEqual([low.status, low.body.error.code, low.body.error.details.estimate], [409, "confirmation_required", 94]);

  // Too expensive for the per-run ceiling: refused before anything is reserved.
  const big = { ...PLAN, tests: [...PLAN.tests, { ...PLAN.tests[0], title: "Home again" }] };
  const b = await approved("198.51.100.22", big);
  assert.equal(b.v.estimate.credits, 131);
  const over = await b.g.go("POST", `/app/api/projects/${b.pid}/certifications`, { version: 1, confirmSpend: 131 });
  assert.deepEqual([over.status, over.body.error.code], [429, "guest_limit_reached"]);

  // Concurrent requests from one guest: exactly one gets through.
  const [r1, r2] = await Promise.all([1, 2].map(() => a.g.go("POST", `/app/api/projects/${a.pid}/certifications`, { version: 1, confirmSpend: 94 })));
  assert.deepEqual([r1.status, r2.status].sort(), [202, 429]);
  await h.ctx.jobs.idle();

  // The shared budget: 94 of 150 used; another guest's 94-credit run would exceed it.
  const c = await approved("198.51.100.23");
  const budget = await c.g.go("POST", `/app/api/projects/${c.pid}/certifications`, { version: 1, confirmSpend: 94 });
  assert.deepEqual([budget.status, budget.body.error.code], [429, "guest_limit_reached"]);
  assert.match(budget.body.error.message, /credit budget/);
  assert.equal((await c.g.go("GET", "/app/api/session")).body.guestRuns.creditsLeftToday, 150 - 94);
  // Even a single-test run (57) does not fit the 56 left; nothing runs.
  const one = await c.g.go("POST", `/app/api/projects/${c.pid}/certifications`, { version: 1, confirmSpend: 57, tests: ["home_test.md"] });
  assert.deepEqual([one.status, one.body.error.code], [429, "guest_limit_reached"]);
  assert.equal(h.state.kaneCalls.length, 1, "only the one run that fitted every limit reached Kane");
});

test("the one-page check: README claims, one Run click approves and starts Kane, verdict per claim with Kane's note", async () => {
  const h = await setup({ ai: false, env: { GREENLIGHT_GUEST_REAL_RUNS_PER_GUEST: "1" } });
  const g = browser(h, "203.0.113.77");
  await g.go("POST", "/app/api/guest/start", {});
  const base = { repository: "https://github.com/acme/shop", url: "https://shop.example.com/" };

  // Claims: from the pasted notes, or from the repository's README when nothing was pasted.
  const pasted = await g.go("POST", "/app/api/checks/claims", { ...base, notes: "# Shop\n- Visitors can add products to the cart\n- The cart shows a total\n```\nnpm i\n```" });
  assert.equal(pasted.status, 200, pasted.text);
  assert.deepEqual(pasted.body.claims, ["Visitors can add products to the cart", "The cart shows a total"]);
  assert.equal(pasted.body.source, "notes");
  assert.deepEqual([pasted.body.maxClaims, pasted.body.costs], [2, [57, 94]], "the visitor's 100-credit ceiling fits two claims");
  const fromReadme = await g.go("POST", "/app/api/checks/claims", base);
  assert.deepEqual([fromReadme.body.source, fromReadme.body.claims], ["readme", ["Add products to a cart and see the total."]]);

  // Run: the confirmation must cover the cost shown; too many claims are refused before anything is stored.
  const claims = pasted.body.claims;
  assert.equal((await g.go("POST", "/app/api/checks", { ...base, claims, confirm: true, confirmSpend: 50 })).body.error.code, "confirmation_required");
  assert.equal((await g.go("POST", "/app/api/checks", { ...base, claims: [...claims, "A third claim here"], confirm: true, confirmSpend: 200 })).status, 400);
  assert.equal((await g.go("POST", "/app/api/checks", { ...base, claims: ["See https://evil.example now"], confirm: true, confirmSpend: 57 })).status, 400);
  assert.equal((await g.go("GET", "/app/api/projects")).body.projects.length, 0, "refused runs store nothing");

  h.state.kane.set("claim-2_test.md", "failed");
  const started = await g.go("POST", "/app/api/checks", { ...base, notes: "README", claims, confirm: true, confirmSpend: 94 });
  assert.equal(started.status, 202, started.text);
  assert.equal(started.body.estimate, 94);
  assert.deepEqual(h.state.kaneCalls.length, 0, "Kane runs in the job, not in the request");
  await h.ctx.jobs.idle();
  assert.deepEqual(h.state.kaneCalls.at(-1), ["claim-1_test.md", "claim-2_test.md"]);

  const pid = started.body.projectId;
  const job = (await g.go("GET", `/app/api/jobs/${started.body.job.id}`)).body.job;
  assert.equal(job.status, "succeeded", JSON.stringify(job.error));
  const detail = (await g.go("GET", `/app/api/projects/${pid}`)).body;
  assert.equal(detail.versions[0].approval.identity.provider, "guest", "the Run click recorded the approval");
  const run = (await g.go("GET", `/app/api/projects/${pid}/records/${job.recordId}`)).body;
  assert.equal(run.record.status, "failed");
  assert.deepEqual(run.claims.map((c) => [c.text, c.status]), [["Visitors can add products to the cart", "passed"], ["The cart shows a total", "failed"]]);
  const bad = run.tests.find((t) => t.file === "claim-2_test.md");
  assert.match(bad.failureMessage, /Cart total/);
  assert.equal(bad.steps[0].kind, "check");

  // One free run per visitor.
  const again = await g.go("POST", "/app/api/checks", { ...base, claims: claims.slice(0, 1), confirm: true, confirmSpend: 57 });
  assert.deepEqual([again.status, again.body.error.code], [429, "guest_limit_reached"]);
});

test("without the journey migration, visitor runs still work, one per visitor, and the total credit cap stops everyone", async () => {
  const h = await setup({ ai: false, env: { GREENLIGHT_GUEST_REAL_RUNS_PER_GUEST: "1", GREENLIGHT_TOTAL_CREDIT_CAP: "200" } });
  // The production database before migration 6: none of its functions exist.
  for (const fn of ["greenlight_guest_account", "greenlight_reserve_guest_run", "greenlight_attach_guest_run", "greenlight_release_guest_run", "greenlight_guest_run_usage"]) {
    await h.fake.sql(`drop function greenlight_api.${fn}`);
  }
  const base = { repository: "https://github.com/acme/shop", url: "https://shop.example.com/", notes: "- Visitors can add products to the cart\n- The cart shows a total" };
  const claims = ["Visitors can add products to the cart", "The cart shows a total"];
  const visitor = async (ip) => {
    const g = browser(h, ip);
    assert.equal((await g.go("POST", "/app/api/guest/start", {})).status, 201);
    return g;
  };

  const a = await visitor("203.0.113.81");
  const found = await a.go("POST", "/app/api/checks/claims", base);
  assert.equal(found.status, 200, found.text);
  assert.deepEqual(found.body.budget, { cap: 200, left: 200 });
  const first = await a.go("POST", "/app/api/checks", { ...base, claims, confirm: true, confirmSpend: 94 });
  assert.equal(first.status, 202, first.text);
  await h.ctx.jobs.idle();
  assert.equal((await a.go("GET", `/app/api/jobs/${first.body.job.id}`)).body.job.status, "succeeded");
  const again = await a.go("POST", "/app/api/checks", { ...base, claims: claims.slice(0, 1), confirm: true, confirmSpend: 57 });
  assert.deepEqual([again.status, again.body.error.code], [429, "guest_limit_reached"], "one run per visitor, counted from their jobs");

  const b = await visitor("203.0.113.82");
  assert.equal((await b.go("POST", "/app/api/checks/claims", base)).body.budget.left, 106, "the larger of estimate and actual spend counts");
  const second = await b.go("POST", "/app/api/checks", { ...base, claims, confirm: true, confirmSpend: 94 });
  assert.equal(second.status, 202, second.text);
  await h.ctx.jobs.idle();

  const c = await visitor("203.0.113.83");
  const capped = await c.go("POST", "/app/api/checks", { ...base, claims: claims.slice(0, 1), confirm: true, confirmSpend: 57 });
  assert.deepEqual([capped.status, capped.body.error.code], [429, "credit_cap_reached"]);
  assert.match(capped.body.error.message, /only 12 of this server's 200-credit Kane budget is left/);
  assert.equal((await c.go("GET", "/app/api/projects")).body.projects.length, 0, "a capped run stores nothing");
  assert.equal(h.state.kaneCalls.length, 2, "Kane ran exactly twice");
});

test("Claude Code closes the loop: a token reads Kane's verdict and re-runs the approved claims after a fix, within limits", async () => {
  const h = await setup({ ai: false, env: { GREENLIGHT_GUEST_REAL_RUNS_PER_GUEST: "1", GREENLIGHT_GUEST_RECHECKS_PER_CHECK: "2" } });
  const g = browser(h, "203.0.113.91");
  await g.go("POST", "/app/api/guest/start", {});
  const base = { repository: "https://github.com/acme/shop", url: "https://shop.example.com/", notes: "" };
  const claims = ["Visitors can add products to the cart", "The cart shows a total"];
  h.state.kane.set("claim-2_test.md", "failed");
  const started = await g.go("POST", "/app/api/checks", { ...base, claims, confirm: true, confirmSpend: 94 });
  assert.equal(started.status, 202, started.text);
  await h.ctx.jobs.idle();
  const pid = started.body.projectId;

  // "Connect Claude Code": an agent token from the browser session.
  const t = await g.go("POST", "/app/api/tokens", { role: "agent", label: "Claude Code" });
  assert.equal(t.status, 201, t.text);
  const api = async (method, p) => {
    const r = await fetch(h.url + p, { method, headers: { authorization: `Bearer ${t.body.token}`, ...(method === "POST" ? { "content-type": "application/json" } : {}) }, body: method === "POST" ? "{}" : undefined });
    return { status: r.status, body: await r.json() };
  };

  const list = await api("GET", "/v1/checks");
  assert.deepEqual(list.body.checks.map((c) => c.id), [pid]);
  let check = (await api("GET", `/v1/checks/${pid}`)).body.check;
  assert.equal(check.status, "failed");
  assert.equal(check.repository, "https://github.com/acme/shop");
  assert.deepEqual(check.verdict.claims.map((c) => [c.text, c.status]), [[claims[0], "passed"], [claims[1], "failed"]]);
  assert.match(check.verdict.claims[1].kaneSaw, /Cart total/, "Kane's own note reaches the agent");
  assert.equal(check.resultUrl, `https://greenlight.example.com/app/check/${pid}`);

  // The agent pushed a fix: re-check the same approved claims; Kane now passes both.
  h.state.kane.set("claim-2_test.md", "passed");
  const re = await api("POST", `/v1/checks/${pid}/recheck`);
  assert.equal(re.status, 202, JSON.stringify(re.body));
  assert.equal(re.body.estimate, 94);
  await h.ctx.jobs.idle();
  check = (await api("GET", `/v1/checks/${pid}`)).body.check;
  assert.equal(check.status, "passed");
  assert.equal(h.state.kaneCalls.length, 2);

  // The agent can't approve or change claims, and re-checks are limited per check.
  assert.equal((await api("POST", `/v1/projects/${pid}/versions/1/approval`)).status, 403);
  assert.equal((await api("POST", `/v1/checks/${pid}/recheck`)).status, 202);
  await h.ctx.jobs.idle();
  const over = await api("POST", `/v1/checks/${pid}/recheck`);
  assert.deepEqual([over.status, over.body.error.code], [429, "guest_limit_reached"]);
  // Other accounts' checks are invisible to this token.
  assert.equal((await api("GET", `/v1/checks/prj_${"0".repeat(32)}`)).status, 404);
});
