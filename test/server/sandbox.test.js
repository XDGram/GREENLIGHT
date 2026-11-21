// Sandbox execution: Kane remote mode (HyperExecute), the Vercel Sandbox dispatcher, the
// SandboxJobRunner, the in-sandbox worker and the Vercel Function entry. Vercel Sandbox, Kane
// and Supabase are fakes; no network, no Kane run, no credits.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { buildTestrunArgs } from "../../src/kane/runner.js";
import { loadConfig, JobRunner, FileStore, SupabaseStore, createSupabaseClient, sha256Hex, SandboxJobRunner, createSandboxDispatcher, sandboxFiles, SANDBOX_APP_DIR, BOOTSTRAP } from "../../src/server/index.js";
import { createHandler } from "../../api/index.js";
import { createFakeSupabase } from "./fake-supabase.js";
import { fabricatedRun } from "../verify/helpers.js";
import { zipOf } from "../report/zip-helper.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PRELOAD = fileURLToPath(new URL("./fake-supabase-preload.mjs", import.meta.url));
const E2E = readFileSync(new URL("../fixtures/spec/e2e/greenlight.yaml", import.meta.url), "utf8");
const COMMIT = "dc6150b46a46a85efb4255113f0eddc5370621c8";
const EXEC_ID = "0a1b2c3d-0000-4000-8000-0000000000bb";
const KEY = `sb_secret_${"s".repeat(22)}_sandbox1`;
const KANE = { GREENLIGHT_KANE_USERNAME: "kane-user", GREENLIGHT_KANE_ACCESS_KEY: "kane-access-key-secret" };
const SANDBOX_ENV = { SUPABASE_URL: "https://fake-project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY, GREENLIGHT_EXECUTION: "sandbox", GREENLIGHT_KANE_REMOTE: "hyper", GREENLIGHT_PUBLIC_BASE_URL: "https://greenlight.example.com", ...KANE };
const temps = [];
const fakes = [];
after(async () => {
  for (const f of fakes) await f.close();
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

/** A fake @vercel/sandbox Sandbox class that records every call. */
function fakeSandbox({ failOn } = {}) {
  const calls = [];
  class Sandbox {
    static async create(params) {
      calls.push(["create", params]);
      if (failOn === "create") throw new Error("sandbox quota exceeded");
      return new Sandbox();
    }
    sandboxId = "sbx_test";
    async writeFiles(files) {
      calls.push(["writeFiles", files]);
    }
    async runCommand(params) {
      calls.push(["runCommand", params]);
      if (failOn === "run") throw new Error("command refused");
      return { cmdId: "cmd_test" };
    }
    async stop() {
      calls.push(["stop"]);
    }
    static async get(params) {
      calls.push(["get", params]);
      return new Sandbox();
    }
  }
  return { Sandbox, calls };
}

test("Kane remote mode: --remote hyper only via the option, still --local and --no-adaptive-heal, no --headless", () => {
  assert.deepEqual(buildTestrunArgs({ testFiles: ["a_test.md"], startUrl: "https://x.vercel.app", runName: "r1", remote: "hyper" }), [
    "testrun", "run", "a_test.md", "--agent", "--no-adaptive-heal", "--local", "--remote", "hyper", "--override-start-url", "https://x.vercel.app", "--name", "r1",
  ]);
  assert.throws(() => buildTestrunArgs({ testFiles: ["a_test.md"], remote: "lt" }), /only remote backend is hyper/);
  assert.throws(() => buildTestrunArgs({ testFiles: ["a_test.md"], extraArgs: ["--remote"] }), /forbidden/);
  assert.throws(() => buildTestrunArgs({ testFiles: ["a_test.md"], remote: "hyper", local: false }), /--local is mandatory/);
});

test("config: sandbox execution needs Supabase, remote hyper and Kane credentials; credentials never serialise", () => {
  const c = loadConfig(SANDBOX_ENV);
  assert.deepEqual([c.execution, c.kaneRemote], ["sandbox", "hyper"]);
  assert.deepEqual(c.kaneCredentials, { username: "kane-user", accessKey: "kane-access-key-secret" });
  assert.ok(!JSON.stringify(c).includes("kane-access-key-secret") && !JSON.stringify(c).includes(KEY));
  assert.throws(() => loadConfig({ ...SANDBOX_ENV, GREENLIGHT_KANE_REMOTE: "" }), /GREENLIGHT_KANE_REMOTE=hyper/);
  assert.throws(() => loadConfig({ ...SANDBOX_ENV, GREENLIGHT_KANE_ACCESS_KEY: "" }), /GREENLIGHT_KANE_USERNAME and GREENLIGHT_KANE_ACCESS_KEY/);
  assert.throws(() => loadConfig({ ...SANDBOX_ENV, GREENLIGHT_KANE_REMOTE: "lambdatest" }), /must be "hyper"/);
  assert.throws(() => loadConfig({ GREENLIGHT_DATA_DIR: os.tmpdir(), GREENLIGHT_EXECUTION: "sandbox", GREENLIGHT_KANE_REMOTE: "hyper", ...KANE }), /needs Supabase/);
  assert.throws(() => loadConfig({ ...SANDBOX_ENV, GREENLIGHT_EXECUTION: "lambda" }), /"local" or "sandbox"/);
  for (const bad of ["", "not a url", "http://greenlight.example.com", "https://localhost", "https://127.0.0.1", "https://10.0.0.5", "https://u:p@greenlight.example.com", "https://greenlight.example.com/?x=1", "https://greenlight.example.com/#f"]) {
    assert.throws(() => loadConfig({ ...SANDBOX_ENV, GREENLIGHT_PUBLIC_BASE_URL: bad }), /GREENLIGHT_PUBLIC_BASE_URL/, bad);
  }
  assert.equal(loadConfig({ ...SANDBOX_ENV, GREENLIGHT_PUBLIC_BASE_URL: "https://greenlight.vercel.app" }).publicBaseUrl, "https://greenlight.vercel.app");
  assert.equal(loadConfig({ GREENLIGHT_DATA_DIR: os.tmpdir() }).execution, "local");
});

test("a remote certification runs the unchanged pipeline and stores the pack Kane copies back (execution-<id>.evidence)", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "gl-sbx-remote-"));
  temps.push(dataDir);
  const config = loadConfig({ GREENLIGHT_DATA_DIR: dataDir, GREENLIGHT_KANE_REMOTE: "hyper", GREENLIGHT_PUBLIC_BASE_URL: "https://greenlight.example.com" });
  const store = new FileStore(dataDir);
  const seen = [];
  const balances = [11076.5779, 10999.9376];
  const deps = {
    runKane: async (opts) => {
      seen.push(opts.args);
      const dir = path.join(opts.cwd, ".testmuai", "evidence");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, `execution-${EXEC_ID}.evidence`), zipOf({ "run.yaml": "status: finalized\n" }));
      const run = fabricatedRun({ members: [["cart-add-two_test.md", "passed"], ["newsletter-subscribe_test.md", "passed"]].map(([file, status], i) => ({ file, tags: [`clm-00${i + 1}`], status, mode: "authored" })) });
      run.stream.done.executionId = EXEC_ID;
      run.stream.summary.executionId = EXEC_ID;
      run.stream.summary.evidenceId = EXEC_ID;
      return { ...run, stdout: "{}\n", stderr: "", aborted: false };
    },
    readBalance: async () => ({ ok: true, balance: balances.length > 1 ? balances.shift() : balances[0] }),
    validator: async () => ({ exitCode: 0, stdout: '{"valid":true,"status":"finalized","diagnostics":[]}', stderr: "" }),
    verifyLiveDeployment: async (o) => ({ state: "ready", reasons: [], safeToRunKane: true, url: o.url, deployedCommit: o.expectedCommit, expectedCommit: o.expectedCommit, environment: "preview" }),
    now: () => new Date(),
  };
  const p = await store.createProject({ name: "Shop", url: "https://gl-test.vercel.app/", account: "acme", createdBy: "dev", now: new Date() });
  const { projectFromText } = await import("../../src/spec/generate.js");
  const { buildApproval, SCHEMAS } = await import("../../src/server/models.js");
  const d = projectFromText(E2E);
  const v = await store.addVersion(p.id, { schema: SCHEMAS.testVersion, projectId: p.id, approvedTestHash: d.hash, specText: E2E, specFileSha256: d.specFileSha256, project: { name: d.spec.project.name, url: d.spec.project.url }, claims: d.spec.claims.map((c) => ({ id: c.id, text: c.text })), tests: d.rendered.map((r) => ({ file: r.file, claims: r.claims, sha256: r.sha256, content: r.content })), submittedBy: "claude", submittedAt: new Date().toISOString() });
  await store.putApproval(p.id, v.version, buildApproval({ projectId: p.id, version: v, approvedBy: "dev", now: new Date() }));
  const runner = new JobRunner({ store, config, deps });
  const job = await runner.submit({ projectId: p.id, version: 1, request: { commit: COMMIT, confirmSpend: 100 }, requestedBy: "dev" });
  await runner.idle();
  const done = await store.getJob(job.id);
  assert.deepEqual([done.status, done.outcome], ["succeeded", "certified"], JSON.stringify(done.error));
  assert.ok(seen[0].includes("--remote") && seen[0][seen[0].indexOf("--remote") + 1] === "hyper" && seen[0].includes("--local") && !seen[0].includes("--headless"));
  const rec = await store.getRecord(done.recordId);
  assert.equal(rec.evidence.status, "stored");
});

