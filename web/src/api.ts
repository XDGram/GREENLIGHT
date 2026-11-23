import type {
  AdminHealth,
  AdminOverview,
  AgentRequest,
  ApiToken,
  CommitCheck,
  FixItem,
  DeploymentProbe,
  DraftSpec,
  GuestLimits,
  GuestMe,
  GuestProject,
  GuestRun,
  Integrations,
  Job,
  ProjectDetail,
  ProjectSummary,
  RepositoryCheck,
  RunDetail,
  Session,
  SpecCheck,
  VersionView,
} from "./types";

/** Thrown when the server says the session is missing or has expired. */
export class SignInRequired extends Error {
  constructor(public loginUrl: string) {
    super("Sign in to continue.");
  }
}

export class ApiError extends Error {
  problems: string[] = [];
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Where sign-in should come back to (the server only accepts /app paths). */
const here = () => window.location.pathname.replace(/\/+$/, "") || "/app";

async function read<T>(res: Response): Promise<T> {
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (res.status === 401) {
    const google = (body as { google?: boolean } | null)?.google;
    throw new SignInRequired(google ? `/api/auth/google/login?next=${encodeURIComponent(here())}` : `/approve/login?next=${encodeURIComponent(here())}`);
  }
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string; details?: { problems?: string[] } } } | null)?.error;
    const err = new ApiError(res.status, e?.code ?? "error", e?.message ?? `Request failed (HTTP ${res.status}).`);
    err.problems = e?.details?.problems ?? [];
    throw err;
  }
  return body as T;
}

async function get<T>(path: string): Promise<T> {
  return read<T>(await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" }, cache: "no-store" }));
}

async function post<T>(path: string, body: unknown): Promise<T> {
  return read<T>(await fetch(path, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body ?? {}), cache: "no-store" }));
}

/** Guest demo calls never redirect to sign-in: a 401 there means "no guest yet". */
async function guestGet<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" }, cache: "no-store" });
  if (res.status === 401) throw new ApiError(401, "unauthorized", "Start the demo first.");
  return read<T>(res);
}

/** Guest demo: no sign-up; the server remembers this browser with a cookie. */
export const guestApi = {
  me: () => guestGet<GuestMe>("/app/api/guest/me"),
  start: () => post<{ guest: GuestMe["guest"]; limits: GuestLimits }>("/app/api/guest/start", {}),
  sample: () => guestGet<ProjectDetail>("/app/api/guest/sample"),
  projects: () => guestGet<{ projects: GuestProject[] }>("/app/api/guest/projects").then((r) => r.projects),
  project: (id: string) => guestGet<{ project: GuestProject; limits: GuestLimits }>(`/app/api/guest/projects/${encodeURIComponent(id)}`),
  draft: (body: { name: string; url: string; requirements: string }) => post<{ draft: DraftSpec; notes: string | null; pageRead: boolean; check: SpecCheck }>("/app/api/guest/draft", body),
  preview: (spec: DraftSpec) => post<SpecCheck>("/app/api/guest/preview", spec),
  create: (spec: DraftSpec & { source: "ai" | "form"; notes?: string | null }) => post<GuestProject>("/app/api/guest/projects", spec),
  approve: (id: string, confirmHash: string) => post<{ project: GuestProject }>(`/app/api/guest/projects/${encodeURIComponent(id)}/approve`, { confirmHash }),
  run: (id: string) => post<{ run: GuestRun; limits: GuestLimits }>(`/app/api/guest/projects/${encodeURIComponent(id)}/runs`, {}),
};

/** A response that may instead be a request queued for the developer's coding agent. */
export type Queued<T> = T | { agentRequest: AgentRequest };
export const isQueued = <T,>(r: Queued<T>): r is { agentRequest: AgentRequest } => typeof r === "object" && r !== null && "agentRequest" in r;

export interface NewProject {
  name: string;
  url: string;
  repository: string;
  branch: string;
  description: string;
  purpose: string;
  credentials?: { username: string; password: string; notes: string };
}

const P = (id: string) => `/app/api/projects/${encodeURIComponent(id)}`;

