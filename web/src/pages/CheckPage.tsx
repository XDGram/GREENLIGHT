import { useEffect, useState } from "react";
import { Github, Globe, Copy, Check as CheckIcon, ArrowUpRight, ArrowLeft, Play, Plus, GitCommitHorizontal } from "lucide-react";
import { api, ApiError, checkApi, type ClaimsResult } from "../api";
import { Link, useRouter } from "../router";
import type { Job, ProjectDetail, ProjectSummary, RunDetail, Session } from "../types";
import { AppBadge, PageHero, appIdentity } from "../components/Workspace";

// The check flow in the workspace: a new check (app -> claims -> run, with a sticky run summary),
// its result (verdict, claims with what Kane saw, the Claude Code fix) and the list of checks.

type Err = { message: string; problems?: string[] } | null;
const asErr = (e: unknown): Err => ({ message: (e as Error).message, problems: e instanceof ApiError ? e.problems : [] });

function Alert({ error }: { error: Err }) {
  if (!error) return null;
  return (
    <div className="ws-alert" role="alert">
      <span>
        {error.message}
        {error.problems?.length ? ` ${error.problems.join(" ")}` : ""}
      </span>
    </div>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="ws-btn ghost"
      style={{ height: 32, padding: "0 10px", fontSize: 13 }}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setDone(true);
          setTimeout(() => setDone(false), 1600);
        } catch {
          // the text stays selectable
        }
      }}
    >
      {done ? <CheckIcon size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      {done ? "Copied" : label}
    </button>
  );
}

// ---------------------------------------------------------------- new check

