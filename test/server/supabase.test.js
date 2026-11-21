// Supabase persistence: the real migrations (PGlite), a fake PostgREST/Storage
// layer, and the real SupabaseStore, HTTP API and certification code on top.
// Kane, balances and the deployment check are fakes. No network, Kane or credits.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { loadConfig, createServerContext, startServer, sha256Hex, SupabaseStore, createSupabaseClient, publicHash } from "../../src/server/index.js";
import { GreenlightError } from "../../src/cli/errors.js";
import { fabricatedRun } from "../verify/helpers.js";
import { zipOf } from "../report/zip-helper.js";
import { createFakeSupabase } from "./fake-supabase.js";

const E2E = readFileSync(new URL("../fixtures/spec/e2e/greenlight.yaml", import.meta.url), "utf8");
const COMMIT = "dc6150b46a46a85efb4255113f0eddc5370621c8";
const EXEC_ID = "0a1b2c3d-0000-4000-8000-00000000000a";
const T = { owner: "owner-token-supabase-0123456789", agent: "agent-token-supabase-0123456789", other: "other-token-supabase-0123456789" };
const sha = (b) => createHash("sha256").update(b).digest("hex");

const temps = [];
const servers = [];
const fakes = [];
after(async () => {
  for (const s of servers) s.close();
  for (const f of fakes) await f.close();
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

function fakeKane(calls, statuses = { "cart-add-two_test.md": "passed", "newsletter-subscribe_test.md": "passed" }) {
  return async (opts) => {
    calls.push({ name: "runKane", opts });
    const store = path.join(opts.cwd, ".testmuai", "evidence");
    await mkdir(store, { recursive: true });
    await writeFile(path.join(store, `${EXEC_ID}.evidence`), zipOf({ "run.yaml": "status: finalized\n", "tests/x/result.yaml": "status: passed\n" }));
    const run = fabricatedRun({ members: Object.entries(statuses).map(([file, status], i) => ({ file, tags: [`clm-00${i + 1}`], status, mode: "authored" })) });
    run.stream.done.executionId = EXEC_ID;
    run.stream.summary.executionId = EXEC_ID;
    run.stream.summary.evidenceId = EXEC_ID;
    return { ...run, stdout: "{}\n", stderr: "", aborted: false };
  };
}

async function newFake() {
  const fake = await createFakeSupabase();
  fakes.push(fake);
  // Accounts, users and tokens exist only in the database (no GREENLIGHT_API_TOKENS).
  const admin = createSupabaseClient({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: fake.fetch });
  for (const acct of ["acme", "other"]) await admin.rpc("greenlight_ensure_account", { p_slug: acct });
  for (const [acct, name, role, tok] of [["acme", "dev", "owner", T.owner], ["acme", "claude", "agent", T.agent], ["other", "eve", "owner", T.other]]) {
    await admin.rpc("greenlight_create_user", { p_account: acct, p_name: name, p_role: role });
    await admin.rpc("greenlight_add_token", { p_account: acct, p_user: name, p_token_sha256: sha256Hex(tok), p_label: "test" });
  }
  return { fake, admin };
}

/** One server instance on a (shared) fake Supabase. Call again with the same fake to "restart". */
async function instance(fake, { statuses, balances = [11076.5779, 10999.9376] } = {}) {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "gl-supa-work-"));
  temps.push(workDir);
  const config = loadConfig({ SUPABASE_URL: fake.url, SUPABASE_SERVICE_ROLE_KEY: fake.serviceRoleKey, GREENLIGHT_WORK_DIR: workDir, GREENLIGHT_PORT: "0", GREENLIGHT_PUBLIC_BASE_URL: "https://greenlight.example.com" });
  const calls = [];
  const b = [...balances];
  const deps = {
    runKane: fakeKane(calls, statuses),
    readBalance: async () => ({ ok: true, balance: b.length > 1 ? b.shift() : b[0] }),
    validator: async () => ({ exitCode: 0, stdout: '{"valid":true,"status":"finalized","diagnostics":[]}', stderr: "" }),
    verifyLiveDeployment: async (o) => ({ state: "ready", reasons: [], safeToRunKane: true, url: o.url, deployedCommit: o.expectedCommit, expectedCommit: o.expectedCommit, environment: "preview" }),
    now: () => new Date(),
  };
  const store = new SupabaseStore({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: fake.fetch, workRoot: workDir });
  const ctx = await createServerContext({ config, deps, store });
  const server = await startServer({ config, ...ctx, now: deps.now });
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { token = T.owner, body } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return { config, ctx, calls, call, server, workDir, store };
}

