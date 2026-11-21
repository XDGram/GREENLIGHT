import { useState, type FormEvent } from "react";
import { ApiError, api } from "../api";
import { FormError } from "../components/Bits";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
import { Link, useRouter } from "../router";
import type { Session } from "../types";

const GITHUB = /^https:\/\/(www\.)?github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/?$/;
const URLISH = /^https?:\/\/[^\s/]+\.[^\s/]+/;

/** Submit an application: what it is, where its code lives, where it runs. Nothing runs yet. */
export function NewProjectPage({ session, onCreated }: { session: Session; onCreated: () => void }) {
  const { navigate } = useRouter();
  const [f, setF] = useState({ name: "", url: "https://", repository: "https://github.com/", branch: "main", purpose: "" });
  const [creds, setCreds] = useState({ open: false, username: "", password: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; problems?: string[] } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const missing = [
    !f.name.trim() && "a project name",
    !GITHUB.test(f.repository.trim().replace(/\.git$/, "")) && "the GitHub repository URL",
    !URLISH.test(f.url.trim()) && "the live app URL",
    f.purpose.trim().length < 20 && "a description of what the app does",
  ].filter(Boolean) as string[];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (missing.length) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api.createProject({
        name: f.name.trim(),
        url: f.url.trim(),
        repository: f.repository.trim(),
        branch: f.branch.trim() || "main",
        description: "",
        purpose: f.purpose.trim(),
        ...(creds.open && (creds.username || creds.password || creds.notes) ? { credentials: { username: creds.username, password: creds.password, notes: creds.notes } } : {}),
      });
      onCreated();
      navigate(`/app/projects/${d.project.id}?understand=1`);
    } catch (err) {
      const a = err as ApiError;
      setError({ message: a.message, problems: a.problems });
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar title="Submit an app" eyebrow={<Link href="/app/projects">My projects</Link>} />

      <form className="split" onSubmit={submit} noValidate>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", minWidth: 0 }}>
          <section className="card" aria-labelledby="where-h">
            <h2 id="where-h" className="card-title lg">
              Where your app lives
            </h2>
            <div className="why-field">
              <label className="field">
                <span>
                  GitHub repository URL <b className="req">required</b>
                </span>
                <input type="url" inputMode="url" value={f.repository} onChange={set("repository")} placeholder="https://github.com/you/your-app" required />
              </label>
              <p className="why">
                <I.GitBranch size={14} aria-hidden="true" /> Greenlight reads the public code to understand the app (its framework, pages and features) and links every test result to the exact commit it tested. No GitHub sign-in: if the repository is private, Greenlight says so and works from your description and the live app.
              </p>
              <label className="field" style={{ maxWidth: 260 }}>
                <span>Branch</span>
                <input value={f.branch} onChange={set("branch")} placeholder="main" autoComplete="off" />
              </label>
            </div>
            <div className="why-field">
              <label className="field">
                <span>
                  Live app URL <b className="req">required</b>
                </span>
                <input type="url" inputMode="url" value={f.url} onChange={set("url")} placeholder="https://your-app.vercel.app/" required />
              </label>
              <p className="why">
                <I.Globe size={14} aria-hidden="true" /> The deployed app a real browser will open and use, exactly like a visitor. Public addresses only.
              </p>
            </div>
          </section>

          <section className="card" aria-labelledby="app-h">
            <h2 id="app-h" className="card-title lg">
              What it is
            </h2>
            <label className="field">
              <span>
                Project name <b className="req">required</b>
              </span>
              <input value={f.name} onChange={set("name")} maxLength={120} placeholder="e.g. Watchdog" autoComplete="off" required />
            </label>
            <label className="field">
              <span>
                What does the app do? <b className="req">required</b>
              </span>
              <textarea
                value={f.purpose}
                onChange={set("purpose")}
                maxLength={4000}
                placeholder={"In your own words. e.g. Visitors paste a link and see whether it's dangerous. The threat memory page lists known attackers. Signed-out visitors can't open the dashboard."}
                required
              />
              <span className="hint">Greenlight compares this with what it finds in the code and on the live app, and asks if something doesn't match.</span>
            </label>
          </section>

          <section className="card" aria-labelledby="cred-h">
            <div className="card-head">
              <h2 id="cred-h" className="card-title lg">
                Test account <span className="small">· optional</span>
              </h2>
              <label className="switch">
                <input type="checkbox" checked={creds.open} onChange={(e) => setCreds({ ...creds, open: e.target.checked })} />
                Add a test account
              </label>
            </div>
            {creds.open ? (
              <div className="form-grid">
                <label className="field">
                  <span>Username or email</span>
                  <input value={creds.username} onChange={(e) => setCreds({ ...creds, username: e.target.value })} autoComplete="off" maxLength={200} />
                </label>
                <label className="field">
                  <span>Password</span>
                  <input type="password" value={creds.password} onChange={(e) => setCreds({ ...creds, password: e.target.value })} autoComplete="new-password" maxLength={500} />
                </label>
              </div>
            ) : null}
            <p className="small" style={{ margin: 0 }}>
              Use a throwaway account, never a real one. It's stored encrypted and never shown again. Today's browser tests run signed out, so flows behind a login can't be tested yet; Greenlight will tell you which ones.
            </p>
          </section>
        </div>

        <aside className="card-dark sticky" aria-labelledby="next-h">
          <h2 id="next-h" className="card-title">
            What happens next
          </h2>
          <ol className="list" style={{ gap: 12, fontSize: 13 }}>
            {[
              ["Greenlight learns your app", "Reads the code and opens the live app. Takes up to a minute."],
              ["You review a test plan", "Plain-English tests you can edit, remove, add to, or ask to be revised."],
              ["You approve, then it tests for real", `A real browser runs the plan on your live app${session.role === "guest" && session.guestRuns ? ` (${session.guestRuns.leftForYou} run${session.guestRuns.leftForYou === 1 ? "" : "s"} left for you)` : ""}.`],
              ["Failures go to the Fix Centre", "Explained, with a suggested fix you can send to your coding agent."],
            ].map(([t, d], i) => (
              <li key={t} style={{ display: "grid", gridTemplateColumns: "24px minmax(0,1fr)", gap: 10 }}>
                <span className="step-n" style={{ width: 22, height: 22, fontSize: 10.5, borderColor: "var(--on-dark-line)" }} aria-hidden="true">
                  {i + 1}
                </span>
                <span>
                  <b style={{ fontWeight: 500 }}>{t}.</b> <span style={{ color: "var(--on-dark-muted)" }}>{d}</span>
                </span>
              </li>
            ))}
          </ol>
          {missing.length && (f.name || f.purpose || f.repository.length > 19) ? (
            <p style={{ margin: 0, fontSize: 12.5, color: "var(--on-dark-muted)" }} aria-live="polite">
              Still needed: {missing.join(", ")}.
            </p>
          ) : null}
          <FormError error={error} />
          <button type="submit" className="btn on-dark" disabled={busy || missing.length > 0}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {busy ? "Saving…" : "Submit and learn my app"}
          </button>
          <p style={{ margin: 0, fontSize: 12, color: "var(--on-dark-muted)" }}>Nothing is tested until you approve a plan.</p>
        </aside>
      </form>
    </>
  );
}
