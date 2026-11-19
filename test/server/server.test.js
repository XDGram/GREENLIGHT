// Greenlight server: API, server-side approval and certification. Kane, the
// credit balance and the deployment check are fakes; the HTTP server listens on
// an ephemeral loopback port of THIS process only. No Kane, network or credits.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import {
  loadConfig,
  createServerContext,
  startServer,
  sha256Hex,
  publicHash,
  verifyRecordIntegrity,
  selfHash,
  buildVerificationRecord,
  JobRunner,
  FileStore,
} from "../../src/server/index.js";
import { fabricatedRun } from "../verify/helpers.js";
import { zipOf } from "../report/zip-helper.js";

const E2E = readFileSync(new URL("../fixtures/spec/e2e/greenlight.yaml", import.meta.url), "utf8");
const COMMIT = "dc6150b46a46a85efb4255113f0eddc5370621c8";
const OTHER = "1111111111111111111111111111111111111111";
const EXEC_ID = "0a1b2c3d-0000-4000-8000-000000000009";
const TOKENS = { owner: "owner-token-0123456789abcdef", agent: "agent-token-0123456789abcdef", other: "other-owner-0123456789abcdef" };

const temps = [];
const servers = [];
after(async () => {
  for (const s of servers) s.close();
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

/** A fake Kane: writes an evidence pack, returns a well-formed stream; records calls. */
function fakeKane(calls, { statuses = { "cart-add-two_test.md": "passed", "newsletter-subscribe_test.md": "passed" }, exitCode } = {}) {
  return async (opts) => {
    calls.push({ name: "runKane", opts, workspace: await readdir(opts.cwd) });
    const store = path.join(opts.cwd, ".testmuai", "evidence");
    await mkdir(store, { recursive: true });
    await writeFile(path.join(store, `${EXEC_ID}.evidence`), zipOf({ "run.yaml": "status: finalized\n" }));
    const run = fabricatedRun({
      members: Object.entries(statuses).map(([file, status], i) => ({ file, tags: [`clm-00${i + 1}`], status, mode: "authored" })),
      ...(exitCode === undefined ? {} : { exitCode }),
    });
    run.stream.done.executionId = EXEC_ID;
    run.stream.summary.executionId = EXEC_ID;
    run.stream.summary.evidenceId = EXEC_ID;
    return { ...run, stdout: `{"note":"ran in ${opts.cwd}"}\n`, stderr: "account dev@example.com\n", aborted: false };
  };
}

async function harness({ env = {}, kane = {}, deployed = COMMIT, balance = [11076.5779, 10999.9376] } = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "gl-server-"));
  temps.push(dataDir);
  const config = loadConfig({
    GREENLIGHT_DATA_DIR: dataDir,
    GREENLIGHT_PORT: "0",
    GREENLIGHT_PUBLIC_BASE_URL: "https://greenlight.example.com",
    GREENLIGHT_API_TOKENS: JSON.stringify([
      { name: "dev", role: "owner", account: "acme", sha256: sha256Hex(TOKENS.owner) },
      { name: "claude", role: "agent", account: "acme", sha256: sha256Hex(TOKENS.agent) },
      { name: "eve", role: "owner", account: "other", sha256: sha256Hex(TOKENS.other) },
    ]),
    ...env,
  });
  const calls = [];
  const balances = [...balance];
  const deps = {
    runKane: fakeKane(calls, kane),
    readBalance: async () => (calls.push({ name: "readBalance" }), { ok: true, balance: balances.length > 1 ? balances.shift() : balances[0] }),
    validator: async () => ({ exitCode: 0, stdout: '{"valid":true,"status":"finalized","diagnostics":[]}', stderr: "" }),
    verifyLiveDeployment: async (o) => {
      calls.push({ name: "verifyLiveDeployment", opts: o });
      const ready = deployed === o.expectedCommit;
      return { state: ready ? "ready" : "stale_deployment", reasons: ready ? [] : ["commit_mismatch", "timed_out"], safeToRunKane: ready, url: o.url, deployedCommit: deployed, expectedCommit: o.expectedCommit, environment: "preview" };
    },
    now: () => new Date("2026-11-19T12:00:00.000Z"),
  };
  const ctx = await createServerContext({ config, deps });
  const server = await startServer({ config, ...ctx, now: deps.now });
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, { token = TOKENS.owner, body } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  };
  return { config, ctx, calls, call, dataDir, base };
}

