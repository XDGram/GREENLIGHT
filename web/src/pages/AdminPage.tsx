import { useState, type ReactNode } from "react";
import { adminApi, type SignInRequired } from "../api";
import { Empty, ErrorNotice, LoadingRows, Notice, Tag } from "../components/Bits";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
import { credits, formatDateTime, relative } from "../format";
import { ADMIN_KINDS, Link, type AdminKind } from "../router";
import { useData } from "../useData";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "—" : String(v));
const bytes = (n: number) => (n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const TITLES: Record<AdminKind, string> = { users: "Users", projects: "Projects", jobs: "Verification runs", records: "Records", tokens: "API tokens", events: "Activity log", guests: "Demo checks" };

function AdminTabs({ current }: { current: AdminKind | "overview" }) {
  return (
    <nav className="seg" aria-label="Admin sections" style={{ flexWrap: "wrap" }}>
      <Link href="/app/admin" className="seg-link" aria-current={current === "overview" ? "page" : undefined}>
        Overview
      </Link>
      {ADMIN_KINDS.map((k) => (
        <Link key={k} href={`/app/admin/${k}`} className="seg-link" aria-current={current === k ? "page" : undefined}>
          {TITLES[k]}
        </Link>
      ))}
    </nav>
  );
}

export function AdminPage({ onSignIn }: { onSignIn: (e: SignInRequired) => void }) {
  const ov = useData(() => adminApi.overview(), [], { onSignIn, refreshMs: 30_000 });
  const health = useData(() => adminApi.health(), [], { onSignIn, refreshMs: 30_000 });
  const settings = useData(() => adminApi.settings(), [], { onSignIn, refreshMs: 60_000 });
  const failed = useData(() => adminApi.list<Row>("jobs", 50), [], { onSignIn, refreshMs: 30_000 });

  return (
    <>
      <TopBar title="Admin" eyebrow="System overview · administrators only">
        <AdminTabs current="overview" />
      </TopBar>
      {ov.value.state === "loading" ? <LoadingRows /> : null}
      {ov.value.state === "error" ? <ErrorNotice error={ov.value.error} onRetry={ov.reload} /> : null}
      {ov.value.state === "ready" ? (
        <section className="card" aria-labelledby="ov-h">
          <div className="card-head">
            <h2 id="ov-h" className="card-title lg">
              Usage
            </h2>
            <span className="small">Updated {relative(ov.value.data.at)}</span>
          </div>
          <dl className="stats">
            {(
              [
                ["Users", ov.value.data.overview.users, "signed in with Google"],
                ["Projects", ov.value.data.overview.projects, `${ov.value.data.overview.versions} test versions`],
                ["Approvals", ov.value.data.overview.approvals, "signed, write-once"],
                ["Runs", Object.values(ov.value.data.overview.jobs ?? {}).reduce((a, b) => a + b, 0), Object.entries(ov.value.data.overview.jobs ?? {}).map(([k, v]) => `${v} ${k}`).join(" · ") || "none yet"],
                ["Records", ov.value.data.overview.records, `${ov.value.data.overview.certified} certified`],
                ["Credits spent", credits(Number(ov.value.data.overview.creditsSpent)), `${credits(Number(ov.value.data.overview.creditsEstimated))} estimated`],
                ["Active tokens", ov.value.data.overview.activeTokens, "Claude Code, MCP, CLI"],
                ["Demo checks (24 h)", ov.value.data.overview.guestRuns24h, `${ov.value.data.overview.guestSessions} demo visitors`],
                ["Evidence stored", bytes(Number(ov.value.data.overview.evidenceBytes)), "private bucket"],
              ] as [string, ReactNode, string][]
            ).map(([k, v, s]) => (
              <div key={k} className="stat">
                <dt>{k}</dt>
                <dd>{v}</dd>
                <small>{s}</small>
              </div>
            ))}
          </dl>
          <p className="small" style={{ margin: 0 }}>
            Limits: {ov.value.data.limits.maxCreditsPerRun ?? "—"} credits per run, reserve {ov.value.data.limits.reserve ?? "—"}, {ov.value.data.limits.maxQueuedJobs ?? "—"} queued runs at most
            {ov.value.data.limits.guest ? ` · demo: ${ov.value.data.limits.guest.runsPerGuest} checks per visitor, ${ov.value.data.limits.guest.runsPerDay} per day` : ""}.
          </p>
        </section>
      ) : null}

      <div className="row">
        <section className="card" aria-labelledby="h-h" style={{ flex: "1 1 360px" }}>
          <div className="card-head">
            <h2 id="h-h" className="card-title lg">
              System health
            </h2>
            {health.value.state === "ready" ? <Tag form={health.value.data.ok ? "solid" : "outline"}>{health.value.data.ok ? "Healthy" : "Needs attention"}</Tag> : null}
          </div>
          {health.value.state === "error" ? <ErrorNotice error={health.value.error} onRetry={health.reload} /> : null}
          {health.value.state === "ready" ? (
            <>
              <dl className="kv-list">
                <dt>Database</dt>
                <dd>{health.value.data.database}</dd>
                <dt>Evidence storage</dt>
                <dd>{health.value.data.storage}</dd>
                <dt>Execution</dt>
                <dd>{health.value.data.execution === "sandbox" ? "Vercel Sandbox per run" : "Local"}</dd>
                {Object.entries(health.value.data.configuration).map(([k, v]) => (
                  <ConfigRow key={k} name={k} value={v} />
                ))}
              </dl>
              {health.value.data.stuckJobs.length ? (
                <Notice>
                  {health.value.data.stuckJobs.length} run(s) have been queued or running for over 45 minutes: {health.value.data.stuckJobs.map((j) => j.id).join(", ")}.
                </Notice>
              ) : null}
              <span className="small">Checked {formatDateTime(health.value.data.checkedAt)}</span>
            </>
          ) : null}
        </section>

        <section className="card" aria-labelledby="ctl-h" style={{ flex: "1 1 320px" }}>
          <h2 id="ctl-h" className="card-title lg">
            Controls
          </h2>
          {settings.value.state === "ready" ? <PauseDemo initial={settings.value.data.settings["guest.checks_paused"] === true} onChanged={settings.reload} /> : null}
          {settings.value.state === "error" ? <ErrorNotice error={settings.value.error} onRetry={settings.reload} /> : null}
          <p className="small" style={{ margin: 0 }}>
            The console cannot approve tests, start runs, change records or reveal secrets. Every change here is recorded in <Link href="/app/admin/events">admin activity</Link>.
          </p>
        </section>
      </div>

      <section className="card" aria-labelledby="fail-h">
        <div className="card-head">
          <h2 id="fail-h" className="card-title lg">
            Failed runs
          </h2>
          <Link href="/app/admin/jobs" className="small">
            All runs
          </Link>
        </div>
        {failed.value.state === "ready" ? (
          (() => {
            const rows = failed.value.data.filter((j) => j.status === "failed").slice(0, 10);
            return rows.length ? (
              <Table rows={rows} kind="jobs" />
            ) : (
              <Empty title="No failed runs">
                <span>Runs that stop before a result (deployment not ready, credit check refused, sandbox errors) appear here.</span>
              </Empty>
            );
          })()
        ) : null}
        {failed.value.state === "error" ? <ErrorNotice error={failed.value.error} onRetry={failed.reload} /> : null}
      </section>
    </>
  );
}

const CONFIG_LABELS: Record<string, string> = {
  publicBaseUrl: "Public URL",
  signInWithGoogle: "Sign in with Google",
  administratorSignIn: "Administrator sign-in",
  approvalSigning: "Approval signing key",
  claudeApi: "Claude API key",
  guestDemo: "Guest demo",
  kaneCredentials: "Kane credentials",
};
function ConfigRow({ name, value }: { name: string; value: unknown }) {
  return (
    <>
      <dt>{CONFIG_LABELS[name] ?? name}</dt>
      <dd>{typeof value === "boolean" ? (value ? "Configured" : "Not configured") : str(value)}</dd>
    </>
  );
}

function PauseDemo({ initial, onChanged }: { initial: boolean; onChanged: () => void }) {
  const [paused, setPaused] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async (next: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await adminApi.setSetting("guest.checks_paused", next);
      setPaused(next);
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label className="switch">
        <input type="checkbox" checked={paused} disabled={busy} onChange={(e) => void toggle(e.target.checked)} />
        Pause demo checks
      </label>
      <span className="small">{paused ? "Visitors can still explore the demo and write tests, but can’t run demo checks." : "Demo checks are running normally. They never spend credits."}</span>
      {error ? (
        <span className="small" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

export function AdminListPage({ kind, onSignIn }: { kind: AdminKind; onSignIn: (e: SignInRequired) => void }) {
  const { value, reload } = useData(() => adminApi.list<Row>(kind, 300), [kind], { onSignIn, refreshMs: 30_000 });
  const [q, setQ] = useState("");
  const [certifiedOnly, setCertifiedOnly] = useState(false);
  const rows = value.state === "ready" ? value.data.filter((r) => (!q || JSON.stringify(r).toLowerCase().includes(q.toLowerCase())) && (!certifiedOnly || r.certified === true)) : [];
  return (
    <>
      <TopBar title={TITLES[kind]} eyebrow={<Link href="/app/admin">Admin</Link>}>
        <AdminTabs current={kind} />
      </TopBar>
      <section className="card">
        <div className="card-head">
          <label className="field" style={{ flex: "1 1 280px", maxWidth: 420 }}>
            <span className="sr-only">Filter</span>
            <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" />
          </label>
          {kind === "records" ? (
            <label className="switch">
              <input type="checkbox" checked={certifiedOnly} onChange={(e) => setCertifiedOnly(e.target.checked)} />
              Certifications with public records only
            </label>
          ) : null}
          <span className="small">{value.state === "ready" ? `${rows.length} of ${value.data.length}` : ""}</span>
        </div>
        {kind === "guests" ? <p className="small" style={{ margin: 0 }}>Demo data: checks run by visitors without an account. They never use Kane, never spend credits and never certify.</p> : null}
        {kind === "events" ? <p className="small" style={{ margin: 0 }}>Append-only: sign-ups, projects, test versions, approvals, verification requests, tokens and administrator changes.</p> : null}
        {value.state === "loading" ? <LoadingRows /> : null}
        {value.state === "error" ? <ErrorNotice error={value.error} onRetry={reload} /> : null}
        {value.state === "ready" && !rows.length ? <Empty title={q ? "Nothing matches" : "Nothing here yet"} /> : null}
        {rows.length ? <Table rows={rows} kind={kind} onChanged={reload} /> : null}
      </section>
    </>
  );
}

function Table({ rows, kind, onChanged }: { rows: Row[]; kind: AdminKind; onChanged?: () => void }) {
  const cols: { h: string; cell: (r: Row) => ReactNode; num?: boolean }[] = (() => {
    switch (kind) {
      case "users":
        return [
          { h: "Name", cell: (r) => str(r.name) },
          { h: "Email", cell: (r) => str(r.email) },
          { h: "Account", cell: (r) => <span className="mono">{str(r.account)}</span> },
          { h: "Projects", cell: (r) => str(r.projects), num: true },
          { h: "Joined", cell: (r) => formatDateTime(r.createdAt as string) },
          { h: "Last sign-in", cell: (r) => relative(r.lastSignInAt as string) },
        ];
      case "projects":
        return [
          { h: "Project", cell: (r) => <>{str(r.name)}<br /><span className="small mono">{str(r.id)}</span></> },
          { h: "URL", cell: (r) => str(r.url) },
          { h: "Account", cell: (r) => <span className="mono">{str(r.account)}</span> },
          { h: "Versions", cell: (r) => str(r.versions), num: true },
          { h: "Approved", cell: (r) => str(r.approved), num: true },
          { h: "Runs", cell: (r) => str(r.records), num: true },
          { h: "Certified", cell: (r) => str(r.certified), num: true },
          { h: "Created", cell: (r) => formatDateTime(r.createdAt as string) },
        ];
      case "jobs":
        return [
          { h: "Run", cell: (r) => <span className="mono">{str(r.id)}</span> },
          { h: "Project", cell: (r) => <>{str(r.projectName)}<br /><span className="small">{str(r.account)}</span></> },
          { h: "Version", cell: (r) => `v${str(r.version)}` },
          { h: "Status", cell: (r) => <Tag form={r.status === "succeeded" ? "solid" : r.status === "failed" ? "outline" : "dashed"}>{str(r.status)}</Tag> },
          { h: "Outcome / error", cell: (r) => str((r.error as { code?: string } | null)?.code ?? r.outcome) },
          { h: "Max credits", cell: (r) => str((r.request as { confirmSpend?: number } | null)?.confirmSpend), num: true },
          { h: "Created", cell: (r) => formatDateTime(r.createdAt as string) },
        ];
      case "records":
        return [
          { h: "Record", cell: (r) => <span className="mono">{str(r.id)}</span> },
          { h: "Project", cell: (r) => <>{str(r.projectName)}<br /><span className="small">{str(r.account)}</span></> },
          { h: "Status", cell: (r) => str(r.status) },
          { h: "Certified", cell: (r) => (r.certified ? <Tag form="solid">Certified</Tag> : <Tag form="dashed">No</Tag>) },
          { h: "Commit", cell: (r) => <span className="mono">{str(r.commit).slice(0, 10)}</span> },
          { h: "Credits", cell: (r) => credits((r.credits as { actualSpend?: number } | null)?.actualSpend ?? null), num: true },
          { h: "Public", cell: (r) => (r.certified ? <a href={`/v1/public/records/${str(r.id)}`} target="_blank" rel="noopener noreferrer">Open</a> : "—") },
          { h: "Started", cell: (r) => formatDateTime(r.startedAt as string) },
        ];
      case "tokens":
        return [
          { h: "Label", cell: (r) => str(r.label) },
          { h: "Account", cell: (r) => <span className="mono">{str(r.account)}</span> },
          { h: "Role", cell: (r) => str(r.role) },
          { h: "Id", cell: (r) => <span className="mono">{str(r.id)}</span> },
          { h: "Created", cell: (r) => formatDateTime(r.createdAt as string) },
          { h: "State", cell: (r) => (r.revokedAt ? `Revoked ${relative(r.revokedAt as string)}` : <RevokeButton id={str(r.id)} onDone={onChanged} />) },
        ];
      case "events":
        return [
          { h: "When", cell: (r) => formatDateTime(r.at as string) },
          { h: "Who", cell: (r) => str(r.actor) },
          { h: "Action", cell: (r) => <span className="mono">{str(r.action)}</span> },
          { h: "Target", cell: (r) => <span className="mono">{str(r.target)}</span> },
          { h: "Detail", cell: (r) => <span className="mono small">{JSON.stringify(r.detail)}</span> },
        ];
      case "guests":
        return [
          { h: "App", cell: (r) => <>{str(r.projectName)}<br /><span className="small">{str(r.url)}</span></> },
          { h: "Kind", cell: (r) => (r.kind === "demo_check" ? "Demo check" : "Kane run (before demo checks)") },
          { h: "Status", cell: (r) => str(r.status) },
          { h: "Started", cell: (r) => formatDateTime(r.createdAt as string) },
          { h: "Finished", cell: (r) => formatDateTime(r.finishedAt as string) },
        ];
    }
  })();
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            {cols.map((c) => (
              <th key={c.h} className={c.num ? "num" : undefined}>
                {c.h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={str(r.id ?? i)}>
              {cols.map((c) => (
                <td key={c.h} className={c.num ? "num" : undefined}>
                  {c.cell(r)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RevokeButton({ id, onDone }: { id: string; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost sm"
      disabled={busy}
      onClick={async () => {
        if (!window.confirm("Revoke this token? Anything using it stops working immediately.")) return;
        setBusy(true);
        try {
          await adminApi.revokeToken(id);
          onDone?.();
        } catch (e) {
          window.alert((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? <span className="spinner" aria-hidden="true" /> : <I.Ban size={14} aria-hidden="true" />} Revoke
    </button>
  );
}
