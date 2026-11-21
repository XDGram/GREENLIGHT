import { Empty, ErrorNotice, LoadingRows, Tag } from "../components/Bits";
import * as I from "../components/Icons";
import { ApprovalsBell, SearchPill, TopBar } from "../components/Shell";
import { formatDate, host } from "../format";
import { Link, useRouter } from "../router";
import { projectStage } from "../state";
import type { ProjectSummary } from "../types";
import type { Loadable } from "../useData";

export function ProjectsPage({ projects, reload }: { projects: Loadable<ProjectSummary[]>; reload: () => void }) {
  const { search, navigate } = useRouter();
  const q = search.get("q") ?? "";
  const list = projects.state === "ready" ? projects.data : [];
  const pending = list.reduce((n, p) => n + p.pendingApprovals.length, 0);
  const shown = list.filter((p) => !q || `${p.name} ${p.url} ${p.id}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <TopBar title="Projects" eyebrow={`${list.length} in this account`}>
        <SearchPill value={q} onChange={(v) => navigate(v ? `/app/projects?q=${encodeURIComponent(v)}` : "/app/projects")} />
        <ApprovalsBell pending={pending} />
        <Link href="/app/projects/new" className="btn">
          <I.Plus size={15} aria-hidden="true" /> Add project
        </Link>
      </TopBar>
      {projects.state === "loading" ? <LoadingRows /> : null}
      {projects.state === "error" ? <ErrorNotice error={projects.error} onRetry={reload} /> : null}
      {projects.state === "ready" && shown.length === 0 ? (
        <section className="card">
          <Empty title={q ? `No project matches “${q}”` : "No projects yet"}>
            {q ? null : (
              <>
                <span>Add the app you want to verify: its live URL, GitHub repository and what it should do.</span>
                <Link href="/app/projects/new" className="btn">
                  <I.Plus size={15} aria-hidden="true" /> Add project
                </Link>
              </>
            )}
          </Empty>
        </section>
      ) : null}
      <div className="grid-cards">
        {shown.map((p) => {
          const st = projectStage(p);
          return (
            <Link key={p.id} href={`/app/projects/${p.id}`} className="project-card">
              <div className="card-head">
                <span className="mono small">{host(p.url)}</span>
                <span className={`pill-icon ${st.form === "solid" ? "" : st.form}`} style={{ width: 30, height: 30 }} aria-hidden="true">
                  {st.form === "solid" ? <I.Check size={13} strokeWidth={2.4} /> : <I.Clock size={13} />}
                </span>
              </div>
              <h3>{p.name}</h3>
              <dl className="kv">
                <div>
                  <dt>Claims</dt>
                  <dd className="num">{p.latestVersion?.claims ?? 0}</dd>
                </div>
                <div>
                  <dt>Tests</dt>
                  <dd className="num">{p.latestVersion?.tests ?? 0}</dd>
                </div>
                <div>
                  <dt>Runs</dt>
                  <dd className="num">{p.records}</dd>
                </div>
              </dl>
              <div className="tags">
                <Tag form={st.form}>{st.label}</Tag>
                {p.latestVersion ? <Tag>Version {p.latestVersion.version}</Tag> : null}
                <Tag form="dashed">Added {formatDate(p.createdAt)}</Tag>
              </div>
            </Link>
          );
        })}
      </div>
    </>
  );
}
