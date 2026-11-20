import type { ReactNode } from "react";
import { Link, useRouter, type Route } from "../router";
import type { Session } from "../types";
import { Avatar, Logo } from "./Chrome";
import * as I from "./Icons";

const NAV: { href: string; label: string; icon: typeof I.Home; match: Route["name"][] }[] = [
  { href: "/app", label: "Home", icon: I.Home, match: ["home"] },
  { href: "/app/projects", label: "Projects", icon: I.Projects, match: ["projects", "project"] },
  { href: "/app/approvals", label: "Approvals", icon: I.Approvals, match: ["approvals"] },
  { href: "/app/records", label: "Records", icon: I.Records, match: ["records"] },
];

export function Sidebar({ session, pending, onSignOut }: { session: Session; pending: number; onSignOut: () => void }) {
  const { route } = useRouter();
  const minutes = Math.max(0, Math.round((new Date(session.expiresAt).getTime() - Date.now()) / 60_000));
  return (
    <nav className="sidebar" aria-label="Main">
      <Link href="/app" className="brand">
        <Logo />
        <span className="brand-name">Greenlight</span>
      </Link>
      <div className="nav">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="nav-item" aria-current={n.match.includes(route.name) ? "page" : undefined}>
            <n.icon size={18} strokeWidth={1.6} aria-hidden="true" />
            {n.label}
            {n.label === "Approvals" && pending > 0 ? (
              <span className="nav-count" aria-label={`${pending} waiting`}>
                {pending}
              </span>
            ) : null}
          </Link>
        ))}
      </div>
      <div className="side-spacer" />
      <div className="side-user">
        <Avatar name={session.user} />
        <div className="side-user-name">{session.user}</div>
        <div className="side-user-meta">
          {session.account} · signed in via Vercel{session.username ? ` as ${session.username}` : ""}
        </div>
        <div className="side-user-meta">Session ends in {minutes} min</div>
        <button type="button" className="side-signout" onClick={onSignOut}>
          Sign out
        </button>
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
