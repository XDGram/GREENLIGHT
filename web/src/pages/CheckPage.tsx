import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError, checkApi, type ClaimsResult } from "../api";
import { FormError, ResultMark } from "../components/Bits";
import * as I from "../components/Icons";
import { Link, useRouter } from "../router";
import type { Job, ProjectDetail, RunDetail, Session } from "../types";

// The whole product on one page: paste the GitHub URL, the live URL and the README (or notes),
// see the claims Kane will test and what it costs, click Run, get a verdict per claim.

type Err = { message: string; problems?: string[] } | null;
const asErr = (e: unknown): Err => ({ message: (e as Error).message, problems: e instanceof ApiError ? e.problems : [] });

/**
 * The form. `beforeFirstCall` lets the signed-out landing page start a visitor session first;
 * `onStarted` receives the new project id once Kane's run is queued.
 */
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

  const runsNote = guestRuns
    ? noRunsLeft
      ? guestRuns.paused
        ? "Kane runs are paused by the administrator right now."
        : !guestRuns.enabled
          ? "Kane runs for visitors are not switched on on this server."
          : guestRuns.leftForYou < 1
            ? "You have used your free Kane run on this browser."
            : guestRuns.leftToday >= 1 && overBudget && guestRuns.creditsLeftToday >= (found?.costs[0] ?? Infinity)
              ? `Today's free budget has ${guestRuns.creditsLeftToday} credits left: test fewer claims.`
              : "Today's free Kane runs are used up. Try again tomorrow."
      : `No account needed · ${guestRuns.leftForYou} free run${guestRuns.leftForYou === 1 ? "" : "s"} left · results stay private`
    : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
      <section className="step-card" aria-labelledby="c1">
        <div className="step-card-head">
          <h2 id="c1">Your app</h2>
          <span className="num-tag">Step 1</span>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>GitHub repository</span>
            <input value={repository} onChange={(e) => (setRepository(e.target.value), changed())} placeholder="https://github.com/you/your-app" inputMode="url" autoComplete="off" />
          </label>
          <label className="field">
            <span>Live app URL</span>
            <input value={url} onChange={(e) => (setUrl(e.target.value), changed())} placeholder="https://your-app.vercel.app" inputMode="url" autoComplete="off" />
          </label>
        </div>
        <label className="field">
          <span>README or notes · optional</span>
          <textarea value={notes} onChange={(e) => (setNotes(e.target.value), changed())} placeholder={"Paste your README, or list what the app does, one per line:\n- Users can sign up with email\n- The dashboard shows their tasks"} rows={8} />
          <span className="hint">Leave empty to use the README from the repository. Each bullet point or line becomes one claim.</span>
        </label>
        {!found ? (
          <div>
            <button type="button" className="btn" onClick={findClaims} disabled={busy !== null || !repository.trim() || !url.trim()}>
              {busy === "claims" ? <span className="spinner" aria-hidden="true" /> : null}
              Check my app
            </button>
          </div>
        ) : null}
      </section>

      {found ? (
        <section className="step-card" aria-labelledby="c2">
          <div className="step-card-head">
            <h2 id="c2">What Kane will test</h2>
            <span className="num-tag">Step 2</span>
          </div>
          <p className="small" style={{ margin: 0 }}>
            {claims.length === 0
              ? `No claims were found${found.source === "none" ? " (the repository's README could not be read)" : ""}. Add what the app should do below.`
              : `Found ${found.claims.length} claim${found.claims.length === 1 ? "" : "s"} in ${found.source === "readme" ? "the repository's README" : "your notes"}. One run can test up to ${max}. Pick which ones, or edit them.`}
          </p>
          <ul className="list" style={{ gap: 8 }}>
            {claims.map((c, i) => (
              <li key={i} className="claim-row">
                <label className="uv-switch">
                  <input type="checkbox" checked={c.on} onChange={() => toggle(i)} aria-label={`Test claim ${i + 1}`} />
                  <span className="switch-track" aria-hidden="true">
                    <span className="switch-inner" />
                    <span className="switch-knob" />
                  </span>
                </label>
                <label className="field">
                  <span className="sr-only">Claim {i + 1}</span>
                  <input value={c.text} onChange={(e) => setClaims((cs) => cs.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
                </label>
              </li>
            ))}
          </ul>
          <div className="editor-row" style={{ alignItems: "flex-end" }}>
            <label className="field" style={{ flex: "1 1 240px" }}>
              <span>Add a claim</span>
              <input value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addClaim()} placeholder="Users can reset their password" />
            </label>
            <button type="button" className="btn ghost" onClick={addClaim} disabled={!extra.trim()}>
              + Add
            </button>
          </div>

          <div className="confirm-box">
            <p style={{ margin: 0 }}>
              {chosen.length ? (
                <>
                  Kane opens <b>{url}</b> in a real browser and tests {chosen.length} claim{chosen.length === 1 ? "" : "s"}. Estimated cost: <b>{cost} credits</b>.
                </>
              ) : (
                "Tick at least one claim to test."
              )}
            </p>
            {runsNote && !overCap ? <p className="small mono" style={{ margin: 0 }}>{runsNote}</p> : null}
            {budget ? (
              <p className="small mono" style={{ margin: 0 }}>
                {overCap
                  ? budget.left >= (found?.costs[0] ?? Infinity)
                    ? `Only ${budget.left} of the server's ${budget.cap} Kane credits are left: test fewer claims.`
                    : `The server's ${budget.cap}-credit Kane budget is used up. No more runs can start.`
                  : `Server budget · ${budget.left} of ${budget.cap} Kane credits left`}
              </p>
            ) : null}
            <div>
              <button type="button" className="btn green" onClick={run} disabled={busy !== null || !chosen.length || cost == null || noRunsLeft}>
                {busy === "run" ? <span className="spinner" aria-hidden="true" /> : <I.Play size={14} aria-hidden="true" />}
                {cost != null ? `Run · ${cost} credits` : "Run"}
              </button>
            </div>
            <p className="small" style={{ margin: 0 }}>
              Clicking Run approves exactly these claims as the tests and confirms the cost.
            </p>
          </div>
        </section>
      ) : null}
      <FormError error={error} />
    </div>
  );
}

