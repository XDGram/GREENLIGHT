// Deployment checker tests. Git and HTTP are mocked (one test uses a real
// local git repository with a local bare remote). No network, no Kane.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { readFileSync, existsSync } from "node:fs";
import { mkdtemp, writeFile, rm, readFile, readdir, chmod, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  verifyDeployment,
  checkOnce,
  requireReady,
  DeploymentNotReadyError,
  checkGit,
  gitRunner,
  redactUrl,
  redactText,
  endpointFor,
} from "../../src/deploy/index.js";

const PREVIEW = "https://gl-test-93mjujacr-timeb7208-5361s-projects.vercel.app";
const COMMIT = "dc6150b46a46a85efb4255113f0eddc5370621c8";
const OLD = "8f315c8a4da544f77af0e1df801cb07fbb597923";
const REAL_BODY = readFileSync(new URL("../fixtures/deploy/greenlight.json", import.meta.url), "utf8");

const temps = [];
after(() => Promise.all(temps.map((d) => rm(d, { recursive: true, force: true }))));

// No real network: any test that falls back to the global fetch fails loudly.
const realFetch = globalThis.fetch;
globalThis.fetch = () => {
  throw new Error("real network request attempted in a deploy test");
};
after(() => {
  globalThis.fetch = realFetch;
});

// ---------------------------------------------------------------- mocks

/** Git that is clean, on a branch, with HEAD pushed. Override any answer by args key. */
function fakeGit({ head = COMMIT, remote = COMMIT, dirty = "", overrides = {}, calls = [] } = {}) {
  const answers = {
    "status --porcelain=v1 --untracked-files=all": { code: 0, stdout: dirty },
    "rev-parse HEAD": { code: 0, stdout: `${head}\n` },
    "symbolic-ref --short -q HEAD": { code: 0, stdout: "main\n" },
    "rev-parse --abbrev-ref --symbolic-full-name @{u}": { code: 0, stdout: "origin/main\n" },
    "rev-parse @{u}": { code: 0, stdout: `${remote}\n` },
    [`merge-base --is-ancestor ${head} ${remote}`]: { code: 1, stdout: "" },
    "ls-remote --exit-code origin refs/heads/main": { code: 0, stdout: `${remote}\trefs/heads/main\n` },
    ...overrides,
  };
  return async (args) => {
    calls.push(args);
    const a = answers[args.join(" ")];
    if (!a) throw new Error(`unexpected git call: ${args.join(" ")}`);
    return { stderr: "", ...a };
  };
}

const json = (obj, status = 200) => new Response(typeof obj === "string" ? obj : JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

/** fetch that returns the given responses in order (repeating the last), recording calls. */
function fakeFetch(responses, calls = []) {
  let i = 0;
  return async (url, init) => {
    calls.push({ url, init });
    const r = responses[Math.min(i++, responses.length - 1)];
    if (r instanceof Error) throw r;
    return typeof r === "function" ? r() : r.clone();
  };
}

/** Clock that only moves when sleep() is called. */
function fakeTime() {
  let t = 0;
  const slept = [];
  return { clock: () => t, sleep: async (ms) => { slept.push(ms); t += ms; }, slept };
}

const run = (over = {}) => {
  const time = fakeTime();
  return verifyDeployment({ url: PREVIEW, runGit: fakeGit(), intervalMs: 5_000, timeoutMs: 30_000, ...time, ...over }).then((r) => ({ ...r, time }));
};

// ---------------------------------------------------------------- ready

test("matching commit on the real /greenlight.json response: ready on the first attempt", async () => {
  const calls = [];
  const r = await run({ fetchImpl: fakeFetch([new Response(REAL_BODY, { status: 200 })], calls), expectedEnvironment: "preview" });
  assert.equal(r.state, "ready");
  assert.deepEqual(r.reasons, []);
  assert.equal(r.safeToRunKane, true);
  assert.equal(r.deployedCommit, COMMIT);
  assert.equal(r.expectedCommit, COMMIT);
  assert.equal(r.environment, "preview");
  assert.equal(r.attempts.length, 1);
  assert.equal(r.endpoint, `${PREVIEW}/greenlight.json`);
  assert.equal(calls[0].url, `${PREVIEW}/greenlight.json`);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.headers["cache-control"], "no-cache");
  assert.equal(requireReady(r), r);
});