async function approvedProject(h) {
  const p = await h.call("POST", "/v1/projects", { token: T.agent, body: { name: "Shop", url: "https://gl-test.vercel.app/" } });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const v = await h.call("POST", `/v1/projects/${p.body.id}/versions`, { token: T.agent, body: { specText: E2E } });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  const a = await h.call("POST", `/v1/projects/${p.body.id}/versions/1/approval`, { body: { confirmHash: v.body.approvedTestHash } });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  return { projectId: p.body.id, hash: v.body.approvedTestHash };
}

async function certify(h, projectId, body = {}) {
  const r = await h.call("POST", `/v1/projects/${projectId}/certifications`, { body: { version: 1, commit: COMMIT, confirmSpend: 100, ...body } });
  if (r.status !== 202) return { submit: r };
  await h.ctx.jobs.idle();
  return { submit: r, job: (await h.call("GET", `/v1/jobs/${r.body.id}`)).body };
}

// ---------------------------------------------------------------- schema, privileges, RLS

test("migrations: private schema, RLS on every table, anon/authenticated locked out, service_role only via RPC", async () => {
  const { fake } = await newFake();
  assert.equal(fake.applied.length, 6);
  const tables = await fake.sql("select c.relname, c.relrowsecurity from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'greenlight' and c.relkind = 'r' order by 1");
  assert.deepEqual(tables.map((t) => t.relname), ["accounts", "admin_events", "api_tokens", "approvals", "certification_records", "fix_items", "guest_projects", "guest_run_reservations", "guest_runs", "guest_sessions", "jobs", "project_details", "projects", "record_claims", "record_tests", "runs", "settings", "test_versions", "users", "web_identities"]);
  assert.ok(tables.every((t) => t.relrowsecurity), "RLS enabled everywhere");
  // All 54 RPC functions (20 core + 12 guest demo + 12 web platform + 10 journey) live in greenlight_api; nothing Greenlight owns is in public.
  const rpcs = await fake.sql("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'greenlight_api' order by 1");
  assert.equal(rpcs.length, 54);
  assert.ok(rpcs.every((r) => r.proname.startsWith("greenlight_")));
  assert.deepEqual(await fake.sql("select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'greenlight%'"), []);
  assert.deepEqual(await fake.sql("select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'greenlight%'"), []);
  const fnPriv = "select p.oid::regprocedure::text as sig, has_function_privilege($1, p.oid, 'execute') as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('greenlight_api', 'greenlight')";
  for (const role of ["anon", "authenticated", "public"]) {
    if (role !== "public") {
      for (const schema of ["greenlight", "greenlight_api"]) {
        assert.deepEqual(await fake.sql("select has_schema_privilege($1, $2, 'usage') as u", [role, schema]), [{ u: false }], `${role} ${schema}`);
      }
      const fns = await fake.sql(fnPriv, [role]);
      assert.ok(fns.length >= 22, "20 RPCs + 2 trigger functions");
      assert.deepEqual(fns.filter((f) => f.x), [], `${role} can execute no Greenlight function`);
      await assert.rejects(fake.sql("select * from greenlight.projects", [], { role }), /permission denied/);
      await assert.rejects(fake.sql("select greenlight_api.greenlight_list_projects('acme')", [], { role }), /permission denied/);
      await assert.rejects(fake.sql("select * from greenlight.guest_runs", [], { role }), /permission denied/);
      await assert.rejects(fake.sql("select greenlight_api.greenlight_guest_runs_today()", [], { role }), /permission denied/);
    }
  }
  const svc = await fake.sql("select bool_and(has_function_privilege('service_role', p.oid, 'execute')) as ok, bool_and(has_schema_privilege('service_role', 'greenlight_api', 'usage')) as usage from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'greenlight_api'");
  assert.deepEqual(svc, [{ ok: true, usage: true }]);
  // Trigger functions are not callable by anyone but their owner.
  assert.deepEqual(await fake.sql("select bool_or(has_function_privilege('service_role', p.oid, 'execute')) as x from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'greenlight'"), [{ x: false }]);
  assert.deepEqual(await fake.sql("select id, public from storage.buckets"), [{ id: "greenlight-evidence", public: false }]);
});

