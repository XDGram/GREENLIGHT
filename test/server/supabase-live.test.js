// LIVE integration test against the real Supabase project. Skipped unless
//   GREENLIGHT_LIVE_SUPABASE=1  SUPABASE_URL=https://<ref>.supabase.co  SUPABASE_SERVICE_ROLE_KEY=<secret key>
// are set (the key may be a placeholder when an egress proxy injects the real one).
//
// It drives the real server code (HTTP API, JobRunner, certification pipeline,
// SupabaseStore) against the real greenlight_api RPCs and the private
// greenlight-evidence bucket. Kane, the credit balance, the evidence validator
// and the deployment check are fakes: no Kane, no credits, no deployment.
//
// Rows it writes are permanent (the tables are immutable by design), so it only
// uses the dedicated accounts greenlight-e2e-a and greenlight-e2e-b, a new
// project per run, and fresh tokens that it revokes at the end. Every run it
// stores is a FAILED run (certified: false): it never creates a certification.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { loadConfig, createServerContext, startServer, sha256Hex, SupabaseStore, createSupabaseClient, publicHash } from "../../src/server/index.js";
import { fabricatedRun } from "../verify/helpers.js";
import { zipOf } from "../report/zip-helper.js";

const LIVE = process.env.GREENLIGHT_LIVE_SUPABASE === "1" && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY;
const skip = LIVE ? false : "set GREENLIGHT_LIVE_SUPABASE=1, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to run against the real project";

const E2E = readFileSync(new URL("../fixtures/spec/e2e/greenlight.yaml", import.meta.url), "utf8");
const COMMIT = "dc6150b46a46a85efb4255113f0eddc5370621c8";
const ACCT = { a: "greenlight-e2e-a", b: "greenlight-e2e-b" };
const tok = () => `glt_e2e_${randomBytes(24).toString("base64url")}`;
const T = { owner: tok(), agent: tok(), other: tok() };
const sha = (b) => createHash("sha256").update(b).digest("hex");

