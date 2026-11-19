// Tracks the state of one `kane-cli testrun run --agent` stream.
//
// This module records what Kane reported. It deliberately does NOT classify
// results (passed / app_failure / couldnt_verify): that is Step 2. The only
// judgements made here are about the stream itself: did it start, did every
// planned test report an end, did the completion event arrive.
//
// Event shapes verified against Kane CLI 0.10.6 (fixtures run1-authored and
// run2-replay):
//   stream_start                    {cli_version, surface, pid}
//   testrun_plan                    {members: [{path, tags}], valid, parallel}
//   testrun_start                   {execution_id, members, parallel, override_start_url?}   (replay pass only)
//   testrun_member_start / _end     replay pass
//   testrun_authored_member_start / _end   authoring pass (path may be a bare file name)
//   *_end                           {path, test_id?, status, duration_s, session_id, log_path, failure?}
//   testrun_progress                informational
//   testrun_evidence_ingest         {status, evidence_id}
//   testrun_summary                 {execution, authored, totals, duration_s, upload, cancelled}
//   testrun_done                    {execution_id, overall_status, coverage?}   <- completion event
// Every line also carries `v` (contract version) and `ts`.

import path from "node:path";

export const COMPLETION_EVENT = "testrun_done";
export const STREAM_CONTRACT_VERSION = 1;

const MEMBER_START = new Map([
  ["testrun_member_start", "replay"],
  ["testrun_authored_member_start", "authored"],
]);
const MEMBER_END = new Map([
  ["testrun_member_end", "replay"],
  ["testrun_authored_member_end", "authored"],
]);

// Event types this module understands. Anything else is counted as unknown
// and otherwise ignored, as the Kane stream contract requires.
const KNOWN_TYPES = new Set([
  "stream_start",
  "testrun_plan",
  "testrun_start",
  ...MEMBER_START.keys(),
  ...MEMBER_END.keys(),
  "testrun_progress",
  "testrun_investigations_wait",
  "testrun_evidence_ingest",
  "testrun_summary",
  COMPLETION_EVENT,
  "warning",
  "error",
  "coverage",
  "verdict",
  "recording_state",
  "update_available",
  "skill_update_available",
]);

/** Kane reports test paths sometimes absolute, sometimes bare. Match by file name. */
export function memberKey(memberPath) {
  return path.basename(String(memberPath ?? ""));
}

export class TestrunStream {
  constructor() {
    this.streamStart = null;
    this.plan = null;
    this.start = null;
    this.summary = null;
    this.done = null;
    this.evidenceIngest = [];
    this.warnings = [];
    this.errors = [];
    this.coverage = [];
    this.verdicts = [];
    /** @type {Map<string, object>} file name -> member record */
    this.members = new Map();
    this.unknownEventTypes = {};
    this.untypedEvents = 0;
    this.eventCount = 0;
    this.contractVersions = new Set();
    this.eventsAfterCompletion = 0;
  }

  /** Feed one parsed event. Never throws on unexpected shapes. */
  apply(event) {
    this.eventCount += 1;
    if (event.v !== undefined) this.contractVersions.add(event.v);
    if (this.done) this.eventsAfterCompletion += 1;

    const type = typeof event.type === "string" ? event.type : null;
    if (type === null) {
      this.untypedEvents += 1;
      return;
    }
    if (!KNOWN_TYPES.has(type)) {
      this.unknownEventTypes[type] = (this.unknownEventTypes[type] ?? 0) + 1;
      return;
    }

    switch (type) {
      case "stream_start":
        this.streamStart ??= {
          cliVersion: event.cli_version ?? null,
          surface: event.surface ?? null,
          pid: event.pid ?? null,
          ts: event.ts ?? null,
        };
        break;
      case "testrun_plan":
        this.plan = {
          valid: event.valid === true,
          parallel: event.parallel ?? null,
          members: Array.isArray(event.members)
            ? event.members.map((m) => ({
                file: memberKey(m?.path),
                path: m?.path ?? null,
                tags: Array.isArray(m?.tags) ? [...m.tags] : [],
                failure: m?.failure ?? null,
              }))
            : [],
          raw: event,
        };
        for (const m of this.plan.members) this.#member(m.file, { path: m.path, tags: m.tags, inPlan: true });
        break;
      case "testrun_start":
        this.start = {
          executionId: event.execution_id ?? null,
          overrideStartUrl: event.override_start_url ?? null,
          parallel: event.parallel ?? null,
          raw: event,
        };
        break;
      case "testrun_evidence_ingest":
        this.evidenceIngest.push({ status: event.status ?? null, evidenceId: event.evidence_id ?? null, raw: event });
        break;
      case "testrun_summary":
        this.summary = {
          executionId: event.execution?.id ?? null,
          executionStatus: event.execution?.status ?? null,
          evidenceId: event.execution?.evidence_id ?? null,
          totals: event.totals ?? null,
          authored: Array.isArray(event.authored) ? event.authored : [],
          durationS: event.duration_s ?? null,
          upload: event.upload ?? null,
          cancelled: event.cancelled ?? null,
          raw: event,
        };
        break;
      case COMPLETION_EVENT:
        this.done ??= {
          executionId: event.execution_id ?? null,
          overallStatus: event.overall_status ?? null,
          raw: event,
        };
        break;
      case "warning":
        this.warnings.push(event);
        break;
      case "error":
        this.errors.push(event);
        break;
      case "coverage":
        this.coverage.push(event);
        break;
      case "verdict":
        this.verdicts.push(event);
        break;
      default:
        if (MEMBER_START.has(type)) this.#memberStart(MEMBER_START.get(type), event);
        else if (MEMBER_END.has(type)) this.#memberEnd(MEMBER_END.get(type), event);
        // testrun_progress, recording_state, update notices: informational only.
        break;
    }
  }