test("the anon key (what a browser holds) gets nothing; the service key is never echoed in errors", async () => {
  const { fake } = await newFake();
  const anon = createSupabaseClient({ url: fake.url, serviceRoleKey: fake.anonKey, fetchImpl: fake.fetch });
  await assert.rejects(anon.rpc("greenlight_list_projects", { p_account: "acme" }), (e) => e instanceof GreenlightError && e.code === "internal_error");
  const leaky = createSupabaseClient({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: async () => { throw new Error(`connect failed with key ${fake.serviceRoleKey}`); } });
  await assert.rejects(leaky.rpc("greenlight_list_projects", { p_account: "acme" }), (e) => !e.message.includes(fake.serviceRoleKey) && e.message.includes("REDACTED"));
  assert.throws(() => createSupabaseClient({ url: "http://evil.example.com", serviceRoleKey: fake.serviceRoleKey }), /https/);
  assert.throws(() => createSupabaseClient({ url: fake.url, serviceRoleKey: "" }), /SERVICE_ROLE_KEY/);
});

// ---------------------------------------------------------------- end to end on Supabase

test("certification on Supabase: records, run history, claims and tests in tables; evidence in the private bucket, hash-verified", async () => {
  const { fake } = await newFake();
  const h = await instance(fake);
  const { projectId, hash } = await approvedProject(h);
  const { job } = await certify(h, projectId);
  assert.deepEqual([job.status, job.outcome], ["succeeded", "certified"], JSON.stringify(job.error));

  const [rec] = await fake.sql("select id, status, certified, approved_test_hash, deployed_commit, run_id, job_id from greenlight.certification_records");
  assert.deepEqual([rec.status, rec.certified, rec.approved_test_hash, rec.deployed_commit, rec.job_id], ["passed", true, hash, COMMIT, job.id]);
  assert.deepEqual(await fake.sql("select claim_id, status from greenlight.record_claims order by claim_id"), [{ claim_id: "CLM-001", status: "passed" }, { claim_id: "CLM-002", status: "passed" }]);
  assert.equal((await fake.sql("select count(*)::int as n from greenlight.record_tests"))[0].n, 2);
  const [run] = await fake.sql("select run_kind, evidence_status, evidence_sha256, storage_prefix, files from greenlight.runs");
  assert.deepEqual([run.run_kind, run.evidence_status], ["certification", "stored"]);
  assert.equal(run.storage_prefix, `projects/${projectId}/runs/${rec.run_id}`);

  // Every stored object is byte-identical to what the run row says.
  for (const f of run.files) {
    const bytes = fake.objects.get(`greenlight-evidence/${run.storage_prefix}/${f.name}`);
    assert.ok(bytes, f.name);
    assert.equal(sha(bytes), f.sha256, f.name);
  }
  assert.ok(run.files.some((f) => f.name.startsWith("evidence/") && f.sha256 === run.evidence_sha256), "the evidence pack is among them");
  assert.equal(existsSync(path.join(h.workDir, "evidence", job.id)), false, "the local in-flight copy is removed after commit");

  // Public view: no storage path, no account, no service details.
  const pub = await h.call("GET", `/v1/public/records/${rec.id}`, { token: null });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.publicSha256, publicHash(pub.body));
  const text = JSON.stringify(pub.body);
  for (const leak of ["storage_prefix", "projects/prj_", "greenlight-evidence", "acme", fake.serviceRoleKey, "supabase.co"]) assert.ok(!text.includes(leak), `public record leaks ${leak}`);

  // Re-verification of stored evidence, and detection of tampering in Storage.
  const ok = await h.call("GET", `/v1/projects/${projectId}/records/${rec.id}/evidence`);
  assert.deepEqual([ok.status, ok.body.ok, ok.body.problems], [200, true, []]);
  assert.ok(!JSON.stringify(ok.body).includes("projects/prj_"), "no storage paths in the integrity response");
  const packKey = [...fake.objects.keys()].find((k) => k.includes("/evidence/"));
  fake.objects.set(packKey, Buffer.from("tampered"));
  const bad = await h.call("GET", `/v1/projects/${projectId}/records/${rec.id}/evidence`);
  assert.equal(bad.body.ok, false);
  assert.match(bad.body.problems.join(","), /hash_mismatch:evidence\//);
  assert.equal((await h.call("GET", `/v1/projects/${projectId}/records/${rec.id}/evidence`, { token: T.other })).status, 404, "other accounts cannot probe evidence");
});