test("dispatcher: one sandbox per job, Greenlight's files and the bootstrap written, secrets only in the detached command's env", async () => {
  const config = loadConfig(SANDBOX_ENV);
  const fake = fakeSandbox();
  const env = { ...SANDBOX_ENV, GREENLIGHT_KANE_TIMEOUT_MINUTES: "20", GREENLIGHT_PUBLIC_BASE_URL: "https://gl.example.com", UNRELATED_SECRET: "nope" };
  const r = await createSandboxDispatcher({ config, env, Sandbox: fake.Sandbox }).dispatch({ id: `job_${"a".repeat(32)}` });
  assert.deepEqual(r, { sandboxId: "sbx_test", cmdId: "cmd_test" });
  const [[, created], [, files], [, cmd]] = fake.calls;
  assert.equal(created.runtime, "node22");
  assert.deepEqual([created.timeout, created.name, created.persistent], [45 * 60_000, `greenlight-job-${"a".repeat(32)}`, false]);
  assert.ok(!JSON.stringify(created).includes(KEY) && !JSON.stringify(created).includes("kane-access-key-secret"), "no secret in the sandbox's saved settings");
  const paths = files.map((f) => f.path);
  for (const p of ["package.json", "run-job.sh", "bin/greenlight-worker.js", "src/server/jobs.js", "src/server/certify.js", "src/kane/runner.js", "src/server/supabase/store.js"]) assert.ok(paths.includes(`${SANDBOX_APP_DIR}/${p}`), p);
  assert.ok(!files.some((f) => f.content.toString().includes(KEY) || f.content.toString().includes("kane-access-key-secret")), "no secret in any file");
  assert.equal(files.find((f) => f.path.endsWith("run-job.sh")).mode, 0o755);
  assert.equal(JSON.parse(files.find((f) => f.path.endsWith("package.json")).content).type, "module");
  assert.deepEqual([cmd.cmd, cmd.args, cmd.cwd, cmd.detached], ["bash", [`${SANDBOX_APP_DIR}/run-job.sh`, `job_${"a".repeat(32)}`], SANDBOX_APP_DIR, true]);
  assert.equal(cmd.env.SUPABASE_SERVICE_ROLE_KEY, KEY);
  assert.deepEqual([cmd.env.GREENLIGHT_KANE_USERNAME, cmd.env.GREENLIGHT_KANE_ACCESS_KEY, cmd.env.GREENLIGHT_KANE_REMOTE], ["kane-user", "kane-access-key-secret", "hyper"]);
  assert.equal(cmd.env.GREENLIGHT_KANE_TIMEOUT_MINUTES, "20");
  assert.equal(cmd.env.UNRELATED_SECRET, undefined, "only the listed settings are forwarded");
  assert.equal(cmd.env.GREENLIGHT_EXECUTION, undefined, "the worker runs the job itself");
  // The bootstrap: pinned Kane, the remote plugin, login, credentials dropped before the job runs.
  assert.match(BOOTSTRAP, /@testmuai\/kane-cli@0\.10\.6/);
  assert.match(BOOTSTRAP, /plugin install remote-execution/);
  assert.match(BOOTSTRAP, /login --username "\$GREENLIGHT_KANE_USERNAME" --access-key "\$GREENLIGHT_KANE_ACCESS_KEY"/);
  assert.ok(BOOTSTRAP.indexOf("unset GREENLIGHT_KANE_USERNAME LOGIN") < BOOTSTRAP.indexOf('exec node bin/greenlight-worker.js "$JOB"'));
  assert.match(BOOTSTRAP, /exec node bin\/greenlight-worker.js "\$JOB"\n`?$/);
  assert.doesNotMatch(BOOTSTRAP, /poweroff|VERCEL_/, "no self power-off, no Vercel credential in the sandbox");
  assert.equal(cmd.env.GREENLIGHT_SANDBOX_FINISHED_URL, "https://greenlight.example.com/v1/sandbox/finished");
  assert.ok(!Object.keys(cmd.env).some((k) => k.startsWith("VERCEL")), "no Vercel credential is forwarded");
  assert.match(BOOTSTRAP, /trap 'fail setup' ERR/);
  // A failure after create stops the sandbox.
  const bad = fakeSandbox({ failOn: "run" });
  await assert.rejects(createSandboxDispatcher({ config, env, Sandbox: bad.Sandbox }).dispatch({ id: `job_${"b".repeat(32)}` }), /command refused/);
  assert.deepEqual(bad.calls.at(-1), ["stop"]);
  // The files really are this checkout's.
  assert.equal((await sandboxFiles(ROOT)).find((f) => f.path.endsWith("src/server/sandbox.js")).content.toString(), readFileSync(path.join(ROOT, "src/server/sandbox.js"), "utf8"));
});

async function supabaseApp({ Sandbox, extraEnv = {} } = {}) {
  const fake = await createFakeSupabase({ serviceRoleKey: KEY });
  fakes.push(fake);
  const admin = createSupabaseClient({ url: fake.url, serviceRoleKey: KEY, fetchImpl: fake.fetch });
  await admin.rpc("greenlight_ensure_account", { p_slug: "acme" });
  await admin.rpc("greenlight_create_user", { p_account: "acme", p_name: "dev", p_role: "owner" });
  await admin.rpc("greenlight_add_token", { p_account: "acme", p_user: "dev", p_token_sha256: sha256Hex("owner-token-sandbox-0123456789"), p_label: "t" });
  const handler = createHandler({ env: { ...SANDBOX_ENV, ...extraEnv }, Sandbox, fetchImpl: fake.fetch });
  const server = http.createServer(handler);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { authorization: "Bearer owner-token-sandbox-0123456789", ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json() };
  };
  return { fake, admin, call, close: () => server.close() };
}

async function approvedProject(call) {
  const p = await call("POST", "/v1/projects", { name: "Shop", url: "https://gl-test.vercel.app/" });
  const v = await call("POST", `/v1/projects/${p.body.id}/versions`, { specText: E2E });
  await call("POST", `/v1/projects/${p.body.id}/versions/1/approval`, { confirmHash: v.body.approvedTestHash });
  return p.body.id;
}

test("Vercel Function: the unchanged API; a certification is persisted and handed to one sandbox before the response", async () => {
  const sbx = fakeSandbox();
  const h = await supabaseApp({ Sandbox: sbx.Sandbox });
  const ready = await h.call("GET", "/v1/ready");
  assert.deepEqual([ready.status, ready.body.database, ready.body.storage], [200, "ok", "ok"]);
  const projectId = await approvedProject(h.call);
  const c = await h.call("POST", `/v1/projects/${projectId}/certifications`, { version: 1, commit: COMMIT, confirmSpend: 100 });
  assert.equal(c.status, 202, JSON.stringify(c.body));
  assert.equal(c.body.status, "queued", "the sandbox's worker runs it");
  assert.deepEqual(sbx.calls.map((x) => x[0]), ["create", "writeFiles", "runCommand"]);
  assert.equal(sbx.calls[2][1].args[1], c.body.id);
  // One active job per project still holds (database index), across function instances.
  const again = await h.call("POST", `/v1/projects/${projectId}/certifications`, { version: 1, commit: COMMIT, confirmSpend: 100 });
  assert.equal(again.body.error.code, "job_limit_reached");
  h.close();
});

test("Vercel Function: a sandbox that cannot start fails the job (nothing ran); a misconfigured deployment answers 503", async () => {
  const h = await supabaseApp({ Sandbox: fakeSandbox({ failOn: "create" }).Sandbox });
  const projectId = await approvedProject(h.call);
  const c = await h.call("POST", `/v1/projects/${projectId}/certifications`, { version: 1, commit: COMMIT, confirmSpend: 100 });
  assert.deepEqual([c.status, c.body.status, c.body.error.code], [202, "failed", "sandbox_dispatch_failed"]);
  h.close();
  const bad = http.createServer(createHandler({ env: { ...SANDBOX_ENV, GREENLIGHT_KANE_ACCESS_KEY: "" } }));
  await new Promise((r) => bad.listen(0, "127.0.0.1", r));
  const res = await fetch(`http://127.0.0.1:${bad.address().port}/v1/health`);
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error.code, "server_not_configured");
  bad.close();
});

