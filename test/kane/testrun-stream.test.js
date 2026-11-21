import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NdjsonDecoder } from "../../src/kane/ndjson.js";
import { TestrunStream, assessCompleteness, memberKey } from "../../src/kane/testrun-stream.js";

const fixture = (name) => readFileSync(new URL(`../fixtures/kane/${name}`, import.meta.url), "utf8");
const OK_PROC = { exitCode: 1, signal: null, timedOut: false, versionMismatch: false, spawnError: null };

function streamFrom(text) {
  const s = new TestrunStream();
  const d = new NdjsonDecoder({ onEvent: (e) => s.apply(e) });
  d.push(text);
  d.end();
  return s.snapshot();
}

const byFile = (snap) => Object.fromEntries(snap.members.map((m) => [m.file, m]));

test("Run 1 (authored): all three tests reported through the authoring events", () => {
  const s = streamFrom(fixture("run1-authored/stdout.ndjson"));
  assert.equal(s.streamStart.cliVersion, "0.10.6");
  assert.equal(s.plan.valid, true);
  assert.equal(s.start, null, "authoring-only runs emit no testrun_start");
  const m = byFile(s);
  assert.deepEqual(Object.keys(m).sort(), ["about_nav_test.md", "cart_test.md", "subscribe_test.md"]);
  for (const f of Object.keys(m)) {
    assert.equal(m[f].inPlan, true);
    assert.equal(m[f].attempts.length, 1);
    assert.equal(m[f].final.mode, "authored");
    assert.ok(m[f].path.startsWith("/"), "keeps the absolute path from the plan, not the bare end-event name");
  }
  assert.deepEqual(m["cart_test.md"].tags, ["clm-001"]);
  assert.equal(m["cart_test.md"].final.status, "passed");
  assert.equal(m["about_nav_test.md"].final.status, "passed");
  assert.equal(m["subscribe_test.md"].final.status, "failed");
  assert.equal(m["subscribe_test.md"].final.failure.step_index, 3);
  assert.match(m["subscribe_test.md"].final.failure.message, /Final verification failed/);
  assert.equal(m["subscribe_test.md"].final.sessionId, "b843d413-1234-483b-8849-e089559cbc12");
  assert.match(m["subscribe_test.md"].final.logPath, /events\.ndjson$/);

  assert.deepEqual(s.summary.totals, { tests: 3, passed: 2, failed: 1, broken: 0, skipped: 0, authored: 3 });
  assert.equal(s.summary.upload, "ok");
  assert.equal(s.summary.authored.length, 3);
  assert.equal(s.evidenceIngest.length, 1);
  assert.equal(s.done.executionId, "553326c5-1953-485e-89e4-308bd415c7b4");
  assert.equal(s.done.overallStatus, "failed");
  assert.deepEqual(s.contractVersions, [1]);
  assert.deepEqual(s.unknownEventTypes, {});

  const c = assessCompleteness(s, OK_PROC);
  assert.equal(c.complete, true, c.reasons.join(","));
});

test("Run 2 (replay): all three tests reported through the replay events", () => {
  const s = streamFrom(fixture("run2-replay/stdout.ndjson"));
  assert.equal(s.start.executionId, "412b9281-8d80-4ea2-a6ef-7d2f348f21b2");
  assert.equal(s.start.overrideStartUrl, "https://gl-test-93mjujacr-timeb7208-5361s-projects.vercel.app");
  const m = byFile(s);
  for (const f of Object.keys(m)) assert.equal(m[f].final.mode, "replay");
  assert.equal(m["subscribe_test.md"].final.status, "failed");
  assert.equal(m["cart_test.md"].final.status, "passed");
  assert.equal(s.summary.upload, "skipped");
  assert.equal(s.summary.totals.authored, 0);
  assert.equal(s.evidenceIngest.length, 0, "--local: no evidence publish event");
  assert.equal(s.done.overallStatus, "failed");
  assert.equal(assessCompleteness(s, OK_PROC).complete, true);
});

test("stream cut off before testrun_done is reported incomplete, with the missing pieces", () => {
  const lines = fixture("run2-replay/stdout.ndjson").split("\n");
  const cut = lines.findIndex((l) => l.includes('"testrun_member_start"') && l.includes("subscribe_test.md"));
  const s = streamFrom(lines.slice(0, cut + 1).join("\n"));
  const c = assessCompleteness(s, OK_PROC);
  assert.equal(c.complete, false);
  assert.ok(c.reasons.includes("missing_completion_event"));
  assert.ok(c.reasons.includes("missing_summary"));
  assert.ok(c.reasons.includes("members_without_end"));
  assert.deepEqual(c.membersWithoutEnd, ["subscribe_test.md"]);
  // The members that did finish keep Kane's reported status.
  assert.equal(byFile(s)["cart_test.md"].final.status, "passed");
  assert.equal(byFile(s)["subscribe_test.md"].final, null);
});