test("pending while the old deployment is still live, then ready when the new commit appears", async () => {
  const r = await run({
    fetchImpl: fakeFetch([
      json({ commit: OLD, environment: "preview" }),
      json("not found", 404),
      json("", 503),
      json({ commit: COMMIT, environment: "preview" }),
    ]),
  });
  assert.equal(r.state, "ready");
  assert.deepEqual(r.attempts.map((a) => [a.state, a.reason]), [
    ["pending", "commit_mismatch"],
    ["pending", "endpoint_missing"],
    ["pending", "http_503"],
    ["ready", null],
  ]);
  assert.deepEqual(r.time.slept, [5000, 5000, 5000]);
});

test("expected commit is compared exactly (case-normalised, whitespace trimmed)", async () => {
  assert.equal((await run({ fetchImpl: fakeFetch([json({ commit: ` ${COMMIT.toUpperCase()} `, environment: "preview" })]) })).state, "ready");
  const short = await run({ fetchImpl: fakeFetch([json({ commit: COMMIT.slice(0, 7), environment: "preview" })]) });
  assert.deepEqual([short.state, short.reasons], ["couldnt_verify", ["commit_missing_or_invalid"]], "a short SHA is not accepted");
});

// ---------------------------------------------------------------- stale / timeouts

test("stale deployment: still serving another commit when the time runs out", async () => {
  const r = await run({ fetchImpl: fakeFetch([json({ commit: OLD, environment: "preview" })]) });
  assert.equal(r.state, "stale_deployment");
  assert.deepEqual(r.reasons, ["commit_mismatch", "timed_out"]);
  assert.equal(r.safeToRunKane, false);
  assert.equal(r.deployedCommit, OLD);
  assert.equal(r.attempts.length, 7, "30 s timeout, 5 s interval: attempts at 0,5,...,30 s");
  assert.ok(r.elapsedMs <= 30_000);
  assert.throws(() => requireReady(r), DeploymentNotReadyError);
});

test("polling is bounded: a timeout of 0 makes exactly one attempt", async () => {
  const r = await run({ timeoutMs: 0, fetchImpl: fakeFetch([json({ commit: OLD, environment: "preview" })]) });
  assert.equal(r.attempts.length, 1);
  assert.equal(r.state, "stale_deployment");
  assert.deepEqual(r.time.slept, []);
});

test("missing endpoint until the timeout: couldnt_verify", async () => {
  const r = await run({ fetchImpl: fakeFetch([json("The page could not be found", 404)]) });
  assert.deepEqual([r.state, r.reasons], ["couldnt_verify", ["endpoint_missing", "timed_out"]]);
});

test("HTTP 5xx and 429 are retried; still failing at the timeout: couldnt_verify", async () => {
  const r = await run({ fetchImpl: fakeFetch([json("", 502), json("", 429), json("", 500)]) });
  assert.deepEqual([r.state, r.reasons], ["couldnt_verify", ["http_500", "timed_out"]]);
  assert.deepEqual(r.attempts.slice(0, 2).map((a) => a.httpStatus), [502, 429]);
});

test("network errors and request timeouts are retried, then reported", async () => {
  const timeoutErr = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  const r = await run({ fetchImpl: fakeFetch([new TypeError("fetch failed"), timeoutErr]) });
  assert.equal(r.state, "couldnt_verify");
  assert.deepEqual(r.attempts.slice(0, 2).map((a) => a.reason), ["network_error", "request_timeout"]);
  assert.deepEqual(r.reasons, ["request_timeout", "timed_out"]);
});

test("a real per-request timeout aborts a hanging server", async () => {
  // Like a real stalled connection, keep the event loop alive until aborted
  // (AbortSignal.timeout's own timer is unref'd).
  const hanging = (url, init) =>
    new Promise((_, reject) => {
      const keepAlive = setTimeout(() => {}, 10_000);
      init.signal.addEventListener("abort", () => {
        clearTimeout(keepAlive);
        reject(init.signal.reason);
      });
    });
  const r = await verifyDeployment({ url: PREVIEW, runGit: fakeGit(), fetchImpl: hanging, requestTimeoutMs: 50, timeoutMs: 0 });
  assert.deepEqual([r.state, r.attempts[0].reason], ["couldnt_verify", "request_timeout"]);
});

// ---------------------------------------------------------------- fatal responses (stop at once)

