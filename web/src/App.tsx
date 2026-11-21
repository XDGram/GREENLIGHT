import { useCallback, useEffect, useState } from "react";
import { api, guestApi, SignInRequired } from "./api";
import { ErrorNotice } from "./components/Bits";
import { ChromeOrb, Logo } from "./components/Chrome";
import * as I from "./components/Icons";
import { Sidebar, TopBar } from "./components/Shell";
import { AccountPage } from "./pages/AccountPage";
import { AdminListPage, AdminPage } from "./pages/AdminPage";
import { FixCentrePage, FixPage } from "./pages/FixCentrePage";
import { HomePage } from "./pages/HomePage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RecordsPage } from "./pages/RecordsPage";
import { RunPage } from "./pages/RunPage";
import { TestsPage } from "./pages/TestsPage";
import { VerifyPage } from "./pages/VerifyPage";
import { currentProject, rememberProject } from "./plain";
import { Link, useRouter, type Route } from "./router";
import type { Session } from "./types";
import { useData } from "./useData";

type Mode = { kind: "loading" } | { kind: "app"; session: Session } | { kind: "landing"; googleUrl: string | null; guestMode: boolean; sample: boolean } | { kind: "fatal"; error: Error };

const ADMIN_LOGIN = "/approve/login?next=%2Fapp";

export function App() {
  const [mode, setMode] = useState<Mode>({ kind: "loading" });

  // Any session (guest cookie, Google or administrator) opens the app; otherwise the landing page.
  const resolve = useCallback(async () => {
    try {
      setMode({ kind: "app", session: await api.session() });
    } catch (e) {
      if (!(e instanceof SignInRequired)) return setMode({ kind: "fatal", error: e as Error });
      let guestMode = true;
      let sample = false;
      try {
        sample = Boolean((await guestApi.me()).sample);
      } catch {
        guestMode = false;
      }
      setMode({ kind: "landing", googleUrl: e.loginUrl.startsWith("/api/auth/google/") ? "/api/auth/google/login?next=%2Fapp" : null, guestMode, sample });
    }
  }, []);
  useEffect(() => {
    void resolve();
  }, [resolve]);

  const onSignIn = useCallback(() => void resolve(), [resolve]);

  switch (mode.kind) {
    case "loading":
      return <div className="page" aria-busy="true" />;
    case "fatal":
      return (
        <div className="page">
          <div className="frame" style={{ maxWidth: 760 }}>
            <main className="main">
              <TopBar title="Greenlight" />
              <ErrorNotice error={mode.error} onRetry={() => window.location.reload()} />
            </main>
          </div>
        </div>
      );
    case "landing":
      return <Landing googleUrl={mode.googleUrl} guestMode={mode.guestMode} sample={mode.sample} onEntered={resolve} />;
    case "app":
      return <Signed session={mode.session} onSignIn={onSignIn} />;
  }
}

function Signed({ session, onSignIn }: { session: Session; onSignIn: (e: SignInRequired) => void }) {
  const { route, navigate } = useRouter();
  const { value: projects, reload } = useData(api.projects, [], { onSignIn });
  const pending = projects.state === "ready" ? projects.data.reduce((n, p) => n + p.pendingApprovals.length, 0) : 0;
  const [project, setProject] = useState<string | null>(currentProject());

  // Remember the project in focus, so Test plan / Verification in the menu open it.
  useEffect(() => {
    const id = "id" in route && typeof route.id === "string" && route.id.startsWith("prj_") ? route.id : null;
    if (id) {
      rememberProject(id);
      setProject(id);
    } else if (projects.state === "ready" && project && !projects.data.some((p) => p.id === project)) {
      setProject(projects.data[0]?.id ?? null);
    } else if (projects.state === "ready" && !project && projects.data[0]) {
      setProject(projects.data[0].id);
    }
  }, [route, projects, project]);

  // Old demo addresses lead into the main journey.
  useEffect(() => {
    if (route.name === "try" || route.name === "try_new" || route.name === "try_project") navigate("/app/projects/new");
    if (route.name === "demo") navigate("/app/sample");
  }, [route, navigate]);

  const signOut = async () => {
    await api.logout();
    window.location.assign("/app");
  };

  let page;
  switch (route.name) {
    case "home":
      page = <HomePage session={session} projects={projects} reload={reload} />;
      break;
    case "projects":
      page = <ProjectsPage projects={projects} reload={reload} />;
      break;
    case "project_new":
      page = <NewProjectPage session={session} onCreated={reload} />;
      break;
    case "project":
      page = <ProjectPage key={route.id} id={route.id} pending={pending} onSignIn={onSignIn} session={session} />;
      break;
    case "sample":
      page = <ProjectPage id="sample" pending={0} onSignIn={onSignIn} load={guestApi.sample} sample session={session} />;
      break;
    case "project_tests":
      page = <TestsPage key={route.id} id={route.id} session={session} onSignIn={onSignIn} onSaved={reload} />;
      break;
    case "approvals":
      page = <ProjectsPage projects={projects} reload={reload} />;
      break;
    case "project_verify":
      page = <VerifyPage key={route.id} id={route.id} session={session} onSignIn={onSignIn} />;
      break;
    case "project_run":
      page = <RunPage key={route.recordId} id={route.id} recordId={route.recordId} onSignIn={onSignIn} />;
      break;
    case "fixes":
      page = <FixCentrePage onSignIn={onSignIn} />;
      break;
    case "fix":
      page = <FixPage key={route.id} id={route.id} session={session} onSignIn={onSignIn} />;
      break;
    case "records":
      page = <RecordsPage projects={projects} onSignIn={onSignIn} />;
      break;
    case "integrations":
      page = <IntegrationsPage onSignIn={onSignIn} session={session} />;
      break;
    case "account":
      page = <AccountPage session={session} onSignOut={signOut} />;
      break;
    case "admin":
      page = session.role === "admin" ? <AdminPage onSignIn={onSignIn} /> : <NotAllowed />;
      break;
    case "admin_list":
      page = session.role === "admin" ? <AdminListPage key={route.kind} kind={route.kind} onSignIn={onSignIn} /> : <NotAllowed />;
      break;
    case "demo":
    case "try":
    case "try_new":
    case "try_project":
      page = null;
      break;
    default:
      page = (
        <>
          <TopBar title="Page not found" />
          <section className="card">
            <p style={{ margin: 0 }}>
              This page doesn’t exist. <Link href="/app">Go to the overview</Link>.
            </p>
          </section>
        </>
      );
  }

  useEffect(() => {
    const titles: Partial<Record<Route["name"], string>> = {
      projects: "My projects",
      project_new: "Submit an app",
      project: "Project",
      sample: "Example project",
      project_tests: "Test plan",
      project_verify: "Verification",
      project_run: "Results",
      fixes: "Fix Centre",
      fix: "Fix Centre",
      records: "Evidence & history",
      integrations: "Integrations",
      account: "Account",
      admin: "Administration",
      admin_list: "Administration",
    };
    document.title = route.name === "home" ? "Greenlight" : `${titles[route.name] ?? "Greenlight"} · Greenlight`;
  }, [route]);

  return (
    <div className="page">
      <div className="frame">
        <Sidebar session={session} pending={pending} onSignOut={signOut} project={project} />
        <main className="main" id="main">
          {page}
        </main>
      </div>
    </div>
  );
}

