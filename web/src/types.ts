// Shapes returned by the server's /app/api routes (src/server/app-api.js, admin-api.js, guest-api.js).

export interface Session {
  provider: "google" | "vercel";
  role: "user" | "admin";
  user: string;
  account: string;
  username: string | null;
  email: string | null;
  name: string | null;
  authenticatedAt: string | null;
  expiresAt: string;
  maxCreditsPerRun: number | null;
  features: { ai: boolean; google: boolean; certification: boolean; admin: boolean };
}

export interface PendingApproval {
  version: number;
  approveUrl: string;
  submittedAt: string;
  submittedBy: string;
}

export interface Job {
  id: string;
  projectId?: string;
  version: number;
  commit?: string | null;
  confirmSpend?: number | null;
  status: "queued" | "running" | "succeeded" | "failed" | string;
  outcome: string | null;
  requestedBy: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  recordId: string | null;
  error: { code: string | null; message: string | null } | null;
}

export type ClaimStatus = "passed" | "failed" | "couldnt_verify" | string;

export interface RecordSummary {
  id: string;
  testVersion: number;
  status: ClaimStatus;
  certified: boolean;
  notCertifiedBecause: string[];
  deployment: { url: string; commit: string; environment: string } | null;
  claims: { id: string; text: string | null; status: ClaimStatus }[];
  startedAt: string | null;
  endedAt: string | null;
  credits: { actual: number | null; estimate: number | null } | null;
  evidenceStatus: string | null;
  integrity: boolean;
  recordSha256?: string | null;
  approvedTestHash?: string | null;
  publicUrl: string | null;
}

export interface ProjectSummary {
  id: string;
  name: string;
  url: string;
  createdAt: string;
  createdBy: string;
  versions: number;
  latestVersion: {
    version: number;
    status: "approved" | "pending_approval";
    submittedAt: string;
    claims: number;
    tests: number;
    approvedAt: string | null;
    approvedBy: string | null;
  } | null;
  pendingApprovals: PendingApproval[];
  lastRecord: RecordSummary | null;
  records: number;
  certified: boolean;
  activeJob: Job | null;
}

export interface Approval {
  approvedBy: string;
  approvedAt: string;
  method: string;
  channel: string | null;
  identity: { provider: string; username: string | null } | null;
  recordSha256: string | null;
  signed: boolean;
  browserApprovalRequired: boolean;
  verified: boolean;
  verificationReason: string | null;
}

export interface TestStep {
  name: string;
  kind: "do" | "expect_text" | string;
  text: string;
}

export interface TestView {
  file: string;
  title: string | null;
  claims: string[];
  sha256: string | null;
  steps: TestStep[];
}

export interface Estimate {
  credits: number;
  runOverhead: number;
  breakdown: { file: string; steps: number | null; credits: number }[];
  cap: number | null;
}

export interface VersionView {
  version: number;
  approvedTestHash: string;
  specFileSha256: string | null;
  submittedBy: string;
  submittedAt: string;
  status: "approved" | "pending_approval";
  approval: Approval | null;
  approveUrl: string | null;
  description: string | null;
  url?: string | null;
  claims: { id: string; text: string }[];
  tests: TestView[];
  estimate: Estimate | null;
}

export interface RepositoryCheck {
  status: "ok" | "not_found_or_private" | "branch_not_found" | "unavailable";
  checkedAt: string;
  message?: string;
  repo?: { fullName: string; private: boolean; defaultBranch: string | null; htmlUrl: string };
  head?: { sha: string; message: string; author: string | null; date: string | null; url: string | null };
}

export interface ProjectDetails {
  description: string | null;
  purpose: string | null;
  repository: string | null;
  branch: string | null;
  repositoryCheck: RepositoryCheck | null;
  hasCredentials: boolean;
  credentialsUpdatedAt: string | null;
  updatedAt: string | null;
}

export interface CommitCheck {
  repository: string;
  status: "found" | "not_found" | "unknown";
  checkedAt: string;
  url?: string;
  message?: string;
}

export interface DeploymentProbe {
  status: "ok" | "missing" | "protected" | "invalid" | "unreachable";
  checkedAt: string;
  commit?: string;
  environment?: string | null;
  reason?: string;
  endpoint?: string;
}

export interface ProjectDetail {
  project: { id: string; name: string; url: string; createdAt: string; createdBy: string };
  details?: ProjectDetails | null;
  versions: VersionView[];
  jobs: Job[];
  records: RecordSummary[];
}

// ---------------------------------------------------------------- guest demo (/app/api/guest)

export interface GuestLimits {
  demoCheck?: boolean;
  paused?: boolean;
  runsPerGuest: number;
  runsLeft: number;
  runsPerDay: number;
  runsLeftToday: number;
  maxCreditsPerRun: number;
  projectsPerGuest: number;
  aiPerGuest: number;
  aiLeft: number;
  aiAvailable: boolean;
  maxTests: number;
  maxClaims: number;
}

