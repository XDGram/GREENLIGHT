import { useState } from "react";
import { api, type SignInRequired } from "../api";
import { ErrorNotice, LoadingRows, Notice, ResultMark, Tag } from "../components/Bits";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
import { claimStatusLabel, credits, formatDateTime, formatDuration, shortHash } from "../format";
import { Link, useRouter } from "../router";
import { OUTCOME_LABEL, OUTCOME_MEANING, outcomeOf } from "../plain";
import type { RunDetail } from "../types";
import { useData } from "../useData";

const bytes = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const why = (r: string) =>
  ({
    status_failed: "at least one claim failed",
    status_couldnt_verify: "at least one claim couldn’t be verified",
    run_not_usable: "the browser run was incomplete",
    evidence_missing: "evidence was missing",
    guest_verification: "it was a visitor run (visitor runs are never certificates)",
    partial_rerun: "only some tests were re-run",
  })[r] ?? r.replace(/_/g, " ");

export function RunPage({ id, recordId, onSignIn }: { id: string; recordId: string; onSignIn: (e: SignInRequired) => void }) {
  const { value, reload } = useData(() => api.run(id, recordId), [id, recordId], { onSignIn, refreshMs: 600_000 });
  if (value.state === "loading") {
    return (
      <>
        <TopBar title="Run result" eyebrow={<Link href={`/app/projects/${id}`}>Project</Link>} />
        <LoadingRows />
      </>
    );
  }
  if (value.state === "error") {
    return (
      <>
        <TopBar title="Run result" eyebrow={<Link href={`/app/projects/${id}`}>Project</Link>} />
        <ErrorNotice error={value.error} onRetry={reload} />
      </>
    );
  }
  return <Run projectId={id} d={value.data} />;
}