const temps = [];
const servers = [];
let admin;
after(async () => {
  for (const s of servers) s.close();
  if (admin) for (const t of Object.values(T)) await admin.rpc("greenlight_revoke_token", { p_token_sha256: sha256Hex(t) }).catch(() => {});
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

function fakeKane(execId, statuses) {
  return async (opts) => {
    const store = path.join(opts.cwd, ".testmuai", "evidence");
    await mkdir(store, { recursive: true });
    await writeFile(path.join(store, `${execId}.evidence`), zipOf({ "run.yaml": "status: finalized\n", "tests/x/result.yaml": `status: failed\nnonce: ${randomBytes(8).toString("hex")}\n` }));
    const run = fabricatedRun({ members: Object.entries(statuses).map(([file, status], i) => ({ file, tags: [`clm-00${i + 1}`], status, mode: "authored" })) });
    run.stream.done.executionId = execId;
    run.stream.summary.executionId = execId;
    run.stream.summary.evidenceId = execId;
    return { ...run, stdout: "{}\n", stderr: "", aborted: false };
  };
}

/** A server instance on the real project. Calling it again = a restart (new store, new runner, recover()). */
async function instance() {
  const workDir = await mkdtemp(path.join(os.tmpdir(), "gl-live-work-"));
  temps.push(workDir);
  const config = loadConfig({ SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY, GREENLIGHT_WORK_DIR: workDir, GREENLIGHT_PORT: "0", GREENLIGHT_RATE_LIMIT_PER_MINUTE: "1000" });
  const execId = `0a1b2c3d-0000-4000-8000-${randomBytes(6).toString("hex")}`;
  const deps = {
    runKane: fakeKane(execId, { "cart-add-two_test.md": "passed", "newsletter-subscribe_test.md": "failed" }),
    readBalance: async () => ({ ok: true, balance: 10000 }),
    validator: async () => ({ exitCode: 0, stdout: '{"valid":true,"status":"finalized","diagnostics":[]}', stderr: "" }),
    verifyLiveDeployment: async (o) => ({ state: "ready", reasons: [], safeToRunKane: true, url: o.url, deployedCommit: o.expectedCommit, expectedCommit: o.expectedCommit, environment: "preview" }),
    now: () => new Date(),
  };
  const store = new SupabaseStore({ url: config.supabase.url, serviceRoleKey: config.supabase.serviceRoleKey, bucket: config.supabase.bucket, workRoot: workDir });
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
  return { ctx, call, server, store };
}

const state = {};

test("live: readiness against the real project (key, greenlight_api exposed, private bucket)", { skip }, async () => {
  admin = createSupabaseClient({ url: process.env.SUPABASE_URL, serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
  assert.deepEqual(await admin.health(process.env.GREENLIGHT_EVIDENCE_BUCKET || "greenlight-evidence"), { ok: true, database: "ok", storage: "ok" });
  // Accounts, users and tokens (admin CLI path).
  for (const a of Object.values(ACCT)) assert.equal((await admin.rpc("greenlight_ensure_account", { p_slug: a })).slug, a);
  for (const [acct, name, role] of [[ACCT.a, "e2e-owner", "owner"], [ACCT.a, "e2e-agent", "agent"], [ACCT.b, "e2e-other", "owner"]]) {
    await admin.rpc("greenlight_create_user", { p_account: acct, p_name: name, p_role: role }).catch((e) => assert.equal(e.code, "conflict"));
  }
  for (const [acct, name, t] of [[ACCT.a, "e2e-owner", T.owner], [ACCT.a, "e2e-agent", T.agent], [ACCT.b, "e2e-other", T.other]]) {
    await admin.rpc("greenlight_add_token", { p_account: acct, p_user: name, p_token_sha256: sha256Hex(t), p_label: "live e2e test" });
  }
  assert.deepEqual(await admin.rpc("greenlight_authenticate", { p_token_sha256: sha256Hex(T.agent) }), { name: "e2e-agent", role: "agent", account: ACCT.a });
});

test("live: projects, versions, approval, a (failed) run with evidence in the bucket, isolation", { skip }, async () => {
  const h = await instance();
  assert.equal((await h.call("GET", "/v1/ready", { token: null })).status, 200);

  const p = await h.call("POST", "/v1/projects", { token: T.agent, body: { name: `Live e2e ${new Date().toISOString()}`, url: "https://gl-test.vercel.app/" } });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  assert.equal(p.body.account, ACCT.a);
  const projectId = p.body.id;
  const v1 = await h.call("POST", `/v1/projects/${projectId}/versions`, { token: T.agent, body: { specText: E2E } });
  const v2 = await h.call("POST", `/v1/projects/${projectId}/versions`, { token: T.agent, body: { specText: E2E.replace("Items in cart: 2", "Items in cart: 3") } });
  assert.deepEqual([v1.status, v1.body.version, v2.body.version], [201, 1, 2]);
  assert.equal((await h.call("POST", `/v1/projects/${projectId}/versions/1/approval`, { token: T.agent, body: { confirmHash: v1.body.approvedTestHash } })).body.error.code, "forbidden");
  assert.equal((await h.call("POST", `/v1/projects/${projectId}/versions/1/approval`, { body: { confirmHash: v2.body.approvedTestHash } })).body.error.code, "approval_hash_mismatch");
  const a = await h.call("POST", `/v1/projects/${projectId}/versions/1/approval`, { body: { confirmHash: v1.body.approvedTestHash } });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal((await h.call("POST", `/v1/projects/${projectId}/versions/1/approval`, { body: { confirmHash: v1.body.approvedTestHash } })).body.error.code, "conflict", "approvals are write-once");

  // A run that FAILS one claim: stored as history with certified=false, evidence in the private bucket.
  const sub = await h.call("POST", `/v1/projects/${projectId}/certifications`, { body: { version: 1, commit: COMMIT, confirmSpend: 100 } });
  assert.equal(sub.status, 202, JSON.stringify(sub.body));
  await h.ctx.jobs.idle();
  const job = (await h.call("GET", `/v1/jobs/${sub.body.id}`)).body;
  assert.deepEqual([job.status, job.outcome], ["succeeded", "not_certified:failed"], JSON.stringify(job.error));
  const records = (await h.call("GET", `/v1/projects/${projectId}/records`)).body.records;
  assert.equal(records.length, 1);
  assert.deepEqual([records[0].status, records[0].certified, records[0].integrity.ok], ["failed", false, true]);
  const ev = await h.call("GET", `/v1/projects/${projectId}/records/${records[0].id}/evidence`);
  assert.deepEqual([ev.status, ev.body.ok, ev.body.problems], [200, true, []]);
  assert.ok(ev.body.files >= 2, "manifest and evidence pack are stored");

  // Evidence bytes in Storage match the run row; re-uploading the same object is refused.
  const run = await h.store.getRun(records[0].execution.runId);
  for (const f of run.files) assert.equal(sha(await admin.storage.download("greenlight-evidence", `${run.storagePrefix}/${f.name}`)), f.sha256, f.name);
  await assert.rejects(admin.storage.upload("greenlight-evidence", `${run.storagePrefix}/${run.files[0].name}`, Buffer.from("overwrite")), (e) => e.code === "conflict");

  // Public view carries no storage path, account or key.
  const pub = await h.call("GET", `/v1/public/records/${records[0].id}`, { token: null });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.publicSha256, publicHash(pub.body));
  for (const leak of [run.storagePrefix, ACCT.a, "greenlight-evidence", process.env.SUPABASE_SERVICE_ROLE_KEY]) assert.ok(!JSON.stringify(pub.body).includes(leak));

  // Isolation: the other account sees nothing of this one and cannot claim it.
  for (const pth of [`/v1/projects/${projectId}`, `/v1/projects/${projectId}/versions`, `/v1/projects/${projectId}/records`, `/v1/jobs/${job.id}`, `/v1/projects/${projectId}/records/${records[0].id}/evidence`]) {
    assert.equal((await h.call("GET", pth, { token: T.other })).status, 404, pth);
  }
  assert.ok(!(await h.call("GET", "/v1/projects", { token: T.other })).body.projects.some((x) => x.id === projectId));
  const mine = await h.call("POST", "/v1/projects", { token: T.other, body: { name: "Other e2e", url: "https://b.example.com/", account: ACCT.a } });
  assert.equal(mine.body.account, ACCT.b, "the account comes from the token, never the request");
  assert.equal((await h.call("GET", "/v1/projects", { token: null })).status, 401);
  assert.equal((await h.call("GET", "/v1/projects", { token: tok() })).status, 401);

  Object.assign(state, { projectId, jobId: job.id, recordId: records[0].id, hash: v1.body.approvedTestHash, otherProject: mine.body.id });
  h.server.close();
});

test("live: a restarted server reads everything back; immutable rows cannot be changed", { skip }, async () => {
  assert.ok(state.projectId, "depends on the previous test");
  const h = await instance(); // new store and job runner; recover() runs
  const pr = await h.call("GET", `/v1/projects/${state.projectId}`);
  assert.equal(pr.status, 200);
  const v = await h.call("GET", `/v1/projects/${state.projectId}/versions`);
  assert.deepEqual(v.body.versions.map((x) => [x.version, x.status]), [[1, "approved"], [2, "pending_approval"]]);
  assert.equal((await h.call("GET", `/v1/jobs/${state.jobId}`)).body.recordId, state.recordId);
  const recs = (await h.call("GET", `/v1/projects/${state.projectId}/records`)).body.records;
  assert.deepEqual(recs.map((r) => [r.id, r.integrity.ok]), [[state.recordId, true]]);
  assert.equal((await h.call("GET", `/v1/projects/${state.projectId}/records/${state.recordId}/evidence`)).body.ok, true);
  assert.equal((await h.call("GET", `/v1/projects/${state.otherProject}`, { token: T.other })).status, 200);

  // Permitted updates only: a finished job cannot move again; a record cannot be rewritten.
  const job = await admin.rpc("greenlight_get_job", { p_id: state.jobId });
  await assert.rejects(admin.rpc("greenlight_put_job", { p_doc: { ...job, status: "running" } }), (e) => ["conflict", "internal_error"].includes(e.code));
  const rec = await admin.rpc("greenlight_get_record", { p_id: state.recordId });
  const run = await admin.rpc("greenlight_get_run", { p_run_id: rec.execution.runId });
  await assert.rejects(admin.rpc("greenlight_put_record", { p_record: { ...rec, certified: true, status: "passed" }, p_run: run }), (e) => ["conflict", "internal_error"].includes(e.code));
  assert.equal((await admin.rpc("greenlight_get_record", { p_id: state.recordId })).certified, false);

  // Revocation takes effect immediately.
  assert.equal(await admin.rpc("greenlight_revoke_token", { p_token_sha256: sha256Hex(T.agent) }), true);
  assert.equal((await h.call("GET", "/v1/projects", { token: T.agent })).status, 401);
});