test("a failed run is stored as history (certified false) with its claims and tests", async () => {
  const { fake } = await newFake();
  const h = await instance(fake, { statuses: { "cart-add-two_test.md": "passed", "newsletter-subscribe_test.md": "failed" } });
  const { projectId } = await approvedProject(h);
  const { job } = await certify(h, projectId);
  assert.equal(job.outcome, "not_certified:failed");
  assert.deepEqual(await fake.sql("select status, certified from greenlight.certification_records"), [{ status: "failed", certified: false }]);
  assert.deepEqual(await fake.sql("select claim_id, status from greenlight.record_claims order by 1"), [{ claim_id: "CLM-001", status: "passed" }, { claim_id: "CLM-002", status: "failed" }]);
});

// ---------------------------------------------------------------- isolation and permissions

test("account isolation and roles are enforced with tokens from the database; revoked tokens stop working", async () => {
  const { fake, admin } = await newFake();
  const h = await instance(fake);
  const { projectId, hash } = await approvedProject(h);
  for (const p of [`/v1/projects/${projectId}`, `/v1/projects/${projectId}/versions`, `/v1/projects/${projectId}/records`]) {
    assert.deepEqual([(await h.call("GET", p, { token: T.other })).status], [404], p);
  }
  assert.equal((await h.call("GET", "/v1/projects", { token: T.other })).body.projects.length, 0);
  // A client cannot pick its account: an "account" in the body is ignored.
  const p2 = await h.call("POST", "/v1/projects", { token: T.other, body: { name: "Mine", url: "https://a.example.com/", account: "acme" } });
  assert.equal(p2.body.account, "other");
  // The agent proposes but can neither approve nor certify.
  const v2 = await h.call("POST", `/v1/projects/${projectId}/versions`, { token: T.agent, body: { specText: E2E.replace("Items in cart: 2", "Items in cart: 3") } });
  assert.equal((await h.call("POST", `/v1/projects/${projectId}/versions/2/approval`, { token: T.agent, body: { confirmHash: v2.body.approvedTestHash } })).body.error.code, "forbidden");
  assert.equal((await h.call("POST", `/v1/projects/${projectId}/certifications`, { token: T.agent, body: { version: 1, commit: COMMIT, confirmSpend: 100, approvedTestHash: hash } })).body.error.code, "forbidden");
  // Revocation.
  assert.equal(await admin.rpc("greenlight_revoke_token", { p_token_sha256: sha256Hex(T.agent) }), true);
  assert.equal((await h.call("GET", "/v1/projects", { token: T.agent })).body.error.code, "unauthorized");
});

// ---------------------------------------------------------------- immutability and database-level rules

test("certification records, runs, claims, approvals and versions are immutable in the database itself", async () => {
  const { fake } = await newFake();
  const h = await instance(fake);
  const { projectId } = await approvedProject(h);
  const { job } = await certify(h, projectId);
  const statements = [
    "update greenlight.certification_records set certified = false",
    "delete from greenlight.certification_records",
    "update greenlight.record_claims set status = 'failed'",
    "delete from greenlight.record_tests",
    "update greenlight.runs set evidence_sha256 = null",
    "delete from greenlight.runs",
    "update greenlight.approvals set approved_test_hash = repeat('0', 64)",
    "delete from greenlight.approvals",
    "update greenlight.test_versions set spec_text = 'x'",
    "truncate greenlight.certification_records cascade",
    `update greenlight.jobs set status = 'running' where id = '${job.id}'`,
    `delete from greenlight.jobs where id = '${job.id}'`,
  ];
  for (const s of statements) await assert.rejects(fake.sql(s), /immutable|kept as history|not allowed/, s);
  assert.equal((await fake.sql("select certified from greenlight.certification_records"))[0].certified, true, "unchanged");
  // Through the API: a second approval of the same version is a conflict.
  const v = await h.call("GET", `/v1/projects/${projectId}/versions/1`);
  assert.deepEqual([(await h.call("POST", `/v1/projects/${projectId}/versions/1/approval`, { body: { confirmHash: v.body.approvedTestHash } })).status], [409]);
});

