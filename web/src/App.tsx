import { useCallback, useEffect, useState } from "react";
import { api, SignInRequired } from "./api";
import { ErrorNotice } from "./components/Bits";
import { ChromeOrb, Logo } from "./components/Chrome";
import * as I from "./components/Icons";
import { Sidebar, TopBar } from "./components/Shell";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { HomePage } from "./pages/HomePage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RecordsPage } from "./pages/RecordsPage";
import { Link, useRouter } from "./router";
import type { Session } from "./types";
import { useData } from "./useData";

export function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [signIn, setSignIn] = useState<string | null>(null);
  const [fatal, setFatal] = useState<Error | null>(null);

  const onSignIn = useCallback((e: SignInRequired) => setSignIn(e.loginUrl), []);

  useEffect(() => {
    api.session().then(setSession, (e) => (e instanceof SignInRequired ? setSignIn(e.loginUrl) : setFatal(e)));
  }, []);

  // Sign the person out of this screen when the server session ends.
  useEffect(() => {
    if (!session) return;
    const ms = new Date(session.expiresAt).getTime() - Date.now();
    const t = window.setTimeout(() => setSignIn(`/approve/login?next=${encodeURIComponent(window.location.pathname)}`), Math.max(ms, 0) + 1000);
    return () => window.clearTimeout(t);
  }, [session]);

  if (signIn) return <SignIn loginUrl={signIn} />;
  if (fatal) {
    return (
      <div className="page">
        <div className="frame" style={{ maxWidth: 760 }}>
          <main className="main">
            <TopBar title="Greenlight" />
            <ErrorNotice error={fatal} onRetry={() => window.location.reload()} />
          </main>
        </div>
      </div>
    );
  }
  if (!session) return <div className="page" aria-busy="true" />;
  return <Signed session={session} onSignIn={onSignIn} />;
}

function Signed({ session, onSignIn }: { session: Session; onSignIn: (e: SignInRequired) => void }) {
  const { route } = useRouter();
  const { value: projects, reload } = useData(api.projects, [], { onSignIn });
  const pending = projects.state === "ready" ? projects.data.reduce((n, p) => n + p.pendingApprovals.length, 0) : 0;

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
    case "project":
      page = <ProjectPage key={route.id} id={route.id} pending={pending} onSignIn={onSignIn} />;
      break;
    case "approvals":
      page = <ApprovalsPage projects={projects} reload={reload} />;
      break;
    case "records":
      page = <RecordsPage projects={projects} onSignIn={onSignIn} />;
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
    document.title = route.name === "home" ? "Greenlight" : `${route.name === "project" ? "Project" : route.name[0]!.toUpperCase() + route.name.slice(1)} · Greenlight`;
  }, [route]);

  return (
    <div className="page">
      <div className="frame">
        <Sidebar session={session} pending={pending} onSignOut={signOut} />
        <main className="main" id="main">
          {page}
        </main>
      </div>
    </div>
  );
}

function SignIn({ loginUrl }: { loginUrl: string }) {
  return (
    <div className="page">
      <div className="signin-wrap">
        <div className="signin">
          <section className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Logo />
              <span className="brand-name">Greenlight</span>
            </div>
            <h1>Verify what your app claims to do.</h1>
            <p>Greenlight checks a live deployment against the claims a person approved, and keeps the evidence. Sign in with the Vercel account listed as an approver.</p>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <a className="btn" href={loginUrl}>
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3l10 18H2z" fill="currentColor" />
                </svg>
                Sign in with Vercel
              </a>
            </div>
            <p className="small">Sessions last 15 minutes. Nothing can be approved or run from a signed-out page.</p>
          </section>
          <section className="card-dark" aria-hidden="true">
            <ChromeOrb intensity={1.2} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="claim-id">Approved claims · live evidence · signed records</span>
              <span style={{ fontSize: 13, color: "var(--on-dark-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                <I.Check size={14} /> Every approval is signed by the server
              </span>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