async function approvedProject(h) {
  const p = await h.call("POST", "/v1/projects", { token: TOKENS.agent, body: { name: "Greenlight Test App", url: "https://gl-test.vercel.app/" } });
  assert.equal(p.status, 201, JSON.stringify(p.body));
  const v = await h.call("POST", `/v1/projects/${p.body.id}/versions`, { token: TOKENS.agent, body: { specText: E2E } });
  assert.equal(v.status, 201, JSON.stringify(v.body));
  const a = await h.call("POST", `/v1/projects/${p.body.id}/versions/1/approval`, { body: { confirmHash: v.body.approvedTestHash } });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  return { projectId: p.body.id, hash: v.body.approvedTestHash };
}

async function certify(h, projectId, body) {
  const r = await h.call("POST", `/v1/projects/${projectId}/certifications`, { body: { version: 1, commit: COMMIT, confirmSpend: 100, ...body } });
  if (r.status !== 202) return { submit: r };
  await h.ctx.jobs.idle();
  return { submit: r, job: (await h.call("GET", `/v1/jobs/${r.body.id}`)).body };
}

const kaneRuns = (calls) => calls.filter((c) => c.name === "runKane").length;

// ---------------------------------------------------------------- configuration and auth

test("config: tokens are stored as hashes only; bad configuration is refused", () => {
  assert.throws(() => loadConfig({}), /GREENLIGHT_DATA_DIR/);
  assert.throws(() => loadConfig({ GREENLIGHT_DATA_DIR: "relative/dir" }), /absolute/);
  assert.throws(() => loadConfig({ GREENLIGHT_DATA_DIR: "/tmp/x", GREENLIGHT_API_TOKENS: '[{"name":"a","role":"owner","account":"x","token":"plaintext"}]' }), /sha256/);
  assert.throws(() => loadConfig({ GREENLIGHT_DATA_DIR: "/tmp/x", GREENLIGHT_API_TOKENS: '[{"name":"a","role":"admin","account":"x","sha256":"' + "a".repeat(64) + '"}]' }), /role/);
});

test("auth: no token, a wrong token and a wrong role are refused with stable codes", async () => {
  const h = await harness();
  assert.equal((await h.call("GET", "/v1/health", { token: null })).status, 200);
  const none = await h.call("GET", "/v1/projects", { token: null });
  assert.deepEqual([none.status, none.body.error.code], [401, "unauthorized"]);
  const wrong = await h.call("GET", "/v1/projects", { token: "x".repeat(32) });
  assert.deepEqual([wrong.status, wrong.body.error.code], [401, "unauthorized"]);
  const p = await h.call("POST", "/v1/projects", { token: TOKENS.agent, body: { name: "A", url: "https://a.example.com/" } });
  const v = await h.call("POST", `/v1/projects/${p.body.id}/versions`, { token: TOKENS.agent, body: { specText: E2E } });
  const agentApprove = await h.call("POST", `/v1/projects/${p.body.id}/versions/1/approval`, { token: TOKENS.agent, body: { confirmHash: v.body.approvedTestHash } });
  assert.deepEqual([agentApprove.status, agentApprove.body.error.code], [403, "forbidden"], "the agent can propose but never approve");
  const agentCertify = await h.call("POST", `/v1/projects/${p.body.id}/certifications`, { token: TOKENS.agent, body: { version: 1, commit: COMMIT, confirmSpend: 100 } });
  assert.deepEqual([agentCertify.status, agentCertify.body.error.code], [403, "forbidden"]);
  assert.ok(agentApprove.body.error.action, "every error says what to do");
});

test("accounts are isolated: another account's owner sees 404, never the project", async () => {
  const h = await harness();
  const { projectId } = await approvedProject(h);
  for (const [m, p] of [["GET", `/v1/projects/${projectId}`], ["GET", `/v1/projects/${projectId}/versions`], ["GET", `/v1/projects/${projectId}/records`]]) {
    const r = await h.call(m, p, { token: TOKENS.other });
    assert.deepEqual([r.status, r.body.error.code], [404, "not_found"], p);
  }
  const c = await h.call("POST", `/v1/projects/${projectId}/certifications`, { token: TOKENS.other, body: { version: 1, commit: COMMIT, confirmSpend: 100 } });
  assert.equal(c.status, 404);
  assert.equal((await h.call("GET", "/v1/projects", { token: TOKENS.other })).body.projects.length, 0);
});