/** The new-check form with its run summary. `onStarted` receives the new check's id. */
export function CheckForm({ session, beforeFirstCall, onStarted }: { session: Session | null; beforeFirstCall?: () => Promise<void>; onStarted: (projectId: string) => void }) {
  const [repository, setRepository] = useState("");
  const [url, setUrl] = useState("");
  const [notes, setNotes] = useState("");
  const [found, setFound] = useState<ClaimsResult | null>(null);
  const [claims, setClaims] = useState<{ text: string; on: boolean }[]>([]);
  const [extra, setExtra] = useState("");
  const [busy, setBusy] = useState<"claims" | "run" | null>(null);
  const [error, setError] = useState<Err>(null);

  const max = found?.maxClaims ?? 0;
  const chosen = claims.filter((c) => c.on && c.text.trim());
  const cost = chosen.length ? found?.costs[chosen.length - 1] ?? null : null;
  const guestRuns = found?.guestRuns ?? session?.guestRuns ?? null;
  const overBudget = Boolean(guestRuns && cost != null && guestRuns.creditsLeftToday < cost);
  const budget = found?.budget ?? null;
  const overCap = Boolean(budget && cost != null && cost > budget.left);
  const noRunsLeft = overCap || Boolean(guestRuns && (guestRuns.paused || !guestRuns.enabled || guestRuns.leftForYou < 1 || guestRuns.leftToday < 1 || overBudget));
  const step = !found ? 1 : chosen.length ? 3 : 2;

  const findClaims = async () => {
    setBusy("claims");
    setError(null);
    try {
      await beforeFirstCall?.();
      const r = await checkApi.claims({ repository, url, notes });
      setFound(r);
      setClaims(r.claims.map((text, i) => ({ text, on: i < r.maxClaims })));
    } catch (e) {
      setError(asErr(e));
    } finally {
      setBusy(null);
    }
  };
  const toggle = (i: number) =>
    setClaims((cs) => {
      const next = cs.map((c, j) => (j === i ? { ...c, on: !c.on } : c));
      return next.filter((c) => c.on).length > max ? cs : next;
    });
  const addClaim = () => {
    const t = extra.trim();
    if (!t) return;
    setClaims((cs) => [...cs, { text: t, on: cs.filter((c) => c.on).length < max }]);
    setExtra("");
  };
  const run = async () => {
    if (cost == null) return;
    setBusy("run");
    setError(null);
    try {
      const r = await checkApi.run({ repository, url, notes, claims: chosen.map((c) => c.text.trim()), confirm: true, confirmSpend: cost });
      onStarted(r.projectId);
    } catch (e) {
      setError(asErr(e));
      setBusy(null);
    }
  };
  const changed = () => {
    if (found) {
      setFound(null);
      setClaims([]);
    }
  };

  const limitNote = guestRuns
    ? guestRuns.paused
      ? "Kane runs are paused by the administrator right now."
      : !guestRuns.enabled
        ? "Kane runs for visitors are not switched on on this server."
        : guestRuns.leftForYou < 1
          ? "You have used your free Kane run on this browser."
          : guestRuns.leftToday < 1
            ? "Today's free Kane runs are used up. Try again tomorrow."
            : overBudget
              ? `Today's free budget has ${guestRuns.creditsLeftToday} credits left: test fewer claims.`
              : null
    : null;
  const capNote = overCap && budget ? (budget.left >= (found?.costs[0] ?? Infinity) ? `Only ${budget.left} credits are left on this server: test fewer claims.` : "This server's Kane budget is used up. No more runs can start.") : null;

  return (
    <>
      <div className="ws-stepper" aria-label="Progress">
        <span className={`st ${step >= 1 ? "on" : ""}`}>
          <span className={`ws-step ${step > 1 ? "done" : ""}`}>1</span>Your app
        </span>
        <span className="line" aria-hidden="true" />
        <span className={`st ${step >= 2 ? "on" : ""}`}>
          <span className={`ws-step ${step > 2 ? "done" : ""}`}>2</span>Claims
        </span>
        <span className="line" aria-hidden="true" />
        <span className={`st ${step >= 3 ? "on" : ""}`}>
          <span className="ws-step">3</span>Run
        </span>
      </div>

      <div className="ws-grid">
        <div className="ws-col">
          <section className="ws-card" aria-labelledby="c1">
            <div className="ws-card-head">
              <span className={`ws-step ${found ? "done" : ""}`}>1</span>
              <h2 id="c1">Your app</h2>
              <span className="sp" />
              <span className="ws-sub">Public repo and live URL</span>
            </div>
            <div className="ws-card-body">
              <div className="ws-fields">
                <label className="ws-field">
                  <span>GitHub repository</span>
                  <span className="ws-input">
                    <Github size={16} aria-hidden="true" />
                    <input value={repository} onChange={(e) => (setRepository(e.target.value), changed())} placeholder="https://github.com/you/your-app" inputMode="url" autoComplete="off" />
                  </span>
                </label>
                <label className="ws-field">
                  <span>Live app URL</span>
                  <span className="ws-input">
                    <Globe size={16} aria-hidden="true" />
                    <input value={url} onChange={(e) => (setUrl(e.target.value), changed())} placeholder="https://your-app.vercel.app" inputMode="url" autoComplete="off" />
                  </span>
                </label>
              </div>
              <label className="ws-field">
                <span>README or notes (optional)</span>
                <textarea value={notes} onChange={(e) => (setNotes(e.target.value), changed())} placeholder={"Paste your README, or list what the app does, one per line:\n- Users can sign up with email\n- The dashboard shows their tasks"} rows={7} />
                <span className="ws-hint">Leave it empty to read the README from the repository. Each bullet point becomes one claim.</span>
              </label>
            </div>
            {!found ? (
              <div className="ws-card-foot">
                <button type="button" className="ws-btn primary" onClick={findClaims} disabled={busy !== null || !repository.trim() || !url.trim()}>
                  {busy === "claims" ? <span className="ws-spin" aria-hidden="true" /> : null}
                  Find claims
                </button>
                <span className="ws-note">Free: nothing runs until you click Run.</span>
              </div>
            ) : null}
          </section>

          {found ? (
            <section className="ws-card" aria-labelledby="c2">
              <div className="ws-card-head">
                <span className={`ws-step ${chosen.length ? "done" : ""}`}>2</span>
                <h2 id="c2">What Kane will test</h2>
                <span className="sp" />
                <span className="ws-badge">
                  {chosen.length} of {max} selected
                </span>
              </div>
              <div className="ws-card-body">
                <p className="ws-note" style={{ margin: 0 }}>
                  {claims.length === 0
                    ? `No claims found${found.source === "none" ? " (the repository's README could not be read)" : ""}. Add what the app should do below.`
                    : `Found ${found.claims.length} claim${found.claims.length === 1 ? "" : "s"} in ${found.source === "readme" ? "the repository's README" : "your notes"}. One run can test up to ${max}. Switch claims on or off, or edit them.`}
                </p>
                {claims.length ? (
                  <div className="ws-claims">
                    {claims.map((c, i) => (
                      <div key={i} className={`ws-claim ${c.on ? "" : "off"}`}>
                        <label className="ws-switch">
                          <input type="checkbox" checked={c.on} onChange={() => toggle(i)} aria-label={`Test claim ${i + 1}`} />
                          <span className="track" aria-hidden="true" />
                        </label>
                        <span className="n">{String(i + 1).padStart(2, "0")}</span>
                        <input aria-label={`Claim ${i + 1}`} value={c.text} onChange={(e) => setClaims((cs) => cs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="ws-add">
                  <input aria-label="Add a claim" value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addClaim()} placeholder="Add a claim, e.g. Users can reset their password" />
                  <button type="button" className="ws-btn ghost" onClick={addClaim} disabled={!extra.trim()}>
                    <Plus size={15} aria-hidden="true" />
                    Add
                  </button>
                </div>
              </div>
            </section>
          ) : null}
          <Alert error={error} />
        </div>

        <aside className="ws-aside" aria-label="Run summary">
          <section className="ws-card">
            <div className="ws-card-head">
              <span className="ws-step">3</span>
              <h2>Run summary</h2>
            </div>
            <div className="ws-card-body">
              {found ? (
                <>
                  <div className="ws-cost">
                    <strong>{cost ?? "–"}</strong>
                    <span>credits, estimated</span>
                  </div>
                  <div className="ws-sum">
                    <div className="ws-sum-row">
                      <span>Live app</span>
                      <b>{url.replace(/^https?:\/\//, "")}</b>
                    </div>
                    <div className="ws-sum-row">
                      <span>Claims to test</span>
                      <b>{chosen.length}</b>
                    </div>
                    <div className="ws-sum-row">
                      <span>Runs on</span>
                      <b className="ws-tags">
                        <span className="ws-tag">Kane CLI</span>
                        <span className="ws-tag">Real browser</span>
                      </b>
                    </div>
                  </div>
                  {budget ? (
                    <div className="ws-bar-meter">
                      <div className="row">
                        <span>Server Kane budget</span>
                        <span>
                          {budget.left} left of {budget.cap}
                        </span>
                      </div>
                      <div className="track">
                        <div className="fill" style={{ width: `${Math.max(2, Math.round((budget.left / budget.cap) * 100))}%` }} />
                      </div>
                    </div>
                  ) : null}
                  {limitNote || capNote ? (
                    <div className="ws-alert">{capNote ?? limitNote}</div>
                  ) : guestRuns ? (
                    <ul className="ws-perks">
                      <li>No account needed</li>
                      <li>
                        {guestRuns.leftForYou} free run{guestRuns.leftForYou === 1 ? "" : "s"} left
                      </li>
                      <li>Results stay private</li>
                    </ul>
                  ) : null}
                  <button type="button" className="ws-btn run" onClick={run} disabled={busy !== null || !chosen.length || cost == null || noRunsLeft}>
                    {busy === "run" ? <span className="ws-spin" aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                    Run with Kane
                    {cost != null ? <span className="ws-btn-pill">{cost} credits</span> : null}
                  </button>
                  <p className="ws-note" style={{ margin: 0 }}>
                    Clicking Run approves exactly these claims as the tests and confirms the cost.
                  </p>
                </>
              ) : (
                <div className="ws-empty" style={{ padding: "8px 0" }}>
                  <SummaryArt />
                  <span>Add your repository and live URL, then click Find claims to see what Kane will test and what it costs.</span>
                </div>
              )}
            </div>
          </section>
        </aside>
      </div>
    </>
  );
}

function SummaryArt() {
  return (
    <svg width="148" height="84" viewBox="0 0 148 84" aria-hidden="true">
      <rect x="10" y="6" width="128" height="72" rx="12" fill="#f5f7fc" stroke="#e4e9f4" />
      <rect x="22" y="20" width="60" height="8" rx="4" fill="#dbe3f3" />
      <rect x="22" y="36" width="88" height="6" rx="3" fill="#e4e9f4" />
      <rect x="22" y="48" width="70" height="6" rx="3" fill="#e4e9f4" />
      <rect x="92" y="58" width="36" height="12" rx="6" fill="#d9f24a" />
    </svg>
  );
}

export function CheckPage({ session }: { session: Session }) {
  const { navigate } = useRouter();
  return (
    <>
      <PageHero variant="scan" title={<h1>New check</h1>}>
        <p>Tell Greenlight where your app lives. Kane opens it in a real browser and tests every claim, one by one.</p>
      </PageHero>
      <div className="ws-main ws-lift">
        <CheckForm session={session} onStarted={(id) => navigate(`/app/check/${id}`)} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- result

const VERDICT: Record<string, { title: string; text: string; cls: string }> = {
  passed: { title: "Passed", text: "Kane confirmed every claim on your live app.", cls: "pass" },
  failed: { title: "Failed", text: "Kane found claims that are not true on your live app. What it saw and a suggested fix are below each one.", cls: "fail" },
  couldnt_verify: { title: "Could not verify", text: "Kane could not finish the test, so these claims are neither confirmed nor disproved.", cls: "unknown" },
};

export function CheckResultPage({ id }: { id: string }) {
  const [detail, setDetail] = useState<ProjectDetail | null>(null);
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState<Err>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const d = await api.project(id);
        if (stop) return;
        setDetail(d);
        const job = latest(d.jobs);
        if (job?.recordId) setRun(await api.run(id, job.recordId));
        else setRun(null);
        // Keep watching: a coding agent may start a re-check after pushing a fix.
        timer = setTimeout(tick, job && (job.status === "queued" || job.status === "running") ? 4000 : 15000);
      } catch (e) {
        if (!stop) setError(asErr(e));
      }
    };
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, [id]);

  const job = detail ? latest(detail.jobs) : null;
  const running = job && (job.status === "queued" || job.status === "running");
  const status = run && !running ? (run.record.status === "passed" || run.record.status === "failed" ? run.record.status : "couldnt_verify") : null;

  const id_ = detail ? appIdentity(detail.details?.repository, detail.project.url, detail.project.name) : null;
  const tone = running ? "blue" : status === "passed" ? "pass" : status === "failed" ? "fail" : status ? "warn" : "blue";
  return (
    <>
      <PageHero
        variant="verdict"
        tone={tone}
        back={<Link href="/app/projects" className="ws-back"><ArrowLeft size={15} aria-hidden="true" />My checks</Link>}
        title={
          <div className="ws-ident">
            {id_ ? <AppBadge seed={`${id_.owner}/${id_.name}`} size={52} /> : null}
            <h1>{id_?.title ?? "Check"}</h1>
          </div>
        }
        aside={
          <>
            {running ? (
              <span className="ws-badge live on-dark">
                <span className="d" />
                Kane is testing
              </span>
            ) : status ? (
              <span className={`ws-badge on-dark ${VERDICT[status]!.cls === "unknown" ? "warn" : VERDICT[status]!.cls}`}>
                <span className="d" />
                {VERDICT[status]!.title}
              </span>
            ) : null}
            <Link href="/app" className="ws-btn glass">
              <Plus size={15} aria-hidden="true" />
              New check
            </Link>
          </>
        }
      >
        {detail && id_ ? (
          <div className="ws-tiles">
            {detail.details?.repository ? (
              <a className="ws-tile" href={detail.details.repository} target="_blank" rel="noopener">
                <span className="k">
                  <Github size={13} aria-hidden="true" />
                  Repository
                </span>
                <span className="v">{id_.name}</span>
                {id_.owner ? <span className="s">{id_.owner}</span> : null}
              </a>
            ) : null}
            <a className="ws-tile" href={detail.project.url} target="_blank" rel="noopener">
              <span className="k">
                <Globe size={13} aria-hidden="true" />
                Live app
              </span>
              <span className="v">{id_.host}</span>
              <span className="s">
                Open site <ArrowUpRight size={11} aria-hidden="true" />
              </span>
            </a>
            {job?.commit ? (
              <span className="ws-tile">
                <span className="k">
                  <GitCommitHorizontal size={13} aria-hidden="true" />
                  Commit tested
                </span>
                <span className="v mono">{job.commit.slice(0, 7)}</span>
                <span className="s">{job.commitSource === "live_site" ? "From the live site" : "Branch head"}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </PageHero>
      <div className="ws-main ws-lift">
      <Alert error={error} />
      {!detail && !error ? <section className="ws-card" style={{ height: 180 }} aria-busy="true" /> : null}
      {detail && !job ? <section className="ws-card ws-empty">No Kane run was started for this app.</section> : null}

      {detail && job ? (
        <div className="ws-grid">
          <div className="ws-col">
            {running || (job && !job.recordId) ? <Progress job={job} /> : null}
            {run && !running ? <Verdict run={run} /> : null}
          </div>
          <aside className="ws-aside">
            {run ? <ConnectClaudeCode projectId={id} name={detail.project.name} repository={detail.details?.repository ?? null} /> : null}
            <RunDetails job={job} run={run} />
          </aside>
        </div>
      ) : null}
      </div>
    </>
  );
}

function latest(jobs: Job[]): Job | null {
  return [...jobs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
}

function Progress({ job }: { job: Job }) {
  if (job.status === "failed") {
    return (
      <section className="ws-card" role="alert">
        <div className="ws-card-head">
          <h2>The run did not happen</h2>
        </div>
        <div className="ws-card-body">
          <p style={{ margin: 0 }}>{job.error?.message ?? "Kane could not run the test."}</p>
          <p className="ws-note" style={{ margin: 0 }}>
            Nothing was tested, so there is no verdict. Runs that fail before Kane starts don't count against your limit.
          </p>
        </div>
      </section>
    );
  }
  const started = job.status === "running";
  return (
    <section className="ws-card" aria-live="polite">
      <div className="ws-card-head">
        <h2>{started ? "Kane is testing your app" : "Waiting for Kane to start"}</h2>
        <span className="sp" />
        <span className="ws-badge live">
          <span className="d" />
          Live
        </span>
      </div>
      <div className="ws-progress">
        <div className="bar" aria-hidden="true" />
        <ol className="ws-timeline">
          <li className="done">
            <span className="c" />
            Claims approved and run queued
          </li>
          <li className={started ? "done" : "now"}>
            <span className="c" />
            Starting Kane CLI and a real browser
          </li>
          <li className={started ? "now" : ""}>
            <span className="c" />
            Testing each claim on your live app
          </li>
          <li>
            <span className="c" />
            Verdict
          </li>
        </ol>
        <p className="ws-note" style={{ margin: 0 }}>
          This usually takes one to three minutes. You can leave this page open; it updates by itself.
        </p>
      </div>
    </section>
  );
}

function Ring({ passed, total }: { passed: number; total: number }) {
  const r = 46;
  const c = 2 * Math.PI * r;
  const f = total ? passed / total : 0;
  return (
    <div className="ws-ring" role="img" aria-label={`${passed} of ${total} claims passed`}>
      <svg viewBox="0 0 112 112">
        <circle cx="56" cy="56" r={r} fill="none" stroke="#eef2fa" strokeWidth="10" />
        <circle cx="56" cy="56" r={r} fill="none" stroke={f === 1 ? "#16a34a" : "#2563eb"} strokeWidth="10" strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} />
      </svg>
      <span className="num">
        <span>
          <b>
            {passed}/{total}
          </b>
          passed
        </span>
      </span>
    </div>
  );
}

function Verdict({ run }: { run: RunDetail }) {
  const status = run.record.status === "passed" || run.record.status === "failed" ? run.record.status : "couldnt_verify";
  const v = VERDICT[status]!;
  const tests = run.tests ?? [];
  const passed = run.claims.filter((c) => c.status === "passed").length;
  return (
    <>
      <section className={`ws-card ws-verdict ${v.cls}`} aria-labelledby="verdict">
        <div>
          <span className="lbl">
            Verdict
            <span className="ws-tag">Kane CLI</span>
          </span>
          <h2 id="verdict">{v.title}</h2>
          <p>{v.text}</p>
          <div className="ws-meta">
            {run.record.endedAt ? <span className="ws-badge">{new Date(run.record.endedAt).toLocaleString()}</span> : null}
            {run.credits?.actualSpend != null ? <span className="ws-badge">{Math.round(run.credits.actualSpend)} credits used</span> : null}
            {run.record.deployment?.commit ? <span className="ws-badge ws-mono">{run.record.deployment.commit.slice(0, 7)}</span> : null}
          </div>
        </div>
        <Ring passed={passed} total={run.claims.length} />
      </section>
      <section className="ws-card" aria-labelledby="claims-h">
        <div className="ws-card-head">
          <h2 id="claims-h">Claims</h2>
          <span className="sp" />
          <span className="ws-sub">
            {passed} of {run.claims.length} passed
          </span>
        </div>
        <table className="ws-table">
          <thead>
            <tr>
              <th>Claim</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {run.claims.map((c) => {
              const t = tests.find((x) => x.claims.includes(c.id));
              const cls = c.status === "passed" ? "pass" : c.status === "failed" ? "fail" : "unknown";
              const word = c.status === "passed" ? "Passed" : c.status === "failed" ? "Failed" : "Could not verify";
              const note = t?.failureMessage ?? (t?.reasons?.length ? t.reasons.join(", ").replace(/_/g, " ") : null);
              return (
                <tr key={c.id}>
                  <td>
                    <div className="ws-claimcell">
                      <span className={`ws-mark ${cls}`} aria-hidden="true">
                        {cls === "pass" ? "✓" : cls === "fail" ? "✕" : "–"}
                      </span>
                      <div style={{ minWidth: 0 }}>
                        <div>{c.text}</div>
                        {cls !== "pass" ? (
                          <div className="ws-saw">
                            <span>
                              <b>What Kane saw: </b>
                              {note ?? "Kane did not leave a note."}
                            </span>
                            <span>
                              <b>Suggested fix: </b>
                              {cls === "fail"
                                ? "Repeat what a visitor would do for this claim on the live app, fix what Kane describes, deploy, then check again. Or let Claude Code do it."
                                : "Make sure the app loads publicly (no login wall, no errors) and that this can be done from the start page, then check again."}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td className="st">
                    <span className={`ws-badge ${cls === "unknown" ? "warn" : cls}`}>{word}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>
    </>
  );
}

function RunDetails({ job, run }: { job: Job; run: RunDetail | null }) {
  return (
    <section className="ws-card">
      <div className="ws-card-head">
        <h2>Run details</h2>
      </div>
      <div className="ws-card-body" style={{ paddingTop: 8, paddingBottom: 8 }}>
        <div className="ws-sum">
          <div className="ws-sum-row">
            <span>Status</span>
            <b>{({ queued: "Waiting for Kane", running: "Kane is testing", succeeded: "Finished", failed: "Did not run" } as Record<string, string>)[job.status] ?? job.status}</b>
          </div>
          <div className="ws-sum-row">
            <span>Started</span>
            <b>{new Date(job.createdAt).toLocaleString()}</b>
          </div>
          {job.commit ? (
            <div className="ws-sum-row">
              <span>Commit tested</span>
              <b className="ws-mono">{job.commit.slice(0, 7)}</b>
            </div>
          ) : null}
          {run?.execution?.kane?.version ? (
            <div className="ws-sum-row">
              <span>Kane CLI</span>
              <b>{run.execution.kane.version}</b>
            </div>
          ) : null}
          {run?.credits?.estimate != null ? (
            <div className="ws-sum-row">
              <span>Credits estimated</span>
              <b>{Math.round(run.credits.estimate)}</b>
            </div>
          ) : null}
          {run?.credits?.actualSpend != null ? (
            <div className="ws-sum-row">
              <span>Credits used</span>
              <b>{Math.round(run.credits.actualSpend)}</b>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/**
 * Close the loop: a token that can read this check and re-run its approved claims, inside one
 * message to paste into Claude Code (it fetches the /greenlight instructions and runs the loop).
 */
function ConnectClaudeCode({ projectId, name, repository }: { projectId: string; name: string; repository: string | null }) {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Err>(null);
  const origin = window.location.origin;
  const connect = async () => {
    setBusy(true);
    setError(null);
    try {
      const t = await api.createToken("agent", `Claude Code · ${name}`.slice(0, 80));
      setToken(t.token);
    } catch (e) {
      setError(asErr(e));
    } finally {
      setBusy(false);
    }
  };
  const repo = repository?.replace(/\.git$/, "").replace(/\/+$/, "") ?? null;
  const message = token
    ? [
        "Use Greenlight to fix my app until Kane CLI passes every claim.",
        `First run: curl -fsSL ${origin}/app/downloads/greenlight/commands/greenlight.md`,
        "Then follow those instructions exactly, with:",
        `- GREENLIGHT_URL: ${origin}`,
        `- GREENLIGHT_CHECK: ${projectId}`,
        `- GREENLIGHT_TOKEN: ${token}`,
        ...(repo ? [`- Repository: ${repo} (clone it if this folder isn't it)`] : []),
      ].join("\n")
    : "";
  return (
    <section className="ws-card" aria-labelledby="cc-h">
      <div className="ws-card-head">
        <h2 id="cc-h">Fix it with Claude Code</h2>
      </div>
      <div className="ws-card-body">
        <p className="ws-note" style={{ margin: 0, color: "var(--ws-text)" }}>
          Paste one message into Claude Code. It gets your code, reads Kane's verdict, fixes what failed, pushes and asks Kane to check again until every claim passes. This page updates as it goes.
        </p>
        {token ? (
          <>
            <div className="ws-copyrow">
              <span>Paste this into Claude Code</span>
              <CopyButton text={message} />
            </div>
            <pre className="ws-code">{message}</pre>
            <p className="ws-note" style={{ margin: 0 }}>
              The token is shown only once. It can only read this check and re-run the claims you approved. Don't share it publicly.
            </p>
          </>
        ) : (
          <button type="button" className="ws-btn primary" onClick={connect} disabled={busy}>
            {busy ? <span className="ws-spin" aria-hidden="true" /> : null}
            Connect Claude Code
          </button>
        )}
        <Alert error={error} />
        <InstallGuide />
      </div>
    </section>
  );
}

/** First-time setup for people who don't have Claude Code (or Git) yet. */
function InstallGuide() {
  const win = [
    "irm https://claude.ai/install.ps1 | iex",
    '$bin = "$env:USERPROFILE\\.local\\bin"',
    '[Environment]::SetEnvironmentVariable("Path", [Environment]::GetEnvironmentVariable("Path","User") + ";$bin", "User")',
    '$env:Path += ";$bin"',
    "claude",
  ].join("\n");
  const mac = ["curl -fsSL https://claude.ai/install.sh | bash", "claude"].join("\n");
  return (
    <details className="ws-details">
      <summary>First time? Install Claude Code</summary>
      <div className="in">
        <span>You need Git and Claude Code with a Claude account. It takes about five minutes, once.</span>
        <b>Windows</b>
        <ol>
          <li>
            Install Git for Windows: <a href="https://git-scm.com/download/win">git-scm.com/download/win</a>
          </li>
          <li>Open PowerShell and run:</li>
        </ol>
        <div className="ws-copyrow">
          <span>PowerShell</span>
          <CopyButton text={win} />
        </div>
        <pre className="ws-code">{win}</pre>
        <b>macOS or Linux</b>
        <div className="ws-copyrow">
          <span>Terminal</span>
          <CopyButton text={mac} />
        </div>
        <pre className="ws-code">{mac}</pre>
        <span>Sign in when Claude Code opens, then paste the message above. When it asks to run curl or git, choose "Yes, and don't ask again". Pushing the fix needs write access to the repository.</span>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- my checks

export function ChecksListPage() {
  const [items, setItems] = useState<ProjectSummary[] | null>(null);
  const [error, setError] = useState<Err>(null);
  useEffect(() => {
    api
      .projects()
      .then(setItems)
      .catch((e) => setError(asErr(e)));
  }, []);
  const badge = (p: ProjectSummary) => {
    if (p.activeJob) return <span className="ws-badge live">Testing</span>;
    const s = p.lastRecord?.status;
    if (!s) return <span className="ws-badge">Not run</span>;
    return s === "passed" ? <span className="ws-badge pass">Passed</span> : s === "failed" ? <span className="ws-badge fail">Failed</span> : <span className="ws-badge warn">Could not verify</span>;
  };
  return (
    <>
      <PageHero
        variant="waves"
        title={<h1>My checks</h1>}
        aside={
          <Link href="/app" className="ws-btn glass">
            <Plus size={15} aria-hidden="true" />
            New check
          </Link>
        }
      >
        <p>Every app you checked from this browser, with Kane’s latest verdict.</p>
      </PageHero>
      <div className="ws-main ws-lift">
      <Alert error={error} />
      <section className="ws-card">
        {items === null ? (
          <div className="ws-empty">Loading…</div>
        ) : items.length === 0 ? (
          <div className="ws-empty">
            <SummaryArt />
            <span>No checks yet.</span>
            <Link href="/app" className="ws-btn primary">
              Check your first app
            </Link>
          </div>
        ) : (
          <table className="ws-table">
            <thead>
              <tr>
                <th>App</th>
                <th className="ws-hide-sm">Live URL</th>
                <th>Verdict</th>
                <th className="ws-hide-sm">Checked</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="ws-list-row">
                  <td>
                    <AppRow p={p} />
                  </td>
                  <td className="ws-hide-sm ws-mono">{p.url.replace(/^https?:\/\//, "")}</td>
                  <td>{badge(p)}</td>
                  <td className="ws-hide-sm ws-mono">{new Date(p.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      </div>
    </>
  );
}

function AppRow({ p }: { p: ProjectSummary }) {
  const id = appIdentity(null, p.url, p.name);
  return (
    <Link href={`/app/check/${p.id}`} className="ws-approw">
      <AppBadge seed={`${id.owner}/${id.name}`} size={34} />
      <span>
        <b>{id.title}</b>
        <span className="ws-owner">
          <Github size={12} aria-hidden="true" />
          {id.owner ?? id.host}
        </span>
      </span>
    </Link>
  );
}
