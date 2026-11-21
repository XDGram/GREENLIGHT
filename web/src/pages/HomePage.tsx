import { api, guestApi } from "../api";
import { ErrorNotice, LoadingRows } from "../components/Bits";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
import { formatDateTime, host } from "../format";
import { FIX_STATUS_LABEL } from "../plain";
import { Link } from "../router";
import type { ProjectSummary, Session } from "../types";
import { useData, type Loadable } from "../useData";

/** The one next step for a project, in plain words. */
function nextStep(p: ProjectSummary): { label: string; href: string } {
  if (p.activeJob) return { label: "Testing now…", href: `/app/projects/${p.id}/verify` };
  if (!p.latestVersion) return { label: "Review the test plan", href: `/app/projects/${p.id}/tests` };
  if (p.latestVersion.status === "pending_approval") return { label: "Approve the test plan", href: `/app/projects/${p.id}/tests` };
  if (!p.lastRecord) return { label: "Test it in a browser", href: `/app/projects/${p.id}/verify` };
  if (p.lastRecord.status !== "passed") return { label: "See what failed", href: `/app/projects/${p.id}/runs/${p.lastRecord.id}` };
  return { label: "Last run worked", href: `/app/projects/${p.id}` };
}

export function HomePage({ session, projects, reload }: { session: Session; projects: Loadable<ProjectSummary[]>; reload: () => void }) {
  const fixes = useData(() => api.fixes(), [], { refreshMs: 60_000 });
  const me = useData(() => guestApi.me(), [], { refreshMs: 600_000 });
  const sample = me.value.state === "ready" && Boolean(me.value.data.sample);
  const list = projects.state === "ready" ? projects.data : [];
  const openFixes = fixes.value.state === "ready" ? fixes.value.data.filter((f) => !["fixed", "dismissed"].includes(f.status)) : [];
  return (
    <>
      <TopBar title="Overview" eyebrow={session.role === "guest" ? "No account needed · this browser remembers your projects" : session.name ?? session.email ?? session.user}>
        <Link href="/app/projects/new" className="btn">
          <I.Plus size={15} aria-hidden="true" /> Submit an app
        </Link>
      </TopBar>
      {projects.state === "loading" ? <LoadingRows /> : null}
      {projects.state === "error" ? <ErrorNotice error={projects.error} onRetry={reload} /> : null}

      {projects.state === "ready" && !list.length ? (
        <section className="card" style={{ gap: 18 }}>
          <h2 className="card-title lg">Find out if your app really works</h2>
          <ol className="journey" style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {[
              ["Submit", "GitHub repository, live URL, what it does"],
              ["Learn", "Greenlight reads the code and opens the app"],
              ["Plan", "Plain-English tests you approve"],
              ["Test", "A real browser runs them on your live app"],
              ["Fix", "Failures explained, fixes sent to your coding agent"],
            ].map(([t, s], i) => (
              <li key={t}>
                <div className="j">
                  <span className="j-n">Step {i + 1}</span>
                  <span className="j-t">{t}</span>
                  <span className="j-s">{s}</span>
                </div>
              </li>
            ))}
          </ol>
          <div className="tags">
            <Link href="/app/projects/new" className="btn">
              Submit your first app
            </Link>
            {sample ? (
              <Link href="/app/sample" className="btn ghost">
                See an example project
              </Link>
            ) : null}
          </div>
        </section>
      ) : null}

      {list.length ? (
        <section className="card" aria-labelledby="proj-h">
          <div className="card-head">
            <h2 id="proj-h" className="card-title lg">
              Your projects
            </h2>
            <Link href="/app/projects" className="small">
              All projects
            </Link>
          </div>
          <ul className="list">
            {list.slice(0, 8).map((p) => {
              const next = nextStep(p);
              const r = p.lastRecord;
              return (
                <li key={p.id} className="list-row">
                  <div className="list-main">
                    <b>
                      <Link href={`/app/projects/${p.id}`}>{p.name}</Link>
                    </b>
                    <span>
                      {host(p.url)}
                      {r ? ` · last tested ${formatDateTime(r.startedAt)}: ${r.claims.filter((c) => c.status === "passed").length} of ${r.claims.length} working` : " · not tested yet"}
                    </span>
                  </div>
                  <Link href={next.href} className={next.label === "Last run worked" ? "btn ghost sm" : "btn sm"}>
                    {next.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {openFixes.length ? (
        <section className="card" aria-labelledby="fix-h">
          <div className="card-head">
            <h2 id="fix-h" className="card-title lg">
              In the Fix Centre
            </h2>
            <Link href="/app/fixes" className="small">
              Open the Fix Centre
            </Link>
          </div>
          <ul className="list">
            {openFixes.slice(0, 5).map((f) => (
              <li key={f.id} className="list-row">
                <span className="outcome not_working">{FIX_STATUS_LABEL[f.status]}</span>
                <div className="list-main">
                  <b>
                    <Link href={`/app/fixes/${f.id}`}>{f.test?.title ?? f.testFile}</Link>
                  </b>
                  <span>{f.project?.name}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
