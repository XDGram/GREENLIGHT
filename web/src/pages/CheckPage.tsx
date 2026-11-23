import { useEffect, useState } from "react";
import { api, ApiError, checkApi, type ClaimsResult } from "../api";
import { FormError, ResultMark } from "../components/Bits";
import { TrafficLight } from "../components/Chrome";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
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
      <h1 className="headline">
        Paste it. <em>Run it.</em>
      </h1>
      <CheckForm session={session} onStarted={(id) => navigate(`/app/check/${id}`)} />
    </>
  );
}

// ---------------------------------------------------------------- result

const VERDICT: Record<string, { title: string; text: string }> = {
  passed: { title: "Passed", text: "Kane confirmed every claim on your live app." },
  failed: { title: "Failed", text: "Kane found claims that are not true on your live app. Suggested fixes are below." },
  couldnt_verify: { title: "Could not verify", text: "Kane could not finish the test, so these claims are neither confirmed nor disproved." },
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
        if (job?.recordId) {
          setRun(await api.run(id, job.recordId));
          return;
        }
        if (job && (job.status === "queued" || job.status === "running")) timer = setTimeout(tick, 4000);
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

  return (
    <>
      <TopBar title={title} eyebrow={detail ? <a href={detail.project.url}>{detail.project.url}</a> : "Greenlight"}>
        <Link href="/app" className="btn ghost">
          <I.Plus size={15} aria-hidden="true" />
          New check
        </Link>
      </TopBar>
      <FormError error={error} />
      {!detail && !error ? <section className="card skeleton" style={{ height: 160 }} aria-busy="true" /> : null}
      {detail && !job ? <section className="card">No Kane run was started for this app.</section> : null}
      {job && !job.recordId ? <Progress job={job} /> : null}
      {run ? <Verdict run={run} /> : null}
    </>
  );
}

function latest(jobs: Job[]): Job | null {
  return [...jobs].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))[0] ?? null;
}

function Progress({ job }: { job: Job }) {
  if (job.status === "failed") {
    return (
      <section className="card" role="alert">
        <h2 className="card-title">The run did not happen</h2>
        <p style={{ margin: 0 }}>{job.error?.message ?? "Kane could not run the test."}</p>
        <p className="small" style={{ margin: 0 }}>
          Nothing was tested, so there is no verdict. Runs that fail before Kane starts don't count against your limit.
        </p>
      </section>
    );
  }
  return (
    <section className="card" aria-live="polite">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="dash-loader" aria-hidden="true">
          <i />
          <i />
          <i />
          <i />
        </span>
        <h2 className="card-title" style={{ margin: 0 }}>
          {job.status === "queued" ? "Waiting for Kane to start..." : "Kane is testing your app in a real browser..."}
        </h2>
      </div>
      <p className="small" style={{ margin: 0 }}>
        This usually takes a few minutes. You can leave this page open; the verdict appears here when it's done.
      </p>
    </section>
  );
}

function Verdict({ run }: { run: RunDetail }) {
  const status = run.record.status === "passed" || run.record.status === "failed" ? run.record.status : "couldnt_verify";
  const v = VERDICT[status]!;
  const tests = run.tests ?? [];
  const passed = run.claims.filter((c) => c.status === "passed").length;
  return (
    <>
      <section className={`verdict ${status === "passed" ? "pass" : status === "failed" ? "fail" : "unknown"}`} aria-labelledby="verdict">
        <div className="verdict-body">
          <span className="eyebrow" style={{ color: "inherit" }}>
            Verdict · tested by Kane
          </span>
          <h2 id="verdict" className="verdict-word">
            {v.title}
          </h2>
          <p style={{ margin: 0 }}>{v.text}</p>
          <p className="small mono" style={{ margin: 0 }}>
            {passed}/{run.claims.length} claims passed
            {run.credits?.actualSpend != null ? ` · ${Math.round(run.credits.actualSpend)} credits used` : ""}
            {run.record.endedAt ? ` · ${new Date(run.record.endedAt).toLocaleString()}` : ""}
          </p>
        </div>
        <TrafficLight lit={status === "passed" ? "green" : status === "failed" ? "red" : "amber"} label={`${v.title}: ${passed} of ${run.claims.length} claims passed`} />
      </section>
      <section className="step-card" aria-labelledby="claims-h">
        <div className="step-card-head">
          <h2 id="claims-h">Claims</h2>
          <span className="num-tag">Result</span>
        </div>
        <ul className="claim-list">
          {run.claims.map((c) => {
            const t = tests.find((x) => x.claims.includes(c.id));
            const bad = c.status !== "passed";
            const word = c.status === "passed" ? "Passed" : c.status === "failed" ? "Failed" : "Could not verify";
            return (
              <li key={c.id}>
                <ResultMark status={c.status} />
                <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
                  <div>{c.text}</div>
                  {bad ? <Fix status={c.status} claim={c.text ?? ""} note={t?.failureMessage ?? null} reasons={t?.reasons ?? []} /> : null}
                </div>
                <span className={`claim-status ${c.status}`}>{word}</span>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}

function Fix({ status, claim, note, reasons }: { status: string; claim: string; note: string | null; reasons: string[] }) {
  const failed = status === "failed";
  return (
    <div className="why" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div className="small">
        <b>What Kane saw:</b> {note ?? (reasons.length ? reasons.join(", ").replace(/_/g, " ") : "Kane did not leave a note.")}
      </div>
      <div className="small">
        <b>Suggested fix:</b>{" "}
        {failed
          ? `Open the live app and do what a visitor would to check “${claim}”. Fix what Kane describes above so it works on the deployed site, deploy, then check again.`
          : "Make sure the live app loads publicly (no login wall, no errors) and that this claim can be done from the start page, then check again."}
      </div>
    </div>
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
      <TopBar title="My checks" />
      <FormError error={error} />
      <section className="card">
        {items === null ? (
          <p className="small" style={{ margin: 0 }}>
            Loading...
          </p>
        ) : items.length === 0 ? (
          <p style={{ margin: 0 }}>
            No checks yet. <Link href="/app">Check an app</Link>.
          </p>
        ) : (
          <ul className="list" style={{ gap: 10 }}>
            {items.map((p) => (
              <li key={p.id}>
                <Link href={`/app/check/${p.id}`}>{p.name}</Link>
                <span className="small"> · {p.url} · {new Date(p.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