for (const [label, response, reason] of [
  ["malformed JSON", new Response("<html>not json</html>", { status: 200 }), "malformed_json"],
  ["JSON array", json([1, 2]), "malformed_json"],
  ["missing commit", json({ environment: "preview" }), "commit_missing_or_invalid"],
  ["non-hex commit", json({ commit: "z".repeat(40), environment: "preview" }), "commit_missing_or_invalid"],
  ["Vercel login redirect", new Response(null, { status: 302, headers: { location: "https://vercel.com/sso-api?url=x" } }), "redirected_possibly_protected"],
  ["401", json("", 401), "deployment_protected"],
  ["403", json("", 403), "deployment_protected"],
  ["400", json("", 400), "http_400"],
  ["oversized body", new Response("x".repeat(70 * 1024), { status: 200 }), "response_too_large"],
]) {
  test(`${label}: couldnt_verify immediately, no further polling`, async () => {
    const r = await run({ fetchImpl: fakeFetch([response]) });
    assert.deepEqual([r.state, r.reasons], ["couldnt_verify", [reason]]);
    assert.equal(r.attempts.length, 1);
    assert.equal(r.safeToRunKane, false);
  });
}

// ---------------------------------------------------------------- environment

test("environment must be present, allowed, and match when an expected one is set", async () => {
  const env = async (body, over = {}) => (await run({ fetchImpl: fakeFetch([json(body)]), ...over })).reasons;
  assert.deepEqual(await env({ commit: COMMIT }), ["environment_missing"]);
  assert.deepEqual(await env({ commit: COMMIT, environment: "development" }), ["environment_not_allowed"]);
  assert.deepEqual(await env({ commit: COMMIT, environment: "production" }, { expectedEnvironment: "preview" }), ["environment_mismatch"]);
  assert.deepEqual(await env({ commit: COMMIT, environment: "staging" }, { allowedEnvironments: ["staging"] }), []);
});

// ---------------------------------------------------------------- git

test("dirty working tree: couldnt_verify, and no HTTP request is made", async () => {
  const calls = [];
  const r = await run({ runGit: fakeGit({ dirty: " M src/app.js\n?? notes.txt\n" }), fetchImpl: fakeFetch([json({ commit: COMMIT, environment: "preview" })], calls) });
  assert.equal(r.state, "couldnt_verify");
  assert.ok(r.reasons.includes("dirty_working_tree"));
  assert.deepEqual(r.git.dirtyFiles, ["src/app.js", "notes.txt"]);
  assert.equal(calls.length, 0);
});

test("unpushed commit: couldnt_verify, no HTTP request", async () => {
  const calls = [];
  const r = await run({ runGit: fakeGit({ head: COMMIT, remote: OLD }), fetchImpl: fakeFetch([json({ commit: COMMIT })], calls) });
  assert.deepEqual([r.state, r.reasons], ["couldnt_verify", ["unpushed_commit"]]);
  assert.equal(calls.length, 0);
});

test("remote ahead of local HEAD (someone pushed more): couldnt_verify", async () => {
  const r = await run({ runGit: fakeGit({ head: OLD, remote: COMMIT, overrides: { [`merge-base --is-ancestor ${OLD} ${COMMIT}`]: { code: 0, stdout: "" } } }), fetchImpl: fakeFetch([]) });
  assert.deepEqual(r.reasons, ["remote_ahead_of_local"]);
});

test("expected commit must be HEAD", async () => {
  const r = await run({ expectedCommit: OLD, fetchImpl: fakeFetch([]) });
  assert.ok(r.reasons.includes("head_is_not_expected_commit"));
  assert.equal(r.expectedCommit, OLD);
});

test("detached HEAD, no upstream, git failures and unknown remote commit are reported", async () => {
  const cases = [
    [{ "symbolic-ref --short -q HEAD": { code: 1, stdout: "" } }, "detached_head"],
    [{ "rev-parse --abbrev-ref --symbolic-full-name @{u}": { code: 128, stdout: "" } }, "no_upstream"],
    [{ "status --porcelain=v1 --untracked-files=all": { code: 128, stdout: "" } }, "git_status_failed"],
    [{ "rev-parse HEAD": { code: 128, stdout: "" } }, "no_head_commit"],
    [{ "rev-parse @{u}": { code: 128, stdout: "" } }, "remote_commit_unknown"],
  ];
  for (const [overrides, reason] of cases) {
    const r = await run({ runGit: fakeGit({ overrides }), fetchImpl: fakeFetch([]) });
    assert.equal(r.state, "couldnt_verify");
    assert.ok(r.reasons.includes(reason), `${reason}: ${r.reasons}`);
  }
});

