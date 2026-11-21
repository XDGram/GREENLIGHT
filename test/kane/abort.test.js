// runKane's optional abortSignal (added in Step 8 so Ctrl-C in the CLI reaches
// Kane, which runs in its own process group). Uses the fake Kane only.

import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { runKane } from "../../src/kane/runner.js";

const FAKE = fileURLToPath(new URL("../fixtures/kane/fake-kane.mjs", import.meta.url));
const run = (mode, opts) =>
  runKane({ command: [process.execPath, FAKE], args: ["testrun", "run"], env: { ...process.env, FAKE_KANE_MODE: mode }, timeoutMs: 20_000, killGraceMs: 2_000, ...opts });

test("aborting stops Kane behind its launcher with SIGINT and marks the run incomplete", async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 300);
  const r = await run("launcher", { abortSignal: ac.signal });
  assert.equal(r.aborted, true);
  assert.equal(r.timedOut, false);
  assert.deepEqual(r.signalsSent.map((s) => [s.signal, s.reason]), [["SIGINT", "aborted"]]);
  assert.equal(r.exitCode, 3);
  assert.ok(r.completeness.reasons.includes("aborted"));
});

test("an already-aborted signal never starts Kane", async () => {
  const ac = new AbortController();
  ac.abort();
  const r = await run("graceful", { abortSignal: ac.signal });
  assert.equal(r.aborted, true);
  assert.equal(r.stdout, "");
  assert.equal(r.exitCode, null);
  assert.deepEqual(r.signalsSent, []);
});

test("a run without abortSignal is unchanged", async () => {
  const r = await run("graceful", { timeoutMs: 200 });
  assert.equal(r.aborted, false);
  assert.equal(r.timedOut, true);
});