test("SandboxJobRunner recovery settles only jobs older than a sandbox's lifetime", async () => {
  const fake = await createFakeSupabase({ serviceRoleKey: KEY });
  fakes.push(fake);
  const config = loadConfig(SANDBOX_ENV);
  const store = new SupabaseStore({ url: fake.url, serviceRoleKey: KEY, fetchImpl: fake.fetch });
  await store.ensureAccount("acme");
  const mk = async (id, createdAt) => {
    const p = await store.createProject({ name: id, url: "https://a.example.com/", account: "acme", createdBy: "dev", now: new Date(createdAt) });
    const { projectFromText } = await import("../../src/spec/generate.js");
    const d = projectFromText(E2E);
    await store.addVersion(p.id, { schema: "greenlight.test-version/v1", projectId: p.id, approvedTestHash: d.hash, specText: E2E, specFileSha256: d.specFileSha256, project: { name: "x", url: "https://a.example.com/" }, claims: [], tests: [], submittedBy: "dev", submittedAt: createdAt });
    const j = { schema: "greenlight.job/v1", id, kind: "certification", projectId: p.id, version: 1, status: "queued", request: {}, requestedBy: "dev", createdAt, startedAt: null, finishedAt: null, recordId: null, outcome: null, error: null };
    await store.putJob(j);
    await store.putJob({ ...j, status: "running", startedAt: createdAt });
  };
  const now = Date.now();
  await mk(`job_${"1".repeat(32)}`, new Date(now - 5 * 60_000).toISOString());
  await mk(`job_${"2".repeat(32)}`, new Date(now - 3 * 60 * 60_000).toISOString());
  const runner = new SandboxJobRunner({ store, config, deps: { now: () => new Date(now) }, dispatcher: { dispatch: async () => {} } });
  await runner.recover();
  assert.equal((await store.getJob(`job_${"1".repeat(32)}`)).status, "running", "a recent job may still be running in its sandbox");
  const old = await store.getJob(`job_${"2".repeat(32)}`);
  assert.deepEqual([old.status, old.error.code], ["failed", "interrupted"]);
});

