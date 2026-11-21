// Runner tests use a fake Kane (test/fixtures/kane/fake-kane.mjs).
// Real Kane is never executed and no credits are used.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runKane, buildTestrunArgs, KANE_CLI_VERSION } from "../../src/kane/runner.js";

const FAKE = fileURLToPath(new URL("../fixtures/kane/fake-kane.mjs", import.meta.url));
const FIX = (p) => fileURLToPath(new URL(`../fixtures/kane/${p}`, import.meta.url));
const fake = (mode, extraEnv = {}, opts = {}) =>
  runKane({
    command: [process.execPath, FAKE],
    args: ["testrun", "run", "x_test.md", "--agent"],
    env: { ...process.env, FAKE_KANE_MODE: mode, ...extraEnv },
    timeoutMs: 20_000,
    killGraceMs: 2_000,
    ...opts,
  });

test("pins Kane CLI 0.10.6", () => {
  assert.equal(KANE_CLI_VERSION, "0.10.6");
});

for (const run of ["run1-authored", "run2-replay"]) {
  test(`${run}: captures stdout and stderr byte-for-byte, exit code, and the parsed stream`, async () => {
    const stdout = readFileSync(FIX(`${run}/stdout.ndjson`), "utf8");
    const stderr = readFileSync(FIX(`${run}/stderr.txt`), "utf8");
    const exit = Number(readFileSync(FIX(`${run}/exit_code.txt`), "utf8"));
    const seen = [];
    const r = await fake(
      "replay",
      { FAKE_KANE_STDOUT: FIX(`${run}/stdout.ndjson`), FAKE_KANE_STDERR: FIX(`${run}/stderr.txt`), FAKE_KANE_EXIT: String(exit) },
      { onEvent: (e) => seen.push(e.type ?? "untyped") },
    );
    assert.equal(r.stdout, stdout);
    assert.equal(r.stderr, stderr);
    assert.equal(r.exitCode, 1);
    assert.equal(r.signal, null);
    assert.equal(r.timedOut, false);
    assert.equal(r.versionMismatch, false);
    assert.deepEqual(r.signalsSent, []);
    assert.equal(r.nonJsonLines.length, 0);
    assert.equal(seen[0], "stream_start");
    assert.equal(seen.at(-1), "testrun_done");
    assert.equal(r.stream.members.length, 3);
    assert.equal(r.completeness.complete, true, r.completeness.reasons.join(","));
    assert.deepEqual(r.command.slice(-4), ["testrun", "run", "x_test.md", "--agent"]);
  });
}

test("a stream that stops early with exit 1 is reported incomplete, not as a result", async () => {
  const r = await fake("replay", {
    FAKE_KANE_STDOUT: FIX("run1-authored/stdout.ndjson"),
    FAKE_KANE_LINES: "5",
    FAKE_KANE_EXIT: "1",
  });
  assert.equal(r.exitCode, 1);
  assert.equal(r.completeness.complete, false);
  assert.ok(r.completeness.reasons.includes("missing_completion_event"));
  // First 5 lines: about_nav ended, cart started but never ended, subscribe never started.
  assert.deepEqual(r.completeness.membersWithoutEnd, ["cart_test.md", "subscribe_test.md"]);
  const cart = r.stream.members.find((m) => m.file === "cart_test.md");
  assert.equal(cart.attempts.length, 1);
  assert.equal(cart.attempts[0].end, null);
});

test("timeout: SIGINT first; a process that exits on SIGINT is not SIGKILLed", async () => {
  const r = await fake("graceful", {}, { timeoutMs: 300, killGraceMs: 3_000 });
  assert.equal(r.timedOut, true);
  assert.deepEqual(r.signalsSent.map((s) => s.signal), ["SIGINT"]);
  assert.equal(r.exitCode, 3);
  assert.equal(r.completeness.complete, false);
  assert.ok(r.completeness.reasons.includes("timed_out"));
  assert.ok(r.completeness.reasons.includes("missing_completion_event"));
  assert.equal(r.stream.streamStart.cliVersion, "0.10.6", "events before the timeout are kept");
});

test("timeout: SIGKILL follows when SIGINT is ignored", async () => {
  const r = await fake("stubborn", {}, { timeoutMs: 300, killGraceMs: 400 });
  assert.equal(r.timedOut, true);
  assert.deepEqual(r.signalsSent.map((s) => s.signal), ["SIGINT", "SIGKILL"]);
  assert.equal(r.signalsSent[1].reason, "timeout:grace_expired");
  assert.ok(r.signalsSent[1].atMs >= r.signalsSent[0].atMs + 350);
  assert.equal(r.exitCode, null);
  assert.equal(r.signal, "SIGKILL");
  assert.match(r.stderr, /ignoring SIGINT/);
  assert.ok(r.completeness.reasons.includes("no_exit_code"));
});

