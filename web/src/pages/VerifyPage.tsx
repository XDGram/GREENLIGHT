import { useEffect, useState } from "react";
import { ApiError, api, type SignInRequired } from "../api";
import { CodeBlock, Empty, ErrorNotice, FormError, LoadingRows, Notice, ResultMark, Tag } from "../components/Bits";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
import { credits, formatDateTime, formatDuration, host, relative } from "../format";
import { OUTCOME_LABEL, outcomeOf } from "../plain";
import { Link, useRouter } from "../router";
import type { CommitCheck, DeploymentProbe, Job, ProjectDetail, Session, VersionView } from "../types";
import { useData } from "../useData";

const SHA = /^[0-9a-f]{40}([0-9a-f]{24})?$/;

export function VerifyPage({ id, session, onSignIn }: { id: string; session: Session; onSignIn: (e: SignInRequired) => void }) {
  const { value, reload } = useData(() => api.project(id), [id], { onSignIn, refreshMs: 60_000 });
  if (value.state === "loading") {
    return (
      <>
        <TopBar title="Verification" eyebrow={<Link href="/app/projects">My projects</Link>} />
        <LoadingRows />
      </>
    );
  }
  if (value.state === "error") {
    return (
      <>
        <TopBar title="Verification" eyebrow={<Link href="/app/projects">My projects</Link>} />
        <ErrorNotice error={value.error} onRetry={reload} />
      </>
    );
  }
  return <Verify detail={value.data} session={session} reload={reload} />;
}

function Verify({ detail, session, reload }: { detail: ProjectDetail; session: Session; reload: () => void }) {
  const approved = detail.versions.filter((v) => v.status === "approved");
  const [versionNo, setVersionNo] = useState<number | null>(approved[0]?.version ?? null);
  const v = approved.find((x) => x.version === versionNo) ?? approved[0] ?? null;
  const active = detail.jobs.find((j) => j.status === "queued" || j.status === "running") ?? null;
  const [job, setJob] = useState<Job | null>(active);
  const [probe, setProbe] = useState<DeploymentProbe | null>(null);
  const pid = detail.project.id;

  return (
    <>
      <TopBar title="Verification" eyebrow={<Link href={`/app/projects/${pid}`}>{detail.project.name}</Link>}>
      </TopBar>

      {job ? <JobProgress projectId={pid} job={job} onUpdate={setJob} onFinished={reload} /> : null}

      {!v ? (
        <section className="card">
          <Empty title="No approved tests yet">
            {detail.versions[0] ? (
              <span>
                Version {detail.versions[0].version} is waiting for approval. <a href={detail.versions[0].approveUrl ?? "#"}>Review and approve it</a>, then come back here.
              </span>
            ) : (
              <span>
                <Link href={`/app/projects/${pid}/tests`}>Write the claims and tests</Link> and approve them first.
              </span>
            )}
          </Empty>
        </section>
      ) : (
        <div className="split">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", minWidth: 0 }}>
            <WhatRuns detail={detail} v={v} versions={approved} onPick={setVersionNo} />
            <Deployment detail={detail} probe={probe} setProbe={setProbe} />
          </div>
          {job && (job.status === "queued" || job.status === "running") ? (
            <aside className="card-dark sticky">
              <h2 className="card-title">A run is in progress</h2>
              <p style={{ margin: 0, fontSize: 13, color: "var(--on-dark-muted)" }}>One verification per project at a time. Its progress is shown above.</p>
            </aside>
          ) : (
            session.role === "guest" ? (
              <GuestConfirm detail={detail} v={v} session={session} deployed={probe?.commit ?? null} onStarted={setJob} />
            ) : (
              <Confirm key={probe?.commit ?? "none"} detail={detail} v={v} session={session} deployed={probe?.commit ?? null} onStarted={setJob} />
            )
          )}
        </div>
      )}

      <History detail={detail} />
    </>
  );
}

