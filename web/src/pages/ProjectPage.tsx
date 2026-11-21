import { useState } from "react";
import { api } from "../api";
import { Empty, ErrorNotice, LoadingRows, Pill, Tag } from "../components/Bits";
import { ChromeOrb } from "../components/Chrome";
import * as I from "../components/Icons";
import { ApprovalsBell, TopBar } from "../components/Shell";
import { Timeline } from "../components/Timeline";
import { claimStatusLabel, credits, formatDateTime, host, shortHash } from "../format";
import { Link } from "../router";
import { certificationPath, claimResults, doneCount, type PathStep } from "../state";
import type { ProjectDetail, VersionView } from "../types";
import { useData } from "../useData";
import type { SignInRequired } from "../api";

export function ProjectPage({ id, pending, onSignIn, load, sample = false }: { id: string; pending: number; onSignIn: (e: SignInRequired) => void; load?: () => Promise<ProjectDetail>; sample?: boolean }) {
  const { value, reload } = useData(load ?? (() => api.project(id)), [id], { onSignIn });
  const [picked, setPicked] = useState<number | null>(null);

  if (value.state === "loading") {
    return (
      <>
        <TopBar title="Loading…" eyebrow={<Link href="/app/projects">Projects</Link>} />
        <LoadingRows />
      </>
    );
  }
  if (value.state === "error") {
    return (
      <>
        <TopBar title="Project" eyebrow={<Link href="/app/projects">Projects</Link>} />
        <ErrorNotice error={value.error} onRetry={reload} />
      </>
    );
  }

  const d = value.data;
  const v = d.versions.find((x) => x.version === picked) ?? d.versions[0];
  return (
    <>
      <TopBar
        title={d.project.name}
        eyebrow={
          sample ? (
            <>
              <span>Sample project · read-only</span>
              <I.ChevronRight size={13} aria-hidden="true" />
              <span>A real Greenlight project, approved by its owner</span>
            </>
          ) : (
            <>
              <Link href="/app/projects">Projects</Link>
              <I.ChevronRight size={13} aria-hidden="true" />
              <span className="mono">{d.project.id}</span>
              {value.refreshing ? <span className="refreshing" aria-label="Refreshing" /> : null}
            </>
          )
        }
      >
        {v ? <ApprovalPill v={v} /> : null}
        {v?.estimate ? <Pill form="outline" icon={<I.Coins size={14} />} title={`${credits(v.estimate.credits)} credits`} sub={`Estimate${v.estimate.cap != null ? ` · cap ${v.estimate.cap}` : ""}`} /> : null}
        {d.versions.length > 1 ? (
          <div className="seg" role="group" aria-label="Test version">
            {d.versions.map((x) => (
              <button key={x.version} type="button" aria-pressed={x.version === v?.version} onClick={() => setPicked(x.version)}>
                v{x.version}
              </button>
            ))}
          </div>
        ) : null}
        {sample ? (
          <Link href="/app/try/new" className="btn">
            Test your own app
          </Link>
        ) : (
          <>
            <ApprovalsBell pending={pending} />
            <Link href={`/app/projects/${d.project.id}/tests`} className="btn ghost">
              <I.Pencil size={14} aria-hidden="true" /> {v ? "Edit tests" : "Write tests"}
            </Link>
            {v ? (
              <Link href={`/app/projects/${d.project.id}/verify`} className="btn">
                <I.Play size={14} aria-hidden="true" /> Verify
              </Link>
            ) : null}
          </>
        )}
      </TopBar>

      {sample ? (
        <p className="small" style={{ margin: 0 }}>
          This is how a real project looks inside Greenlight: approved claims, the exact browser tests behind them, the credit estimate and every run. You can read everything here; nothing in the demo can change it.
        </p>
      ) : null}

      {!v ? (
        <section className="card">
          <Empty title="No claims or tests yet">
            <span>Draft the claims and browser tests for {d.project.name}, review them, and approve the exact version you want verified.</span>
            {!sample ? (
              <Link href={`/app/projects/${d.project.id}/tests`} className="btn">
                Write claims and tests
              </Link>
            ) : null}
          </Empty>
        </section>
      ) : (
        <VersionView detail={d} v={v} />
      )}

      {!sample && d.details ? <DetailsCard detail={d} onChanged={reload} /> : null}
      {!sample && d.records.length ? <RunsCard detail={d} /> : null}
    </>
  );
}

