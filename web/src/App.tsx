import { useCallback, useEffect, useState } from "react";
import { api, guestApi, SignInRequired } from "./api";
import { ErrorNotice } from "./components/Bits";
import { Sidebar, TopBar } from "./components/Shell";
import { AccountPage } from "./pages/AccountPage";
import { CheckPage, CheckResultPage, ChecksListPage } from "./pages/CheckPage";
import { Landing } from "./pages/Landing";
import { AdminListPage, AdminPage } from "./pages/AdminPage";
import { FixCentrePage, FixPage } from "./pages/FixCentrePage";
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
      page = <CheckPage session={session} />;
      break;
    case "check":
      page = <CheckResultPage key={route.id} id={route.id} />;
      break;
    case "projects":
      page = <ChecksListPage />;
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
      check: "Result",
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