export function CheckPage({ session }: { session: Session }) {
  const { navigate } = useRouter();
  return (
    <>
      <PageHead kicker="New check" title="Check an app" text="Paste a repository and its live URL. You see every claim and the exact cost before anything runs." />
      <div className="frost-wrap">
        <CheckForm session={session} onStarted={(id) => navigate(`/app/check/${id}`)} />
      </div>
    </>
  );
}

// ---------------------------------------------------------------- building blocks

function PageHead({ kicker, title, text, children }: { kicker: string; title: string; text?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <span className="page-kicker">{kicker}</span>
        <h1 className="page-title">{title}</h1>
        {text ? <p className="page-text">{text}</p> : null}
      </div>
      {children ? <div className="page-actions">{children}</div> : null}
    </header>
  );
}

/** A progress ring: `value` of `total`, or spinning when `busy`. */
function Ring({ value = 0, total = 1, busy = false, tone = "ink" }: { value?: number; total?: number; busy?: boolean; tone?: string }) {
  const pct = total ? Math.round((value / total) * 100) : 0;
  return <span className={`pring ${busy ? "busy" : ""} ${tone}`} style={{ ["--p" as string]: `${busy ? 28 : pct}%` }} aria-hidden="true" />;
}

/**
 * The card used across the app: a frosted outer card with a header strip, a white inner card
 * for the content, and an optional "Coming next" footer.
 */
function Panel({ top, next, children, className = "", label }: { top?: ReactNode; next?: ReactNode; children: ReactNode; className?: string; label?: string }) {
  return (
    <section className={`pcard ${className}`} aria-label={label}>
      {top ? <div className="pcard-top">{top}</div> : null}
      <div className="pcard-in">{children}</div>
      {next ? <div className="pcard-next">{next}</div> : null}
    </section>
  );
}

// ---------------------------------------------------------------- result

