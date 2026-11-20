import { useCallback, useEffect, useState } from "react";
import { api, guestApi, SignInRequired } from "./api";
import { ErrorNotice } from "./components/Bits";
import { ChromeOrb, Logo } from "./components/Chrome";
import * as I from "./components/Icons";
import { Sidebar, TopBar } from "./components/Shell";
import { ApprovalsPage } from "./pages/ApprovalsPage";
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

const OWNER_LOGIN = "/approve/login?next=%2Fapp";

export function App() {
  const [mode, setMode] = useState<Mode>({ kind: "loading" });

  // An owner session (Sign in with Vercel) wins; otherwise this browser's guest session; otherwise the landing page.
  const resolve = useCallback(async () => {
    try {
      setMode({ kind: "owner", session: await api.session() });
      return;
    } catch (e) {
      if (!(e instanceof SignInRequired)) {
        setMode({ kind: "fatal", error: e as Error });
        return;
      }
    }
    try {
      const me = await guestApi.me();
      setMode(me.guest ? { kind: "guest", me, loginUrl: OWNER_LOGIN } : { kind: "landing", loginUrl: OWNER_LOGIN, guestMode: true });
    } catch {
      setMode({ kind: "landing", loginUrl: OWNER_LOGIN, guestMode: false }); // guest demo not enabled
    }
  }, []);
  useEffect(() => {
    void resolve();
  }, [resolve]);

  const onSignIn = useCallback((e: SignInRequired) => setMode({ kind: "landing", loginUrl: e.loginUrl, guestMode: true }), []);

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
      return <Landing loginUrl={mode.loginUrl} guestMode={mode.guestMode} onGuest={(me) => setMode({ kind: "guest", me, loginUrl: OWNER_LOGIN })} />;
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

function Landing({ loginUrl, guestMode, onGuest }: { loginUrl: string; guestMode: boolean; onGuest: (me: GuestMe) => void }) {
  const { navigate, route } = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const explore = async () => {
    setBusy(true);
    setError(null);
    try {
      await guestApi.start();
      const me = await guestApi.me();
      onGuest(me);
      if (route.name === "home" || !route.name.startsWith("try")) navigate(me.sample ? "/app/demo" : "/app/try/new");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="page">
      <div className="signin-wrap">
        <div className="signin">
          <section className="card">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <Logo />
              <span className="brand-name">Greenlight</span>
            </div>
            <h1>Prove your app does what it claims.</h1>
            <p>
              Greenlight turns what an app is supposed to do into tests a person approves, runs them in a real browser against the live site, and keeps the result with its evidence.
            </p>
            <div className="landing-actions">
              {guestMode ? (
                <button type="button" className="btn" onClick={explore} disabled={busy}>
                  {busy ? <span className="spinner" aria-hidden="true" /> : <I.Play size={15} aria-hidden="true" />}
                  Explore as a guest
                </button>
              ) : null}
              <a className={guestMode ? "btn ghost" : "btn"} href={loginUrl}>
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M12 3l10 18H2z" fill="currentColor" />
                </svg>
                App owners: sign in with Vercel
              </a>
            </div>
            {error ? (
              <div className="notice" role="alert">
                <I.CircleAlert size={18} aria-hidden="true" />
                <p>{error}</p>
              </div>
            ) : null}
            <p className="small">
              {guestMode ? "No sign-up. Guests explore a real project, add their own app and run it once in a real browser; this browser remembers you. " : ""}Owner sessions last 15 minutes.
            </p>
          </section>
          <section className="card-dark" aria-hidden="true">
            <ChromeOrb intensity={1.2} />
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span className="claim-id">Approved claims · live evidence · signed records</span>
              <span style={{ fontSize: 13, color: "var(--on-dark-muted)", display: "flex", alignItems: "center", gap: 6 }}>
                <I.Check size={14} /> Nothing runs until a person approves the exact tests
              </span>
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
          <TopBar title="For app owners" />
          <section className="card">
            <p style={{ margin: 0 }}>
              This area is for the owners of verified apps. <a href={loginUrl}>Sign in with Vercel</a>, or go back to <Link href="/app/try">your guest workspace</Link>.
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
              {limits.runsLeft} real run left · {limits.runsLeftToday} today
            </div>
            <a className="side-signout" href={loginUrl} style={{ display: "inline-grid", placeItems: "center", textDecoration: "none" }}>
              Owner sign-in
            </a>
          </div>
        </nav>
        <main className="main" id="main">
          {page}
        </main>
      </div>
    </div>
  );
}