test("ls-remote mode asks the remote directly, and handles a missing branch or unreachable remote", async () => {
  const calls = [];
  const ok = await checkGit({ runGit: fakeGit({ calls }), remoteCheck: "ls-remote" });
  assert.equal(ok.ok, true);
  assert.ok(calls.some((c) => c[0] === "ls-remote"));
  assert.ok(!calls.some((c) => c.join(" ") === "rev-parse @{u}"));
  const missing = await checkGit({ runGit: fakeGit({ overrides: { "ls-remote --exit-code origin refs/heads/main": { code: 2, stdout: "" } } }), remoteCheck: "ls-remote" });
  assert.deepEqual(missing.reasons, ["remote_branch_missing"]);
  const down = await checkGit({ runGit: fakeGit({ overrides: { "ls-remote --exit-code origin refs/heads/main": { code: 128, stdout: "" } } }), remoteCheck: "ls-remote" });
  assert.deepEqual(down.reasons, ["remote_unreachable"]);
});

// ---------------------------------------------------------------- URLs and redaction

test("localhost and non-http URLs are refused before git or HTTP", async () => {
  for (const [url, reason] of [
    ["http://localhost:3000/", "localhost_not_allowed"],
    ["http://127.0.0.1:8080", "localhost_not_allowed"],
    ["http://app.localhost/", "localhost_not_allowed"],
    ["ftp://example.com/", "url_not_http"],
    ["not a url", "invalid_url"],
  ]) {
    const gitCalls = [];
    const fetchCalls = [];
    const r = await run({ url, runGit: fakeGit({ calls: gitCalls }), fetchImpl: fakeFetch([], fetchCalls) });
    assert.deepEqual([r.state, r.reasons], ["couldnt_verify", [reason]]);
    assert.equal(gitCalls.length + fetchCalls.length, 0);
  }
});

test("credentials, query and fragment never appear in results or logs; they are still used for the request", async () => {
  const secretUrl = `https://bob:hunter2pw@gl-test-93mjujacr-timeb7208-5361s-projects.vercel.app/app?x-vercel-protection-bypass=TOPSECRET123#frag`;
  const calls = [];
  const logs = [];
  const r = await run({
    url: secretUrl,
    fetchImpl: fakeFetch([new TypeError(`fetch failed for ${secretUrl}`), json({ commit: COMMIT, environment: "preview" })], calls),
    log: (e) => logs.push(e),
  });
  assert.equal(r.state, "ready");
  assert.equal(calls[0].url, `${PREVIEW}/greenlight.json?x-vercel-protection-bypass=TOPSECRET123`, "query kept on the request");
  assert.equal(calls[0].init.headers.authorization, `Basic ${Buffer.from("bob:hunter2pw").toString("base64")}`);
  const visible = JSON.stringify({ r, logs });
  for (const s of ["TOPSECRET123", "hunter2pw", "bob:", "frag", "x-vercel-protection-bypass"]) {
    assert.equal(visible.includes(s), false, `${s} leaked`);
  }
  assert.equal(r.url, `${PREVIEW}/app?REDACTED`);
  assert.equal(r.endpoint, `${PREVIEW}/greenlight.json?REDACTED`);
  assert.match(r.attempts[0].error, /fetch failed for REDACTED/);
  assert.ok(logs.some((l) => l.event === "attempt") && logs.at(-1).event === "result");
});

test("redaction helpers", () => {
  assert.equal(redactUrl("https://u:p@h.example.com/a/b?q=1#f"), "https://h.example.com/a/b?REDACTED");
  assert.equal(redactUrl("https://h.example.com"), "https://h.example.com/");
  assert.equal(redactUrl("::bad"), "<invalid url>");
  assert.equal(redactText("token=abc123 in https://h.example.com/?token=abc123", "https://h.example.com/?token=abc123"), "REDACTED in REDACTED");
  assert.equal(endpointFor("https://h.example.com/deep/path/").requestUrl, "https://h.example.com/greenlight.json", "endpoint is at the site root");
});

test("input checks", async () => {
  await assert.rejects(verifyDeployment({ url: PREVIEW, intervalMs: -1 }), /intervalMs/);
  await assert.rejects(verifyDeployment({ url: PREVIEW, timeoutMs: NaN }), /timeoutMs/);
  await assert.rejects(verifyDeployment({ url: PREVIEW, requestTimeoutMs: 0 }), /requestTimeoutMs/);
  await assert.rejects(verifyDeployment({ url: PREVIEW, expectedCommit: "dc6150b" }), /expectedCommit/);
  assert.throws(() => requireReady(null), DeploymentNotReadyError);
  assert.throws(() => requireReady({ state: "ready", safeToRunKane: false }), DeploymentNotReadyError);
});

