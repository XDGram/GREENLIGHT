import { Empty, ErrorNotice, LoadingRows, Pill } from "../components/Bits";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
import { formatDateTime, relative } from "../format";
import { Link } from "../router";
import type { ProjectSummary } from "../types";
import type { Loadable } from "../useData";

export function ApprovalsPage({ projects, reload }: { projects: Loadable<ProjectSummary[]>; reload: () => void }) {
  const list = projects.state === "ready" ? projects.data : [];
  const waiting = list.flatMap((p) => p.pendingApprovals.map((a) => ({ p, a }))).sort((x, y) => y.a.submittedAt.localeCompare(x.a.submittedAt));
  const approved = list.filter((p) => p.latestVersion?.status === "approved").sort((x, y) => String(y.latestVersion?.approvedAt).localeCompare(String(x.latestVersion?.approvedAt)));

  return (
    <>
      <TopBar title="Approvals" eyebrow="A person approves every test specification before it can be certified">
        <Pill form={waiting.length ? "outline" : "solid"} icon={waiting.length ? <I.Clock size={14} /> : <I.Check size={14} strokeWidth={2.4} />} title={waiting.length ? `${waiting.length} waiting` : "Nothing waiting"} sub="For your review" />
      </TopBar>
      {projects.state === "loading" ? <LoadingRows /> : null}
      {projects.state === "error" ? <ErrorNotice error={projects.error} onRetry={reload} /> : null}
      {projects.state === "ready" ? (
        <div className="row">
          <section className="card" aria-labelledby="wait-h" style={{ flex: "999 1 560px" }}>
            <div className="card-head">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h2 id="wait-h" className="card-title lg">
                  Waiting for you
                </h2>
                <span className="count-chip">{waiting.length}</span>
              </div>
            </div>
            {waiting.length === 0 ? (
              <Empty title="You’re up to date">
                <span>New test specifications appear here when they are submitted.</span>
              </Empty>
            ) : (
              <ul className="list">
                {waiting.map(({ p, a }) => (
                  <li key={`${p.id}-${a.version}`} className="list-row">
                    <span className="pill-icon outline" aria-hidden="true">
                      <I.Clock size={14} />
                    </span>
                    <div className="list-main">
                      <b>
                        {p.name} · version {a.version}
                      </b>
                      <span title={formatDateTime(a.submittedAt)}>
                        Submitted by {a.submittedBy} {relative(a.submittedAt)}
                      </span>
                    </div>
                    <Link href={`/app/projects/${p.id}`} className="btn ghost sm">
                      Details
                    </Link>
                    <a href={a.approveUrl} className="btn sm">
                      Review and approve <I.ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  </li>
                ))}
              </ul>
            )}
            <p className="small" style={{ margin: 0 }}>
              Approving opens the secure approval page: you confirm the test-specification hash and the server-version hash, signed in with Vercel.
            </p>
          </section>
          <section className="card-dark" aria-labelledby="done-h" style={{ flex: "1 1 320px" }}>
            <h2 id="done-h" className="card-title" style={{ fontSize: 15 }}>
              Approved specifications
            </h2>
            {approved.length === 0 ? (
              <p style={{ margin: 0, fontSize: 12.5, color: "var(--on-dark-muted)" }}>None yet.</p>
            ) : (
              <ul className="dots" style={{ gap: 14 }}>
                {approved.map((p) => (
                  <li key={p.id}>
                    <span className="dot" style={{ background: "var(--on-dark)" }} aria-hidden="true" />
                    <Link href={`/app/projects/${p.id}`} style={{ textDecoration: "none" }}>
                      <b style={{ fontWeight: 500 }}>{p.name}</b> v{p.latestVersion!.version}
                      <br />
                      <span style={{ fontSize: 11.5, color: "var(--on-dark-muted)" }}>
                        by {p.latestVersion!.approvedBy} · {formatDateTime(p.latestVersion!.approvedAt)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