function NotAllowed() {
  return (
    <>
      <TopBar title="Administrators only" />
      <section className="card">
        <p style={{ margin: 0 }}>
          This area is for the operator of this Greenlight server. <Link href="/app">Go to your overview</Link>.
        </p>
      </section>
    </>
  );
}

const HOW = [
  { n: 1, title: "Submit your app", text: "Its GitHub repository and live URL, and what it should do." },
  { n: 2, title: "Greenlight learns it", text: "Reads the public code and opens the live app, then proposes tests in plain English." },
  { n: 3, title: "Test it for real", text: "After you approve the plan, a real browser runs it on your live app." },
  { n: 4, title: "Understand and fix", text: "Every failure is explained, with a suggested fix you can hand to your coding agent." },
  { n: 5, title: "Verify again", text: "Re-run the failed tests to confirm the fix." },
];

function Landing({ googleUrl, guestMode, sample, onEntered }: { googleUrl: string | null; guestMode: boolean; sample: boolean; onEntered: () => Promise<void> }) {
  const { navigate } = useRouter();
  const [busy, setBusy] = useState<"submit" | "sample" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const enter = async (to: "submit" | "sample") => {
    setBusy(to);
    setError(null);
    try {
      await guestApi.start();
      navigate(to === "submit" ? "/app/projects/new" : "/app/sample");
      await onEntered();
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  };
  return (
    <div className="page">
      <div className="signin-wrap">
        <div className="signin" style={{ maxWidth: 1040 }}>
          <section className="card" style={{ gap: 22 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Logo />
              <span className="brand-name">Greenlight</span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <h1>Find out if your app really works.</h1>
              <p style={{ margin: 0 }}>
                Give Greenlight your GitHub repository and live URL. It works out what your app should do, tests it in a real browser, explains anything that fails in plain English, and helps you fix it.
              </p>
            </div>
            {guestMode ? (
              <div className="landing-actions">
                <button type="button" className="btn" onClick={() => enter("submit")} disabled={busy !== null}>
                  {busy === "submit" ? <span className="spinner" aria-hidden="true" /> : <I.Play size={15} aria-hidden="true" />}
                  Test your app, no account needed
                </button>
                {sample ? (
                  <button type="button" className="btn ghost" onClick={() => enter("sample")} disabled={busy !== null}>
                    {busy === "sample" ? <span className="spinner" aria-hidden="true" /> : <I.Eye size={15} aria-hidden="true" />}
                    See an example project
                  </button>
                ) : null}
              </div>
            ) : (
              <p className="small" style={{ margin: 0 }}>
                Visitor access is not enabled on this server.
              </p>
            )}
            {error ? (
              <div className="notice" role="alert">
                <I.CircleAlert size={18} aria-hidden="true" />
                <p>{error}</p>
              </div>
            ) : null}
            <p className="small" style={{ margin: 0 }}>
              No sign-up: this browser remembers your projects. Real browser runs are limited per visitor and never become public certificates.{" "}
              {googleUrl ? (
                <>
                  <a href={googleUrl}>Sign in with Google</a> ·{" "}
                </>
              ) : null}
              <a href={ADMIN_LOGIN}>Administrator sign-in</a>
            </p>
          </section>
          <section className="card-dark" aria-labelledby="how-h" style={{ gap: 18 }}>
            <h2 id="how-h" className="card-title" style={{ fontSize: 15 }}>
              How it works
            </h2>
            <ol className="list" style={{ gap: 14 }}>
              {HOW.map((h) => (
                <li key={h.n} style={{ display: "grid", gridTemplateColumns: "28px minmax(0,1fr)", gap: 12 }}>
                  <span className="step-n" style={{ borderColor: "var(--on-dark-line)" }} aria-hidden="true">
                    {h.n}
                  </span>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 500 }}>{h.title}</div>
                    <div style={{ fontSize: 12.5, color: "var(--on-dark-muted)", lineHeight: 1.5 }}>{h.text}</div>
                  </div>
                </li>
              ))}
            </ol>
            <div style={{ marginTop: "auto" }}>
              <ChromeOrb intensity={0.9} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