function worker(args, env) {
  const child = spawn(process.execPath, ["--import", PRELOAD, "bin/greenlight-worker.js", ...args], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: os.tmpdir(), SUPABASE_URL: "https://fake-project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY, ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  child.stderr.on("data", (c) => (log += c));
  return new Promise((resolve) => child.on("exit", (code) => resolve({ code, log })));
}

test("worker: refuses bad input, and reports a setup failure without running Kane", async () => {
  assert.equal((await worker(["not-a-job"], {})).code, 2);
  assert.equal((await worker([`job_${"c".repeat(32)}`], { SUPABASE_SERVICE_ROLE_KEY: "" })).code, 2);
  const noKane = await worker([`job_${"c".repeat(32)}`], { GREENLIGHT_KANE_REMOTE: "hyper", GREENLIGHT_KANE_BIN: path.join(os.tmpdir(), "no-such-kane") });
  assert.equal(noKane.code, 1);
  assert.match(noKane.log, /"kane":"kane_not_installed"/);
  assert.match(noKane.log, /"chrome":"remote"/, "no local Chrome is required in remote mode");
  const failed = await worker(["--fail", `job_${"c".repeat(32)}`, "kane_login"], {});
  assert.equal(failed.code, 1);
  assert.ok(!(noKane.log + failed.log).includes(KEY));
});

test("vercel.json routes /v1 to the function, bundles the files the sandbox needs, and serves no repository files", async () => {
  const v = JSON.parse(readFileSync(path.join(ROOT, "vercel.json"), "utf8"));
  assert.equal(v.functions["api/index.js"].includeFiles, "{src,bin,node_modules/@sparticuz/chromium/bin}/**", "the serverless Chromium binary (application reading) ships with the function");
  assert.ok(v.functions["api/index.js"].maxDuration <= 300);
  const toFunction = v.rewrites.filter((r) => r.destination === "/api");
  assert.deepEqual(toFunction, [{ source: "/v1/:path*", destination: "/api" }, { source: "/approve", destination: "/api" }, { source: "/approve/:path*", destination: "/api" }, { source: "/api/auth/callback", destination: "/api" }, { source: "/api/auth/google/:path*", destination: "/api" }, { source: "/mcp", destination: "/api" }, { source: "/app/api/:path*", destination: "/api" }]);
  // Every other rewrite only serves the web app's own entry page (client-side routes under /app).
  assert.deepEqual(v.rewrites.filter((r) => r.destination !== "/api"), [{ source: "/app", destination: "/app/index.html" }, { source: "/app/:path((?!api/|assets/|downloads/|favicon\\.svg$).*)", destination: "/app/index.html" }]);
  // Static files come only from public/. In the repository it holds nothing but .gitkeep; the
  // build writes the web app (from web/ only) to public/app, which is never committed. No source,
  // docs or config of the repository is ever served.
  assert.equal(v.outputDirectory, "public");
  const { readdirSync } = await import("node:fs");
  assert.deepEqual(readdirSync(path.join(ROOT, "public")).filter((f) => f !== "app"), [".gitkeep"]);
  assert.equal(readFileSync(path.join(ROOT, "public/.gitkeep"), "utf8"), "");
  assert.match(readFileSync(path.join(ROOT, ".gitignore"), "utf8"), /^public\/app\/$/m, "build output is not committed");
  const vite = readFileSync(path.join(ROOT, "web/vite.config.ts"), "utf8");
  assert.match(vite, /outDir: fileURLToPath\(new URL\("\.\.\/public\/app", import\.meta\.url\)\)/);
  assert.match(vite, /root: fileURLToPath\(new URL\("\.", import\.meta\.url\)\)/, "the build reads only web/");
  assert.match(vite, /assetsInlineLimit: 0,/, "no data: URIs, which the /app CSP would block");
  assert.equal(v.buildCommand, "npm run build");
  assert.equal(v.cleanUrls ?? false, false);
  assert.equal(v.routes, undefined, "no legacy routes that could expose files");
  // The web app is framed by nobody and loads nothing from other origins.
  const appHeaders = Object.fromEntries(v.headers.find((h) => h.source === "/app/:path*").headers.map((h) => [h.key, h.value]));
  assert.match(appHeaders["Content-Security-Policy"], /default-src 'self'.*frame-ancestors 'none'/);
  assert.equal(appHeaders["X-Frame-Options"], "DENY");
  const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.dependencies["@vercel/sandbox"], "3.9.1", "exact version");
  assert.equal(pkg.scripts.build, "vite build --config web/vite.config.ts && node scripts/copy-downloads.js");
  assert.ok(Object.values(pkg.devDependencies).every((ver) => /^\d+\.\d+\.\d+$/.test(ver)), "exact versions for the web app's build tools");
});