test("request validation: localhost/private URLs, bad bodies, ids and oversized requests", async () => {
  const h = await harness();
  for (const url of ["http://localhost:3000/", "http://127.0.0.2/", "http://10.0.0.5/", "http://169.254.169.254/", "http://[::1]/", "http://app.internal/"]) {
    const r = await h.call("POST", "/v1/projects", { body: { name: "A", url } });
    assert.deepEqual([r.status, r.body.error.code], [422, "url_not_allowed"], url);
  }
  assert.equal((await h.call("POST", "/v1/projects", { body: { name: "", url: "https://a.example.com/" } })).body.error.code, "invalid_request");
  assert.equal((await h.call("POST", "/v1/projects", { body: { name: "A", url: "https://a.example.com/?token=x" } })).body.error.code, "invalid_request");
  assert.equal((await h.call("GET", "/v1/projects/../../etc/passwd")).body.error.code, "not_found");
  assert.equal((await h.call("GET", "/v1/projects/prj_..%2F..%2Fetc")).body.error.code, "not_found");
  const big = await h.call("POST", "/v1/projects", { body: { name: "A", url: "https://a.example.com/", pad: "x".repeat(300 * 1024) } });
  assert.deepEqual([big.status, big.body.error.code], [413, "payload_too_large"]);
  const res = await fetch(`${h.base}/v1/projects`, { method: "POST", headers: { authorization: `Bearer ${TOKENS.owner}`, "content-type": "text/plain" }, body: "{}" });
  assert.equal((await res.json()).error.code, "invalid_request");
});

test("rate limiting per token and per anonymous client", async () => {
  const h = await harness({ env: { GREENLIGHT_RATE_LIMIT_PER_MINUTE: "3" } });
  for (let i = 0; i < 3; i++) assert.equal((await h.call("GET", "/v1/projects")).status, 200);
  const limited = await h.call("GET", "/v1/projects");
  assert.deepEqual([limited.status, limited.body.error.code], [429, "rate_limited"]);
  assert.equal((await h.call("GET", "/v1/projects", { token: TOKENS.agent })).status, 200, "a different principal has its own window");
});

// ---------------------------------------------------------------- versions and approval

test("test versions: the server derives the hash; an invalid spec is refused with its problems", async () => {
  const h = await harness();
  const p = await h.call("POST", "/v1/projects", { token: TOKENS.agent, body: { name: "A", url: "https://a.example.com/" } });
  const bad = await h.call("POST", `/v1/projects/${p.body.id}/versions`, { token: TOKENS.agent, body: { specText: "version: 1\nproject:\n  name: X\n" } });
  assert.deepEqual([bad.status, bad.body.error.code], [422, "spec_invalid"]);
  assert.ok(Array.isArray(bad.body.error.details.problems) && bad.body.error.details.problems.length);
  const v = await h.call("POST", `/v1/projects/${p.body.id}/versions`, { token: TOKENS.agent, body: { specText: E2E, approvedTestHash: "f".repeat(64) } });
  assert.equal(v.body.approvedTestHash, "68d811b0ab3cd7f57c015348a47208b8e7efc176d3bea30d7fd9127b4728e152", "a submitted hash is ignored; the server computes it");
  assert.equal(v.body.status, "pending_approval");
  const full = await h.call("GET", `/v1/projects/${p.body.id}/versions/1`);
  assert.ok(full.body.tests.every((t) => typeof t.content === "string" && t.content.includes("Generated by Greenlight")), "reviewers see the exact tests");
});