function WhatRuns({ detail, v, versions, onPick }: { detail: ProjectDetail; v: VersionView; versions: VersionView[]; onPick: (n: number) => void }) {
  const last = detail.records.find((r) => r.testVersion === v.version);
  const results = new Map((last?.claims ?? []).map((c) => [c.id, c.status]));
  return (
    <section className="card" aria-labelledby="runs-h">
      <div className="card-head">
        <h2 id="runs-h" className="card-title lg">
          What will be tested
        </h2>
        {versions.length > 1 ? (
          <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <span>Version</span>
            <select value={v.version} onChange={(e) => onPick(Number(e.target.value))} style={{ width: "auto", minHeight: 36 }}>
              {versions.map((x) => (
                <option key={x.version} value={x.version}>
                  v{x.version} · approved {formatDateTime(x.approval?.approvedAt)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <Tag form="solid">Version {v.version}</Tag>
        )}
      </div>
      <ul className="list">
        {v.claims.map((c) => (
          <li key={c.id} className="list-row" style={{ alignItems: "flex-start" }}>
            <ResultMark status={results.get(c.id)} />
            <div className="list-main">
              <b>{c.text}</b>
              <span>
                {(() => { const n = v.tests.filter((t) => t.claims.includes(c.id)).length; return `${n} test${n === 1 ? "" : "s"}`; })()} · last run: {OUTCOME_LABEL[outcomeOf(results.get(c.id))]}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <dl className="kv-list">
        <dt>Approved</dt>
        <dd>
          {v.approval ? `${formatDateTime(v.approval.approvedAt)} ${v.approval.identity?.provider === "guest" ? "by you" : `by ${v.approval.identity?.username ?? v.approval.approvedBy}${v.approval.identity?.provider ? ` (signed in with ${v.approval.identity.provider === "google" ? "Google" : "Vercel"})` : ""}`}` : "—"}
          {v.approval && !v.approval.verified ? ` · not certifiable: ${v.approval.verificationReason?.replace(/_/g, " ")}` : ""}
        </dd>
        <dt>Tests</dt>
        <dd>
          {v.tests.length} tests, {v.tests.reduce((n, t) => n + t.steps.length, 0)} steps · <Link href={`/app/projects/${detail.project.id}`}>see every step</Link>
        </dd>
      </dl>
    </section>
  );
}

function Deployment({ detail, probe, setProbe }: { detail: ProjectDetail; probe: DeploymentProbe | null; setProbe: (p: DeploymentProbe) => void }) {
  const [busy, setBusy] = useState(false);
  const [inRepo, setInRepo] = useState<CommitCheck | null>(null);
  const head = detail.details?.repositoryCheck?.head ?? null;
  const check = async () => {
    setBusy(true);
    try {
      const r = await api.deploymentCheck(detail.project.id);
      setInRepo(r.inRepository);
      setProbe(r.deployment);
    } catch (e) {
      setProbe({ status: "unreachable", checkedAt: new Date().toISOString(), reason: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const matches = probe?.commit && head?.sha ? probe.commit === head.sha : null;
  return (
    <section className="card" aria-labelledby="dep-h">
      <div className="card-head">
        <h2 id="dep-h" className="card-title lg">
          Which version of your code
        </h2>
        <button type="button" className="btn ghost sm" onClick={check} disabled={busy}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <I.RefreshCw size={14} aria-hidden="true" />} Check again
        </button>
      </div>
      <dl className="kv-list">
        <dt>Live site</dt>
        <dd>
          {!probe ? (
            "Checking…"
          ) : probe.status === "ok" ? (
            <>
              <span className="mono">{probe.commit}</span> · {probe.environment ?? "no environment"}
            </>
          ) : (
            <>Not readable ({probe.reason?.replace(/_/g, " ") ?? probe.status})</>
          )}
        </dd>
        <dt>{detail.details?.branch ? `Branch ${detail.details.branch}` : "Repository"}</dt>
        <dd>
          {head ? (
            <>
              <span className="mono">{head.sha.slice(0, 12)}</span> · {head.message} {head.date ? `· ${relative(head.date)}` : ""}
            </>
          ) : (
            detail.details?.repositoryCheck?.message ?? "No repository check yet."
          )}
        </dd>
        {inRepo ? (
          <>
            <dt>In the repository?</dt>
            <dd>
              {inRepo.status === "found" ? (
                <>
                  Yes:{" "}
                  <a href={inRepo.url} target="_blank" rel="noopener noreferrer">
                    the deployed commit is in {inRepo.repository.replace("https://github.com/", "")}
                  </a>
                </>
              ) : inRepo.status === "not_found" ? (
                <b>No. GitHub has no such commit in {inRepo.repository.replace("https://github.com/", "")}.</b>
              ) : (
                <>Unknown: {inRepo.message} Greenlight does not claim this commit belongs to the repository.</>
              )}
            </dd>
          </>
        ) : null}
      </dl>
      {inRepo?.status === "not_found" ? <Notice>The live site reports a commit that is not in the repository you entered. Check the repository URL, or make sure the deployment is built from it, before verifying.</Notice> : null}
      {matches === false ? <Notice>The live site is not serving the branch’s latest commit. Verification always tests the commit the site is serving; deploy first if you meant to verify the latest code.</Notice> : null}
      {probe && probe.status !== "ok" ? (
        <>
          <p className="small" style={{ margin: 0 }}>
            Certification checks that the live site serves the exact commit being verified. Publish a <code className="mono">/greenlight.json</code> file with the deployed commit, for example in your build step:
          </p>
          <CodeBlock title="public/greenlight.json (generated at build time)" code={`{ "commit": "<full git commit sha>", "environment": "production" }`} />
        </>
      ) : null}
    </section>
  );
}

function Confirm({ detail, v, session, deployed, onStarted }: { detail: ProjectDetail; v: VersionView; session: Session; deployed: string | null; onStarted: (j: Job) => void }) {
  const est = v.estimate?.credits ?? null;
  const cap = v.estimate?.cap ?? session.maxCreditsPerRun;
  // Prefilled with what the live site reports; the server checks it again before anything runs.
  const [commit, setCommit] = useState(deployed ?? detail.details?.repositoryCheck?.head?.sha ?? "");
  const [limit, setLimit] = useState<number>(est ? Math.ceil(est) : 0);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; problems?: string[] } | null>(null);
  const overCap = est != null && cap != null && est > cap;
  const tooLow = est != null && limit < est;
  const ready = SHA.test(commit.trim().toLowerCase()) && agree && !overCap && !tooLow && limit > 0 && session.features.certification;

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.certify(detail.project.id, { version: v.version, commit: commit.trim().toLowerCase(), confirmSpend: limit, approvedTestHash: v.approvedTestHash });
      onStarted(r.job);
    } catch (e) {
      const a = e as ApiError;
      setError({ message: a.message, problems: a.problems });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="card sticky" aria-labelledby="spend-h" style={{ border: "1.5px solid var(--ink)" }}>
      <h2 id="spend-h" className="card-title lg">
        Test it in a real browser
      </h2>
      <dl className="stats" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <div className="stat">
          <dt>Estimated cost</dt>
          <dd>{credits(est)}</dd>
          <small>Kane credits</small>
        </div>
        <div className="stat">
          <dt>Server limit</dt>
          <dd>{cap ?? "—"}</dd>
          <small>per run</small>
        </div>
      </dl>
      {v.estimate ? (
        <p className="small" style={{ margin: 0 }}>
          {v.estimate.breakdown.length} tests authored afresh ({v.estimate.breakdown.map((b) => credits(b.credits)).join(" + ")}) plus {credits(v.estimate.runOverhead)} per run. The actual spend is read from the balance afterwards and recorded.
        </p>
      ) : null}
      {overCap ? <Notice>These tests are estimated above this server’s limit, so the run would be refused. Use fewer tests or steps.</Notice> : null}
      <label className="field">
        <span>Commit to verify (must be what the live site serves)</span>
        <input className="mono" value={commit} onChange={(e) => setCommit(e.target.value)} placeholder="full 40-character commit sha" spellCheck={false} autoComplete="off" />
      </label>
      <label className="field">
        <span>Most credits you accept for this run</span>
        <input type="number" inputMode="decimal" min={est ?? 1} max={cap ?? undefined} step="1" value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
        {tooLow ? <span className="hint">At least the estimate ({credits(est)}), or the run is refused before it starts.</span> : null}
      </label>
      <div className="confirm-box">
        <label className="check-line">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            I confirm this run may spend up to <b>{credits(limit)}</b> credits to test version {v.version} against <span className="mono">{commit ? commit.slice(0, 12) : "the deployed commit"}</span>.
          </span>
        </label>
      </div>
      <FormError error={error} />
      {!session.features.certification ? <Notice>Verification runs are not available on this server.</Notice> : null}
      <button type="button" className="btn" disabled={!ready || busy} onClick={start}>
        {busy ? <span className="spinner" aria-hidden="true" /> : <I.Play size={15} aria-hidden="true" />}
        Spend up to {credits(limit)} credits and verify
      </button>
      <p className="small" style={{ margin: 0 }}>
        The server re-checks the approval, the fingerprint and the deployed commit before a browser opens. A run that fully passes becomes a public certification record; any other result stays in your private history.
      </p>
    </aside>
  );
}

/** Guests: the server picks the commit; real runs are limited and never certify. */
function GuestConfirm({ detail, v, session, deployed, onStarted }: { detail: ProjectDetail; v: VersionView; session: Session; deployed: string | null; onStarted: (j: Job) => void }) {
  const { search } = useRouter();
  const only = (search.get("tests") ?? "").split(",").filter((t) => v.tests.some((x) => x.file === t));
  const chosen = only.length ? v.tests.filter((t) => only.includes(t.file)) : v.tests;
  const runs = session.guestRuns;
  const per = v.estimate?.breakdown.filter((b) => chosen.some((t) => t.file === b.file)).reduce((n, b) => n + b.credits, 0) ?? 0;
  const est = only.length ? per + (v.estimate?.runOverhead ?? 0) : v.estimate?.credits ?? null;
  const cap = runs?.maxCreditsPerRun ?? v.estimate?.cap ?? null;
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; problems?: string[] } | null>(null);
  const head = detail.details?.repositoryCheck?.head?.sha ?? null;
  const blocked = !runs?.enabled ? "Real browser runs aren't available for visitors on this server." : runs.paused ? "Real browser runs are paused by the administrator right now." : runs.leftForYou <= 0 ? "You've used your real browser runs on this browser." : runs.leftToday <= 0 ? "Today's real browser runs are used up for all visitors. Try again tomorrow." : est != null && cap != null && est > cap ? "This plan is too large for a visitor run. Remove a test or some steps." : null;
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.certify(detail.project.id, { version: v.version, confirmSpend: Math.min(cap ?? 150, Math.ceil(est ?? 150)), approvedTestHash: v.approvedTestHash, ...(only.length ? { tests: only } : {}) });
      onStarted(r.job);
    } catch (e) {
      const a = e as ApiError;
      setError({ message: a.message, problems: a.problems });
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="card sticky" aria-labelledby="spend-h" style={{ border: "1.5px solid var(--ink)" }}>
      <h2 id="spend-h" className="card-title lg">
        Test it in a real browser
      </h2>
      <p style={{ margin: 0, fontSize: 13.5 }}>
        A real browser opens <b>{host(detail.project.url)}</b> and follows {only.length ? `the ${chosen.length} chosen test${chosen.length === 1 ? "" : "s"}` : `all ${chosen.length} tests`} exactly as approved. It usually takes a few minutes.
      </p>
      {only.length ? <Notice>Re-running only: {chosen.map((t) => t.title ?? t.file).join(", ")}.</Notice> : null}
      <dl className="kv-list">
        <dt>Code version</dt>
        <dd>{deployed ? `${deployed.slice(0, 7)}, reported by your live site` : head ? `${head.slice(0, 7)}, the latest on ${detail.details?.branch ?? "main"} (your site doesn't say which version it runs, so this is marked unconfirmed)` : "Unknown: add /greenlight.json to your site or make the repository public"}</dd>
        <dt>Runs left</dt>
        <dd>{runs ? `${runs.leftForYou} for you · ${runs.leftToday} today for all visitors` : "—"}</dd>
        <dt>Cost</dt>
        <dd>About {credits(est)} test credits, paid by Greenlight (limit {cap ?? "—"})</dd>
      </dl>
      {blocked ? (
        <Notice>{blocked}</Notice>
      ) : (
        <label className="check-line">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>Run {chosen.length === 1 ? "this test" : `these ${chosen.length} tests`} on my live app now. This uses one of my real browser runs.</span>
        </label>
      )}
      <FormError error={error} />
      <button type="button" className="btn" disabled={!agree || busy || Boolean(blocked) || (!deployed && !head)} onClick={start}>
        {busy ? <span className="spinner" aria-hidden="true" /> : <I.Play size={15} aria-hidden="true" />} Start the browser test
      </button>
      <p className="small" style={{ margin: 0 }}>
        Visitor runs are private: they are never turned into public certificates.
      </p>
    </aside>
  );
}

const PHASES = [
  { key: "queued", label: "Queued" },
  { key: "running", label: "Checking the live app, then testing in a browser" },
  { key: "done", label: "Result recorded" },
];

function JobProgress({ projectId, job, onUpdate, onFinished }: { projectId: string; job: Job; onUpdate: (j: Job) => void; onFinished: () => void }) {
  const [now, setNow] = useState(Date.now());
  const finished = job.status === "succeeded" || job.status === "failed";
  useEffect(() => {
    if (finished) return;
    const t = window.setInterval(async () => {
      setNow(Date.now());
      try {
        const j = await api.job(job.id);
        onUpdate(j);
        if (j.status === "succeeded" || j.status === "failed") onFinished();
      } catch {
        // keep polling; a transient error is not a result
      }
    }, 4000);
    return () => window.clearInterval(t);
  }, [job.id, finished, onUpdate, onFinished]);
  const idx = finished ? 2 : job.status === "running" ? 1 : 0;
  const since = new Date(job.startedAt ?? job.createdAt).getTime();
  return (
    <section className="card" aria-labelledby="job-h" aria-live="polite" style={{ border: "1.5px solid var(--ink)" }}>
      <div className="card-head">
        <h2 id="job-h" className="card-title lg">
          {finished ? (job.recordId ? "Verification finished" : "Verification stopped") : "Verification in progress"}
        </h2>
        <span className="small mono">{job.id}</span>
      </div>
      <ol className="stepper">
        {PHASES.map((p, i) => (
          <li key={p.key} className={i < idx || (finished && i === 2) ? "done" : undefined} aria-current={i === idx && !finished ? "step" : undefined}>
            <span className="step-n" aria-hidden="true">
              {i + 1}
            </span>
            {p.label}
          </li>
        ))}
      </ol>
      {!finished ? (
        <>
          <div className="progress indeterminate" aria-hidden="true">
            <span />
          </div>
          <p className="small" style={{ margin: 0 }}>
            Version {job.version} · commit <span className="mono">{job.commit?.slice(0, 12) ?? "—"}</span> · {job.status === "queued" ? "waiting to start" : `running for ${formatDuration(now - since)}`}. A run usually takes a few minutes; this page updates by itself and you can leave it.
          </p>
        </>
      ) : job.recordId ? (
        <div className="tags">
          <span className="small" style={{ alignSelf: "center" }}>
            Outcome: {job.outcome?.replace(/[_:]/g, " ") ?? job.status}
          </span>
          <Link className="btn" href={`/app/projects/${projectId}/runs/${job.recordId}`}>
            See the results <I.ChevronRight size={15} aria-hidden="true" />
          </Link>
        </div>
      ) : (
        <Notice>
          <b>{job.error?.code?.replace(/_/g, " ") ?? "Stopped"}.</b> {job.error?.message ?? "The run stopped before results."} No verification record was written.
        </Notice>
      )}
    </section>
  );
}

function History({ detail }: { detail: ProjectDetail }) {
  if (!detail.records.length && !detail.jobs.length) return null;
  const failedJobs = detail.jobs.filter((j) => j.status === "failed" && !j.recordId).slice(0, 5);
  return (
    <section className="card" aria-labelledby="hist-h">
      <h2 id="hist-h" className="card-title lg">
        Earlier runs
      </h2>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Run</th>
              <th>Version</th>
              <th>Commit</th>
              <th>Result</th>
              <th className="num">Credits</th>
              <th>Certification</th>
            </tr>
          </thead>
          <tbody>
            {detail.records.map((r) => (
              <tr key={r.id}>
                <td>
                  <Link href={`/app/projects/${detail.project.id}/runs/${r.id}`}>{formatDateTime(r.startedAt)}</Link>
                </td>
                <td>v{r.testVersion}</td>
                <td className="mono">{r.deployment?.commit.slice(0, 10) ?? "—"}</td>
                <td>
                  {r.claims.filter((c) => c.status === "passed").length}/{r.claims.length} claims passed
                </td>
                <td className="num">{credits(r.credits?.actual)}</td>
                <td>{r.certified ? <Tag form="solid">Certified</Tag> : <Tag form="dashed">Not certified</Tag>}</td>
              </tr>
            ))}
            {failedJobs.map((j) => (
              <tr key={j.id}>
                <td>{formatDateTime(j.createdAt)}</td>
                <td>v{j.version}</td>
                <td className="mono">{j.commit?.slice(0, 10) ?? "—"}</td>
                <td>Stopped: {j.error?.code?.replace(/_/g, " ") ?? "failed"}</td>
                <td className="num">—</td>
                <td>
                  <Tag form="dashed">No record</Tag>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small" style={{ margin: 0 }}>Re-verify any time with the form above; each run is a separate record.</p>
    </section>
  );
}
