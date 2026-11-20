import type { ProjectDetail, ProjectSummary, Session } from "./types";

/** Thrown when the server says the Vercel session is missing or has expired. */
export class SignInRequired extends Error {
  constructor(public loginUrl: string) {
    super("Sign in with Vercel to continue.");
  }
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { credentials: "same-origin", headers: { accept: "application/json" }, cache: "no-store" });
  if (res.status === 401) {
    // Come back to the page the person was on (the server only accepts /app paths).
    const here = window.location.pathname.replace(/\/+$/, "") || "/app";
    throw new SignInRequired(`/approve/login?next=${encodeURIComponent(here)}`);
  }
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const e = (body as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? "error", e?.message ?? `Request failed (HTTP ${res.status}).`);
  }
  return body as T;
}

export const api = {
  session: () => get<Session>("/app/api/session"),
  projects: () => get<{ projects: ProjectSummary[] }>("/app/api/projects").then((r) => r.projects),
  project: (id: string) => get<ProjectDetail>(`/app/api/projects/${encodeURIComponent(id)}`),
  async logout(): Promise<void> {
    await fetch("/app/api/logout", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "signout=1" });
  },
};