export const api = {
  session: () => get<Session>("/app/api/session"),
  projects: () => get<{ projects: ProjectSummary[] }>("/app/api/projects").then((r) => r.projects),
  project: (id: string) => get<ProjectDetail>(P(id)),
  createProject: (body: NewProject) => post<ProjectDetail>("/app/api/projects", body),
  updateDetails: (id: string, body: Partial<NewProject> & { clearCredentials?: boolean }) => post<ProjectDetail>(`${P(id)}/details`, body),
  repositoryCheck: (id: string) => post<{ repositoryCheck: RepositoryCheck }>(`${P(id)}/repository-check`, {}),
  deploymentCheck: (id: string) => post<{ deployment: DeploymentProbe; inRepository: CommitCheck | null }>(`${P(id)}/deployment-check`, {}),
  draft: (id: string, requirements?: string) => post<Queued<{ draft: DraftSpec; notes: string | null; pageRead: boolean; check: SpecCheck }>>(`${P(id)}/draft`, requirements ? { requirements } : {}),
  preview: (id: string, body: { draft: DraftSpec } | { specText: string }) => post<SpecCheck>(`${P(id)}/preview`, body),
  propose: (id: string, body: { draft: DraftSpec } | { specText: string }) => post<{ version: VersionView }>(`${P(id)}/versions`, body),
  certify: (id: string, body: { version: number; commit?: string; confirmSpend: number; approvedTestHash: string; tests?: string[] }) => post<{ job: Job }>(`${P(id)}/certifications`, body),
  understand: (id: string, body: { step: "inspect" | "analyze" | "answers"; answers?: Record<string, string> }) => post<Queued<ProjectDetail>>(`${P(id)}/understand`, body),
  revise: (id: string, current: DraftSpec, instruction: string) => post<Queued<{ draft: DraftSpec; notes: string | null; pageRead: boolean; check: SpecCheck; revised: boolean }>>(`${P(id)}/draft`, { current, instruction }),
  agentRequests: (projectId: string) => get<{ requests: AgentRequest[] }>(`/app/api/agent-requests?projectId=${encodeURIComponent(projectId)}`).then((r) => r.requests),
  agentRequest: (requestId: string) => get<{ request: AgentRequest }>(`/app/api/agent-requests/${encodeURIComponent(requestId)}`).then((r) => r.request),
  cancelAgentRequest: (requestId: string) => post<{ request: AgentRequest }>(`/app/api/agent-requests/${encodeURIComponent(requestId)}/cancel`, {}).then((r) => r.request),
  approveInApp: (id: string, version: number, approvedTestHash: string) => post<ProjectDetail>(`${P(id)}/versions/${version}/approve`, { confirm: true, approvedTestHash }),
  fixes: (projectId?: string) => get<{ fixes: FixItem[] }>(`/app/api/fixes${projectId ? `?projectId=${encodeURIComponent(projectId)}` : ""}`).then((r) => r.fixes),
  fix: (fixId: string) => get<{ fix: FixItem }>(`/app/api/fixes/${encodeURIComponent(fixId)}`).then((r) => r.fix),
  openFix: (projectId: string, recordId: string, testFile: string) => post<{ fix: FixItem }>("/app/api/fixes/open", { projectId, recordId, testFile }).then((r) => r.fix),
  fixAction: (fixId: string, action: "explain" | "proposal" | "send" | "dismiss" | "reopen", body: Record<string, unknown> = {}) => post<{ fix: FixItem; agentRequest?: AgentRequest }>(`/app/api/fixes/${encodeURIComponent(fixId)}/${action}`, body),
  askFix: (fixId: string, message: string) => post<{ fix: FixItem; agentRequest?: AgentRequest }>(`/app/api/fixes/${encodeURIComponent(fixId)}/ask`, { message }),
  job: (jobId: string) => get<{ job: Job }>(`/app/api/jobs/${encodeURIComponent(jobId)}`).then((r) => r.job),
  run: (id: string, recordId: string) => get<RunDetail>(`${P(id)}/records/${encodeURIComponent(recordId)}`),
  integrity: (id: string, recordId: string) => get<{ ok: boolean; problems: string[]; files: number; record: boolean; checkedAt: string }>(`${P(id)}/records/${encodeURIComponent(recordId)}/integrity`),
  fileUrl: (id: string, recordId: string, name: string) => `${P(id)}/records/${encodeURIComponent(recordId)}/files/${name.split("/").map(encodeURIComponent).join("/")}`,
  tokens: () => get<{ tokens: ApiToken[] }>("/app/api/tokens").then((r) => r.tokens),
  createToken: (role: "agent" | "owner", label: string) => post<ApiToken & { token: string; note: string }>("/app/api/tokens", { role, label }),
  revokeToken: (tokenId: string) => post<{ revoked: string }>(`/app/api/tokens/${encodeURIComponent(tokenId)}/revoke`, {}),
  integrations: () => get<Integrations>("/app/api/integrations"),
  async logout(): Promise<void> {
    await fetch("/app/api/logout", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: "{}" });
  },
};

/** The one-page check: claims from the README or notes, then one Kane run. */
export interface ClaimsResult {
  claims: string[];
  source: "notes" | "readme" | "none";
  maxClaims: number;
  costs: number[];
  ceiling: number;
  guestRuns: Session["guestRuns"] | null;
  /** The server's total Kane credit budget (null when there is no cap). */
  budget: { cap: number; left: number } | null;
}
export const checkApi = {
  claims: (body: { repository: string; url: string; notes: string }) => post<ClaimsResult>("/app/api/checks/claims", body),
  run: (body: { repository: string; url: string; notes: string; claims: string[]; confirm: true; confirmSpend: number }) => post<{ projectId: string; job: Job; estimate: number }>("/app/api/checks", body),
};

export const adminApi = {
  overview: () => get<AdminOverview>("/app/api/admin/overview"),
  health: () => get<AdminHealth>("/app/api/admin/health"),
  list: <T = Record<string, unknown>>(kind: string, limit = 200) => get<{ kind: string; items: T[] }>(`/app/api/admin/list/${encodeURIComponent(kind)}?limit=${limit}`).then((r) => r.items ?? []),
  settings: () => get<{ settings: Record<string, unknown>; editable: string[] }>("/app/api/admin/settings"),
  setSetting: (key: string, value: unknown) => post<{ key: string; value: unknown }>("/app/api/admin/settings", { key, value }),
  revokeToken: (tokenId: string) => post<{ revoked: string }>(`/app/api/admin/tokens/${encodeURIComponent(tokenId)}/revoke`, {}),
};