test("checkOnce never reports ready for a mismatched commit", async () => {
  const endpoint = endpointFor(PREVIEW);
  const a = await checkOnce({ endpoint, expectedCommit: COMMIT, allowedEnvironments: ["preview"], fetchImpl: fakeFetch([json({ commit: OLD, environment: "preview" })]), requestTimeoutMs: 1000, baseUrl: PREVIEW });
  assert.deepEqual([a.outcome, a.reason, a.deployedCommit], ["stale", "commit_mismatch", OLD]);
});

// ---------------------------------------------------------------- independence from Kane

test("the deploy module imports nothing from Kane or credits, and only git spawns processes", async () => {
  const dir = fileURLToPath(new URL("../../src/deploy/", import.meta.url));
  for (const f of await readdir(dir)) {
    const src = await readFile(path.join(dir, f), "utf8");
    assert.equal(/from\s+["']\.\.\/(kane|credits|evidence|verify)\//.test(src), false, `${f} imports another Greenlight module`);
    assert.equal(/kane-cli|runKane/.test(src.replace(/\/\/.*$/gm, "")), false, `${f} mentions Kane in code`);
    if (f !== "git.js") assert.equal(/child_process/.test(src), false, `${f} uses child_process`);
  }
  const git = await readFile(path.join(dir, "git.js"), "utf8");
  assert.match(git, /execFile\("git",/);
  const refused = await gitRunner(os.tmpdir())(["push", "origin", "main"]);
  assert.match(refused.stderr, /refused git subcommand: push/);
});

test("end to end with a real local git repo and remote: ready, and no Kane binary is ever executed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gl-deploy-"));
  temps.push(root);
  const g = (cwd, ...args) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@example.invalid", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
  const remote = path.join(root, "remote.git");
  const work = path.join(root, "work");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", work]);
  await writeFile(path.join(work, "index.html"), "<h1>app</h1>\n");
  g(work, "add", ".");
  g(work, "commit", "-q", "-m", "app");
  g(work, "remote", "add", "origin", remote);

  // A booby-trapped kane-cli first on PATH: it records any execution.
  const bin = path.join(root, "bin");
  await mkdir(bin);
  const marker = path.join(root, "KANE_WAS_RUN");
  await writeFile(path.join(bin, "kane-cli"), `#!/bin/sh\necho "$@" > "${marker}"\n`);
  await chmod(path.join(bin, "kane-cli"), 0o755);
  const savedPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${savedPath}`;
  try {
    const head = g(work, "rev-parse", "HEAD");
    const body = (commit) => json({ commit, environment: "preview" });

    let r = await verifyDeployment({ url: PREVIEW, cwd: work, fetchImpl: fakeFetch([body(head)]), timeoutMs: 0 });
    assert.deepEqual([r.state, r.reasons], ["couldnt_verify", ["no_upstream"]], "not pushed yet");

    g(work, "push", "-q", "-u", "origin", "main");
    r = await verifyDeployment({ url: PREVIEW, cwd: work, fetchImpl: fakeFetch([body(head)]), timeoutMs: 0, expectedEnvironment: "preview" });
    assert.equal(r.state, "ready", r.reasons.join(","));
    assert.equal(r.git.head, head);
    assert.equal(r.git.upstream, "origin/main");

    r = await verifyDeployment({ url: PREVIEW, cwd: work, fetchImpl: fakeFetch([body(head)]), timeoutMs: 0, remoteCheck: "ls-remote" });
    assert.equal(r.state, "ready", "ls-remote against a local bare remote");

    await writeFile(path.join(work, "index.html"), "<h1>changed</h1>\n");
    r = await verifyDeployment({ url: PREVIEW, cwd: work, fetchImpl: fakeFetch([body(head)]), timeoutMs: 0 });
    assert.deepEqual(r.reasons, ["dirty_working_tree"]);

    g(work, "commit", "-q", "-am", "change");
    r = await verifyDeployment({ url: PREVIEW, cwd: work, fetchImpl: fakeFetch([body(head)]), timeoutMs: 0 });
    assert.deepEqual(r.reasons, ["unpushed_commit"]);

    g(work, "push", "-q");
    r = await verifyDeployment({ url: PREVIEW, cwd: work, fetchImpl: fakeFetch([body(head)]), timeoutMs: 0 });
    assert.deepEqual([r.state, r.deployedCommit], ["stale_deployment", head], "pushed, but the live URL still serves the old commit");
  } finally {
    process.env.PATH = savedPath;
  }
  assert.equal(existsSync(marker), false, "kane-cli was executed");
});