test("empty stream: every structural piece is reported missing", () => {
  const c = assessCompleteness(streamFrom(""), { ...OK_PROC, exitCode: 2 });
  assert.equal(c.complete, false);
  for (const r of ["missing_stream_start", "missing_plan", "missing_summary", "missing_completion_event"]) {
    assert.ok(c.reasons.includes(r), r);
  }
});

test("invalid plan, cancellation, mismatched totals and ids are flagged", () => {
  const s = new TestrunStream();
  s.apply({ type: "stream_start", cli_version: "0.10.6", v: 1 });
  s.apply({ type: "testrun_plan", members: [{ path: "/w/a_test.md", failure: "org_mismatch" }], valid: false, v: 1 });
  s.apply({ type: "testrun_summary", execution: { id: "x1" }, totals: { tests: 2 }, cancelled: true, v: 1 });
  s.apply({ type: "testrun_done", execution_id: "x2", overall_status: "cancelled", v: 1 });
  const snap = s.snapshot();
  assert.equal(snap.plan.members[0].failure, "org_mismatch");
  const c = assessCompleteness(snap, { ...OK_PROC, exitCode: 3 });
  for (const r of ["plan_invalid", "cancelled", "totals_mismatch", "execution_id_mismatch", "members_without_end"]) {
    assert.ok(c.reasons.includes(r), r);
  }
});

test("process-level facts are passed through as reasons", () => {
  const snap = streamFrom(fixture("run1-authored/stdout.ndjson"));
  const c = assessCompleteness(snap, { exitCode: null, signal: "SIGKILL", timedOut: true, versionMismatch: true, spawnError: "ENOENT" });
  for (const r of ["timed_out", "version_mismatch", "no_exit_code", "spawn_failed"]) assert.ok(c.reasons.includes(r), r);
});

test("unknown and untyped events are counted and otherwise ignored", () => {
  const s = new TestrunStream();
  s.apply({ type: "brand_new_event", v: 1 });
  s.apply({ type: "brand_new_event", v: 1 });
  s.apply({ step: 1, status: "running", remark: "progress line" });
  s.apply({ type: "testrun_progress", running: [], v: 1 });
  const snap = s.snapshot();
  assert.deepEqual(snap.unknownEventTypes, { brand_new_event: 2 });
  assert.equal(snap.untypedEvents, 1);
  assert.equal(snap.eventCount, 4);
});

test("a test that replays then is authored keeps both attempts; the last end is final", () => {
  const s = new TestrunStream();
  s.apply({ type: "testrun_plan", members: [{ path: "/w/a_test.md", tags: ["t"] }], valid: true });
  s.apply({ type: "testrun_member_start", path: "/w/a_test.md", session_id: "s1" });
  s.apply({ type: "testrun_member_end", path: "/w/a_test.md", status: "broken", session_id: "s1" });
  s.apply({ type: "testrun_authored_member_start", path: "/w/a_test.md", session_id: "s2" });
  s.apply({ type: "testrun_authored_member_end", path: "a_test.md", status: "passed", session_id: "s2" });
  const [m] = s.snapshot().members;
  assert.equal(m.attempts.length, 2);
  assert.deepEqual(m.attempts.map((a) => [a.mode, a.end.status]), [["replay", "broken"], ["authored", "passed"]]);
  assert.equal(m.final.mode, "authored");
  assert.equal(m.final.status, "passed");
  assert.equal(m.final.sessionId, "s2");
});

test("an end event without a start, and a test not in the plan, are still recorded", () => {
  const s = new TestrunStream();
  s.apply({ type: "testrun_plan", members: [{ path: "/w/a_test.md" }], valid: true });
  s.apply({ type: "testrun_member_end", path: "/w/a_test.md", status: "passed" });
  s.apply({ type: "testrun_member_end", path: "/w/zzz_test.md", status: "failed" });
  const snap = s.snapshot();
  const m = byFile(snap);
  assert.equal(m["a_test.md"].attempts[0].start, null);
  assert.equal(m["a_test.md"].final.status, "passed");
  assert.equal(m["zzz_test.md"].inPlan, false);
  const c = assessCompleteness(snap, OK_PROC);
  assert.deepEqual(c.unplannedMembers, ["zzz_test.md"]);
  assert.ok(c.reasons.includes("unplanned_members"));
});

test("events after the completion event are counted; the first testrun_done wins", () => {
  const s = new TestrunStream();
  s.apply({ type: "testrun_done", execution_id: "e1", overall_status: "passed" });
  s.apply({ type: "testrun_done", execution_id: "e2", overall_status: "failed" });
  const snap = s.snapshot();
  assert.equal(snap.done.executionId, "e1");
  assert.equal(snap.eventsAfterCompletion, 1);
});

test("memberKey matches absolute and bare paths", () => {
  assert.equal(memberKey("/a/b/cart_test.md"), "cart_test.md");
  assert.equal(memberKey("cart_test.md"), "cart_test.md");
  assert.equal(memberKey(undefined), "");
});
