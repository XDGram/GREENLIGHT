import { useState } from "react";
import { ApiError, guestApi } from "../../api";
import { Empty, ErrorNotice, LoadingRows, Pill, Tag } from "../../components/Bits";
import { ChromeOrb } from "../../components/Chrome";
import * as I from "../../components/Icons";
import { TopBar } from "../../components/Shell";
import { claimStatusLabel, credits, formatDateTime, formatDuration, host, relative, shortHash } from "../../format";
import { Link } from "../../router";
import type { GuestLimits, GuestProject, GuestRun } from "../../types";
import { useData } from "../../useData";

export function GuestProjectPage({ id, onLimits }: { id: string; onLimits: (l: GuestLimits) => void }) {
  // Refreshes every few seconds so a running demo shows its results as soon as they land.
  const { value, reload } = useData(
    async () => {
      const r = await guestApi.project(id);
      onLimits(r.limits);
      return r;
    },
    [id],
    { refreshMs: 5_000 },
  );

  if (value.state === "loading") {
    return (
      <>
        <TopBar title="Loading…" eyebrow={<Link href="/app/try">My apps</Link>} />
        <LoadingRows />
      </>
    );
  }
  if (value.state === "error") {
    return (
      <>
        <TopBar title="App" eyebrow={<Link href="/app/try">My apps</Link>} />
        <ErrorNotice error={value.error} onRetry={reload} />
      </>
    );
  }
  const { project: p, limits } = value.data;
  const runs = p.runs ?? [];
  const active = runs.find((r) => r.status === "queued" || r.status === "running");
  const last = runs[0];
  const results = new Map((last?.result?.claims ?? []).map((c) => [c.id, c.status]));
  const step = !p.approvedAt ? 1 : active ? 3 : last?.status === "succeeded" ? 4 : 2;

  return (
    <>
      <TopBar
        title={p.name}
        eyebrow={
          <>
            <Link href="/app/try">My apps</Link>
            <I.ChevronRight size={13} aria-hidden="true" />
            <span className="guest-badge">Guest demo</span>
            {value.refreshing ? <span className="refreshing" aria-label="Refreshing" /> : null}
          </>
        }
      >
        <Pill form={p.approvedAt ? "solid" : "outline"} icon={p.approvedAt ? <I.Check size={14} strokeWidth={2.4} /> : <I.Clock size={14} />} title={p.approvedAt ? "Tests approved" : "Needs your approval"} sub={p.approvedAt ? relative(p.approvedAt) : "Step 1"} />
        {p.estimate ? <Pill form="outline" icon={<I.Coins size={14} />} title={`${credits(p.estimate.credits)} credits`} sub={`Estimate · demo cap ${p.estimate.cap}`} /> : null}
      </TopBar>

      <div className="row">
        <PathCard step={step} last={last} />
        <section className="card-dark" aria-labelledby="site-h" style={{ flex: "1 1 260px" }}>
          <div className="card-head">
            <h2 id="site-h" className="card-title" style={{ fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
              <I.Globe size={16} aria-hidden="true" /> Live site
            </h2>
            <a href={p.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12 }}>
              Open <I.ArrowUpRight size={13} aria-hidden="true" />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
          <ChromeOrb />
          <div>
            <div className="mono" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
              {host(p.url)}
            </div>
            <div style={{ fontSize: 12, color: "var(--on-dark-muted)" }}>
              Added {formatDateTime(p.createdAt)} · tests {p.source === "ai" ? "written by Claude, reviewed by you" : "written by you"}
            </div>
          </div>
        </section>
      </div>

      {!p.approvedAt ? <ApproveCard p={p} onDone={reload} /> : <RunCard p={p} limits={limits} active={active} onStarted={reload} />}

      {last ? <ResultCard run={last} p={p} /> : null}

      <ClaimsAndTests p={p} results={results} />
    </>
  );
}

function PathCard({ step, last }: { step: number; last?: GuestRun }) {
  const steps = [
    { label: "Tests saved", note: "Claims and tests for your app" },
    { label: "Approved by you", note: "You confirm the exact tests" },
    { label: "Real Kane run", note: "A browser tests the live site" },
    { label: "Results", note: last?.status === "failed" ? "The run stopped" : "Claim by claim" },
  ];
  return (
    <section className="card" aria-labelledby="gpath-h" style={{ flex: "2 1 460px" }}>
      <div className="card-head">
        <h2 id="gpath-h" className="label">
          <I.LayoutGrid size={16} aria-hidden="true" /> How a demo run works
        </h2>
      </div>
      <div className="steps" style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }} role="img" aria-label={`Step ${step} of 4`}>
        {steps.map((_, i) => (
          <span key={i} className={i + 1 < step || step === 4 ? "done" : i + 1 === step ? "current" : ""} />
        ))}
      </div>
      <ol className="dots" style={{ gap: 14 }}>
        {steps.map((s, i) => (
          <li key={s.label}>
            <span className={`dot ${i + 1 < step || step === 4 ? "" : i + 1 === step ? "open" : "faint"}`} aria-hidden="true" />
            <span>
              <b style={{ fontWeight: 500 }}>{s.label}</b>
              <span className="muted"> · {s.note}</span>
            </span>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {i + 1 < step || step === 4 ? "Done" : i + 1 === step ? "Now" : "—"}
            </span>
          </li>
        ))}
      </ol>
      <p className="small" style={{ margin: 0 }}>
        Demo runs show how Greenlight checks an app. They are never certifications: those need the app owner’s signed approval and a check of the deployed commit.
      </p>
    </section>
  );
}