const VERDICT: Record<string, { title: string; text: string; tone: string }> = {
  passed: { title: "Passed", text: "Kane confirmed every claim on your live app.", tone: "pass" },
  failed: { title: "Failed", text: "Kane found claims that are not true on your live app. What it saw and a fix are below each one.", tone: "fail" },
  couldnt_verify: { title: "Could not verify", text: "Kane could not finish the test, so these claims are neither confirmed nor disproved.", tone: "wait" },
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
        // Keep watching: a coding agent (Claude Code) may start a re-check after pushing a fix.
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
  const title = detail?.project.name ?? "Result";
  const host = detail ? hostOf(detail.project.url) : "";

  return (
    <>
      <PageHead kicker="Check" title={title} text={detail ? <a href={detail.project.url}>{host}</a> : null}>
        <Link href="/app" className="btn ghost">
          <I.Plus size={15} aria-hidden="true" />
          New check
        </Link>
      </PageHead>
      <FormError error={error} />
      {!detail && !error ? <section className="pcard skeleton" style={{ height: 200 }} aria-busy="true" /> : null}
      {detail && !job ? (
        <Panel>
          <p style={{ margin: 0 }}>No Kane run was started for this app.</p>
        </Panel>
      ) : null}
      {detail && job ? (
        <div className="result-grid">
          <div className="result-main">
            {!job.recordId ? <Progress job={job} host={host} /> : null}
            {run ? <Verdict run={run} host={host} /> : null}
          </div>
          <aside className="result-side">
            {run ? <ConnectClaudeCode projectId={id} name={detail.project.name} repository={detail.details?.repository ?? null} failed={run.record.status !== "passed"} /> : null}
            <RunDetails job={job} run={run} />
          </aside>
        </div>
      ) : null}
    </>
  );
}

const hostOf = (u: string) => {
  try {
    return new URL(u).host;
  } catch {
    return u;
  }
};

