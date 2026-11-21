// CLI <-> server: greenlight submit, server-approve and publish against the real HTTP server
// (file store). Kane, the credit balance, the evidence validator and the deployment check are
// fakes on the server side; git is faked on the CLI side. No network beyond 127.0.0.1, no Kane.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { PassThrough } from "node:stream";
import { readFileSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { main, EXIT } from "../../src/cli/main.js";
import { writeGenerated, loadProject, approve } from "../../src/spec/index.js";
import { loadConfig, createServerContext, startServer, sha256Hex } from "../../src/server/index.js";
import { fabricatedRun } from "../verify/helpers.js";
import { zipOf } from "../report/zip-helper.js";

const E2E = readFileSync(new URL("../fixtures/spec/e2e/greenlight.yaml", import.meta.url), "utf8");
const COMMIT = "dc6150b46a46a85efb4255113f0eddc5370621c8";
const EXEC_ID = "0a1b2c3d-0000-4000-8000-0000000000aa";
const TOK = { owner: "owner-token-cli-0123456789abcdef", agent: "agent-token-cli-0123456789abcdef" };
const HUMAN = { PATH: process.env.PATH, HOME: process.env.HOME };
const temps = [];
const servers = [];
after(async () => {
  for (const s of servers) s.close();
  await Promise.all(temps.map((d) => rm(d, { recursive: true, force: true })));
});

async function server(statuses = { "cart-add-two_test.md": "passed", "newsletter-subscribe_test.md": "passed" }) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), "gl-link-srv-"));
  temps.push(dataDir);
  const config = loadConfig({
    GREENLIGHT_DATA_DIR: dataDir,
    GREENLIGHT_PORT: "0",
    GREENLIGHT_PUBLIC_BASE_URL: "https://greenlight.example.com",
    GREENLIGHT_API_TOKENS: JSON.stringify([
      { name: "dev", role: "owner", account: "acme", sha256: sha256Hex(TOK.owner) },
      { name: "claude", role: "agent", account: "acme", sha256: sha256Hex(TOK.agent) },
    ]),
  });
  const kaneCalls = [];
  const balances = [11076.5779, 10999.9376];
  const deps = {
    runKane: async (opts) => {
      kaneCalls.push(opts);
      const store = path.join(opts.cwd, ".testmuai", "evidence");
      await mkdir(store, { recursive: true });
      await writeFile(path.join(store, `${EXEC_ID}.evidence`), zipOf({ "run.yaml": "status: finalized\n" }));
      const run = fabricatedRun({ members: Object.entries(statuses).map(([file, status], i) => ({ file, tags: [`clm-00${i + 1}`], status, mode: "authored" })) });
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
  const ctx = await createServerContext({ config, deps });
  const s = await startServer({ config, ...ctx, now: deps.now });
  servers.push(s);
  return { url: `http://127.0.0.1:${s.address().port}`, kaneCalls };
}

async function repo({ humanApproval = true } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "gl-link-repo-"));
  temps.push(root);
  await writeFile(path.join(root, "greenlight.yaml"), E2E);
  await writeGenerated(root);
  const hash = (await loadProject(root)).hash;
  if (humanApproval) {
    const stdin = new PassThrough();
    stdin.isTTY = true;
    stdin.end(`${hash.slice(0, 12)}\n`);
    const stdout = new PassThrough();
    stdout.isTTY = true;
    stdout.resume();
    assert.equal((await approve({ root, env: HUMAN, stdin, stdout, approver: () => "dev" })).approved, true);
  }
  return { root, hash };
}

const git = async (args) => {
  const k = args.join(" ");
  if (k.startsWith("status")) return { code: 0, stdout: "" };
  if (k === "rev-parse HEAD" || k === "rev-parse @{u}") return { code: 0, stdout: `${COMMIT}\n` };
  if (k.startsWith("symbolic-ref")) return { code: 0, stdout: "main\n" };
  if (k.startsWith("rev-parse --abbrev-ref")) return { code: 0, stdout: "origin/main\n" };
  throw new Error(k);
};

async function cli(argv, { root, env, deps = {} }) {
  let out = "";
  let err = "";
  const o = new PassThrough();
  o.on("data", (c) => (out += c));
  const e = new PassThrough();
  e.on("data", (c) => (err += c));
  const stdin = new PassThrough();
  stdin.end();
  const code = await main([...argv, "--json"], { cwd: root, env, stdin, stdout: o, stderr: e, deps: { fetch: (...a) => fetch(...a), sleep: async () => {}, runGit: git, ...deps } });
  return { code, json: JSON.parse(out), err };
}