test("Hobby: sandbox mode defaults to 45 / 25 / 300 and refuses settings that cannot fit the plan", () => {
  const c = loadConfig(SANDBOX_ENV);
  assert.deepEqual([c.sandboxTimeoutMs, c.kaneTimeoutMs, c.deployTimeoutMs], [45 * 60_000, 25 * 60_000, 300_000]);
  // setup/upload 10 + deployment 5 + Kane 25 = 40 minutes <= 45.
  assert.throws(() => loadConfig({ ...SANDBOX_ENV, GREENLIGHT_SANDBOX_TIMEOUT_MINUTES: "60" }), /exceeds the plan's sandbox limit \(45 min/);
  assert.throws(() => loadConfig({ ...SANDBOX_ENV, GREENLIGHT_KANE_TIMEOUT_MINUTES: "31" }), /can take 46 min/);
  assert.equal(loadConfig({ ...SANDBOX_ENV, GREENLIGHT_SANDBOX_MAX_MINUTES: "1440", GREENLIGHT_SANDBOX_TIMEOUT_MINUTES: "60", GREENLIGHT_KANE_TIMEOUT_MINUTES: "30" }).sandboxTimeoutMs, 60 * 60_000);
  const local = loadConfig({ GREENLIGHT_DATA_DIR: os.tmpdir() });
  assert.deepEqual([local.kaneTimeoutMs, local.deployTimeoutMs, local.sandboxTimeoutMs, local.kaneRemote], [30 * 60_000, 600_000, null, null], "local execution unchanged");
});

test("a finished job's sandbox is stopped when the API reads the result; running jobs' sandboxes are left alone", async () => {
  const sbx = fakeSandbox();
  const h = await supabaseApp({ Sandbox: sbx.Sandbox });
  const projectId = await approvedProject(h.call);
  const c = await h.call("POST", `/v1/projects/${projectId}/certifications`, { version: 1, commit: COMMIT, confirmSpend: 100 });
  await h.call("GET", `/v1/jobs/${c.body.id}`);
  assert.ok(!sbx.calls.some((x) => x[0] === "get"), "a queued job's sandbox keeps running");
  // The worker settles the job (as it would in the sandbox).
  const job = await h.admin.rpc("greenlight_get_job", { p_id: c.body.id });
  await h.admin.rpc("greenlight_put_job", { p_doc: { ...job, status: "failed", finishedAt: new Date().toISOString(), error: { code: "sandbox_setup_failed", message: "x", action: "y" } } });
  const done = await h.call("GET", `/v1/jobs/${c.body.id}`);
  assert.equal(done.body.status, "failed");
  assert.deepEqual(sbx.calls.filter((x) => x[0] === "get" || x[0] === "stop").slice(-2), [["get", { name: `greenlight-${c.body.id.replace("_", "-")}`, resume: false }], ["stop"]]);
  await h.call("GET", `/v1/jobs/${c.body.id}`);
  assert.equal(sbx.calls.filter((x) => x[0] === "get").length, 1, "stopped once");
  h.close();
});

test("the sandbox's signed 'job settled' report stops its sandbox; forged, early or unknown reports do not", async () => {
  const { finishedSignature } = await import("../../src/server/index.js");
  const sbx = fakeSandbox();
  const h = await supabaseApp({ Sandbox: sbx.Sandbox });
  const projectId = await approvedProject(h.call);
  const c = await h.call("POST", `/v1/projects/${projectId}/certifications`, { version: 1, commit: COMMIT, confirmSpend: 100 });
  const report = (jobId, signature) => h.call("POST", "/v1/sandbox/finished", { jobId, signature });
  const stops = () => sbx.calls.filter((x) => x[0] === "stop").length;
  assert.equal((await report(c.body.id, "0".repeat(64))).status, 401, "forged signature");
  assert.equal((await report(c.body.id, finishedSignature(KEY, c.body.id))).status, 409, "the job is not finished yet");
  // A signature is bound to one job: another project's (or any other) job id cannot reuse it.
  const otherProject = await approvedProject(h.call);
  const other = await h.call("POST", `/v1/projects/${otherProject}/certifications`, { version: 1, commit: COMMIT, confirmSpend: 100 });
  const o = await h.admin.rpc("greenlight_get_job", { p_id: other.body.id });
  await h.admin.rpc("greenlight_put_job", { p_doc: { ...o, status: "failed", finishedAt: new Date().toISOString(), error: { code: "sandbox_setup_failed", message: "x", action: "y" } } });
  assert.equal((await report(other.body.id, finishedSignature(KEY, c.body.id))).status, 401, "job A's signature cannot stop job B's sandbox");
  assert.equal((await report(other.body.id, finishedSignature("another-key-entirely-0123456789", other.body.id))).status, 401, "a signature needs the server key");
  assert.equal((await report(`job_${"9".repeat(32)}`, finishedSignature(KEY, `job_${"9".repeat(32)}`))).status, 404);
  assert.equal(stops(), 0);
  const job = await h.admin.rpc("greenlight_get_job", { p_id: c.body.id });
  await h.admin.rpc("greenlight_put_job", { p_doc: { ...job, status: "failed", finishedAt: new Date().toISOString(), error: { code: "sandbox_setup_failed", message: "x", action: "y" } } });
  const ok = await report(c.body.id, finishedSignature(KEY, c.body.id));
  assert.deepEqual([ok.status, ok.body], [200, { jobId: c.body.id, stopped: true }]);
  assert.deepEqual(sbx.calls.filter((x) => x[0] === "get").at(-1), ["get", { name: `greenlight-${c.body.id.replace("_", "-")}`, resume: false }]);
  assert.equal(stops(), 1);
  h.close();
});

test("local execution has no sandbox report endpoint", async () => {
  const { createApp, FileStore: FS } = await import("../../src/server/index.js");
  const dir = await mkdtemp(path.join(os.tmpdir(), "gl-sbx-local-"));
  temps.push(dir);
  const config = loadConfig({ GREENLIGHT_DATA_DIR: dir });
  const store = new FS(dir);
  const server = http.createServer(createApp({ config, store, jobs: new JobRunner({ store, config, deps: { now: () => new Date() } }) }));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const res = await fetch(`http://127.0.0.1:${server.address().port}/v1/sandbox/finished`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: `job_${"1".repeat(32)}`, signature: "0".repeat(64) }) });
  assert.equal(res.status, 404);
  server.close();
});