function latest(jobs: Job[]): Job | null {
  return [...jobs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
}

function Progress({ job, host }: { job: Job; host: string }) {
  if (job.status === "failed") {
    return (
      <Panel top={<><Ring tone="fail" /> Run stopped</>} next={<><span>Coming next</span>Start a new check</>}>
        <span className="pcard-k">Nothing was tested</span>
        <h2 className="pcard-title">The run did not happen</h2>
        <p className="pcard-text">{job.error?.message ?? "Kane could not run the test."}</p>
        <p className="small" style={{ margin: 0 }}>
          There is no verdict. Runs that fail before Kane starts don't count against your limit.
        </p>
      </Panel>
    );
  }
  return (
    <Panel top={<><Ring busy /> {job.status === "queued" ? "Waiting for Kane" : "Kane is testing"} <span className="sp" /> {host}</>} next={<><span>Coming next</span>Your verdict, claim by claim</>}>
      <span className="pcard-k">In progress</span>
      <h2 className="pcard-title">{job.status === "queued" ? "Waiting for Kane to start" : "Kane is using your live app"}</h2>
      <p className="pcard-text">This usually takes a few minutes. You can leave this page open; the verdict appears here when it's done.</p>
      <div className="pcard-cta">
        <span className="pill-dark ghosted">
          <span className="dash-loader small" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          Testing in a real browser
        </span>
      </div>
    </Panel>
  );
}

function Verdict({ run, host }: { run: RunDetail; host: string }) {
  const status = run.record.status === "passed" || run.record.status === "failed" ? run.record.status : "couldnt_verify";
  const v = VERDICT[status]!;
  const tests = run.tests ?? [];
  const passed = run.claims.filter((c) => c.status === "passed").length;
  const total = run.claims.length;
  return (
    <>
      <Panel
        className={`verdict-card ${v.tone}`}
        label="Verdict"
        top={
          <>
            <Ring value={passed} total={total} tone={v.tone} /> Verdict · Kane CLI <span className="sp" />
            {passed}/{total} passed
          </>
        }
        next={
          <>
            <span>Coming next</span>
            {status === "passed" ? "Check another app" : "Fix it with Claude Code"}
          </>
        }
      >
        <span className="pcard-k">Tested on {host}</span>
        <h2 className={`verdict-title ${v.tone}`}>{v.title}</h2>
        <p className="pcard-text">{v.text}</p>
        <div className="pcard-chips">
          {run.record.endedAt ? <span className="chip">{new Date(run.record.endedAt).toLocaleString()}</span> : null}
          {run.credits?.actualSpend != null ? <span className="chip">{Math.round(run.credits.actualSpend)} credits used</span> : null}
          <span className={`chip ${v.tone}`}>
            {passed} of {total} claims passed
          </span>
        </div>
      </Panel>

      <Panel
        label="Claims"
        top={
          <>
            <Ring value={passed} total={total} /> Claims <span className="sp" />
            {total} tested
          </>
        }
      >
        <ul className="claim-cards">
          {run.claims.map((c, i) => {
            const t = tests.find((x) => x.claims.includes(c.id));
            const bad = c.status !== "passed";
            const word = c.status === "passed" ? "Passed" : c.status === "failed" ? "Failed" : "Could not verify";
            return (
              <li key={c.id} className={`claim-card ${c.status}`}>
                <div className="claim-row-top">
                  <ResultMark status={c.status} />
                  <span className="claim-n">{String(i + 1).padStart(2, "0")}</span>
                  <span className="claim-text">{c.text}</span>
                  <span className={`claim-status ${c.status}`}>{word}</span>
                </div>
                {bad ? <Fix status={c.status} claim={c.text ?? ""} note={t?.failureMessage ?? null} reasons={t?.reasons ?? []} /> : null}
              </li>
            );
          })}
        </ul>
      </Panel>
    </>
  );
}

function Fix({ status, claim, note, reasons }: { status: string; claim: string; note: string | null; reasons: string[] }) {
  const failed = status === "failed";
  return (
    <div className="fix-box">
      <div>
        <span className="fix-k">What Kane saw</span>
        {note ?? (reasons.length ? reasons.join(", ").replace(/_/g, " ") : "Kane did not leave a note.")}
      </div>
      <div>
        <span className="fix-k">Suggested fix</span>
        {failed
          ? `Open the live app and do what a visitor would to check “${claim}”. Fix what Kane describes above so it works on the deployed site, deploy, then check again. Or let Claude Code do it.`
          : "Make sure the live app loads publicly (no login wall, no errors) and that this claim can be done from the start page, then check again."}
      </div>
    </div>
  );
}

function RunDetails({ job, run }: { job: Job; run: RunDetail | null }) {
  const rows: [string, ReactNode][] = [
    ["Status", job.status === "queued" ? "Waiting" : job.status === "running" ? "Running" : job.status === "failed" ? "Stopped" : "Finished"],
    ["Started", job.createdAt ? new Date(job.createdAt).toLocaleString() : "—"],
  ];
  if (run?.execution?.kane?.version) rows.push(["Kane CLI", run.execution.kane.version]);
  if (run?.credits?.estimate != null) rows.push(["Credits estimated", String(Math.round(run.credits.estimate))]);
  if (run?.credits?.actualSpend != null) rows.push(["Credits used", String(Math.round(run.credits.actualSpend))]);
  return (
    <Panel label="Run details" top={<><Ring value={run ? 1 : 0} total={1} busy={!run && job.status !== "failed"} /> Run details</>}>
      <dl className="kv">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost sm"
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
      {done ? <I.Check size={14} aria-hidden="true" /> : <I.Copy size={14} aria-hidden="true" />}
      {done ? "Copied" : label}
    </button>
  );
}

/**
 * Close the loop: a token that can read this check and re-run its approved claims, inside one
 * message to paste into Claude Code (it fetches the /greenlight instructions and runs the loop).
 */
function ConnectClaudeCode({ projectId, name, repository, failed }: { projectId: string; name: string; repository: string | null; failed: boolean }) {
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
    <Panel className={failed ? "cc-card hot" : "cc-card"} label="Fix it with Claude Code" next={<><span>Coming next</span>Kane checks again</>}>
      <span className="pcard-k">Close the loop</span>
      <h2 className="pcard-title">Fix it with Claude Code</h2>
      <p className="pcard-text">Paste one message into Claude Code. It gets your code, reads Kane's verdict, fixes what failed, pushes and asks Kane to check again until every claim passes. This page updates as it goes.</p>
      {token ? (
        <>
          <div className="cc-copyrow">
            <span>Paste this into Claude Code</span>
            <CopyButton text={message} />
          </div>
          <pre className="cc-code">{message}</pre>
          <p className="small" style={{ margin: 0 }}>
            The token is shown only once. It can only read this check and re-run the claims you approved. Don't share it publicly.
          </p>
        </>
      ) : (
        <button type="button" className="pill-dark wide" onClick={connect} disabled={busy}>
          {busy ? <span className="spinner" aria-hidden="true" /> : null}
          Connect Claude Code <span className="pill-time">1 paste</span>
        </button>
      )}
      <FormError error={error} />
      <InstallGuide />
    </Panel>
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
    <details className="cc-details">
      <summary>First time? Install Claude Code</summary>
      <div className="cc-in">
        <span>You need Git and Claude Code with a Claude account. It takes about five minutes, once.</span>
        <b>Windows</b>
        <ol>
          <li>
            Install Git for Windows: <a href="https://git-scm.com/download/win">git-scm.com/download/win</a>
          </li>
          <li>Open PowerShell and run:</li>
        </ol>
        <div className="cc-copyrow">
          <span>PowerShell</span>
          <CopyButton text={win} />
        </div>
        <pre className="cc-code">{win}</pre>
        <b>macOS or Linux</b>
        <div className="cc-copyrow">
          <span>Terminal</span>
          <CopyButton text={mac} />
        </div>
        <pre className="cc-code">{mac}</pre>
        <span>Sign in when Claude Code opens, then paste the message above. When it asks to run curl or git, choose "Yes, and don't ask again". Pushing the fix needs write access to the repository.</span>
      </div>
    </details>
  );
}

