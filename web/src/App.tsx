import { useCallback, useEffect, useState } from "react";
import { api, guestApi, SignInRequired } from "./api";
import { DemoBanner, ErrorNotice } from "./components/Bits";
import { ChromeOrb, Logo } from "./components/Chrome";
import * as I from "./components/Icons";
import { Sidebar, TopBar } from "./components/Shell";
import { ApprovalsPage } from "./pages/ApprovalsPage";
import { AccountPage } from "./pages/AccountPage";
import { AdminListPage, AdminPage } from "./pages/AdminPage";
import { IntegrationsPage } from "./pages/IntegrationsPage";
import { NewProjectPage } from "./pages/NewProjectPage";
import { RunPage } from "./pages/RunPage";
import { TestsPage } from "./pages/TestsPage";
import { VerifyPage } from "./pages/VerifyPage";
import { HomePage } from "./pages/HomePage";
import { ProjectPage } from "./pages/ProjectPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { RecordsPage } from "./pages/RecordsPage";
import { Link, useRouter, type Route } from "./router";
import type { GuestLimits, GuestMe, Session } from "./types";
import { GuestProjectPage } from "./pages/guest/GuestProjectPage";
import { MyAppsPage } from "./pages/guest/MyAppsPage";
import { NewAppPage } from "./pages/guest/NewAppPage";
import { useData } from "./useData";

type Mode =
  | { kind: "loading" }
  | { kind: "owner"; session: Session }
  | { kind: "guest"; me: GuestMe; loginUrl: string }
  | { kind: "landing"; loginUrl: string; guestMode: boolean }
  | { kind: "fatal"; error: Error };

const ADMIN_LOGIN = "/approve/login?next=%2Fapp";
const GOOGLE_LOGIN = "/api/auth/google/login?next=%2Fapp";
const googleEnabled = (loginUrl: string) => loginUrl.startsWith("/api/auth/google/");

export function App() {
  const [mode, setMode] = useState<Mode>({ kind: "loading" });

  // A signed-in session (Google user or Vercel administrator) wins; otherwise this browser's demo
  // session, but only on the demo pages; otherwise the landing page.
  const resolve = useCallback(async () => {
    let loginUrl = ADMIN_LOGIN;
    try {
      setMode({ kind: "owner", session: await api.session() });
      return;
    } catch (e) {
      if (!(e instanceof SignInRequired)) {
        setMode({ kind: "fatal", error: e as Error });
        return;
      }
      loginUrl = googleEnabled(e.loginUrl) ? GOOGLE_LOGIN : ADMIN_LOGIN;
    }
    try {
      const me = await guestApi.me();
      const onDemoPage = /^\/app\/(demo|try)(\/|$)/.test(window.location.pathname);
      setMode(me.guest && onDemoPage ? { kind: "guest", me, loginUrl } : { kind: "landing", loginUrl, guestMode: true });
    } catch {
      setMode({ kind: "landing", loginUrl, guestMode: false }); // guest demo not enabled
    }
  }, []);
  useEffect(() => {
    void resolve();
  }, [resolve]);

  const onSignIn = useCallback((e: SignInRequired) => setMode({ kind: "landing", loginUrl: googleEnabled(e.loginUrl) ? GOOGLE_LOGIN : ADMIN_LOGIN, guestMode: true }), []);

  // Leave the owner screens when the server session ends.
  useEffect(() => {
    if (mode.kind !== "owner") return;
    const ms = new Date(mode.session.expiresAt).getTime() - Date.now();
    const t = window.setTimeout(() => void resolve(), Math.max(ms, 0) + 1000);
    return () => window.clearTimeout(t);
  }, [mode, resolve]);

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
      return <Landing loginUrl={mode.loginUrl} guestMode={mode.guestMode} onGuest={(me) => setMode({ kind: "guest", me, loginUrl: mode.loginUrl })} />;
    case "guest":
      return <GuestApp me={mode.me} loginUrl={mode.loginUrl} onEnded={() => void resolve()} />;
    case "owner":
      return <Signed session={mode.session} onSignIn={onSignIn} />;
  }
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
    case "project_new":
      page = <NewProjectPage session={session} onCreated={reload} />;
      break;
    case "project":
      page = <ProjectPage key={route.id} id={route.id} pending={pending} onSignIn={onSignIn} />;
      break;
    case "project_tests":
      page = <TestsPage key={route.id} id={route.id} session={session} onSignIn={onSignIn} onSaved={reload} />;
      break;
    case "project_verify":
      page = <VerifyPage key={route.id} id={route.id} session={session} onSignIn={onSignIn} />;
      break;
    case "project_run":
      page = <RunPage key={route.recordId} id={route.id} recordId={route.recordId} onSignIn={onSignIn} />;
      break;
    case "integrations":
      page = <IntegrationsPage onSignIn={onSignIn} />;
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
      page = (
        <>
          <TopBar title="You’re signed in" />
          <section className="card">
            <p style={{ margin: 0 }}>
              The demo is for visitors without an account. Your own projects are under <Link href="/app/projects">Projects</Link>; to look at the demo, sign out first.
            </p>
          </section>
        </>
      );
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
    const titles: Partial<Record<Route["name"], string>> = { projects: "Projects", project_new: "Add project", project: "Project", project_tests: "Claims and tests", project_verify: "Verify", project_run: "Run result", approvals: "Approvals", records: "Runs", integrations: "Integrations", account: "Account", admin: "Admin", admin_list: "Admin" };
    document.title = route.name === "home" ? "Greenlight" : `${titles[route.name] ?? "Greenlight"} · Greenlight`;
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
  { n: 1, title: "Describe the app", text: "Live URL, GitHub repository and what it should do. Claude drafts claims and browser tests; you edit them." },
  { n: 2, title: "Approve the exact tests", text: "You confirm two fingerprints on a signed page. Nothing runs before that, and changed tests need a new approval." },
  { n: 3, title: "Verify the live site", text: "A real browser runs the approved tests against the deployed commit, after you confirm the credit spend." },
  { n: 4, title: "Keep the evidence", text: "Claim-by-claim results, logs and screenshots. A fully passing run becomes a permanent public record." },
];