function DetailsCard({ detail, onChanged }: { detail: ProjectDetail; onChanged: () => void }) {
  const dd = detail.details!;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const recheck = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.repositoryCheck(detail.project.id);
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const rc = dd.repositoryCheck;
  return (
    <section className="card" aria-labelledby="details-h">
      <div className="card-head">
        <h2 id="details-h" className="card-title lg">
          Project details
        </h2>
        <button type="button" className="btn ghost sm" onClick={recheck} disabled={busy || !dd.repository}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <I.RefreshCw size={14} aria-hidden="true" />} Check repository
        </button>
      </div>
      <dl className="kv-list">
        <dt>Live URL</dt>
        <dd>
          <a href={detail.project.url} target="_blank" rel="noopener noreferrer">
            {detail.project.url}
          </a>
        </dd>
        <dt>Repository</dt>
        <dd>
          {dd.repository ? (
            <a href={dd.repository} target="_blank" rel="noopener noreferrer">
              {dd.repository.replace("https://github.com/", "")}
            </a>
          ) : (
            "—"
          )}{" "}
          · branch <span className="mono">{dd.branch ?? "main"}</span>
        </dd>
        <dt>Latest commit</dt>
        <dd>
          {rc?.status === "ok" && rc.head ? (
            <>
              <span className="mono">{rc.head.sha.slice(0, 12)}</span> · {rc.head.message} · checked {formatDateTime(rc.checkedAt)}
            </>
          ) : (
            rc?.message ?? "Not checked yet."
          )}
        </dd>
        {dd.description ? (
          <>
            <dt>Description</dt>
            <dd>{dd.description}</dd>
          </>
        ) : null}
        <dt>Should do</dt>
        <dd style={{ whiteSpace: "pre-wrap" }}>{dd.purpose ?? "—"}</dd>
        <dt>Test credentials</dt>
        <dd>{dd.hasCredentials ? `Stored encrypted${dd.credentialsUpdatedAt ? ` (${formatDateTime(dd.credentialsUpdatedAt)})` : ""}; never shown again` : "None"}</dd>
      </dl>
      {err ? (
        <p className="small" role="alert" style={{ margin: 0 }}>
          {err}
        </p>
      ) : null}
    </section>
  );
}