test("approval needs the full hash typed back, happens once, and a changed spec is a new unapproved version", async () => {
  const h = await harness();
  const p = await h.call("POST", "/v1/projects", { token: TOKENS.agent, body: { name: "A", url: "https://a.example.com/" } });
  const v = await h.call("POST", `/v1/projects/${p.body.id}/versions`, { token: TOKENS.agent, body: { specText: E2E } });
  for (const confirmHash of [v.body.approvedTestHash.slice(0, 12), "0".repeat(64), undefined]) {
    const r = await h.call("POST", `/v1/projects/${p.body.id}/versions/1/approval`, { body: { confirmHash } });
    assert.deepEqual([r.status, r.body.error.code], [409, "approval_hash_mismatch"]);
  }
  const ok = await h.call("POST", `/v1/projects/${p.body.id}/versions/1/approval`, { body: { confirmHash: v.body.approvedTestHash } });
  assert.deepEqual([ok.status, ok.body.method, ok.body.certifiable, ok.body.approvedBy], [201, "server-owner", true, "dev"]);
  const again = await h.call("POST", `/v1/projects/${p.body.id}/versions/1/approval`, { body: { confirmHash: v.body.approvedTestHash } });
  assert.deepEqual([again.status, again.body.error.code], [409, "conflict"], "approvals are write-once");

  const changed = E2E.replace("Items in cart: 2", "Items in cart: 3");
  const v2 = await h.call("POST", `/v1/projects/${p.body.id}/versions`, { token: TOKENS.agent, body: { specText: changed } });
  assert.equal(v2.body.version, 2);
  assert.notEqual(v2.body.approvedTestHash, v.body.approvedTestHash);
  const c = await h.call("POST", `/v1/projects/${p.body.id}/certifications`, { body: { version: 2, commit: COMMIT, confirmSpend: 100 } });
  assert.deepEqual([c.status, c.body.error.code], [403, "approval_not_certifiable"], "the changed tests are not approved");
});

// ---------------------------------------------------------------- certification

test("certification: a fresh server-side run of the approved tests produces a permanent certified record", async () => {
  const h = await harness();
  const { projectId, hash } = await approvedProject(h);
  const { submit, job } = await certify(h, projectId, { approvedTestHash: hash });
  assert.equal(submit.status, 202);
  assert.equal(job.status, "succeeded", JSON.stringify(job.error));
  assert.equal(job.outcome, "certified");

  // Fresh by construction: Kane saw only the generated tests, no recordings.
  const k = h.calls.find((c) => c.name === "runKane");
  assert.deepEqual(k.workspace.sort(), ["cart-add-two_test.md", "newsletter-subscribe_test.md"]);
  for (const flag of ["--local", "--no-adaptive-heal"]) assert.ok(k.opts.args.includes(flag), flag);
  assert.ok(!k.opts.args.some((a) => ["--push", "--author", "--remote"].includes(a)));
  assert.equal(existsSync(h.ctx.store.workDir(job.id)), false, "the workspace is removed afterwards");

  const records = (await h.call("GET", `/v1/projects/${projectId}/records`)).body.records;
  assert.equal(records.length, 1);
  const r = records[0];
  assert.deepEqual([r.status, r.certified, r.approvedTestHash, r.deployment.commit], ["passed", true, hash, COMMIT]);
  assert.equal(r.execution.runKind, "certification");
  assert.equal(r.execution.freshAuthoring, true);
  assert.equal(r.evidence.status, "stored");
  assert.match(r.evidence.packSha256, /^[0-9a-f]{64}$/);
  assert.equal(r.credits.actualSpend, 76.6403);
  assert.equal(r.integrity.ok, true);
  assert.deepEqual(r.claims.map((c) => [c.id, c.status]), [["CLM-001", "passed"], ["CLM-002", "passed"]]);

  // Public view: independently checkable, nothing private.
  const pub = await h.call("GET", `/v1/public/records/${r.id}`, { token: null });
  assert.equal(pub.status, 200);
  assert.equal(pub.body.publicUrl, `https://greenlight.example.com/v1/public/records/${r.id}`);
  assert.equal(pub.body.publicSha256, publicHash(pub.body), "anyone can recompute the public hash");
  assert.equal(pub.body.integrity.recordSha256, r.recordSha256);
  const text = JSON.stringify(pub.body);
  for (const secret of ["acme", "dev@example.com", "\"dev\"", "approvedBy", "balanceBefore", "/tmp/", h.dataDir]) assert.ok(!text.includes(secret), `public record leaks ${secret}`);
});

