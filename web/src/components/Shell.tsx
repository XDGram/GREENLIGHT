import type { ReactNode } from "react";
import { Link, useRouter, type Route } from "../router";
import type { Session } from "../types";
import { Avatar, Logo } from "./Chrome";
import * as I from "./Icons";

type NavItem = { href: string; label: string; icon: typeof I.Home; match: Route["name"][] };

function journeyNav(project: string | null): NavItem[] {
  const p = project ? `/app/projects/${project}` : null;
  return [
    { href: "/app", label: "Overview", icon: I.Home, match: ["home"] },
    { href: "/app/projects", label: "My projects", icon: I.Projects, match: ["projects", "project"] },
    { href: "/app/projects/new", label: "Submit an app", icon: I.Plus, match: ["project_new"] },
    { href: p ? `${p}/tests` : "/app/projects", label: "Test plan", icon: I.FileText, match: ["project_tests", "approvals"] },
    { href: p ? `${p}/verify` : "/app/projects", label: "Verification", icon: I.Play, match: ["project_verify"] },
    { href: "/app/fixes", label: "Fix Centre", icon: I.Wrench, match: ["fixes", "fix"] },
    { href: "/app/records", label: "Evidence & history", icon: I.Records, match: ["records", "project_run"] },
  ];
}
const SETUP: NavItem[] = [
  { href: "/app/integrations", label: "Integrations", icon: I.Plug, match: ["integrations"] },
  { href: "/app/account", label: "Account", icon: I.UserRound, match: ["account"] },
];
const ADMIN: NavItem[] = [{ href: "/app/admin", label: "Administration", icon: I.Server, match: ["admin", "admin_list"] }];

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
      </Link>
      <div className="nav">
        <NavLinks items={journeyNav(project)} pending={pending} />
        <div className="nav-sep" aria-hidden="true" />
        <NavLinks items={guest ? SETUP.filter((n) => n.label === "Integrations") : SETUP} />
        {session.role === "admin" ? <NavLinks items={ADMIN} /> : null}
      </div>
      <div className="side-spacer" />
      <div className="side-user">
        <Avatar name={display} />
        <div className="side-user-name">{display}</div>
        <div className="side-user-meta">
          {guest ? "No account · remembered on this browser" : session.role === "admin" ? "Administrator · Vercel" : `Google${session.email && session.email !== display ? ` · ${session.email}` : ""}`}
        </div>
        {guest && session.guestRuns ? (
          <div className="side-user-meta">
            {session.guestRuns.leftForYou} real browser run{session.guestRuns.leftForYou === 1 ? "" : "s"} left
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
