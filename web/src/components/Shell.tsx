import { useEffect, useState, type ReactNode } from "react";
import { api } from "../api";
import { ListChecks, LogOut as LogOutIcon, PlusCircle, ShieldCheck } from "lucide-react";
import { Link, useRouter, type Route } from "../router";
import type { Session } from "../types";
import { Avatar, Logo } from "./Chrome";
import * as I from "./Icons";

type NavItem = { href: string; label: string; icon: typeof I.Home; match: Route["name"][] };

function journeyNav(_project: string | null): NavItem[] {
  return [
    { href: "/app", label: "Check", icon: I.Play, match: ["home"] },
    { href: "/app/projects", label: "My checks", icon: I.Projects, match: ["projects", "check", "project", "project_run"] },
  ];
}
const SETUP: NavItem[] = [
  { href: "/app/integrations", label: "Integrations", icon: I.Plug, match: ["integrations"] },
  { href: "/app/account", label: "Account", icon: I.UserRound, match: ["account"] },
];
const ADMIN: NavItem[] = [{ href: "/app/admin", label: "Admin", icon: I.Server, match: ["admin", "admin_list"] }];

function NavLinks({ items, pending = 0 }: { items: NavItem[]; pending?: number }) {
  const { route } = useRouter();
  return (
    <>
      {items.map((n) => (
        <Link key={n.label} href={n.href} className="nav-item" aria-current={n.match.includes(route.name) ? "page" : undefined}>
          <n.icon size={18} strokeWidth={1.6} aria-hidden="true" />
          {n.label}
          {n.label === "Test plan" && pending > 0 ? (
            <span className="nav-count" aria-label={`${pending} waiting for approval`}>
              {pending}
            </span>
          ) : null}
        </Link>
      ))}
    </>
  );
}

export function Sidebar({ session, pending, onSignOut, project }: { session: Session; pending: number; onSignOut: () => void; project: string | null }) {
  const minutes = Math.max(0, Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 60_000));
  const guest = session.role === "guest";
  const display = guest ? "Guest" : session.name ?? session.email ?? session.username ?? session.user;
  return (
    <nav className="sidebar" aria-label="Main">
      <Link href="/app" className="brand">
        <Logo />
        <span className="brand-name">Greenlight</span>
        <span className="brand-tag">KANE</span>
      </Link>
      <div className="nav">
        <NavLinks items={journeyNav(project)} pending={pending} />
        {/* one strip of boxed links, as in the reference */}
        {guest ? null : <NavLinks items={SETUP.filter((n) => n.label === "Account")} />}
        {session.role === "admin" ? <NavLinks items={ADMIN} /> : null}
      </div>
      <div className="side-spacer" />
      <div className="side-user">
        <Avatar name={display} />
        <div className="side-user-name">{display}</div>
        <div className="side-user-meta">
          {guest ? "No account" : session.role === "admin" ? "Administrator · Vercel" : `Google${session.email && session.email !== display ? ` · ${session.email}` : ""}`}
        </div>
        {guest && session.guestRuns ? (
          <div className="side-user-meta">
            {session.guestRuns.leftForYou} free Kane run{session.guestRuns.leftForYou === 1 ? "" : "s"} left
          </div>
        ) : (
          <div className="side-user-meta">Session ends in {minutes >= 120 ? `${Math.round(minutes / 60)} h` : `${minutes} min`}</div>
        )}
        {guest ? null : (
          <button type="button" className="side-signout" onClick={onSignOut}>
            Sign out
          </button>
        )}
      </div>
    </nav>
  );
}

export function TopBar({ title, eyebrow, children }: { title: string; eyebrow?: ReactNode; children?: ReactNode }) {
  return (
    <header className="topbar">
      <div className="title-block">
        {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
        <h1 className="title">{title}</h1>
      </div>
      {children}
    </header>
  );
}

export function SearchPill({ value, onChange, placeholder = "Search projects" }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="search">
      <span className="pill-icon" aria-hidden="true">
        <I.Search size={15} strokeWidth={2} />
      </span>
      <span className="sr-only">Search</span>
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </label>
  );
}

export function ApprovalsBell({ pending }: { pending: number }) {
  return (
    <Link href="/app/approvals" className="icon-btn" aria-label={pending ? `${pending} approvals waiting` : "Approvals"}>
      <I.Bell size={18} strokeWidth={1.6} aria-hidden="true" />
      {pending > 0 ? <span className="badge">{pending}</span> : null}
    </Link>
  );
}

/** The workspace's slim top bar: brand, two tabs, the visitor's limits, who is signed in. */
export function AppBar({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const { route } = useRouter();
  const guest = session.role === "guest";
  const display = guest ? "Guest" : session.name ?? session.email ?? session.username ?? session.user;
  const initials = display
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
  // The visitor's free runs change as checks start, so the count refreshes itself.
  const [runs, setRuns] = useState(session.guestRuns);
  useEffect(() => {
    if (!guest) return;
    let stop = false;
    const refresh = () =>
      api
        .session()
        .then((s) => !stop && setRuns(s.guestRuns))
        .catch(() => {});
    void refresh();
    const t = setInterval(refresh, 15000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [guest, route.name]);
  const nav = [
    { href: "/app", label: "New check", icon: PlusCircle, on: route.name === "home" },
    { href: "/app/projects", label: "My checks", icon: ListChecks, on: route.name === "projects" || route.name === "check" },
    ...(session.role === "admin" ? [{ href: "/app/admin", label: "Admin", icon: ShieldCheck, on: route.name === "admin" || route.name === "admin_list" }] : []),
  ];
  return (
    <aside className="ws-side" aria-label="Main">
      <Link href="/app" className="ws-brand">
        <Logo size={24} />
        <span>Greenlight</span>
      </Link>
      <nav className="ws-nav">
        <span className="ws-nav-h">Workspace</span>
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className="ws-nav-item" aria-current={n.on ? "page" : undefined}>
            <n.icon size={17} strokeWidth={1.8} aria-hidden="true" />
            {n.label}
          </Link>
        ))}
      </nav>
      <span className="ws-side-sp" />
      {guest && runs ? (
        <div className="ws-side-card">
          <span className="k">Free Kane runs</span>
          <span className="v">
            <b>{runs.leftForYou}</b>
            <span>left on this browser</span>
          </span>
          <span className="track" aria-hidden="true">
            <span className="fill" style={{ width: `${Math.round((runs.leftForYou / Math.max(1, runs.perGuest)) * 100)}%` }} />
          </span>
        </div>
      ) : null}
      <div className="ws-side-user">
        <span className="ws-avatar" aria-hidden="true">
          {initials}
        </span>
        <span className="who">
          <b>{display}</b>
          <span>{guest ? "No account" : session.role === "admin" ? "Administrator" : "Signed in"}</span>
        </span>
        {guest ? null : (
          <button type="button" className="ws-link-btn" onClick={onSignOut} aria-label="Sign out">
            <LogOutIcon size={16} aria-hidden="true" />
          </button>
        )}
      </div>
    </aside>
  );
}