function ApproveCard({ p, onDone }: { p: GuestProject; onDone: () => void }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await guestApi.approve(p.id, typed.trim());
      onDone();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card" aria-labelledby="approve-h">
      <div className="card-head">
        <h2 id="approve-h" className="card-title lg">
          Approve your tests
        </h2>
        <span className="small">{p.tests.length} tests · {p.tests.reduce((n, t) => n + t.steps.length, 0)} steps</span>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>
        Greenlight only runs tests a person has approved, exactly as written. Read the tests below, then confirm by typing or pasting their fingerprint. Any later change would need a new approval.
      </p>
      <div className="hash-box" aria-label="Test fingerprint">
        {p.approvedTestHash}
      </div>
      <div className="editor-row">
        <label className="field" style={{ flex: "1 1 420px" }}>
          <span>Fingerprint (all 64 characters)</span>
          <input className="mono" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} placeholder="Paste or type the fingerprint shown above" />
        </label>
        <button type="button" className="btn" style={{ marginTop: 22 }} disabled={busy || typed.trim().length !== 64} onClick={approve}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <I.Approvals size={15} aria-hidden="true" />} Approve tests
        </button>
      </div>
      {error ? (
        <div className="notice" role="alert">
          <I.CircleAlert size={18} aria-hidden="true" />
          <p>{error}</p>
        </div>
      ) : null}
    </section>
  );
}

function RunCard({ p, limits, active, onStarted }: { p: GuestProject; limits: GuestLimits; active?: GuestRun; onStarted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const blocked = limits.runsLeft === 0 ? "You’ve used your real run for this browser." : limits.runsLeftToday === 0 ? "Today’s demo runs are used up for all guests. Explore the sample project, or come back tomorrow." : null;
  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      await guestApi.run(p.id);
      onStarted();
    } catch (e) {
      setError((e as ApiError).message);
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };
  if (active) {
    return (
      <section className="notice" aria-live="polite">
        <span className="spinner" aria-hidden="true" />
        <p>
          <b>{active.status === "queued" ? "Starting the browser…" : "Kane is testing your live site."}</b> A real browser is following your tests on {host(p.url)}. This usually takes a few minutes; the page updates by itself.
        </p>
      </section>
    );
  }
  return (
    <section className="card" aria-labelledby="run-h">
      <div className="card-head">
        <h2 id="run-h" className="card-title lg">
          Run it for real
        </h2>
        <span className="tags">
          <Tag form={limits.runsLeft ? "outline" : "dashed"}>{limits.runsLeft} run left for you</Tag>
          <Tag form={limits.runsLeftToday ? "outline" : "dashed"}>{limits.runsLeftToday} left today</Tag>
        </span>
      </div>
      <p className="muted" style={{ margin: 0, maxWidth: "72ch" }}>
        Kane opens your live site in a real browser, follows each test and checks every expected text. The run uses about {credits(p.estimate?.credits)} credits from Greenlight’s demo budget; nothing is charged to you.
      </p>
      {blocked ? (
        <div className="notice">
          <I.Clock size={18} aria-hidden="true" />
          <p>{blocked}</p>
          <Link href="/app/demo" className="btn ghost sm">
            See the sample project
          </Link>
        </div>
      ) : confirm ? (
        <div className="tags">
          <button type="button" className="btn" disabled={busy} onClick={start}>
            {busy ? <span className="spinner" aria-hidden="true" /> : <I.Play size={15} aria-hidden="true" />} Yes, start the run
          </button>
          <button type="button" className="btn ghost" disabled={busy} onClick={() => setConfirm(false)}>
            Not yet
          </button>
          <span className="small" style={{ alignSelf: "center" }}>
            This uses your one demo run.
          </span>
        </div>
      ) : (
        <div>
          <button type="button" className="btn" onClick={() => setConfirm(true)}>
            <I.Play size={15} aria-hidden="true" /> Start real run
          </button>
        </div>
      )}
      {error ? (
        <div className="notice" role="alert">
          <I.CircleAlert size={18} aria-hidden="true" />
          <p>{error}</p>
        </div>
      ) : null}
    </section>
  );
}