function RunsCard({ detail }: { detail: ProjectDetail }) {
  return (
    <section className="card" aria-labelledby="runs-h">
      <div className="card-head">
        <h2 id="runs-h" className="card-title lg">
          Verification history
        </h2>
        <span className="small">{detail.records.length} runs</span>
      </div>
      <ul className="list">
        {detail.records.map((r) => (
          <li key={r.id} className="list-row">
            <span className={`pill-icon ${r.certified ? "" : "outline"}`} aria-hidden="true">
              {r.certified ? <I.Check size={14} strokeWidth={2.4} /> : <I.X size={14} />}
            </span>
            <div className="list-main">
              <b>
                <Link href={`/app/projects/${detail.project.id}/runs/${r.id}`}>{formatDateTime(r.startedAt)}</Link> · version {r.testVersion}
              </b>
              <span>
                {r.claims.filter((c) => c.status === "passed").length} of {r.claims.length} claims passed
                {r.deployment ? ` · ${r.deployment.commit.slice(0, 7)}` : ""}
                {r.credits?.actual != null ? ` · ${credits(r.credits.actual)} credits` : ""}
              </span>
            </div>
            <Tag form={r.certified ? "solid" : "outline"}>{r.certified ? "Certified" : claimStatusLabel(r.status)}</Tag>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ApprovalPill({ v }: { v: VersionView }) {
  if (!v.approval) return <Pill form="outline" icon={<I.Clock size={14} />} title="Awaiting approval" sub={`Version ${v.version}`} href={v.approveUrl ?? undefined} />;
  return <Pill icon={<I.Check size={14} strokeWidth={2.4} />} title="Spec approved" sub={`Version ${v.version}`} />;
}

function VersionView({ detail, v }: { detail: ProjectDetail; v: VersionView }) {
  const steps = certificationPath(detail, v);
  const results = claimResults(detail, v);
  return (
    <>
      {!v.approval && v.approveUrl ? (
        <div className="notice">
          <I.Approvals size={20} aria-hidden="true" />
          <p>
            <b>Version {v.version} is waiting for your approval.</b> Review the claims and tests, then confirm the two hashes on the secure approval page.
          </p>
          <a className="btn" href={v.approveUrl}>
            Review and approve <I.ArrowUpRight size={15} aria-hidden="true" />
          </a>
        </div>
      ) : null}

      <div className="row">
        <Timeline steps={steps} approver={v.approval?.approvedBy ?? null} />
        <PathCard steps={steps} />
        <LiveSite detail={detail} />
      </div>

      <div className="row">
        <FilesCard v={v} />
        <ClaimsCard v={v} results={results} />
      </div>

      <TestsCard v={v} results={results} />
    </>
  );
}

function PathCard({ steps }: { steps: PathStep[] }) {
  const next = steps.find((s) => s.state === "current" || s.state === "blocked");
  return (
    <section className="card" aria-labelledby="path-h" style={{ flex: "1 1 250px", gap: 14 }}>
      <div className="card-head">
        <h2 id="path-h" className="card-title">
          Certification path
        </h2>
        <I.LayoutGrid size={16} aria-hidden="true" />
      </div>
      <div>
        <div className="small">Steps complete</div>
        <div className="big-number num">{doneCount(steps)} of 5</div>
        <div className="small">{next ? `${next.state === "blocked" ? "Blocked" : "Next"}: ${next.label.toLowerCase()} · ${next.note}` : "All steps complete"}</div>
      </div>
      <div className="steps" role="img" aria-label={`${doneCount(steps)} of 5 steps complete`}>
        {steps.map((s) => (
          <span key={s.key} className={s.state === "done" ? "done" : s.state === "current" || s.state === "blocked" ? "current" : ""} />
        ))}
      </div>
      <ul className="dots">
        {steps.map((s) => (
          <li key={s.key}>
            <span className={`dot ${s.state === "done" ? "" : s.state === "todo" ? "faint" : "open"}`} aria-hidden="true" />
            <span>{s.label}</span>
            <span className="muted" style={{ fontSize: 11.5 }}>
              {s.state === "done" ? "Done" : s.state === "blocked" ? "Blocked" : s.state === "current" ? "Now" : "—"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function LiveSite({ detail }: { detail: ProjectDetail }) {
  const record = detail.records[0];
  return (
    <section className="card-dark" aria-labelledby="live-h" style={{ flex: "1 1 250px" }}>
      <div className="card-head">
        <h2 id="live-h" className="card-title" style={{ fontSize: 15, display: "flex", alignItems: "center", gap: 8 }}>
          <I.Globe size={16} aria-hidden="true" /> Live site
        </h2>
        <a href={detail.project.url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 }}>
          Open <I.ArrowUpRight size={13} aria-hidden="true" />
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      </div>
      <ChromeOrb />
      <div>
        <div className="mono" style={{ fontSize: 12, overflowWrap: "anywhere" }}>
          {host(detail.project.url)}
        </div>
        <div style={{ fontSize: 12, color: "var(--on-dark-muted)" }}>
          {record?.deployment ? `Last verified ${record.deployment.environment} · ${record.deployment.commit.slice(0, 7)}` : `Added ${formatDateTime(detail.project.createdAt)} by ${detail.project.createdBy}`}
        </div>
      </div>
    </section>
  );
}

function FilesCard({ v }: { v: VersionView }) {
  return (
    <section className="card tight" aria-labelledby="files-h" style={{ flex: "1 1 300px" }}>
      <div className="card-head">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="round-icon" aria-hidden="true">
            <I.Folder size={16} />
          </span>
          <h2 id="files-h" className="card-title" style={{ fontSize: 13 }}>
            {v.approval ? "Approved files" : "Submitted files"}
          </h2>
        </div>
        <span className="small">Version {v.version}</span>
      </div>
      <ul className="file-list">
        <li className="file-row">
          <span className="file-kind" aria-hidden="true">
            YML
          </span>
          <span className="file-name">greenlight.yaml</span>
          <span className="file-meta" title={v.specFileSha256 ?? undefined}>
            {v.specFileSha256 ? v.specFileSha256.slice(0, 6) + "…" : "—"}
          </span>
        </li>
        {v.tests.map((t) => (
          <li key={t.file} className="file-row">
            <span className="file-kind" aria-hidden="true">
              MD
            </span>
            <span className="file-name" title={t.file}>
              {t.file}
            </span>
            <span className="file-meta">{t.steps.length} steps</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClaimsCard({ v, results }: { v: VersionView; results: Map<string, string> }) {
  const est = v.estimate;
  const max = est ? Math.max(...est.breakdown.map((b) => b.credits), est.runOverhead, 1) : 1;
  const testFor = (claimId: string) => v.tests.filter((t) => t.claims.includes(claimId));
  return (
    <section className="card tight" aria-labelledby="claims-h" style={{ flex: "999 1 560px", gap: 16 }}>
      <div className="card-head" style={{ gap: "14px 28px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h2 id="claims-h" className="card-title lg">
            Claims
          </h2>
          <span className="count-chip">{v.claims.length}</span>
        </div>
        <Fact icon={<I.Approvals size={15} />} label={v.approval ? "Approved by" : "Submitted by"} value={v.approval?.approvedBy ?? v.submittedBy} />
        <Fact icon={<I.Hash size={15} />} label="Spec hash" value={shortHash(v.approvedTestHash)} mono title={v.approvedTestHash} />
        <Fact icon={<I.Check size={15} />} label="Signature" value={!v.approval ? "Not approved yet" : v.approval.verified ? "Verified by server" : v.approval.signed ? "Not verified" : "Unsigned"} />
      </div>
      <div className="claims-dark">
        {v.claims.map((c) => {
          const status = results.get(c.id);
          const tests = testFor(c.id);
          const expect = tests.flatMap((t) => t.steps.filter((s) => s.kind === "expect_text").map((s) => s.text))[0];
          return (
            <article key={c.id} className="claim">
              <div className="claim-id">{c.id}</div>
              <h3>{c.text}</h3>
              <p>
                {tests.length ? `Test ${tests.map((t) => t.file.replace(/_test\.md$/, "")).join(", ")}` : "No test covers this claim"}
                {expect ? ` · expects “${expect}”` : ""}
              </p>
              <div className="claim-foot">
                <div className="caps">
                  <span>Result</span>
                  <b>{claimStatusLabel(status)}</b>
                </div>
                <div className="meter">
                  <span style={{ width: status === "passed" ? "100%" : status ? "35%" : "0%" }} />
                </div>
              </div>
            </article>
          );
        })}
        {est ? (
          <article className="claim" aria-labelledby="est-h" style={{ flex: "1 1 170px" }}>
            <h3 id="est-h">Credit estimate</h3>
            <div className="bars" role="img" aria-label={`Estimate: ${est.breakdown.map((b, i) => `test ${i + 1} ${credits(b.credits)}`).join(", ")}, run ${credits(est.runOverhead)}; ${credits(est.credits)} in total`}>
              {est.breakdown.map((b) => (
                <div key={b.file} className="bar-col">
                  <span>{credits(b.credits)}</span>
                  <div className="bar" style={{ height: `${(b.credits / max) * 72}px` }} />
                </div>
              ))}
              {est.runOverhead ? (
                <div className="bar-col">
                  <span>{credits(est.runOverhead)}</span>
                  <div className="bar overhead" style={{ height: `${(est.runOverhead / max) * 72}px` }} />
                </div>
              ) : null}
            </div>
            <div className="caps">
              <span>Tests 1–{est.breakdown.length} · run</span>
              <b>{credits(est.credits)}</b>
            </div>
          </article>
        ) : null}
      </div>
    </section>
  );
}

function Fact({ icon, label, value, mono = false, title }: { icon: React.ReactNode; label: string; value: string; mono?: boolean; title?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
      <span className="round-icon light" aria-hidden="true">
        {icon}
      </span>
      <div style={{ fontSize: 11.5, color: "var(--muted)", lineHeight: 1.3, minWidth: 0 }}>
        {label}
        <br />
        <b className={mono ? "mono" : undefined} title={title} style={{ color: "var(--ink)", fontWeight: mono ? 500 : 600, fontSize: 13 }}>
          {value}
        </b>
      </div>
    </div>
  );
}

function TestsCard({ v, results }: { v: VersionView; results: Map<string, string> }) {
  return (
    <section className="card" aria-labelledby="tests-h">
      <div className="card-head">
        <h2 id="tests-h" className="card-title lg">
          Tests
        </h2>
        <span className="small">{v.tests.reduce((n, t) => n + t.steps.length, 0)} steps in {v.tests.length} tests</span>
      </div>
      {v.description ? <p className="muted" style={{ margin: 0, maxWidth: "70ch" }}>{v.description}</p> : null}
      <div className="tests">
        {v.tests.map((t, i) => {
          const statuses = t.claims.map((c) => results.get(c)).filter(Boolean);
          const status = statuses.length ? (statuses.every((s) => s === "passed") ? "passed" : statuses.find((s) => s !== "passed")) : undefined;
          return (
            <details key={t.file} className="test" open={i === 0}>
              <summary>
                <I.ChevronRight className="chev" size={16} aria-hidden="true" />
                <span className="test-title">{t.title ?? t.file}</span>
                <span className="tags">
                  {t.claims.map((c) => (
                    <Tag key={c}>{c}</Tag>
                  ))}
                  <Tag form={status === "passed" ? "solid" : status ? "outline" : "dashed"}>{claimStatusLabel(status)}</Tag>
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
          );
        })}
      </div>
    </section>
  );
}
