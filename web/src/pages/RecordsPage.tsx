import { api, type SignInRequired } from "../api";
import { Empty, ErrorNotice, LoadingRows, Pill, Tag } from "../components/Bits";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
import { credits, formatDateTime } from "../format";
import { OUTCOME_LABEL, outcomeOf } from "../plain";
import { Link } from "../router";
import type { ProjectSummary, RecordSummary } from "../types";
import { useData, type Loadable } from "../useData";

export function RecordsPage({ projects, onSignIn }: { projects: Loadable<ProjectSummary[]>; onSignIn: (e: SignInRequired) => void }) {
  const ids = projects.state === "ready" ? projects.data.filter((p) => p.records > 0).map((p) => p.id) : null;
  const { value, reload } = useData(
    async () => {
      if (!ids) return null;
      const all: { name: string; projectId: string; r: RecordSummary }[] = [];
      for (const id of ids) {
        const d = await api.project(id);
        for (const r of d.records) all.push({ name: d.project.name, projectId: id, r });
      }
      return all.sort((a, b) => String(b.r.startedAt).localeCompare(String(a.r.startedAt)));
    },
    [ids?.join(",") ?? "pending"],
    { onSignIn, refreshMs: 60_000 },
  );
  const rows = value.state === "ready" ? value.data ?? [] : [];
  const certified = rows.filter((x) => x.r.certified).length;

  return (
    <>
      <TopBar title="Evidence & history" eyebrow="Every browser test run, what worked and what didn’t, with its evidence">
        <Pill icon={<I.Records size={14} />} title={`${rows.length} runs`} sub={certified ? `${certified} certified` : "Private history"} />
      </TopBar>
      {projects.state === "loading" || value.state === "loading" || (value.state === "ready" && value.data === null) ? <LoadingRows /> : null}
      {value.state === "error" ? <ErrorNotice error={value.error} onRetry={reload} /> : null}
      {value.state === "ready" && value.data !== null ? (
        <section className="card">
          {rows.length === 0 ? (
            <Empty title="No runs yet">
              <span>A record is written every time a verification run reaches the browser, whether it passes or not. Start one from a project’s Verify page.</span>
            </Empty>
          ) : (
            <ul className="list">
              {rows.map(({ name, projectId, r }) => (
                <li key={r.id} className="list-row">
                  <span className={`pill-icon ${r.certified ? "" : "outline"}`} aria-hidden="true">
                    {r.certified ? <I.Check size={14} strokeWidth={2.4} /> : <I.X size={14} />}
                  </span>
                  <div className="list-main">
                    <b>
                      <Link href={`/app/projects/${projectId}/runs/${r.id}`}>{name}</Link> · version {r.testVersion}
                    </b>
                    <span>
                      {formatDateTime(r.startedAt)}
                      {r.deployment ? ` · ${r.deployment.environment} ${r.deployment.commit.slice(0, 7)}` : ""}
                      {r.credits?.actual != null ? ` · ${credits(r.credits.actual)} credits` : ""}
                    </span>
                  </div>
                  <span className="tags">
                    <span className={`outcome ${outcomeOf(r.status)}`}>{OUTCOME_LABEL[outcomeOf(r.status)]}</span>
                    {r.certified ? <Tag form="solid">Public certificate</Tag> : null}
                    {r.integrity ? null : <Tag form="dashed">Record failed its integrity check</Tag>}
                  </span>
                  {r.certified && r.publicUrl ? (
                    <a className="btn ghost sm" href={r.publicUrl} target="_blank" rel="noopener noreferrer">
                      Public record <I.ArrowUpRight size={14} aria-hidden="true" />
                    </a>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </>
  );
}