export interface GuestMe {
  guest: { id: string; createdAt: string; projects: number } | null;
  limits: GuestLimits;
  sample?: boolean;
}

export interface DraftStep {
  name: string;
  kind: "do" | "expect_text";
  text: string;
}
export interface DraftTest {
  title: string;
  claims: string[];
  steps: DraftStep[];
}
export interface DraftSpec {
  name: string;
  url: string;
  description: string | null;
  claims: { id: string; text: string }[];
  tests: DraftTest[];
}

export interface SpecCheck {
  ok: boolean;
  problems: string[];
  warnings?: string[];
  hash?: string;
  specText?: string;
  claims?: { id: string; text: string }[];
  tests?: TestView[];
  estimate?: { credits: number; cap: number | null };
}

export interface RunTest {
  file: string;
  title: string | null;
  claims: string[];
  status: string;
  reasons: string[];
  durationS: number | null;
  failureMessage: string | null;
  failedStep: { index: number; name: string; kind: string; text: string } | null;
  steps: TestStep[];
}

export interface RunFile {
  name: string;
  bytes: number;
  sha256: string;
  kind: "image" | "log" | "manifest" | "file";
}

export interface RunDetail {
  record: RecordSummary;
  approval: { method: string; approvedAt: string; recordSha256: string } | null;
  execution: { runId: string | null; runKind: string | null; startedAt: string | null; endedAt: string | null; kane: { version: string | null; executionId: string | null; exitCode: number | null } | null; freshAuthoring?: boolean } | null;
  evidence: { status: string | null; packSha256: string | null; packBytes: number | null; validation: string | null; kaneStdoutSha256: string | null; runManifestSha256: string | null } | null;
  credits: { actualSpend: number | null; kaneReportedSpend: number | null; estimate: number | null; status: string | null } | null;
  claims: { id: string; text: string | null; status: string; tests: string[] }[];
  tests: RunTest[] | null;
  files: RunFile[];
}

export interface ApiToken {
  id: string;
  role: "owner" | "agent";
  user: string;
  label: string;
  createdAt: string;
  revokedAt: string | null;
}

export interface Integrations {
  claudeApi: { configured: boolean; model: string | null; usedFor: string };
  claudeCode: { apiUrl: string; install: string | null; skillFiles: string[]; activeAgentTokens: number };
  mcp: { url: string; transport: string; auth: string; activeTokens: number };
}

export interface AdminOverview {
  overview: {
    accounts: number;
    users: number;
    projects: number;
    versions: number;
    approvals: number;
    jobs: Record<string, number> | null;
    records: number;
    certified: number;
    creditsSpent: number;
    creditsEstimated: number;
    activeTokens: number;
    guestSessions: number;
    guestProjects: number;
    guestRuns24h: number;
    evidenceBytes: number;
  };
  limits: { maxCreditsPerRun: number | null; reserve: number | null; maxQueuedJobs: number | null; guest: { runsPerGuest: number; runsPerDay: number; projectsPerGuest: number; aiPerGuest: number } | null };
  at: string;
}

export interface AdminHealth {
  database: string;
  storage: string;
  ok: boolean;
  execution: string;
  stuckJobs: { id: string; projectId: string; status: string; since: string }[];
  configuration: Record<string, boolean | string | null>;
  checkedAt: string;
}

export interface DemoCheckStep {
  name: string;
  kind: string;
  text: string;
  result: "found" | "missing" | "not_checked" | "action_not_performed" | "start_page_loaded";
}

export interface GuestRunResult {
  kind?: "demo_check";
  page?: { url: string; read: boolean; characters: number };
  status: string;
  counts?: Record<string, number>;
  reasons?: string[];
  runUsable?: boolean;
  claims: { id: string; text: string | null; status: string }[];
  tests: { file: string; title: string | null; claims: string[]; status: string; reasons?: string[]; durationS?: number | null; failureMessage?: string | null; failureStepIndex?: number | null; steps?: DemoCheckStep[] }[];
  credits: { estimate: number; actual: number | null };
  startedAt: string;
  endedAt: string;
  certified: false;
}

export interface GuestRun {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed";
  refunded: boolean;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  error: { code: string; message: string } | null;
  result: GuestRunResult | null;
}

export interface GuestProject {
  id: string;
  name: string;
  url: string;
  description: string | null;
  createdAt: string;
  approvedTestHash: string;
  approvedAt: string | null;
  source: "ai" | "form";
  notes: string | null;
  specText: string;
  claims: { id: string; text: string }[];
  tests: TestView[];
  estimate: Estimate | null;
  runs?: GuestRun[];
}