test("timeout reaches the real CLI behind a launcher that ignores SIGINT (process-group signal)", async () => {
  const r = await fake("launcher", {}, { timeoutMs: 500, killGraceMs: 5_000 });
  assert.equal(r.timedOut, true);
  assert.deepEqual(r.signalsSent.map((s) => s.signal), ["SIGINT"], "no SIGKILL needed");
  assert.equal(r.exitCode, 3, "launcher exits with the child's cancel code");
  assert.match(r.stderr, /cancelled/);
});

test("a different Kane version in stream_start aborts the run before it does work", async () => {
  const r = await fake("version", {}, { timeoutMs: 20_000 });
  assert.equal(r.versionMismatch, true);
  assert.equal(r.timedOut, false);
  assert.deepEqual(r.signalsSent.map((s) => [s.signal, s.reason]), [["SIGINT", "version_mismatch"]]);
  assert.equal(r.exitCode, 3);
  assert.equal(r.stream.streamStart.cliVersion, "0.9.9");
  assert.ok(r.completeness.reasons.includes("version_mismatch"));
});

test("version check can be disabled", async () => {
  const r = await fake("version", {}, { expectedVersion: null, timeoutMs: 300 });
  assert.equal(r.versionMismatch, false);
  assert.equal(r.timedOut, true);
});

test("stdin is /dev/null: not a TTY and immediately at end-of-file", async () => {
  const r = await fake("stdin");
  const probe = JSON.parse(r.stdout.split("\n").find((l) => l.includes("x_stdin")));
  assert.equal(probe.isTTY, false);
  assert.equal(probe.bytes, 0);
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.stream.unknownEventTypes, { x_stdin: 1 });
});

test("noisy stream: non-JSON skipped, unknown events counted, CRLF, split UTF-8, no final newline", async () => {
  const r = await fake("noise");
  assert.deepEqual(r.nonJsonLines.map((l) => l.reason), ["invalid_json", "not_an_object", "not_an_object", "invalid_json"]);
  assert.deepEqual(r.stream.unknownEventTypes, { brand_new_event: 1 });
  assert.equal(r.stream.untypedEvents, 1);
  assert.equal(r.stream.warnings[0].message, "dash — here");
  assert.equal(r.stream.plan.members[0].file, "a_test.md");
  assert.equal(r.stream.done.executionId, "e1");
});

test("an onEvent callback that throws does not break the run", async () => {
  const r = await fake(
    "replay",
    { FAKE_KANE_STDOUT: FIX("run2-replay/stdout.ndjson"), FAKE_KANE_EXIT: "1" },
    { onEvent: () => { throw new Error("boom"); } },
  );
  assert.equal(r.callbackErrors, r.stream.eventCount);
  assert.equal(r.completeness.complete, true);
});

test("a missing Kane binary is reported, not thrown", async () => {
  const r = await runKane({ command: "/nonexistent/kane-cli", args: ["--version"], timeoutMs: 5_000 });
  assert.match(r.spawnError, /ENOENT/);
  assert.equal(r.exitCode, null);
  assert.ok(r.completeness.reasons.includes("spawn_failed"));
});

test("runKane rejects a non-array args", () => {
  assert.throws(() => runKane({ args: "testrun run" }), /args must be an array/);
});

test("buildTestrunArgs: defaults include --agent --headless --no-adaptive-heal --local", () => {
  assert.deepEqual(
    buildTestrunArgs({ testFiles: ["a_test.md", "b_test.md"], startUrl: "https://x.vercel.app", runName: "gl-1" }),
    ["testrun", "run", "a_test.md", "b_test.md", "--agent", "--headless", "--no-adaptive-heal", "--local",
      "--override-start-url", "https://x.vercel.app", "--name", "gl-1"],
  );
});

test("buildTestrunArgs: --local and --no-adaptive-heal cannot be turned off; upload options are refused", () => {
  assert.deepEqual(buildTestrunArgs({ testFiles: ["a_test.md"], headless: false }), ["testrun", "run", "a_test.md", "--agent", "--no-adaptive-heal", "--local"]);
  assert.throws(() => buildTestrunArgs({ testFiles: ["a_test.md"], local: false }), /--local is mandatory/);
  assert.throws(() => buildTestrunArgs({ testFiles: ["a_test.md"], noAdaptiveHeal: false }), /--no-adaptive-heal is mandatory/);
  for (const bad of ["--push", "--author", "--remote", "--remote=lt", "--code-export", "--evidence-publish"]) {
    assert.throws(() => buildTestrunArgs({ testFiles: ["a_test.md"], extraArgs: [bad] }), /forbidden Kane option/, bad);
  }
});

test("buildTestrunArgs: validates inputs", () => {
  assert.throws(() => buildTestrunArgs({ testFiles: [] }), /non-empty/);
  assert.throws(() => buildTestrunArgs({ testFiles: ["a.md"] }), /_test\.md/);
  assert.throws(() => buildTestrunArgs({ testFiles: ["a_test.md"], startUrl: "ftp://x" }), /http/);
  assert.throws(() => buildTestrunArgs({ testFiles: ["a_test.md"], startUrl: "not a url" }), /invalid startUrl/);
  assert.throws(() => buildTestrunArgs({ testFiles: ["a_test.md"], runName: "bad name" }), /runName/);
});