test("the database refuses certified=true unless every certification condition holds, and approvals for other tests", async () => {
  const { fake, admin } = await newFake();
  const h = await instance(fake);
  const { projectId, hash } = await approvedProject(h);
  const jobId = `job_${"e".repeat(32)}`;
  await admin.rpc("greenlight_put_job", { p_doc: { schema: "greenlight.job/v1", id: jobId, kind: "certification", projectId, version: 1, status: "queued", request: {}, requestedBy: "dev", createdAt: new Date().toISOString() } });
  await admin.rpc("greenlight_put_job", { p_doc: { schema: "greenlight.job/v1", id: jobId, kind: "certification", projectId, version: 1, status: "running", request: {}, requestedBy: "dev", createdAt: (await admin.rpc("greenlight_get_job", { p_id: jobId })).createdAt, startedAt: new Date().toISOString() } });
  const [appr] = await fake.sql("select record_sha256 from greenlight.approvals");
  const record = (over = {}) => ({ id: `vr_${"f".repeat(32)}`, projectId, testVersion: 1, approvedTestHash: hash, status: "passed", certified: true, deployment: { commit: COMMIT }, approval: { recordSha256: appr.record_sha256 }, claims: [], recordSha256: "a".repeat(64), createdAt: new Date().toISOString(), ...over });
  const run = (over = {}) => ({ runId: "cert-forged", jobId, projectId, runKind: "certification", manifest: { runKind: "certification" }, manifestSha256: "b".repeat(64), evidenceStatus: "stored", storagePrefix: "x", files: [], createdAt: new Date().toISOString(), ...over });
  const refused = [
    [record({ status: "failed" }), run(), /certification rule|violates check/],
    [record(), run({ evidenceStatus: "corrupted" }), /certification rule/],
    [record(), run({ manifest: { runKind: "iteration" } }), /certification rule/],
    [record({ approval: { recordSha256: "c".repeat(64) } }), run(), /certification rule/],
    [record({ approvedTestHash: "d".repeat(64) }), run(), /other tests/],
  ];
  for (const [r, ru, re] of refused) await assert.rejects(admin.rpc("greenlight_put_record", { p_record: r, p_run: ru }), re);
  assert.equal((await fake.sql("select count(*)::int as n from greenlight.runs"))[0].n, 0, "a refused record leaves no run row (one transaction)");
  // An approval for different tests than the version is refused by the database.
  await assert.rejects(admin.rpc("greenlight_put_approval", { p_doc: { projectId, version: 1, approvedTestHash: "0".repeat(64), approvedBy: "x", approvedAt: new Date().toISOString(), method: "server-owner", certifiable: true, recordSha256: "1".repeat(64) } }), /does not match/);
  // A job cannot claim success without its record.
  await assert.rejects(admin.rpc("greenlight_put_job", { p_doc: { id: jobId, kind: "certification", projectId, version: 1, status: "succeeded", recordId: `vr_${"9".repeat(32)}`, request: {}, requestedBy: "dev", createdAt: (await admin.rpc("greenlight_get_job", { p_id: jobId })).createdAt, finishedAt: new Date().toISOString() } }), /must point at its stored record/);
});

