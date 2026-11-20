import type { Job, ProjectDetail, ProjectSummary, RecordSummary, VersionView } from "./types";

export type Form = "solid" | "outline" | "dashed";

/** One line of status for a project card or header pill. */
export function projectStage(p: ProjectSummary): { label: string; detail: string; form: Form } {
  if (p.activeJob) return { label: "Run in progress", detail: `Version ${p.activeJob.version}`, form: "outline" };
  if (p.pendingApprovals.length) return { label: "Awaiting approval", detail: `Version ${p.pendingApprovals[0]!.version}`, form: "outline" };
  if (p.lastRecord?.certified) return { label: "Certified", detail: `Version ${p.lastRecord.testVersion}`, form: "solid" };
  if (p.lastRecord) return { label: "Not certified", detail: `Last run: ${p.lastRecord.status.replace("_", " ")}`, form: "outline" };
  if (p.latestVersion?.status === "approved") return { label: "Spec approved", detail: `Version ${p.latestVersion.version}`, form: "solid" };
  return { label: "No tests yet", detail: "Waiting for a submission", form: "dashed" };
}

export type StepState = "done" | "current" | "blocked" | "todo";
export interface PathStep {
  key: "submitted" | "approved" | "deployment" | "run" | "certified";
  label: string;
  state: StepState;
  note: string;
  start: number | null;
  end: number | null;
}

const t = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);

/** The five steps from a submitted spec to a certified record, for one version. */
export function certificationPath(detail: ProjectDetail, v: VersionView): PathStep[] {
  const jobs = detail.jobs.filter((j) => j.version === v.version).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const records = detail.records.filter((r) => r.testVersion === v.version);
  const job: Job | undefined = jobs[0];
  const record: RecordSummary | undefined = records[0];
  const jobFailed = job?.status === "failed" && !job.recordId;
  const jobActive = job && (job.status === "queued" || job.status === "running");

  const submitted: PathStep = { key: "submitted", label: "Submitted", state: "done", note: `by ${v.submittedBy}`, start: t(v.submittedAt), end: t(v.submittedAt) };
  const approved: PathStep = v.approval
    ? { key: "approved", label: "Spec review", state: "done", note: `Approved by ${v.approval.approvedBy}`, start: t(v.submittedAt), end: t(v.approval.approvedAt) }
    : { key: "approved", label: "Spec review", state: "current", note: "Waiting for approval", start: t(v.submittedAt), end: null };

  let deployment: PathStep;
  let run: PathStep;
  if (record) {
    deployment = { key: "deployment", label: "Deployment check", state: "done", note: record.deployment ? `${record.deployment.environment} · ${record.deployment.commit.slice(0, 7)}` : "Verified", start: t(job?.startedAt ?? record.startedAt), end: t(record.startedAt) };
    run = { key: "run", label: "Kane run", state: "done", note: `${record.claims.filter((c) => c.status === "passed").length} of ${record.claims.length} claims passed`, start: t(record.startedAt), end: t(record.endedAt) };
  } else if (jobFailed) {
    const code = job!.error?.code ?? "failed";
    deployment = { key: "deployment", label: "Deployment check", state: "blocked", note: `Stopped: ${code.replace(/_/g, " ")}`, start: t(job!.startedAt ?? job!.createdAt), end: t(job!.finishedAt) };
    run = { key: "run", label: "Kane run", state: "todo", note: "Not started", start: null, end: null };
  } else if (jobActive) {
    deployment = { key: "deployment", label: "Deployment check", state: job!.status === "running" ? "current" : "todo", note: job!.status === "running" ? "In progress" : "Queued", start: t(job!.startedAt ?? job!.createdAt), end: null };
    run = { key: "run", label: "Kane run", state: "todo", note: "After the deployment check", start: null, end: null };
  } else {
    deployment = { key: "deployment", label: "Deployment check", state: "todo", note: v.approval ? "Starts with certification" : "After approval", start: null, end: null };
    run = { key: "run", label: "Kane run", state: "todo", note: `${v.tests.length} tests · not started`, start: null, end: null };
  }
  const certified: PathStep = record
    ? { key: "certified", label: "Certification", state: record.certified ? "done" : "blocked", note: record.certified ? "Certified" : `Not certified: ${record.notCertifiedBecause.map((r) => r.replace(/_/g, " ")).join(", ") || record.status}`, start: t(record.endedAt), end: t(record.endedAt) }
    : { key: "certified", label: "Certification", state: "todo", note: "Pending", start: null, end: null };

  // The approval step is "current" only until approved; once approved, the next open step is.
  const steps = [submitted, approved, deployment, run, certified];
  if (v.approval) {
    const next = steps.find((s) => s.state === "todo");
    if (next && !steps.some((s) => s.state === "current" || s.state === "blocked")) next.state = "current";
  }
  return steps;
}

export const doneCount = (steps: PathStep[]) => steps.filter((s) => s.state === "done").length;

/** Result of each claim in this version's latest record, if it has been run. */
export function claimResults(detail: ProjectDetail, v: VersionView): Map<string, string> {
  const record = detail.records.find((r) => r.testVersion === v.version);
  return new Map((record?.claims ?? []).map((c) => [c.id, c.status]));
}
