// File-backed store -> Supabase migration: dry run writes nothing, apply imports
// everything verifiable, re-running is idempotent, existing Supabase data is
// never overwritten, and nothing is dropped silently. Mocked Supabase (real
// migrations in PGlite); no network, Kane or credits.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { loadConfig, createServerContext, startServer, sha256Hex, SupabaseStore, FileStore, createSupabaseClient } from "../../src/server/index.js";
import { migrateFileStoreToSupabase } from "../../src/server/supabase/migrate.js";
import { fabricatedRun } from "../verify/helpers.js";
import { zipOf } from "../report/zip-helper.js";
import { createFakeSupabase } from "./fake-supabase.js";

const E2E = readFileSync(new URL("../fixtures/spec/e2e/greenlight.yaml", import.meta.url), "utf8");
const COMMIT = "dc6150b46a46a85efb4255113f0eddc5370621c8";
const EXEC_ID = "0a1b2c3d-0000-4000-8000-00000000000b";
const OWNER = "owner-token-migrate-0123456789";
const sha = (b) => createHash("sha256").update(b).digest("hex");

const temps = [];
const servers = [];
const fakes = [];
after(async () => {
  for (const s of servers) s.close();
  for (const f of fakes) await f.close();
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

/** Build a realistic file-backed data dir by driving the real server on a FileStore. */
async function fileBackedData() {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "gl-migrate-src-"));
  temps.push(dataDir);
  const config = loadConfig({ GREENLIGHT_DATA_DIR: dataDir, GREENLIGHT_PORT: "0", GREENLIGHT_API_TOKENS: JSON.stringify([{ name: "dev", role: "owner", account: "acme", sha256: sha256Hex(OWNER) }]) });
  let n = 0;
  const deps = {
    runKane: async (opts) => {
      n += 1;
      const store = path.join(opts.cwd, ".testmuai", "evidence");
      await mkdir(store, { recursive: true });
      await writeFile(path.join(store, `${EXEC_ID}.evidence`), zipOf({ "run.yaml": `status: finalized ${n}\n` }));
      const run = fabricatedRun({ members: [["cart-add-two_test.md", "passed"], ["newsletter-subscribe_test.md", n === 1 ? "passed" : "failed"]].map(([file, status], i) => ({ file, tags: [`clm-00${i + 1}`], status, mode: "authored" })) });
      run.stream.done.executionId = EXEC_ID;
      run.stream.summary.executionId = EXEC_ID;
      run.stream.summary.evidenceId = EXEC_ID;
      return { ...run, stdout: "{}\n", stderr: "", aborted: false };
    },
    readBalance: async () => ({ ok: true, balance: 11000 }),
    validator: async () => ({ exitCode: 0, stdout: '{"valid":true,"status":"finalized","diagnostics":[]}', stderr: "" }),
    verifyLiveDeployment: async (o) => ({ state: o.expectedCommit === COMMIT ? "ready" : "stale_deployment", reasons: o.expectedCommit === COMMIT ? [] : ["commit_mismatch"], safeToRunKane: o.expectedCommit === COMMIT, url: o.url, deployedCommit: COMMIT, expectedCommit: o.expectedCommit, environment: "preview" }),
    now: () => new Date(),
  };
  const ctx = await createServerContext({ config, deps });
  const server = await startServer({ config, ...ctx, now: deps.now });
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = async (method, p, body) => {
    const res = await fetch(base + p, { method, headers: { authorization: `Bearer ${OWNER}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return res.json();
  };
  const p = await call("POST", "/v1/projects", { name: "Shop", url: "https://gl-test.vercel.app/" });
  const v = await call("POST", `/v1/projects/${p.id}/versions`, { specText: E2E });
  await call("POST", `/v1/projects/${p.id}/versions/1/approval`, { confirmHash: v.approvedTestHash });
  await call("POST", `/v1/projects/${p.id}/versions`, { specText: E2E.replace("Items in cart: 2", "Items in cart: 3") }); // version 2, unapproved
  for (const body of [{ version: 1, commit: COMMIT, confirmSpend: 100 }, { version: 1, commit: COMMIT, confirmSpend: 100 }, { version: 1, commit: "1".repeat(40), confirmSpend: 100 }]) {
    await call("POST", `/v1/projects/${p.id}/certifications`, body);
    await ctx.jobs.idle();
  }
  server.close();
  return { dataDir, projectId: p.id, source: new FileStore(dataDir) };
}

async function supabase() {
  const fake = await createFakeSupabase();
  fakes.push(fake);
  const workDir = await mkdtemp(path.join(os.tmpdir(), "gl-migrate-work-"));
  temps.push(workDir);
  return { fake, target: new SupabaseStore({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: fake.fetch, workRoot: workDir }) };
}

const count = async (fake, table) => (await fake.sql(`select count(*)::int as n from greenlight.${table}`))[0].n;

test("dry run reads and compares only: nothing is written to Supabase", async () => {
  const { source } = await fileBackedData();
  const { fake, target } = await supabase();
  const r = await migrateFileStoreToSupabase({ source, target });
  assert.equal(r.mode, "dry_run");
  assert.ok(r.summary.wouldImport >= 7, JSON.stringify(r.summary));
  assert.equal(r.summary.imported, 0);
  for (const t of ["accounts", "projects", "test_versions", "approvals", "jobs", "runs", "certification_records"]) assert.equal(await count(fake, t), 0, t);
  assert.equal(fake.objects.size, 0);
});

test("apply imports projects, versions, approvals, jobs, records and verified evidence, preserving ids and history", async () => {
  const { source, projectId } = await fileBackedData();
  const { fake, target } = await supabase();
  const r = await migrateFileStoreToSupabase({ source, target, apply: true });
  assert.deepEqual([r.summary.conflicts, r.summary.refused], [0, 0], JSON.stringify(r));
  assert.equal(await count(fake, "projects"), 1);
  assert.deepEqual((await fake.sql("select version from greenlight.test_versions order by 1")).map((x) => x.version), [1, 2]);
  assert.equal(await count(fake, "approvals"), 1);
  assert.deepEqual((await fake.sql("select status, count(*)::int as n from greenlight.jobs group by 1 order by 1")), [{ status: "failed", n: 1 }, { status: "succeeded", n: 2 }]);
  assert.deepEqual((await fake.sql("select status, certified from greenlight.certification_records order by status")), [{ status: "failed", certified: false }, { status: "passed", certified: true }]);
  // Same records, byte for byte, and evidence uploaded with matching hashes.
  for (const rec of await source.listRecords(projectId)) {
    const stored = await target.getRecord(rec.id);
    assert.deepEqual(stored, rec);
    const ev = await target.verifyRunEvidence(rec.execution.runId);
    assert.deepEqual([ev.ok, ev.problems], [true, []]);
  }
  // The source is untouched.
  assert.equal((await source.listRecords(projectId)).length, 2);

  // Idempotent: a second apply imports nothing and changes nothing.
  const again = await migrateFileStoreToSupabase({ source, target, apply: true });
  assert.equal(again.summary.imported, 0);
  assert.deepEqual([again.summary.conflicts, again.summary.refused], [0, 0]);
  assert.ok(again.summary.skippedIdentical >= 7, JSON.stringify({ summary: again.summary, skipped: again.skippedIdentical.map((x) => x.kind), would: again.wouldImport }));
});

test("existing Supabase data is never overwritten: a differing project is a conflict and stays as it was", async () => {
  const { source, projectId } = await fileBackedData();
  const { fake, target } = await supabase();
  const admin = createSupabaseClient({ url: fake.url, serviceRoleKey: fake.serviceRoleKey, fetchImpl: fake.fetch });
  await admin.rpc("greenlight_ensure_account", { p_slug: "acme" });
  const theirs = { schema: "greenlight.project/v1", id: projectId, name: "Already here", url: "https://other.example.com/", account: "acme", createdBy: "someone", createdAt: "2026-01-01T00:00:00.000Z" };
  await admin.rpc("greenlight_create_project", { p_doc: theirs });
  const r = await migrateFileStoreToSupabase({ source, target, apply: true });
  assert.ok(r.conflicts.some((c) => c.kind === "project" && c.id === projectId));
  assert.deepEqual(await target.getProject(projectId), theirs, "unchanged");
  assert.equal(await count(fake, "test_versions"), 0, "nothing is attached to a project that is not ours");
  assert.ok(r.refused.filter((x) => x.kind === "job").length === 3 && r.refused.every((x) => x.kind !== "job" || /conflict/.test(x.reason)), "its jobs are refused with a reason, not crashed or dropped");
});

test("tampered records and missing evidence are refused and reported, never imported or dropped silently", async () => {
  const { source, dataDir, projectId } = await fileBackedData();
  const [first, second] = await source.listRecords(projectId);
  const file = path.join(dataDir, "records", `${first.id}.json`);
  const rec = JSON.parse(await readFile(file, "utf8"));
  rec.deployment.commit = "f".repeat(40); // any change breaks the record's own hash
  await writeFile(file, JSON.stringify(rec));
  await rm(path.join(dataDir, "evidence", (await source.listJobs()).find((j) => j.recordId === second.id).id), { recursive: true });
  const { fake, target } = await supabase();
  const r = await migrateFileStoreToSupabase({ source, target, apply: true });
  assert.ok(r.refused.some((x) => x.id === first.id && /record_hash_mismatch/.test(x.reason)), JSON.stringify(r.refused));
  assert.ok(r.refused.some((x) => x.id === second.id && /evidence_missing/.test(x.reason)), JSON.stringify(r.refused));
  assert.equal(await count(fake, "certification_records"), 0);
});

test("unfinished jobs are refused with a reason, not imported half-done", async () => {
  const { source, dataDir, projectId } = await fileBackedData();
  await source.putJob({ schema: "greenlight.job/v1", id: `job_${"7".repeat(32)}`, kind: "certification", projectId, version: 1, status: "running", request: {}, requestedBy: "dev", createdAt: new Date().toISOString() });
  const { target } = await supabase();
  const r = await migrateFileStoreToSupabase({ source, target, apply: true });
  assert.ok(r.refused.some((x) => x.id === `job_${"7".repeat(32)}` && /not_finished:running/.test(x.reason)));
  assert.ok(dataDir);
});