function Landing({ loginUrl, guestMode, onGuest }: { loginUrl: string; guestMode: boolean; onGuest: (me: GuestMe) => void }) {
  const { navigate, route, search } = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const google = googleEnabled(loginUrl);
  const explore = async () => {
    setBusy(true);
    setError(null);
    try {
      await guestApi.start();
      const me = await guestApi.me();
      onGuest(me);
      if (!route.name.startsWith("try") && route.name !== "demo") navigate(me.sample ? "/app/demo" : "/app/try/new");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
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
              <h1>Prove your app does what it claims.</h1>
              <p style={{ margin: 0 }}>Greenlight turns what your app is supposed to do into browser tests a person approves, runs them against the live deployment, and keeps the result with its evidence.</p>
            </div>
            {search.get("signin") === "cancelled" ? <p className="small" style={{ margin: 0 }}>Sign-in was cancelled. Nothing changed.</p> : null}
            <div className="landing-actions">
              {google ? (
                <a className="btn" href={loginUrl}>
                  <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                    <path fill="currentColor" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3zM12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22zm-5.6-8a6 6 0 0 1 0-3.9V7.5H3.1a10 10 0 0 0 0 9zM12 6c1.5 0 2.8.5 3.8 1.5l2.9-2.9A10 10 0 0 0 3.1 7.5l3.3 2.6C7.2 7.8 9.4 6 12 6z" />
                  </svg>
                  Sign in with Google
                </a>
              ) : null}
              {guestMode ? (
                <button type="button" className={google ? "btn ghost" : "btn"} onClick={explore} disabled={busy}>
                  {busy ? <span className="spinner" aria-hidden="true" /> : <I.Play size={15} aria-hidden="true" />}
                  Try the demo, no account
                </button>
              ) : null}
            </div>
            {error ? (
              <div className="notice" role="alert">
                <I.CircleAlert size={18} aria-hidden="true" />
                <p>{error}</p>
              </div>
            ) : null}
            <p className="small" style={{ margin: 0 }}>
              {google ? "Your projects and verification history stay in your own account. " : "Sign in with Google is not enabled on this server yet. "}
              {guestMode ? "The demo uses a sample project and free demo checks; it never spends credits or certifies anything. " : ""}
              <a href={ADMIN_LOGIN}>Administrator sign-in</a>
            </p>
          </section>
          <section className="card-dark" aria-labelledby="how-h" style={{ gap: 18 }}>
            <h2 id="how-h" className="card-title" style={{ fontSize: 15 }}>
              How a verification works
            </h2>
            <ol className="list" style={{ gap: 16 }}>
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
            <div style={{ marginTop: "auto", display: "flex", alignItems: "center", gap: 10 }}>
              <ChromeOrb intensity={0.9} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

const GUEST_NAV: { href: string; label: string; icon: typeof I.Home; match: Route["name"][] }[] = [
  { href: "/app/demo", label: "Sample project", icon: I.Records, match: ["demo"] },
  { href: "/app/try", label: "My apps", icon: I.Projects, match: ["try", "try_project"] },
  { href: "/app/try/new", label: "Add an app", icon: I.FileCode2, match: ["try_new"] },
];

function GuestApp({ me, loginUrl, onEnded }: { me: GuestMe; loginUrl: string; onEnded: () => void }) {
  const { route, navigate } = useRouter();
  const [limits, setLimits] = useState<GuestLimits>(me.limits);
  const signIn = useCallback(() => onEnded(), [onEnded]);

  useEffect(() => {
    const t = window.setInterval(() => {
      guestApi.me().then((m) => (m.guest ? setLimits(m.limits) : onEnded()), () => {});
    }, 30_000);
    return () => window.clearInterval(t);
  }, [onEnded]);

  useEffect(() => {
    if (route.name === "home") navigate(me.sample ? "/app/demo" : "/app/try");
  }, [route, me.sample, navigate]);

  useEffect(() => {
    const titles: Partial<Record<Route["name"], string>> = { demo: "Sample project", try: "My apps", try_new: "Add an app", try_project: "App" };
    document.title = `${titles[route.name] ?? "Greenlight"} · Greenlight`;
  }, [route]);

  let page;
  switch (route.name) {
    case "demo":
      page = me.sample ? (
        <ProjectPage id="sample" pending={0} onSignIn={signIn} load={guestApi.sample} sample />
      ) : (
        <section className="card">
          <p style={{ margin: 0 }}>
            No sample project is set up on this server. <Link href="/app/try/new">Add your own app</Link>.
          </p>
        </section>
      );
      break;
    case "try":
      page = <MyAppsPage limits={limits} />;
      break;
    case "try_new":
      page = <NewAppPage limits={limits} />;
      break;
    case "try_project":
      page = <GuestProjectPage key={route.id} id={route.id} onLimits={setLimits} />;
      break;
    case "home":
      page = null;
      break;
    default:
      page = (
        <>
          <TopBar title="Sign in to continue" />
          <section className="card">
            <p style={{ margin: 0 }}>
              This page belongs to a signed-in account. <a href={loginUrl}>Sign in</a>, or go back to <Link href="/app/try">your demo workspace</Link>.
            </p>
          </section>
        </>
      );
  }

  return (
    <div className="page">
      <div className="frame">
        <nav className="sidebar" aria-label="Main">
          <Link href={me.sample ? "/app/demo" : "/app/try"} className="brand">
            <Logo />
            <span className="brand-name">Greenlight</span>
          </Link>
          <div className="nav">
            {GUEST_NAV.filter((n) => n.href !== "/app/demo" || me.sample).map((n) => (
              <Link key={n.href} href={n.href} className="nav-item" aria-current={n.match.includes(route.name) ? "page" : undefined}>
                <n.icon size={18} strokeWidth={1.6} aria-hidden="true" />
                {n.label}
              </Link>
            ))}
          </div>
          <div className="side-spacer" />
          <div className="side-user">
            <span className="avatar" aria-hidden="true">
              G
            </span>
            <div className="side-user-name">Guest</div>
            <div className="side-user-meta">Remembered on this browser</div>
            <div className="side-user-meta">
              {limits.runsLeft} demo checks left · no credits used
            </div>
            <a className="side-signout" href={loginUrl} style={{ display: "inline-grid", placeItems: "center", textDecoration: "none" }}>
              {googleEnabled(loginUrl) ? "Sign in with Google" : "Sign in"}
            </a>
          </div>
        </nav>
        <main className="main" id="main">
          <DemoBanner>
            <b>Demo mode.</b> Sample data and free demo checks: nothing here spends credits, certifies or publishes. <a href={loginUrl}>Sign in</a> to verify your own app for real.
          </DemoBanner>
          {page}
        </main>
      </div>
    </div>
  );
}
