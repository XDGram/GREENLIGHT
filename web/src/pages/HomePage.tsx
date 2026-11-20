import { ErrorNotice, Empty, LoadingRows, Pill, Tag } from "../components/Bits";
import { ChromeOrb } from "../components/Chrome";
import * as I from "../components/Icons";
import { ApprovalsBell, TopBar } from "../components/Shell";
import { formatDateTime, host, relative } from "../format";
import { Link } from "../router";
import { projectStage } from "../state";
import type { ProjectSummary, Session } from "../types";
import type { Loadable } from "../useData";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

interface Activity {
  at: string;
  project: ProjectSummary;
  what: string;
  form: "solid" | "outline" | "dashed";
}

function activity(projects: ProjectSummary[]): Activity[] {
  const out: Activity[] = [];
  for (const p of projects) {
    out.push({ at: p.createdAt, project: p, what: `Project added by ${p.createdBy}`, form: "dashed" });
    for (const a of p.pendingApprovals) out.push({ at: a.submittedAt, project: p, what: `Version ${a.version} submitted by ${a.submittedBy}, waiting for approval`, form: "outline" });
    if (p.latestVersion?.approvedAt) out.push({ at: p.latestVersion.approvedAt, project: p, what: `Version ${p.latestVersion.version} approved by ${p.latestVersion.approvedBy}`, form: "solid" });
    if (p.lastRecord?.endedAt) out.push({ at: p.lastRecord.endedAt, project: p, what: p.lastRecord.certified ? `Certified (version ${p.lastRecord.testVersion})` : `Run finished: not certified`, form: p.lastRecord.certified ? "solid" : "outline" });
  }
  return out.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 8);
}

export function HomePage({ session, projects, reload }: { session: Session; projects: Loadable<ProjectSummary[]>; reload: () => void }) {
  const list = projects.state === "ready" ? projects.data : [];
  const pending = list.reduce((n, p) => n + p.pendingApprovals.length, 0);
  const certified = list.filter((p) => p.lastRecord?.certified).length;
  const runs = list.reduce((n, p) => n + p.records, 0);
  const claims = list.reduce((n, p) => n + (p.latestVersion?.claims ?? 0), 0);

  return (
    <>
      <TopBar title="Overview" eyebrow={`${greeting()}, ${session.user}`}>
        <Pill form={pending ? "outline" : "solid"} icon={pending ? <I.Clock size={14} /> : <I.Check size={14} strokeWidth={2.4} />} title={pending ? `${pending} waiting` : "All approved"} sub="Approvals" href={pending ? "/app/approvals" : undefined} />
        <Pill form="outline" icon={<I.Records size={14} />} title={`${certified} certified`} sub={`${list.length} projects`} />
        <ApprovalsBell pending={pending} />
      </TopBar>

      {projects.state === "loading" ? <LoadingRows /> : null}
      {projects.state === "error" ? <ErrorNotice error={projects.error} onRetry={reload} /> : null}

      {projects.state === "ready" ? (
        <>
          <div className="row">
            <section className="card" aria-labelledby="sum-h" style={{ flex: "2 1 520px" }}>
              <div className="card-head">
                <h2 id="sum-h" className="label">
                  <I.LayoutGrid size={16} aria-hidden="true" /> Account {session.account}
                </h2>
              </div>
              <dl className="kv" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", rowGap: 18 }}>
                <div>
                  <dt>Projects</dt>
                  <dd className="big-number num">{list.length}</dd>
                </div>
                <div>
                  <dt>Claims under test</dt>
                  <dd className="big-number num">{claims}</dd>
                </div>
                <div>
                  <dt>Waiting for approval</dt>
                  <dd className="big-number num">{pending}</dd>
                </div>
                <div>
                  <dt>Verification runs</dt>
                  <dd className="big-number num">{runs}</dd>
                </div>
              </dl>
              <p className="small" style={{ margin: 0 }}>
                Greenlight checks a live deployment against the claims a person approved, and records the result with its evidence.
              </p>
            </section>
            <section className="card-dark" aria-labelledby="cert-h" style={{ flex: "1 1 280px" }}>
              <h2 id="cert-h" className="card-title" style={{ fontSize: 15 }}>
                Certified projects
              </h2>
              <ChromeOrb />
              <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
                <span className="big-number num">{certified}</span>
                <span style={{ fontSize: 12, color: "var(--on-dark-muted)" }}>of {list.length} · a certificate needs a passing run on the approved tests</span>
              </div>
            </section>
          </div>

          <div className="row">
            <section className="card tight" aria-labelledby="act-h" style={{ flex: "1 1 340px" }}>
              <div className="card-head">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span className="round-icon" aria-hidden="true">
                    <I.Clock size={16} />
                  </span>
                  <h2 id="act-h" className="card-title" style={{ fontSize: 13 }}>
                    Recent activity
                  </h2>
                </div>
              </div>
              {list.length === 0 ? (
                <Empty title="Nothing yet">
                  <span>Activity appears when a project is submitted.</span>
                </Empty>
              ) : (
                <ul className="file-list">
                  {activity(list).map((a, i) => (
                    <li key={i} className="file-row" style={{ minHeight: 52, borderRadius: 26 }}>
                      <span className={`pill-icon ${a.form === "solid" ? "" : a.form}`} style={{ width: 30, height: 30 }} aria-hidden="true">
                        {a.form === "solid" ? <I.Check size={13} strokeWidth={2.4} /> : a.form === "outline" ? <I.Clock size={13} /> : <I.Projects size={13} />}
                      </span>
                      <span className="file-name" style={{ whiteSpace: "normal" }}>
                        <b style={{ fontWeight: 500 }}>{a.project.name}</b> · {a.what}
                      </span>
                      <span className="file-meta" title={formatDateTime(a.at)}>
                        {relative(a.at)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="card tight" aria-labelledby="proj-h" style={{ flex: "999 1 560px" }}>
              <div className="card-head">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <h2 id="proj-h" className="card-title lg">
                    Projects
                  </h2>
                  <span className="count-chip">{list.length}</span>
                </div>
                <Link href="/app/projects" className="btn ghost sm">
                  View all
                </Link>
              </div>
              {list.length === 0 ? (
                <Empty title="No projects yet">
                  <span>
                    Propose one with <code className="mono">greenlight submit</code>.
                  </span>
                </Empty>
              ) : (
                <div className="claims-dark">
                  {list.slice(0, 3).map((p) => {
                    const st = projectStage(p);
                    return (
                      <Link key={p.id} href={`/app/projects/${p.id}`} className="claim" style={{ textDecoration: "none" }}>
                        <div className="claim-id">{host(p.url)}</div>
                        <h3 style={{ fontSize: 18, fontWeight: 400 }}>{p.name}</h3>
                        <p>
                          {p.latestVersion ? `${p.latestVersion.claims} claims · ${p.latestVersion.tests} tests · version ${p.latestVersion.version}` : "No tests submitted"}
                        </p>
                        <div className="claim-foot">
                          <div className="caps">
                            <span>Status</span>
                            <b>{st.label}</b>
                          </div>
                          <div className="meter">
                            <span style={{ width: p.lastRecord?.certified ? "100%" : p.latestVersion?.status === "approved" ? "40%" : p.latestVersion ? "20%" : "0%" }} />
                          </div>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
              {list.length > 0 ? (
                <div className="tags">
                  {list.map((p) => (
                    <Tag key={p.id} form={projectStage(p).form}>
                      {p.name}: {projectStage(p).label}
                    </Tag>
                  ))}
                </div>
              ) : null}
            </section>
          </div>
        </>
      ) : null}
    </>
  );
}