test("a failed certification run is kept as a historical record, never certified", async () => {
  const h = await harness({ kane: { statuses: { "cart-add-two_test.md": "passed", "newsletter-subscribe_test.md": "failed" } } });
  const { projectId } = await approvedProject(h);
  const { job } = await certify(h, projectId);
  assert.equal(job.status, "succeeded");
  assert.equal(job.outcome, "not_certified:failed");
  const pub = (await h.call("GET", `/v1/public/records/${job.recordId}`, { token: null })).body;
  assert.deepEqual([pub.status, pub.certified], ["failed", false]);
  assert.deepEqual(pub.notCertifiedBecause, ["status_failed"]);
  assert.deepEqual(pub.claims.map((c) => c.status), ["passed", "failed"]);
});

test("an infrastructure failure is couldnt_verify and not certified", async () => {
  const h = await harness({ kane: { exitCode: 2 } });
  const { projectId } = await approvedProject(h);
  const { job } = await certify(h, projectId);
  const pub = (await h.call("GET", `/v1/public/records/${job.recordId}`, { token: null })).body;
  assert.deepEqual([pub.status, pub.certified], ["couldnt_verify", false]);
  assert.ok(pub.notCertifiedBecause.includes("run_not_usable"));
});

test("gates before Kane: deployment commit mismatch, spend confirmation, cap and reserve all stop the run first", async () => {
  const cases = [
    [{ deployed: OTHER }, {}, "deployment_not_ready"],
    [{}, { confirmSpend: 50 }, "confirmation_required"], // estimate 94 > owner's confirmation
    [{ env: { GREENLIGHT_MAX_CREDITS_PER_RUN: "60" } }, {}, "credit_check_refused"], // server cap below the estimate
    [{ balance: [560] }, {}, "credit_check_refused"], // 560 - 94 < reserve 500
  ];
  for (const [opts, body, code] of cases) {
    const h = await harness(opts);
    const { projectId } = await approvedProject(h);
    const { job } = await certify(h, projectId, body);
    assert.equal(job.status, "failed", code);
    assert.equal(job.error.code, code);
    assert.equal(kaneRuns(h.calls), 0, `${code}: Kane must not run`);
    assert.equal((await h.call("GET", `/v1/projects/${projectId}/records`)).body.records.length, 0, "no record without a run");
  }
});

test("submission-time checks: commit format, missing confirmation, hash mismatch, unapproved version", async () => {
  const h = await harness();
  const { projectId } = await approvedProject(h);
  const post = (body) => h.call("POST", `/v1/projects/${projectId}/certifications`, { body: { version: 1, commit: COMMIT, confirmSpend: 100, ...body } });
  assert.equal((await post({ commit: "abc" })).body.error.code, "invalid_request");
  assert.equal((await post({ confirmSpend: undefined })).body.error.code, "confirmation_required");
  assert.equal((await post({ approvedTestHash: "0".repeat(64) })).body.error.code, "approval_hash_mismatch");
  assert.equal((await post({ version: 7 })).body.error.code, "not_found");
  assert.equal((await post({ url: "http://localhost:3000/" })).body.error.code, "url_not_allowed");
  assert.equal(kaneRuns(h.calls), 0);
});

test("one certification per project at a time; the queue is bounded", async () => {
  const h = await harness();
  const { projectId } = await approvedProject(h);
  const first = await h.call("POST", `/v1/projects/${projectId}/certifications`, { body: { version: 1, commit: COMMIT, confirmSpend: 100 } });
  const second = await h.call("POST", `/v1/projects/${projectId}/certifications`, { body: { version: 1, commit: COMMIT, confirmSpend: 100 } });
  assert.equal(first.status, 202);
  assert.deepEqual([second.status, second.body.error.code], [429, "job_limit_reached"]);
  await h.ctx.jobs.idle();
  assert.equal(kaneRuns(h.calls), 1, "no duplicate execution");
});

test("tampering with a stored record is detected and the public endpoint refuses it", async () => {
  const h = await harness();
  const { projectId } = await approvedProject(h);
  const { job } = await certify(h, projectId);
  const file = path.join(h.dataDir, "records", `${job.recordId}.json`);
  const rec = JSON.parse(await readFile(file, "utf8"));
  rec.status = "passed";
  rec.claims[0].status = "passed";
  rec.certified = true;
  rec.deployment.commit = OTHER;
  await writeFile(file, JSON.stringify(rec));
  const pub = await h.call("GET", `/v1/public/records/${job.recordId}`, { token: null });
  assert.deepEqual([pub.status, pub.body.error.code], [409, "run_record_invalid"]);
  const list = (await h.call("GET", `/v1/projects/${projectId}/records`)).body.records;
  assert.equal(list[0].integrity.ok, false);
});

