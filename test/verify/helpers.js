// Build KaneRunResult objects for classification tests without running a process.
// Uses the real decoder, stream tracker and completeness check from src/kane.

import { readFileSync } from "node:fs";
import { NdjsonDecoder } from "../../src/kane/ndjson.js";
import { TestrunStream, assessCompleteness } from "../../src/kane/testrun-stream.js";

export const APPROVED_SMOKE = Object.freeze({
  tests: [
    { file: "cart_test.md", claims: ["CLM-001"] },
    { file: "subscribe_test.md", claims: ["CLM-002"] },
    { file: "about_nav_test.md", claims: ["CLM-003"] },
  ],
});

function resultFrom(stream, { exitCode, timedOut = false, versionMismatch = false, spawnError = null, signal = null }) {
  const snapshot = stream.snapshot();
  const proc = { exitCode, signal, timedOut, versionMismatch, spawnError };
  return { exitCode, signal, timedOut, versionMismatch, spawnError, stream: snapshot, completeness: assessCompleteness(snapshot, proc) };
}

/** A KaneRunResult built from a real fixture directory. */
export function runFromFixture(dir, { lines, ...proc } = {}) {
  let text = readFileSync(new URL(`../fixtures/kane/${dir}/stdout.ndjson`, import.meta.url), "utf8");
  if (lines !== undefined) text = text.split("\n").slice(0, lines).join("\n");
  const exitCode = "exitCode" in proc
    ? proc.exitCode
    : Number(readFileSync(new URL(`../fixtures/kane/${dir}/exit_code.txt`, import.meta.url), "utf8"));
  const stream = new TestrunStream();
  const d = new NdjsonDecoder({ onEvent: (e) => stream.apply(e) });
  d.push(text);
  d.end();
  return resultFrom(stream, { ...proc, exitCode });
}

/**
 * A fabricated, otherwise well-formed testrun.
 * members: [{file, tags, status?, mode?}] — status undefined means "no end event".
 */
export function fabricatedRun({
  members,
  exitCode,
  done = true,
  overallStatus,
  planValid = true,
  timedOut = false,
  cancelled = false,
  extraEvents = [],
}) {
  const s = new TestrunStream();
  const ev = (e) => s.apply({ ...e, v: 1 });
  ev({ type: "stream_start", cli_version: "0.10.6", surface: "testrun", pid: 1 });
  ev({ type: "testrun_plan", members: members.map((m) => ({ path: `/w/${m.file}`, tags: m.tags ?? [] })), valid: planValid, parallel: 1 });
  for (const m of members) {
    const mode = m.mode ?? "replay";
    const prefix = mode === "authored" ? "testrun_authored_member" : "testrun_member";
    ev({ type: `${prefix}_start`, path: `/w/${m.file}`, session_id: `s-${m.file}` });
    if (m.status !== undefined) {
      ev({
        type: `${prefix}_end`,
        path: mode === "authored" ? m.file : `/w/${m.file}`,
        status: m.status,
        duration_s: 1,
        session_id: `s-${m.file}`,
        log_path: `/logs/${m.file}.ndjson`,
        ...(m.status === "passed" ? {} : { failure: { message: m.message ?? "Final verification failed", step_index: 2 } }),
      });
    }
  }
  for (const e of extraEvents) ev(e);
  const ended = members.filter((m) => m.status !== undefined);
  const count = (st) => ended.filter((m) => m.status === st).length;
  ev({
    type: "testrun_summary",
    execution: { id: "exec-1", status: overallStatus ?? "failed" },
    authored: [],
    totals: { tests: members.length, passed: count("passed"), failed: count("failed"), broken: count("broken"), skipped: 0, authored: 0 },
    duration_s: 1,
    upload: "skipped",
    cancelled,
  });
  const allPassed = ended.length === members.length && ended.every((m) => m.status === "passed");
  if (done) ev({ type: "testrun_done", execution_id: "exec-1", overall_status: overallStatus ?? (allPassed ? "passed" : "failed") });
  return resultFrom(s, { exitCode: exitCode ?? (allPassed ? 0 : 1), timedOut });
}