test("concurrent proposals get distinct consecutive version numbers (atomic numbering)", async () => {
  const { fake } = await newFake();
  const h = await instance(fake);
  const p = await h.call("POST", "/v1/projects", { token: T.agent, body: { name: "A", url: "https://a.example.com/" } });
  const results = await Promise.all(Array.from({ length: 8 }, () => h.call("POST", `/v1/projects/${p.body.id}/versions`, { token: T.agent, body: { specText: E2E } })));
  assert.deepEqual(results.map((r) => r.body.version).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
});

// ---------------------------------------------------------------- concurrency across instances, restarts

test("two server instances on one database: only one certification per project can be active", async () => {
  const { fake } = await newFake();
  const a = await instance(fake);
  const b = await instance(fake);
  const { projectId } = await approvedProject(a);
  // Instance A's job is accepted but held; instance B must be refused by the database index.
  const pending = a.ctx.jobs;
  pending.pump = () => {}; // keep A's job queued so it stays active
  const ra = await a.call("POST", `/v1/projects/${projectId}/certifications`, { body: { version: 1, commit: COMMIT, confirmSpend: 100 } });
  const rb = await b.call("POST", `/v1/projects/${projectId}/certifications`, { body: { version: 1, commit: COMMIT, confirmSpend: 100 } });
  assert.equal(ra.status, 202);
  assert.deepEqual([rb.status, rb.body.error.code], [429, "job_limit_reached"]);
  assert.equal((await fake.sql("select count(*)::int as n from greenlight.jobs where status in ('queued','running')"))[0].n, 1);
});

test("restart: data persists; a job left running is failed, or completed if its record was already committed", async () => {
  const { fake, admin } = await newFake();
  const first = await instance(fake);
  const { projectId } = await approvedProject(first);
  const done = await certify(first, projectId);
  first.server.close();

  // Simulate two crashes: one job died before Kane, one after its record was committed.
  const createdAt = new Date().toISOString();
  const lost = `job_${"1".repeat(32)}`;
  await admin.rpc("greenlight_put_job", { p_doc: { schema: "greenlight.job/v1", id: lost, kind: "certification", projectId, version: 1, status: "queued", request: {}, requestedBy: "dev", createdAt } });
  await admin.rpc("greenlight_put_job", { p_doc: { schema: "greenlight.job/v1", id: lost, kind: "certification", projectId, version: 1, status: "running", request: {}, requestedBy: "dev", createdAt, startedAt: createdAt } });

  // Crash 2: the record was committed, then the process died before the job update.
  const committed = `job_${"2".repeat(32)}`;
  const t2 = new Date().toISOString();
  const hash = (await admin.rpc("greenlight_get_version", { p_project_id: projectId, p_version: 1 })).approvedTestHash;
  // A second project, since only one job per project may be active at a time.
  const crash2Project = (await admin.rpc("greenlight_create_project", { p_doc: { schema: "greenlight.project/v1", id: `prj_${"3".repeat(32)}`, name: "B", url: "https://b.example.com/", account: "acme", createdBy: "dev", createdAt: t2 } })).id;
  const vdoc = (await admin.rpc("greenlight_get_version", { p_project_id: projectId, p_version: 1 }));
  await admin.rpc("greenlight_add_version", { p_project_id: crash2Project, p_doc: { ...vdoc, projectId: crash2Project } });
  const jdoc = { schema: "greenlight.job/v1", id: committed, kind: "certification", projectId: crash2Project, version: 1, request: {}, requestedBy: "dev", createdAt: t2 };
  await admin.rpc("greenlight_put_job", { p_doc: { ...jdoc, status: "queued" } });
  await admin.rpc("greenlight_put_job", { p_doc: { ...jdoc, status: "running", startedAt: t2 } });
  const { certificationRunId } = await import("../../src/server/certify.js");
  await admin.rpc("greenlight_put_record", {
    p_record: { id: `vr_${"4".repeat(32)}`, projectId: crash2Project, testVersion: 1, approvedTestHash: hash, status: "failed", certified: false, deployment: { commit: COMMIT }, approval: {}, claims: [], execution: { runId: certificationRunId(committed) }, recordSha256: "a".repeat(64), createdAt: t2 },
    p_run: { runId: certificationRunId(committed), jobId: committed, projectId: crash2Project, runKind: "certification", manifest: { runKind: "certification" }, manifestSha256: "b".repeat(64), evidenceStatus: "stored", storagePrefix: "x", files: [], createdAt: t2 },
  });

  const second = await instance(fake); // recover() runs here
  const settled = await admin.rpc("greenlight_get_job", { p_id: committed });
  assert.deepEqual([settled.status, settled.recordId, settled.outcome], ["succeeded", `vr_${"4".repeat(32)}`, "not_certified:failed"], "completed from its committed record, not failed");
  assert.equal((await second.call("GET", `/v1/projects/${projectId}`)).status, 200, "projects survive the restart");
  assert.equal((await second.call("GET", `/v1/projects/${projectId}/versions/1`)).body.status, "approved");
  const records = (await second.call("GET", `/v1/projects/${projectId}/records`)).body.records;
  assert.deepEqual(records.map((r) => r.id), [done.job.recordId]);
  assert.equal(records[0].integrity.ok, true);
  const j = (await second.call("GET", `/v1/jobs/${lost}`)).body;
  assert.deepEqual([j.status, j.error.code], ["failed", "interrupted"]);
  assert.equal(second.calls.filter((c) => c.name === "runKane").length, 0, "nothing is re-run after a restart");
});

test("evidence upload is verified before the record exists: corrupted storage means no record and no run row", async () => {
  const { fake } = await newFake();
  const h = await instance(fake);
  const { projectId } = await approvedProject(h);
  fake.hooks.onUpload = (key, bytes) => (key.includes("/evidence/") ? Buffer.concat([bytes, Buffer.from("x")]) : bytes);
  const { job } = await certify(h, projectId);
  assert.equal(job.status, "failed");
  assert.equal(job.error.code, "run_record_invalid");
  assert.match(job.error.message, /hash_mismatch:evidence\//);
  assert.deepEqual(await fake.sql("select count(*)::int as n from greenlight.certification_records"), [{ n: 1 - 1 }]);
  assert.deepEqual(await fake.sql("select count(*)::int as n from greenlight.runs"), [{ n: 0 }]);
  assert.ok(existsSync(path.join(h.workDir, "evidence", job.id)), "the local evidence is kept for recovery when archiving fails");
});

test("evidence objects are never overwritten", async () => {
  const { fake } = await newFake();
  const client = createSupabaseClient({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: fake.fetch });
  await client.storage.upload("greenlight-evidence", "projects/p1/runs/r1/manifest.json", Buffer.from("{}"));
  await assert.rejects(client.storage.upload("greenlight-evidence", "projects/p1/runs/r1/manifest.json", Buffer.from('{"forged":true}')), (e) => e.code === "conflict");
  assert.equal(fake.objects.get("greenlight-evidence/projects/p1/runs/r1/manifest.json").toString(), "{}");
  await assert.rejects(client.storage.upload("greenlight-evidence", "projects/../secrets", Buffer.from("x")), /unsafe storage path/);
});

// ---------------------------------------------------------------- coexistence with an existing application (Ceaser)

const CEASER_SNAPSHOT = `
  select 'rel' as k, c.relname || ':' || c.relkind::text || ':rls=' || c.relrowsecurity || ':acl=' || coalesce(array_to_string(c.relacl, ','), '') as v
    from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public'
  union all select 'policy', tablename || ':' || policyname || ':' || cmd || ':' || coalesce(qual, '') || ':' || coalesce(with_check, '') from pg_policies where schemaname = 'public'
  union all select 'fn', p.oid::regprocedure::text || ':acl=' || coalesce(array_to_string(p.proacl, ','), '') || ':' || md5(pg_get_functiondef(p.oid)) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'
  union all select 'view', viewname || ':' || md5(definition) from pg_views where schemaname = 'public'
  union all select 'trigger', tgrelid::regclass::text || ':' || tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and not tgisinternal
  union all select 'default_acl', defaclobjtype::text || ':' || array_to_string(defaclacl, ',') from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname = 'public'
  union all select 'schema_acl', coalesce(array_to_string(nspacl, ','), '') from pg_namespace where nspname = 'public'
  union all select 'rows', 'communities=' || (select count(*) from public.communities) || ' posts=' || (select count(*) from public.posts) || ' sum=' || (select md5(string_agg(body, '|' order by id)) from public.posts)
  union all select 'bucket', id || ':' || public::text from storage.buckets where id <> 'greenlight-evidence'
  order by 1, 2`;

test("applying the migrations next to an existing app (Ceaser) changes none of its objects, policies, grants or data", async () => {
  const fake = await createFakeSupabase({ withCeaser: true, migrate: false });
  fakes.push(fake);
  const before = await fake.sql(CEASER_SNAPSHOT);
  assert.ok(before.length > 10);
  await fake.applyMigrations();
  const after = await fake.sql(CEASER_SNAPSHOT);
  assert.deepEqual(after, before);
  // Greenlight added exactly: schemas greenlight + greenlight_api and one private bucket.
  const added = await fake.sql("select nspname from pg_namespace where nspname like 'greenlight%' order by 1");
  assert.deepEqual(added.map((r) => r.nspname), ["greenlight", "greenlight_api"]);
  assert.deepEqual(await fake.sql("select id, public from storage.buckets order by id"), [{ id: "avatars", public: true }, { id: "greenlight-evidence", public: false }]);
});

test("Ceaser's credentials reach nothing of Greenlight, even after broad grants on public; Ceaser keeps working", async () => {
  const fake = await createFakeSupabase({ withCeaser: true });
  fakes.push(fake);
  // A future Ceaser migration being careless with public cannot reach Greenlight.
  await fake.sql("grant execute on all functions in schema public to anon, authenticated");
  await fake.sql("grant select, insert, update, delete on all tables in schema public to anon, authenticated");
  const anon = createSupabaseClient({ url: fake.url, serviceRoleKey: fake.anonKey, fetchImpl: fake.fetch });
  for (const [fn, args] of [["greenlight_list_projects", { p_account: "acme" }], ["greenlight_authenticate", { p_token_sha256: "a".repeat(64) }], ["greenlight_get_record", { p_id: `vr_${"a".repeat(32)}` }]]) {
    await assert.rejects(anon.rpc(fn, args), (e) => e instanceof GreenlightError && /permission denied/.test(e.message), fn);
  }
  for (const role of ["anon", "authenticated"]) {
    await assert.rejects(fake.sql("select * from greenlight.certification_records", [], { role }), /permission denied/);
    await assert.rejects(fake.sql("select greenlight_api.greenlight_list_jobs()", [], { role }), /permission denied/);
  }
  // Ceaser's own anon access is unchanged.
  const res = await fake.fetch(`${fake.url}/rest/v1/rpc/post_count`, { method: "POST", headers: { apikey: fake.anonKey, authorization: `Bearer ${fake.anonKey}`, "content-type": "application/json" }, body: "{}" });
  assert.deepEqual([res.status, await res.json()], [200, 3]);
  // Storage: Ceaser's keys cannot read the evidence bucket.
  const s = await fake.fetch(`${fake.url}/storage/v1/object/authenticated/greenlight-evidence/projects/x/runs/y/manifest.json`, { headers: { apikey: fake.anonKey, authorization: `Bearer ${fake.anonKey}` } });
  assert.equal(s.status, 403);
});

test("if greenlight_api is not exposed in the Data API, the server reports exactly what to configure", async () => {
  const fake = await createFakeSupabase({ exposedSchemas: ["public", "graphql_public"] });
  fakes.push(fake);
  const client = createSupabaseClient({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: fake.fetch });
  await assert.rejects(client.rpc("greenlight_list_projects", { p_account: "acme" }), (e) => e.code === "server_not_configured" && /Exposed schemas/.test(e.message) && /greenlight_api/.test(e.message));
  assert.throws(() => createSupabaseClient({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, schema: "public" }), /never public/);
  assert.ok(fake.calls.every((c) => c.profile === "greenlight_api"), "every RPC targets greenlight_api");
});

// ---------------------------------------------------------------- readiness and key formats

test("readiness: /v1/ready is 200 with database and private bucket ok; liveness stays separate", async () => {
  const { fake } = await newFake();
  const h = await instance(fake);
  const r = await h.call("GET", "/v1/ready", { token: null });
  assert.deepEqual([r.status, r.body], [200, { schema: "greenlight.ready/v1", ok: true, store: "supabase", database: "ok", storage: "ok" }]);
  assert.equal((await h.call("GET", "/v1/health", { token: null })).status, 200);
});

test("readiness reports wrong key, public bucket, missing bucket and unexposed schema as codes, never details", async () => {
  const { fake } = await newFake();
  const bad = new SupabaseStore({ url: fake.url, serviceRoleKey: `wrong-key-${"x".repeat(30)}`, fetchImpl: fake.fetch });
  assert.deepEqual(await bad.health(), { store: "supabase", ok: false, database: "unauthorized", storage: "unauthorized" });
  const missing = new SupabaseStore({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: fake.fetch, bucket: "no-such-bucket" });
  assert.deepEqual(await missing.health(), { store: "supabase", ok: false, database: "ok", storage: "bucket_missing" });
  await fake.sql("update storage.buckets set public = true where id = 'greenlight-evidence'");
  const pub = new SupabaseStore({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: fake.fetch });
  assert.equal((await pub.health()).storage, "bucket_public");
  const down = new SupabaseStore({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: async () => { throw new Error(`connect ECONNREFUSED ${fake.serviceRoleKey}`); } });
  const d = await down.health();
  assert.deepEqual([d.ok, d.database, d.storage], [false, "unreachable", "unreachable"]);
  assert.ok(!JSON.stringify(d).includes(fake.serviceRoleKey));

  const hidden = await createFakeSupabase({ exposedSchemas: ["public", "graphql_public"] });
  fakes.push(hidden);
  const hs = new SupabaseStore({ url: hidden.url, serviceRoleKey: hidden.serviceRoleKey, fetchImpl: hidden.fetch });
  assert.equal((await hs.health()).database, "schema_not_exposed");
});

test("an sb_secret_ key is sent only in the apikey header (it is not a JWT); a legacy JWT key in both", async () => {
  const key = `sb_secret_${"k".repeat(22)}_abcdefgh`;
  const fake = await createFakeSupabase({ serviceRoleKey: key });
  fakes.push(fake);
  const seen = [];
  const store = new SupabaseStore({ url: fake.url, serviceRoleKey: key, fetchImpl: (u, init) => { seen.push(init.headers); return fake.fetch(u, init); } });
  assert.equal((await store.health()).ok, true);
  assert.ok(seen.every((hd) => hd.apikey === key && !("authorization" in hd)));
  const { authHeaders } = await import("../../src/server/supabase/client.js");
  assert.deepEqual(authHeaders("eyJhbGciOiJIUzI1NiJ9.x.y"), { apikey: "eyJhbGciOiJIUzI1NiJ9.x.y", authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.x.y" });
});