test("records are permanent: every run gets its own id and earlier records stay readable", async () => {
  const h = await harness({ balance: [11076.5779, 10999.9376, 10999.9376, 10920] });
  const { projectId } = await approvedProject(h);
  const a = await certify(h, projectId);
  const b = await certify(h, projectId);
  assert.notEqual(a.job.recordId, b.job.recordId);
  for (const id of [a.job.recordId, b.job.recordId]) assert.equal((await h.call("GET", `/v1/public/records/${id}`, { token: null })).status, 200);
  assert.equal((await h.call("GET", `/v1/projects/${projectId}/records`)).body.records.length, 2);
});

test("a job left running by a crashed server is marked failed on restart, never re-run", async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "gl-server-recover-"));
  temps.push(dataDir);
  const store = new FileStore(dataDir);
  await store.putJob({ schema: "greenlight.job/v1", id: `job_${"a".repeat(32)}`, kind: "certification", projectId: `prj_${"b".repeat(32)}`, version: 1, status: "running", request: {}, createdAt: "2026-11-19T11:00:00.000Z" });
  let ran = 0;
  const jobs = new JobRunner({ store, config: { maxConcurrentJobs: 1, maxQueuedJobs: 5 }, deps: { now: () => new Date("2026-11-19T12:00:00Z"), runKane: async () => ran++ } });
  await jobs.recover();
  const j = await store.getJob(`job_${"a".repeat(32)}`);
  assert.deepEqual([j.status, j.error.code], ["failed", "interrupted"]);
  assert.equal(ran, 0);
});

test("certified can only be true for a passing certification run with stored evidence and a valid owner approval", () => {
  const project = { id: `prj_${"c".repeat(32)}`, name: "A", url: "https://a.example.com/" };
  const version = { version: 1, approvedTestHash: "a".repeat(64), claims: [{ id: "CLM-001", text: "x" }] };
  const approval = { schema: "greenlight.server-approval/v1", projectId: project.id, version: 1, approvedTestHash: "a".repeat(64), approvedBy: "dev", approvedAt: "2026-11-19T12:00:00.000Z", method: "server-owner", certifiable: true };
  approval.recordSha256 = selfHash(approval);
  const evaluation = { project: { status: "passed" }, run: { usable: true }, claims: [{ id: "CLM-001", status: "passed", tests: [] }] };
  const manifest = { runId: "cert-1", runKind: "certification", evidence: { status: "stored", sha256: "b".repeat(64) }, kane: {}, outputs: {} };
  const base = { id: `vr_${"d".repeat(32)}`, project, version, approval, deployment: { url: "https://a.example.com/", deployedCommit: COMMIT, environment: "preview" }, evaluation, manifest, credits: null, startedAt: "x", endedAt: "y", now: new Date() };
  assert.equal(buildVerificationRecord(base).certified, true);
  const variants = [
    { manifest: { ...manifest, runKind: "iteration" } }, // a developer-side iteration run
    { approval: { ...approval, method: "relayed-by-agent" } }, // relayed approval
    { approval: { ...approval, method: "local-terminal-confirmation" } }, // local-only approval
    { approval: { ...approval, approvedTestHash: "e".repeat(64) } }, // approval for other tests
    { approval: { ...approval, certifiable: false } },
    { manifest: { ...manifest, evidence: { status: "corrupted" } } },
    { evaluation: { ...evaluation, run: { usable: false } } },
    { evaluation: { ...evaluation, project: { status: "couldnt_verify" } } },
  ];
  for (const v of variants) assert.equal(buildVerificationRecord({ ...base, ...v }).certified, false, JSON.stringify(Object.keys(v)));
  const r = buildVerificationRecord(base);
  assert.equal(verifyRecordIntegrity(r).ok, true);
  assert.equal(verifyRecordIntegrity({ ...r, certified: false }).ok, false);
});