  #member(file, init = {}) {
    let m = this.members.get(file);
    if (!m) {
      m = { file, path: null, tags: [], inPlan: false, attempts: [] };
      this.members.set(file, m);
    }
    if (init.path && (!m.path || path.isAbsolute(init.path))) m.path = init.path;
    if (init.tags?.length) m.tags = init.tags;
    if (init.inPlan) m.inPlan = true;
    return m;
  }

  #memberStart(mode, event) {
    const m = this.#member(memberKey(event.path), { path: event.path });
    m.attempts.push({
      mode,
      start: { testId: event.test_id ?? null, sessionId: event.session_id ?? null, logPath: event.log_path ?? null, ts: event.ts ?? null },
      end: null,
    });
  }

  #memberEnd(mode, event) {
    const m = this.#member(memberKey(event.path), { path: event.path });
    let attempt = [...m.attempts].reverse().find((a) => a.mode === mode && a.end === null);
    if (!attempt) {
      // End without a matching start: still record what Kane said.
      attempt = { mode, start: null, end: null };
      m.attempts.push(attempt);
    }
    attempt.end = {
      status: event.status ?? null,
      durationS: event.duration_s ?? null,
      testId: event.test_id ?? null,
      sessionId: event.session_id ?? null,
      logPath: event.log_path ?? null,
      failure: event.failure ?? null,
      ts: event.ts ?? null,
      raw: event,
    };
  }

  /** Plain-data view of everything Kane reported. */
  snapshot() {
    const members = [...this.members.values()].map((m) => {
      const ended = m.attempts.filter((a) => a.end);
      const last = ended.at(-1) ?? null;
      return {
        file: m.file,
        path: m.path,
        tags: m.tags,
        inPlan: m.inPlan,
        attempts: m.attempts,
        // Kane's own final per-test report, unclassified.
        final: last
          ? {
              mode: last.mode,
              status: last.end.status,
              durationS: last.end.durationS,
              testId: last.end.testId,
              sessionId: last.end.sessionId,
              logPath: last.end.logPath,
              failure: last.end.failure,
            }
          : null,
      };
    });
    return {
      streamStart: this.streamStart,
      plan: this.plan,
      start: this.start,
      members,
      summary: this.summary,
      done: this.done,
      evidenceIngest: this.evidenceIngest,
      warnings: this.warnings,
      errors: this.errors,
      coverage: this.coverage,
      verdicts: this.verdicts,
      unknownEventTypes: this.unknownEventTypes,
      untypedEvents: this.untypedEvents,
      eventCount: this.eventCount,
      contractVersions: [...this.contractVersions],
      eventsAfterCompletion: this.eventsAfterCompletion,
    };
  }
}

/**
 * Facts about whether the run finished cleanly. Not a test verdict.
 * @param {ReturnType<TestrunStream["snapshot"]>} s
 * @param {{exitCode: number|null, signal: string|null, timedOut: boolean, versionMismatch: boolean, spawnError: string|null}} proc
 */
export function assessCompleteness(s, proc) {
  const reasons = [];
  if (proc.spawnError) reasons.push("spawn_failed");
  if (proc.timedOut) reasons.push("timed_out");
  if (proc.aborted) reasons.push("aborted");
  if (proc.versionMismatch) reasons.push("version_mismatch");
  if (proc.exitCode === null) reasons.push("no_exit_code");
  if (!s.streamStart) reasons.push("missing_stream_start");
  if (s.contractVersions.some((v) => v !== STREAM_CONTRACT_VERSION)) reasons.push("unexpected_contract_version");
  if (!s.plan) reasons.push("missing_plan");
  else if (!s.plan.valid) reasons.push("plan_invalid");
  if (!s.summary) reasons.push("missing_summary");
  else if (s.summary.cancelled === true) reasons.push("cancelled");
  if (!s.done) reasons.push("missing_completion_event");

  const membersWithoutEnd = s.members.filter((m) => m.inPlan && m.final === null).map((m) => m.file);
  if (membersWithoutEnd.length) reasons.push("members_without_end");
  const unplannedMembers = s.members.filter((m) => !m.inPlan).map((m) => m.file);
  if (s.plan && unplannedMembers.length) reasons.push("unplanned_members");

  const plannedCount = s.plan?.members.length ?? null;
  const totalTests = s.summary?.totals?.tests ?? null;
  if (plannedCount !== null && totalTests !== null && plannedCount !== totalTests) reasons.push("totals_mismatch");

  if (s.done && s.summary?.executionId && s.done.executionId && s.done.executionId !== s.summary.executionId) {
    reasons.push("execution_id_mismatch");
  }

  return {
    complete: reasons.length === 0,
    reasons,
    membersWithoutEnd,
    unplannedMembers,
  };
}