test("submit -> server-approve -> publish: the full CLI path to a server certification", async () => {
  const srv = await server();
  const { root, hash } = await repo();
  const agentEnv = { ...HUMAN, CLAUDECODE: "1", GREENLIGHT_API_URL: srv.url, GREENLIGHT_API_TOKEN: TOK.agent };
  const ownerEnv = { ...HUMAN, GREENLIGHT_API_URL: srv.url, GREENLIGHT_API_TOKEN: TOK.owner };

  // Claude (agent token) submits: creates the server project and proposes version 1.
  const s = await cli(["submit"], { root, env: agentEnv });
  assert.equal(s.code, EXIT.OK, s.err);
  assert.match(s.json.data.projectId, /^prj_[0-9a-f]{32}$/);
  assert.deepEqual([s.json.data.version, s.json.data.approvedTestHash, s.json.data.status], [1, hash, "pending_approval"]);
  const link = JSON.parse(await readFile(path.join(root, ".greenlight", "server.json"), "utf8"));
  assert.deepEqual(link, { schema: "greenlight.server-link/v1", projectId: s.json.data.projectId, version: 1, approvedTestHash: hash });

  // Submitting again re-uses the version; no duplicate.
  const again = await cli(["submit"], { root, env: agentEnv });
  assert.deepEqual([again.code, again.json.data.version], [EXIT.OK, 1]);

  // The agent can neither approve on the server nor publish.
  assert.equal((await cli(["server-approve"], { root, env: agentEnv, deps: { ask: async () => hash } })).json.error.code, "forbidden");
  assert.equal((await cli(["publish", "--confirm-spend", "100"], { root, env: agentEnv })).json.error.code, "forbidden");

  // Publishing before server approval is refused without starting a job.
  const early = await cli(["publish", "--confirm-spend", "100"], { root, env: ownerEnv });
  assert.equal(early.json.error.code, "approval_not_certifiable");

  // A person approves on the server: a wrong or partial hash changes nothing; the full hash approves.
  assert.equal((await cli(["server-approve"], { root, env: ownerEnv, deps: { ask: async () => hash.slice(0, 12) } })).json.error.code, "approval_refused");
  const a = await cli(["server-approve"], { root, env: ownerEnv, deps: { ask: async () => hash } });
  assert.equal(a.code, EXIT.OK, a.err);
  assert.deepEqual([a.json.data.status, a.json.data.approvedBy], ["approved", "dev"]);

  // publish needs only --confirm-spend now: fresh server-side run -> certified permanent record.
  const p = await cli(["publish", "--confirm-spend", "100"], { root, env: ownerEnv });
  assert.equal(p.code, EXIT.OK, p.err);
  assert.equal(p.json.data.record.certified, true);
  assert.equal(p.json.data.record.deployment.commit, COMMIT);
  assert.equal(srv.kaneCalls.length, 1, "exactly one fresh server-side Kane run");
});

test("submit: a changed spec becomes a new pending version; server-approve refuses a stale version", async () => {
  const srv = await server();
  const { root } = await repo({ humanApproval: false });
  const agentEnv = { ...HUMAN, CLAUDECODE: "1", GREENLIGHT_API_URL: srv.url, GREENLIGHT_API_TOKEN: TOK.agent };
  const ownerEnv = { ...HUMAN, GREENLIGHT_API_URL: srv.url, GREENLIGHT_API_TOKEN: TOK.owner };
  assert.equal((await cli(["submit"], { root, env: agentEnv })).json.data.version, 1);

  await writeFile(path.join(root, "greenlight.yaml"), E2E.replace("Items in cart: 2", "Items in cart: 3"));
  await writeGenerated(root);
  // Version 1 is no longer what greenlight.yaml says: approving it is refused.
  const stale = await cli(["server-approve", "--version", "1"], { root, env: ownerEnv, deps: { ask: async () => "x" } });
  assert.equal(stale.json.error.code, "approval_hash_mismatch");
  const v2 = await cli(["submit"], { root, env: agentEnv });
  assert.deepEqual([v2.code, v2.json.data.version, v2.json.data.status], [EXIT.OK, 2, "pending_approval"]);
  assert.equal(JSON.parse(await readFile(path.join(root, ".greenlight", "server.json"), "utf8")).version, 2);
});

test("submit and server-approve need the server settings and an interactive person", async () => {
  const { root } = await repo({ humanApproval: false });
  assert.equal((await cli(["submit"], { root, env: HUMAN })).json.error.code, "server_not_configured");
  const noTty = await cli(["server-approve"], { root, env: { ...HUMAN, GREENLIGHT_API_URL: "http://127.0.0.1:9", GREENLIGHT_API_TOKEN: TOK.owner }, deps: { ask: undefined } });
  assert.equal(noTty.json.error.code, "approval_refused");
  assert.equal((await cli(["server-approve"], { root, env: { ...HUMAN, CI: "1" } })).json.error.code, "forbidden");
});
