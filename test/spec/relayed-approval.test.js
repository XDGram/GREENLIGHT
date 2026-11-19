// Relayed approval (controlled tests only). Mocks only: no Kane, network or credits.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import {
  approve,
  approveRelayed,
  checkApproval,
  isCertifiable,
  approvalRecordHash,
  loadProject,
  writeGenerated,
  APPROVAL_FILE,
  RELAYED_METHOD,
  HUMAN_METHOD,
} from "../../src/spec/index.js";

const E2E = readFileSync(new URL("../fixtures/spec/e2e/greenlight.yaml", import.meta.url), "utf8");
const RELAY = { GREENLIGHT_RELAYED_APPROVAL: "1" };
const temps = [];
after(() => Promise.all(temps.map((d) => rm(d, { recursive: true, force: true }))));

async function project(spec = E2E) {
  const root = await mkdtemp(path.join(os.tmpdir(), "gl-relay-"));
  temps.push(root);
  await writeFile(path.join(root, "greenlight.yaml"), spec);
  await writeGenerated(root);
  return { root, hash: (await loadProject(root)).hash };
}

test("relayed approval needs GREENLIGHT_RELAYED_APPROVAL=1 and the exact full hash", async () => {
  const { root, hash } = await project();
  const cases = [
    [{}, hash, "relayed_mode_not_enabled"],
    [{ GREENLIGHT_RELAYED_APPROVAL: "true" }, hash, "relayed_mode_not_enabled"],
    [RELAY, hash.slice(0, 12), "full_hash_required"],
    [RELAY, hash.toUpperCase(), "full_hash_required"],
    [RELAY, undefined, "full_hash_required"],
    [RELAY, "0".repeat(64), "hash_mismatch"],
  ];
  for (const [env, h, reason] of cases) {
    const r = await approveRelayed({ root, env, hash: h });
    assert.deepEqual([r.approved, r.reason], [false, reason]);
  }
  assert.equal(existsSync(path.join(root, APPROVAL_FILE)), false);
});

test("relayed approval refuses stale generated tests and invalid specs", async () => {
  const { root, hash } = await project();
  await writeFile(path.join(root, ".greenlight", "tests", "cart-add-two_test.md"), "edited");
  assert.equal((await approveRelayed({ root, env: RELAY, hash })).reason, "generated_tests_out_of_date");
  await writeFile(path.join(root, "greenlight.yaml"), "version: 1\n");
  assert.equal((await approveRelayed({ root, env: RELAY, hash })).reason, "spec_invalid");
});

test("a relayed approval is recorded as relayed-by-agent, never certifiable, and approves the tests", async () => {
  const { root, hash } = await project();
  const r = await approveRelayed({ root, env: RELAY, hash, now: () => new Date("2026-11-19T12:00:00Z") });
  assert.equal(r.approved, true);
  const rec = JSON.parse(await readFile(path.join(root, APPROVAL_FILE), "utf8"));
  assert.equal(rec.method, RELAYED_METHOD);
  assert.equal(rec.approvedBy, RELAYED_METHOD);
  assert.equal(rec.certifiable, false);
  assert.equal(rec.relayedFor, "controlled-test");
  assert.equal(rec.approvedHash, hash);
  assert.equal(rec.recordSha256, approvalRecordHash(rec));
  const s = await checkApproval(root);
  assert.deepEqual([s.status, s.method, s.certifiable], ["approved", RELAYED_METHOD, false]);
});

test("flipping a relayed approval to certifiable breaks its record hash", async () => {
  const { root, hash } = await project();
  await approveRelayed({ root, env: RELAY, hash });
  const file = path.join(root, APPROVAL_FILE);
  const rec = JSON.parse(await readFile(file, "utf8"));
  await writeFile(file, JSON.stringify({ ...rec, certifiable: true, method: HUMAN_METHOD }));
  assert.equal((await checkApproval(root)).status, "approval_corrupt");
});

test("isCertifiable: only a person's terminal approval", () => {
  assert.equal(isCertifiable({ method: HUMAN_METHOD, certifiable: true }), true);
  assert.equal(isCertifiable({ method: HUMAN_METHOD }), true, "human approvals recorded before this field existed");
  assert.equal(isCertifiable({ method: RELAYED_METHOD, certifiable: false }), false);
  assert.equal(isCertifiable({ method: RELAYED_METHOD, certifiable: true }), false, "relayed is never certifiable");
  assert.equal(isCertifiable({ method: "something-else" }), false);
  assert.equal(isCertifiable(null), false);
});

test("the normal human flow is unchanged: relayed mode does not let an agent use approve()", async () => {
  const { root, hash } = await project();
  const stdin = new PassThrough();
  stdin.isTTY = true;
  stdin.end(`${hash.slice(0, 12)}\n`);
  const stdout = new PassThrough();
  stdout.isTTY = true;
  stdout.resume();
  const r = await approve({ root, env: { ...RELAY, CLAUDECODE: "1" }, stdin, stdout });
  assert.deepEqual([r.approved, r.reason], [false, "agent_or_ci_environment"]);
  const stdin2 = new PassThrough();
  stdin2.isTTY = true;
  stdin2.end(`${hash.slice(0, 12)}\n`);
  const human = await approve({ root, env: { PATH: process.env.PATH }, stdin: stdin2, stdout, approver: () => "dev" });
  assert.equal(human.approved, true);
  const s = await checkApproval(root);
  assert.deepEqual([s.method, s.certifiable], [HUMAN_METHOD, true]);
});

test("changing the spec invalidates a relayed approval like any other", async () => {
  const { root, hash } = await project();
  await approveRelayed({ root, env: RELAY, hash });
  await writeFile(path.join(root, "greenlight.yaml"), E2E.replace('"Items in cart: 2"', '"Items in cart: 3"'));
  assert.equal((await checkApproval(root)).status, "invalidated");
});