function ResultCard({ run, p }: { run: GuestRun; p: GuestProject }) {
  if (run.status === "queued" || run.status === "running") return null;
  if (run.status === "failed" || !run.result) {
    return (
      <section className="notice" role="status">
        <I.CircleAlert size={20} aria-hidden="true" />
        <p>
          <b>The run stopped before results.</b> {run.error?.message ?? "Something went wrong."} {run.refunded ? "Kane never started, so it doesn’t count against your run." : ""}
        </p>
      </section>
    );
  }
  const r = run.result;
  const passed = r.claims.filter((c) => c.status === "passed").length;
  return (
    <section className="card" aria-labelledby="res-h">
      <div className="card-head" style={{ gap: "14px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 id="res-h" className="card-title lg">
            Results
          </h2>
          <span className="count-chip">
            {passed}/{r.claims.length}
          </span>
        </div>
        <span className="small">
          Ran {formatDateTime(r.startedAt)} · {formatDuration(new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime())}
          {r.credits.actual != null ? ` · ${credits(r.credits.actual)} credits` : ""}
        </span>
      </div>
      <p className="muted" style={{ margin: 0 }}>
        {r.status === "passed"
          ? `Every claim held on the live site. In a real project, this run could now be certified by the app's owner.`
          : r.status === "failed"
            ? "Some claims did not hold on the live site. In a real project, Greenlight sends the failure report to the developer's coding agent to fix, then runs again."
            : "Some claims couldn't be checked. That usually means the page didn't load or an expected text was guessed."}
      </p>
      <div className="claims-dark">
        {r.claims.map((c) => (
          <article key={c.id} className="claim">
            <div className="claim-id">{c.id}</div>
            <h3>{c.text}</h3>
            <div className="claim-foot">
              <div className="caps">
                <span>Result</span>
                <b>{claimStatusLabel(c.status)}</b>
              </div>
              <div className="meter">
                <span style={{ width: c.status === "passed" ? "100%" : "35%" }} />
              </div>
            </div>
          </article>
        ))}
      </div>
      <ul className="list">
        {r.tests.map((t) => (
          <li key={t.file} className="list-row">
            <span className={`pill-icon ${t.status === "passed" ? "" : "outline"}`} aria-hidden="true">
              {t.status === "passed" ? <I.Check size={14} strokeWidth={2.4} /> : <I.X size={14} />}
            </span>
            <div className="list-main">
              <b>{t.title ?? t.file}</b>
              <span>
                {t.status === "passed" ? "Passed" : t.status === "app_failure" ? "The app did not do this" : "Could not be checked"}
                {t.durationS != null ? ` · ${Math.round(t.durationS)} s` : ""}
                {t.failureMessage ? ` · ${t.failureStepIndex != null ? `step ${t.failureStepIndex}: ` : ""}${t.failureMessage}` : ""}
              </span>
            </div>
            <span className="tags">
              {t.claims.map((c) => (
                <Tag key={c}>{c}</Tag>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="small" style={{ margin: 0 }}>
        Guest demo run · not a certification · fingerprint <span className="mono">{shortHash(p.approvedTestHash)}</span>
      </p>
    </section>
  );
}

function ClaimsAndTests({ p, results }: { p: GuestProject; results: Map<string, string> }) {
  if (!p.tests.length) {
    return (
      <section className="card">
        <Empty title="These tests no longer pass the demo’s rules" />
      </section>
    );
  }
  return (
    <section className="card" aria-labelledby="gtests-h">
      <div className="card-head">
        <h2 id="gtests-h" className="card-title lg">
          Claims and tests
        </h2>
        <span className="small">{p.claims.length} claims</span>
      </div>
      {p.notes ? (
        <p className="small" style={{ margin: 0 }}>
          <b style={{ color: "var(--ink)", fontWeight: 600 }}>Note from the AI:</b> {p.notes}
        </p>
      ) : null}
      <ul className="dots" style={{ gap: 10 }}>
        {p.claims.map((c) => (
          <li key={c.id}>
            <span className={`dot ${results.get(c.id) === "passed" ? "" : results.get(c.id) ? "open" : "faint"}`} aria-hidden="true" />
            <span>
              <span className="mono small">{c.id}</span> {c.text}
            </span>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {claimStatusLabel(results.get(c.id))}
            </span>
          </li>
        ))}
      </ul>
      <div className="tests">
        {p.tests.map((t, i) => (
          <details key={t.file} className="test" open={i === 0}>
            <summary>
              <I.ChevronRight className="chev" size={16} aria-hidden="true" />
              <span className="test-title">{t.title ?? t.file}</span>
              <span className="tags">
                {t.claims.map((c) => (
                  <Tag key={c}>{c}</Tag>
                ))}
              </span>
            </summary>
            <ol className="step-list">
              {t.steps.map((s, n) => (
                <li key={n} className={`step ${s.kind === "expect_text" ? "expect" : ""}`}>
                  <span className="step-n" aria-hidden="true">
                    {n + 1}
                  </span>
                  <div>
                    <div className="step-name">
                      {s.name}
                      {s.kind === "expect_text" ? " · expected text" : ""}
                    </div>
                    <div className="step-text">{s.kind === "expect_text" ? `“${s.text}”` : s.text}</div>
                  </div>
                </li>
              ))}
            </ol>
          </details>
        ))}
      </div>
    </section>
  );
}