// ---------------------------------------------------------------- history

export function ChecksListPage() {
  const [items, setItems] = useState<{ id: string; name: string; url: string; createdAt: string }[] | null>(null);
  const [error, setError] = useState<Err>(null);
  useEffect(() => {
    api
      .projects()
      .then((ps) => setItems(ps.map((p) => ({ id: p.id, name: p.name, url: p.url, createdAt: p.createdAt }))))
      .catch((e) => setError(asErr(e)));
  }, []);
  return (
    <>
      <PageHead kicker="History" title="My checks" text="Every app you have checked from this browser.">
        <Link href="/app" className="btn">
          <I.Plus size={15} aria-hidden="true" />
          New check
        </Link>
      </PageHead>
      <FormError error={error} />
      {items === null ? <section className="pcard skeleton" style={{ height: 180 }} aria-busy="true" /> : null}
      {items && items.length === 0 ? (
        <Panel next={<><span>Coming next</span>Your first verdict</>}>
          <span className="pcard-k">Nothing yet</span>
          <h2 className="pcard-title">No checks yet</h2>
          <p className="pcard-text">Paste a repository and its live URL, and Kane will test what its README promises.</p>
          <Link href="/app" className="pill-dark wide">
            Check an app <span className="pill-time">free</span>
          </Link>
        </Panel>
      ) : null}
      {items && items.length ? (
        <div className="checks-grid">
          {items.map((p, i) => (
            <Panel key={p.id} top={<><Ring value={1} total={1} /> Check {String(items.length - i).padStart(2, "0")} <span className="sp" /> {new Date(p.createdAt).toLocaleDateString()}</>} next={<><span>Live app</span>{hostOf(p.url)}</>}>
              <span className="pcard-k">{new Date(p.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
              <h2 className="pcard-title">{p.name}</h2>
              <Link href={`/app/check/${p.id}`} className="pill-dark">
                Open result <I.ArrowUpRight size={14} aria-hidden="true" />
              </Link>
            </Panel>
          ))}
        </div>
      ) : null}
    </>
  );
}