function Run({ projectId, d }: { projectId: string; d: RunDetail }) {
  const r = d.record;
  const passed = r.claims.filter((c) => c.status === "passed").length;
  const started = r.startedAt ? new Date(r.startedAt).getTime() : null;
  const ended = r.endedAt ? new Date(r.endedAt).getTime() : null;
  const images = d.files.filter((f) => f.kind === "image");
  return (
    <>
      <TopBar
        title={r.status === "passed" ? "Everything worked" : r.status === "failed" ? "Some things don’t work" : "Could not verify everything"}
        eyebrow={
          <>
            <Link href={`/app/projects/${projectId}`}>Project</Link>
            <I.ChevronRight size={13} aria-hidden="true" />
            <Link href={`/app/projects/${projectId}/verify`}>Verification</Link>
            <I.ChevronRight size={13} aria-hidden="true" />
            <span>{formatDateTime(r.startedAt)}</span>
          </>
        }
      >
        <span className="outcome working">{passed} working</span>
        {r.claims.length - passed ? <span className="outcome not_working">{r.claims.length - passed} not working or unverified</span> : null}
        <Link className="btn ghost" href={`/app/projects/${projectId}/verify`}>
          <I.RefreshCw size={14} aria-hidden="true" /> Test again
        </Link>
      </TopBar>

      <Outcomes projectId={projectId} d={d} />

      <section className={r.certified ? "card-dark" : "card"} aria-labelledby="cert-h">
        <div className="card-head">
          <h2 id="cert-h" className="card-title lg">
            Public certificate
          </h2>
          {r.certified ? <Tag form="solid">Public record</Tag> : <Tag form="dashed">Private history</Tag>}
        </div>
        {r.certified ? (
          <p style={{ margin: 0, fontSize: 13.5 }}>
            Every approved claim passed in a fresh browser run of the approved tests on commit <span className="mono">{r.deployment?.commit.slice(0, 12)}</span>, with stored, hash-checked evidence. This record is permanent and public.
          </p>
        ) : (
          <p style={{ margin: 0, fontSize: 13.5 }}>Not certified because {r.notCertifiedBecause.length ? r.notCertifiedBecause.map(why).join(", ") : r.status.replace(/_/g, " ")}. The record is kept as private history; nothing is published.</p>
        )}
        {r.certified && r.publicUrl ? (
          <div className="tags">
            <a className="btn on-dark" href={r.publicUrl} target="_blank" rel="noopener noreferrer">
              Open the public record <I.ArrowUpRight size={14} aria-hidden="true" />
            </a>
          </div>
        ) : null}
      </section>

      <details className="tech">
        <summary>Technical details: commit, credits, integrity, per-claim and per-step results</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
      <div className="row">
        <section className="card" aria-labelledby="facts-h" style={{ flex: "1 1 340px" }}>
          <h2 id="facts-h" className="card-title lg">
            What was verified
          </h2>
          <dl className="kv-list">
            <dt>Live URL</dt>
            <dd>{r.deployment?.url ?? "—"}</dd>
            <dt>Commit</dt>
            <dd className="mono">{r.deployment?.commit ?? "—"}</dd>
            <dt>Commit source</dt>
            <dd>Reported by the live site’s /greenlight.json and checked by the server before the run</dd>
            <dt>Environment</dt>
            <dd>{r.deployment?.environment ?? "—"}</dd>
            <dt>Test version</dt>
            <dd>v{r.testVersion}</dd>
            <dt>Fingerprint</dt>
            <dd className="mono" title={r.approvedTestHash ?? undefined}>
              {shortHash(r.approvedTestHash)}
            </dd>
            <dt>Approved</dt>
            <dd>{d.approval ? formatDateTime(d.approval.approvedAt) : "—"}</dd>
            <dt>Duration</dt>
            <dd>{started && ended ? formatDuration(ended - started) : "—"}</dd>
            <dt>Credits</dt>
            <dd>
              {credits(d.credits?.actualSpend)} spent · {credits(d.credits?.estimate)} estimated
            </dd>
            <dt>Kane</dt>
            <dd>
              {d.execution?.kane?.version ?? "—"}
              {d.execution?.kane?.executionId ? <span className="mono"> · {d.execution.kane.executionId}</span> : null}
            </dd>
          </dl>
        </section>
        <Integrity projectId={projectId} d={d} />
      </div>

      <section className="card" aria-labelledby="claims-h">
        <h2 id="claims-h" className="card-title lg">
          Claims
        </h2>
        <ul className="list">
          {d.claims.map((c) => (
            <li key={c.id} className="list-row" style={{ alignItems: "flex-start" }}>
              <ResultMark status={c.status} />
              <div className="list-main">
                <b>{c.text ?? c.id}</b>
                <span>
                  {c.id} · {claimStatusLabel(c.status)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="card" aria-labelledby="tests-h">
        <div className="card-head">
          <h2 id="tests-h" className="card-title lg">
            Tests
          </h2>
          <span className="small">Re-read from the stored Kane output</span>
        </div>
        {!d.tests ? (
          <p className="small" style={{ margin: 0 }}>
            Per-test details aren’t available for this run (its Kane output could not be read back). The claim results above come from the stored record.
          </p>
        ) : (
          <div className="tests">
            {d.tests.map((t, i) => (
              <details key={t.file} className="test" open={t.status !== "passed" || i === 0}>
                <summary>
                  <I.ChevronRight className="chev" size={16} aria-hidden="true" />
                  <ResultMark status={t.status} />
                  <span className="test-title">{t.title ?? t.file}</span>
                  <span className="tags">
                    {t.claims.map((c) => (
                      <Tag key={c}>{c}</Tag>
                    ))}
                    <Tag form={t.status === "passed" ? "solid" : "outline"}>{t.status === "app_failure" ? "Failed" : claimStatusLabel(t.status)}</Tag>
                    {t.durationS != null ? <Tag form="dashed">{Math.round(t.durationS)} s</Tag> : null}
                  </span>
                </summary>
                {t.status !== "passed" ? (
                  <div style={{ padding: "0 18px 12px" }}>
                    <Notice>
                      {t.failedStep ? (
                        <>
                          <b>
                            Step {t.failedStep.index}, “{t.failedStep.name}”
                          </b>{" "}
                          {t.failedStep.kind === "expect_text" ? `expected the text “${t.failedStep.text}”.` : `tried: ${t.failedStep.text}`}{" "}
                        </>
                      ) : null}
                      {t.failureMessage ?? (t.reasons.length ? `Reason: ${t.reasons.map((x) => x.replace(/_/g, " ")).join(", ")}.` : "No failure message was reported.")}
                    </Notice>
                  </div>
                ) : null}
                <ol className="step-list">
                  {t.steps.map((s, n) => (
                    <li key={n} className={`step ${s.kind === "expect_text" ? "expect" : ""}`} style={t.failedStep?.index === n + 1 ? { outline: "1.5px solid var(--ink)", borderRadius: 14, padding: 6 } : undefined}>
                      <span className="step-n" aria-hidden="true">
                        {n + 1}
                      </span>
                      <div>
                        <div className="step-name">
                          {s.name}
                          {s.kind === "expect_text" ? " · expected text" : ""}
                          {t.failedStep?.index === n + 1 ? " · failed here" : ""}
                        </div>
                        <div className="step-text">{s.kind === "expect_text" ? `“${s.text}”` : s.text}</div>
                      </div>
                    </li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
        )}
      </section>

        </div>
      </details>

      <section className="card" aria-labelledby="ev-h">
        <div className="card-head">
          <h2 id="ev-h" className="card-title lg">
            Evidence
          </h2>
          <span className="small">Each download is re-checked against its recorded SHA-256</span>
        </div>
        {images.length ? (
          <div className="shots">
            {images.map((f) => (
              <a key={f.name} className="shot" href={api.fileUrl(projectId, r.id, f.name)} target="_blank" rel="noopener noreferrer">
                <img src={api.fileUrl(projectId, r.id, f.name)} alt={`Screenshot ${f.name}`} loading="lazy" />
                <span className="mono">{f.name}</span>
              </a>
            ))}
          </div>
        ) : (
          <p className="small" style={{ margin: 0 }}>
            No separate screenshot files were stored for this run. Kane’s screenshots and recordings are inside the evidence pack below.
          </p>
        )}
        {d.files.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>File</th>
                  <th className="num">Size</th>
                  <th>SHA-256</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.files.map((f) => (
                  <tr key={f.name}>
                    <td className="mono">{f.name}</td>
                    <td className="num">{bytes(f.bytes)}</td>
                    <td className="mono" title={f.sha256}>
                      {shortHash(f.sha256)}
                    </td>
                    <td>
                      <a href={api.fileUrl(projectId, r.id, f.name)} download>
                        <I.Download size={14} aria-hidden="true" /> Download
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small" style={{ margin: 0 }}>
            No evidence files are listed for this run.
          </p>
        )}
      </section>
    </>
  );
}

/** Each test in plain English: Working / Not working / Could not verify, and what to do next. */
function Outcomes({ projectId, d }: { projectId: string; d: RunDetail }) {
  const { navigate } = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const r = d.record;
  const commitNote = r.deployment?.commitSource === "branch_head_unconfirmed" ? `the latest code on the branch (${r.deployment.commit.slice(0, 7)}; your site didn't confirm which version it runs)` : r.deployment ? `code version ${r.deployment.commit.slice(0, 7)}` : "your live app";
  const openFix = async (file: string) => {
    setBusy(file);
    setErr(null);
    try {
      const f = await api.openFix(projectId, r.id, file);
      navigate(`/app/fixes/${f.id}`);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(null);
    }
  };
  if (!d.tests) {
    return (
      <section className="card">
        <p style={{ margin: 0 }}>Results by feature are below. Step-by-step details for this run could not be read back.</p>
      </section>
    );
  }
  return (
    <section className="card" aria-labelledby="out-h">
      <div className="card-head">
        <h2 id="out-h" className="card-title lg">
          What was tested
        </h2>
        <span className="small">
          {formatDateTime(r.startedAt)} · {commitNote}
        </span>
      </div>
      <ul className="list">
        {d.tests.map((t) => {
          const o = outcomeOf(t.status);
          const claims = t.claims.map((c) => d.claims.find((x) => x.id === c)?.text ?? c);
          return (
            <li key={t.file} className="list-row" style={{ alignItems: "flex-start" }}>
              <span className={`outcome ${o}`}>{OUTCOME_LABEL[o]}</span>
              <div className="list-main" style={{ gap: 4 }}>
                <b>{t.title ?? t.file}</b>
                <span>{claims.join(" ")}</span>
                {o === "working" ? null : (
                  <span style={{ color: "var(--ink)" }}>
                    {t.failedStep ? `The browser got stuck at step ${t.failedStep.index}: ${t.failedStep.kind === "expect_text" ? `it expected to see “${t.failedStep.text}”` : t.failedStep.text}. ` : ""}
                    {t.failureMessage ?? OUTCOME_MEANING[o]}
                  </span>
                )}
              </div>
              {o === "working" ? null : (
                <button type="button" className="btn sm" onClick={() => openFix(t.file)} disabled={busy !== null}>
                  {busy === t.file ? <span className="spinner" aria-hidden="true" /> : <I.Wrench size={14} aria-hidden="true" />} Open in Fix Centre
                </button>
              )}
            </li>
          );
        })}
      </ul>
      {err ? (
        <p className="small" role="alert" style={{ margin: 0 }}>
          {err}
        </p>
      ) : null}
    </section>
  );
}

function Integrity({ projectId, d }: { projectId: string; d: RunDetail }) {
  const [state, setState] = useState<{ busy: boolean; result: { ok: boolean; problems: string[]; files: number; record: boolean; checkedAt: string } | null; error: string | null }>({ busy: false, result: null, error: null });
  const run = async () => {
    setState({ busy: true, result: null, error: null });
    try {
      setState({ busy: false, result: await api.integrity(projectId, d.record.id), error: null });
    } catch (e) {
      setState({ busy: false, result: null, error: (e as Error).message });
    }
  };
  const res = state.result;
  return (
    <section className="card" aria-labelledby="int-h" style={{ flex: "1 1 300px" }}>
      <div className="card-head">
        <h2 id="int-h" className="card-title lg">
          Integrity
        </h2>
        <I.Lock size={16} aria-hidden="true" />
      </div>
      <dl className="kv-list">
        <dt>Record hash</dt>
        <dd className="mono" title={d.record.recordSha256 ?? undefined}>
          {shortHash(d.record.recordSha256)} {d.record.integrity ? "· intact" : "· MISMATCH"}
        </dd>
        <dt>Evidence pack</dt>
        <dd className="mono" title={d.evidence?.packSha256 ?? undefined}>
          {shortHash(d.evidence?.packSha256)} · {d.evidence?.status ?? "—"}
        </dd>
        <dt>Pack validation</dt>
        <dd>{d.evidence?.validation ?? "—"}</dd>
      </dl>
      <button type="button" className="btn ghost sm" onClick={run} disabled={state.busy} style={{ alignSelf: "flex-start" }}>
        {state.busy ? <span className="spinner" aria-hidden="true" /> : <I.RefreshCw size={14} aria-hidden="true" />} Re-check all evidence now
      </button>
      {res ? (
        <p className="small" style={{ margin: 0 }} aria-live="polite">
          {res.ok && res.record ? `All ${res.files} files downloaded again and match their hashes.` : `Problems: ${[...res.problems, ...(res.record ? [] : ["record hash"])].join(", ")}.`} Checked {formatDateTime(res.checkedAt)}.
        </p>
      ) : null}
      {state.error ? <p className="small" role="alert" style={{ margin: 0 }}>{state.error}</p> : null}
    </section>
  );
}
