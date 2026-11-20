// Shapes returned by the server's read-only /app/api routes (src/server/app-api.js).

export interface Session {
  user: string;
  account: string;
  username: string | null;
  name: string | null;
  authenticatedAt: string | null;
  expiresAt: string;
  maxCreditsPerRun: number | null;
}

export interface PendingApproval {
  version: number;
  approveUrl: string;
  submittedAt: string;
  submittedBy: string;
}

export interface Job {
  id: string;
  version: number;
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
  publicUrl: string;
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
  claims: { id: string; text: string }[];
  tests: TestView[];
  estimate: Estimate | null;
}

export interface ProjectDetail {
  project: { id: string; name: string; url: string; createdAt: string; createdBy: string };
  versions: VersionView[];
  jobs: Job[];
  records: RecordSummary[];
}
