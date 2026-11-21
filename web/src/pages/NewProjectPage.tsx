import { useState, type FormEvent } from "react";
import { ApiError, api } from "../api";
import { FormError } from "../components/Bits";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
import { Stepper } from "../components/Stepper";
import { Link, useRouter } from "../router";
import type { Session } from "../types";

const GITHUB = /^https:\/\/(www\.)?github\.com\/[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}\/?$/;
const URLISH = /^https?:\/\/[^\s/]+\.[^\s/]+/;

/** Step 1 of adding a project: what to verify and where its code lives. Nothing runs. */
export function NewProjectPage({ session, onCreated }: { session: Session; onCreated: () => void }) {
  const { navigate } = useRouter();
  const [f, setF] = useState({ name: "", url: "https://", repository: "https://github.com/", branch: "main", description: "", purpose: "" });
  const [creds, setCreds] = useState({ open: false, username: "", password: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; problems?: string[] } | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  const problems = [
    !f.name.trim() && "Give the project a name.",
    !URLISH.test(f.url.trim()) && "Enter the live URL, starting with https://",
    !GITHUB.test(f.repository.trim().replace(/\.git$/, "")) && "Paste the GitHub repository address, like https://github.com/owner/repo",
    f.purpose.trim().length < 20 && "Describe what the app should do (at least 20 characters).",
  ].filter(Boolean) as string[];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (problems.length) return;
    setBusy(true);
    setError(null);
    try {
      const d = await api.createProject({
        name: f.name.trim(),
        url: f.url.trim(),
        repository: f.repository.trim(),
        branch: f.branch.trim() || "main",
        description: f.description.trim(),
        purpose: f.purpose.trim(),
        ...(creds.open && (creds.username || creds.password || creds.notes) ? { credentials: { username: creds.username, password: creds.password, notes: creds.notes } } : {}),
      });
      onCreated();
      navigate(`/app/projects/${d.project.id}/tests`);
    } catch (err) {
      const a = err as ApiError;
      setError({ message: a.message, problems: a.problems });
      setBusy(false);
    }
  };

  return (
    <>
      <TopBar title="Add a project" eyebrow={<Link href="/app/projects">Projects</Link>}>
        <Stepper current="project" />
      </TopBar>

      <form className="split" onSubmit={submit} noValidate>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", minWidth: 0 }}>
          <section className="card" aria-labelledby="app-h">
            <h2 id="app-h" className="card-title lg">
              The app
            </h2>
            <div className="form-grid">
              <label className="field">
                <span>Project name</span>
                <input value={f.name} onChange={set("name")} maxLength={120} placeholder="e.g. Watchdog" autoComplete="off" required />
              </label>
              <label className="field">
                <span>Live URL</span>
                <input type="url" inputMode="url" value={f.url} onChange={set("url")} placeholder="https://your-app.example.com/" required />
                <span className="hint">The deployed site the browser tests open. Public addresses only.</span>
              </label>
            </div>
            <label className="field">
              <span>Short description (optional)</span>
              <input value={f.description} onChange={set("description")} maxLength={1000} placeholder="One line about the app, shown on its page." />
            </label>
            <label className="field">
              <span>What should the app do?</span>
              <textarea
                value={f.purpose}
                onChange={set("purpose")}
                maxLength={4000}
                placeholder={"Plain English. e.g. Visitors paste a link and see whether it is dangerous. The threat memory page lists verified attackers. Signed-out visitors can't open the dashboard."}
                required
              />
              <span className="hint">Claims and tests are drafted from this. You can edit everything before approving.</span>
            </label>
          </section>

          <section className="card" aria-labelledby="repo-h">
            <div className="card-head">
              <h2 id="repo-h" className="card-title lg">
                Source code
              </h2>
              <I.GitBranch size={16} aria-hidden="true" />
            </div>
            <div className="form-grid">
              <label className="field">
                <span>GitHub repository URL</span>
                <input type="url" inputMode="url" value={f.repository} onChange={set("repository")} placeholder="https://github.com/owner/repo" required />
              </label>
              <label className="field">
                <span>Branch</span>
                <input value={f.branch} onChange={set("branch")} placeholder="main" autoComplete="off" />
              </label>
            </div>
            <p className="small" style={{ margin: 0 }}>
              No GitHub sign-in is needed. Greenlight reads the branch’s latest commit from GitHub’s public API, so it can show which commit you are verifying. Private repositories can’t be read that way; they still work, and the verified commit comes from the deployment itself (<code className="mono">/greenlight.json</code>).
            </p>
          </section>

          <section className="card" aria-labelledby="cred-h">
            <div className="card-head">
              <h2 id="cred-h" className="card-title lg">
                Test credentials <span className="small">· optional</span>
              </h2>
              <label className="switch">
                <input type="checkbox" checked={creds.open} onChange={(e) => setCreds({ ...creds, open: e.target.checked })} />
                Add credentials
              </label>
            </div>
            {creds.open ? (
              <>
                <div className="form-grid">
                  <label className="field">
                    <span>Test account username</span>
                    <input value={creds.username} onChange={(e) => setCreds({ ...creds, username: e.target.value })} autoComplete="off" maxLength={200} />
                  </label>
                  <label className="field">
                    <span>Test account password</span>
                    <input type="password" value={creds.password} onChange={(e) => setCreds({ ...creds, password: e.target.value })} autoComplete="new-password" maxLength={500} />
                  </label>
                </div>
                <label className="field">
                  <span>Notes (optional)</span>
                  <input value={creds.notes} onChange={(e) => setCreds({ ...creds, notes: e.target.value })} maxLength={500} placeholder="e.g. A throwaway account with sample data." />
                </label>
              </>
            ) : null}
            <p className="small" style={{ margin: 0 }}>
              Use a throwaway test account, never a real one. Credentials are encrypted on the server and never shown again or put into tests. The current browser tests run signed out; tests that need a login can’t be run yet.
            </p>
          </section>
        </div>

        <aside className="card-dark sticky" aria-labelledby="next-h">
          <h2 id="next-h" className="card-title">
            Before you continue
          </h2>
          <ul className="list" style={{ gap: 10, fontSize: 13 }}>
            {[
              ["Nothing runs yet", "Adding a project only saves it."],
              ["You review every test", "Claims and tests are drafted next; you edit and approve them."],
              ["Spending is always confirmed", `A verification shows its credit estimate first${session.maxCreditsPerRun ? ` and is capped at ${session.maxCreditsPerRun} credits` : ""}.`],
            ].map(([t, d]) => (
              <li key={t} style={{ display: "grid", gridTemplateColumns: "18px minmax(0,1fr)", gap: 10 }}>
                <I.Check size={15} style={{ marginTop: 2 }} aria-hidden="true" />
                <span>
                  <b style={{ fontWeight: 500 }}>{t}.</b> <span style={{ color: "var(--on-dark-muted)" }}>{d}</span>
                </span>
              </li>
            ))}
          </ul>
          {problems.length && (f.name || f.purpose) ? (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--on-dark-muted)" }} aria-live="polite">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          <FormError error={error} />
          <button type="submit" className="btn on-dark" disabled={busy || problems.length > 0}>
            {busy ? <span className="spinner" aria-hidden="true" /> : null}
            {busy ? "Checking the repository…" : "Save and write tests"}
          </button>
        </aside>
      </form>
    </>
  );
}
