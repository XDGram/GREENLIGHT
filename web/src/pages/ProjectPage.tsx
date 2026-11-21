import { useEffect, useState } from "react";
import { api } from "../api";
import { ErrorNotice, LoadingRows, ResultMark, Tag } from "../components/Bits";
import { ChromeOrb } from "../components/Chrome";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
import { Timeline } from "../components/Timeline";
import { claimStatusLabel, credits, formatDateTime, host, shortHash } from "../format";
import { Link, useRouter } from "../router";
import { OUTCOME_LABEL, outcomeOf } from "../plain";
import { certificationPath, claimResults, doneCount, type PathStep } from "../state";
import type { FixItem, ProjectDetail, Session, VersionView } from "../types";
import { useData } from "../useData";
import type { SignInRequired } from "../api";

export function ProjectPage({ id, pending, onSignIn, load, sample = false, session }: { id: string; pending: number; onSignIn: (e: SignInRequired) => void; load?: () => Promise<ProjectDetail>; sample?: boolean; session?: Session }) {
  const { value, reload } = useData(load ?? (() => api.project(id)), [id], { onSignIn });
  const [picked, setPicked] = useState<number | null>(null);
  const fixes = useData(() => (sample ? Promise.resolve([] as FixItem[]) : api.fixes(id)), [id, sample], { onSignIn, refreshMs: 60_000 });

  if (value.state === "loading") {
    return (
      <>
        <TopBar title="Loading…" eyebrow={<Link href="/app/projects">My projects</Link>} />
        <LoadingRows />
      </>
    );
  }
  if (value.state === "error") {
    return (
      <>
        <TopBar title="Project" eyebrow={<Link href="/app/projects">My projects</Link>} />
        <ErrorNotice error={value.error} onRetry={reload} />
      </>
    );
  }

  const d = value.data;
  const v = d.versions.find((x) => x.version === picked) ?? d.versions[0];
  const openFixes = fixes.value.state === "ready" ? fixes.value.data.filter((f) => !["fixed", "dismissed"].includes(f.status)) : [];

  if (sample) {
    return (
      <>
        <TopBar title={d.project.name} eyebrow={<span>Example project · read-only</span>}>
          <Link href="/app/projects/new" className="btn">
            Test your own app
          </Link>
        </TopBar>
        <p className="small" style={{ margin: 0 }}>
          A real project in Greenlight, approved by its owner: what it claims, the exact browser steps behind each claim and what a run costs. Nothing here can be changed.
        </p>
        {v ? <VersionView detail={d} v={v} /> : null}
      </>
    );
  }

  return (
    <>
      <TopBar
        title={d.project.name}
        eyebrow={
          <>
            <Link href="/app/projects">My projects</Link>
            <I.ChevronRight size={13} aria-hidden="true" />
            <a href={d.project.url} target="_blank" rel="noopener noreferrer">
              {host(d.project.url)}
            </a>
            {value.refreshing ? <span className="refreshing" aria-label="Refreshing" /> : null}
          </>
        }
      >
        <Link href={`/app/projects/${d.project.id}/tests`} className="btn ghost">
          <I.FileText size={14} aria-hidden="true" /> Test plan
        </Link>
        {v?.approval ? (
          <Link href={`/app/projects/${d.project.id}/verify`} className="btn">
            <I.Play size={14} aria-hidden="true" /> Test it
          </Link>
        ) : null}
      </TopBar>

      <Journey detail={d} openFixes={openFixes.length} />
      <Understanding detail={d} onChanged={reload} session={session} />
      <LatestResult detail={d} openFixes={openFixes} />
      {d.details ? <DetailsCard detail={d} onChanged={reload} /> : null}
      {d.records.length ? <RunsCard detail={d} /> : null}

      {v ? (
        <details className="tech">
          <summary>Technical details: versions, approval record, files and credit estimate</summary>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)" }}>
            {d.versions.length > 1 ? (
              <div className="seg" role="group" aria-label="Test plan version">
                {d.versions.map((x) => (
                  <button key={x.version} type="button" aria-pressed={x.version === v.version} onClick={() => setPicked(x.version)}>
                    v{x.version}
                  </button>
                ))}
              </div>
            ) : null}
            <VersionView detail={d} v={v} />
          </div>
        </details>
      ) : null}
      {pending ? null : null}
    </>
  );
}

/** Where the project is: understand → plan → approve → test → fix. */
function Journey({ detail, openFixes }: { detail: ProjectDetail; openFixes: number }) {
  const pid = detail.project.id;
  const u = detail.details?.understanding;
  const v = detail.versions[0];
  const rec = detail.records[0];
  const steps = [
    { t: "Learn the app", s: u?.analysis ? "Done" : u?.inspectedAt ? "Inspected" : "Not yet", done: Boolean(u?.inspectedAt), href: `/app/projects/${pid}#understanding` },
    { t: "Test plan", s: v ? `${v.tests.length} test${v.tests.length === 1 ? "" : "s"}` : "Not written", done: Boolean(v), href: `/app/projects/${pid}/tests` },
    { t: "Approve", s: v?.approval ? "Approved" : v ? "Waiting for you" : "—", done: Boolean(v?.approval), href: `/app/projects/${pid}/tests` },
    { t: "Test in a browser", s: rec ? `${rec.claims.filter((c) => c.status === "passed").length}/${rec.claims.length} working` : "Not run", done: Boolean(rec), href: rec ? `/app/projects/${pid}/runs/${rec.id}` : `/app/projects/${pid}/verify` },
    { t: "Fix", s: openFixes ? `${openFixes} open` : rec && rec.status === "passed" ? "Nothing to fix" : "—", done: Boolean(rec) && openFixes === 0 && rec.status === "passed", href: "/app/fixes" },
  ];
  const now = steps.findIndex((x) => !x.done);
  return (
    <nav className="journey" aria-label="Progress">
      {steps.map((x, i) => (
        <Link key={x.t} href={x.href} className={x.done ? "done" : i === now ? "now" : undefined} aria-current={i === now ? "step" : undefined}>
          <span className="j-n">Step {i + 1}</span>
          <span className="j-t">{x.t}</span>
          <span className="j-s">{x.s}</span>
        </Link>
      ))}
    </nav>
  );
}

const SOURCE: Record<string, string> = { description: "From your description", live_app: "Seen on the live app", repository: "Seen in the code", description_and_live_app: "Description and live app" };

function Understanding({ detail, onChanged, session }: { detail: ProjectDetail; onChanged: () => void; session?: Session }) {
  const { search } = useRouter();
  const u = detail.details?.understanding ?? null;
  const ai = session?.features.ai ?? false;
  const [busy, setBusy] = useState<"inspect" | "analyze" | "answers" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>(u?.answers ?? {});
  const run = async (step: "inspect" | "analyze" | "answers") => {
    setBusy(step);
    setErr(null);
    try {
      if (step === "answers") await api.understand(detail.project.id, { step, answers });
      else await api.understand(detail.project.id, { step });
      if (step === "inspect" && ai) {
        setBusy("analyze");
        await api.understand(detail.project.id, { step: "analyze" });
      }
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  // Right after submitting: learn the app straight away.
  const auto = search.get("understand") === "1" && !u?.inspectedAt;
  useEffect(() => {
    if (auto && !busy) void run("inspect");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  const repo = u?.repository;
  const app = u?.app;
  const a = u?.analysis;
  return (
    <section className="card" aria-labelledby="understanding" id="understanding">
      <div className="card-head">
        <h2 id="understanding" className="card-title lg">
          What Greenlight learned
        </h2>
        <button type="button" className="btn ghost sm" onClick={() => run("inspect")} disabled={busy !== null}>
          {busy === "inspect" || busy === "analyze" ? <span className="spinner" aria-hidden="true" /> : <I.RefreshCw size={14} aria-hidden="true" />}
          {u?.inspectedAt ? "Look again" : "Learn my app"}
        </button>
      </div>
      {busy === "inspect" ? <p className="small" aria-live="polite" style={{ margin: 0 }}>Reading the repository and opening your live app in a browser…</p> : null}
      {busy === "analyze" ? <p className="small" aria-live="polite" style={{ margin: 0 }}>Comparing your description with what was found…</p> : null}
      {err ? (
        <p className="small" role="alert" style={{ margin: 0 }}>
          {err}
        </p>
      ) : null}
      {!u?.inspectedAt && !busy ? (
        <p className="small" style={{ margin: 0 }}>
          Greenlight reads your public repository and opens your live app in a headless browser to see what it can test. Nothing is tested and no credits are used.
        </p>
      ) : null}

      {a ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <p style={{ margin: 0, maxWidth: "75ch" }}>{a.summary}</p>
          <p className="small" style={{ margin: 0 }}>
            <b style={{ color: "var(--ink)", fontWeight: 500 }}>Built with:</b> {a.framework}
          </p>
          <div>
            <h3 className="card-title" style={{ fontSize: 15, margin: "0 0 8px" }}>
              What can be tested
            </h3>
            <ul className="list">
              {a.features.map((f) => (
                <li key={f.name} className="list-row" style={{ alignItems: "flex-start" }}>
                  <ResultMark status={f.testable ? "passed" : null} />
                  <div className="list-main">
                    <b>{f.name}</b>
                    <span>
                      {f.description} · {SOURCE[f.source] ?? f.source}
                      {f.testable ? "" : ` · can't be tested: ${f.why}`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
          {a.mismatches.length ? (
            <div className="notice" role="status">
              <I.CircleAlert size={18} aria-hidden="true" />
              <div style={{ flex: "1 1 260px", fontSize: 13 }}>
                <b>Your description and the live app don't fully match.</b>
                <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                  {a.mismatches.map((m) => (
                    <li key={m.topic}>
                      {m.topic}: you said “{m.description_says}”; the app shows {m.app_shows}.
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          {a.questions.length ? (
            <div className="confirm-box">
              <b style={{ fontWeight: 600 }}>A few questions to get the tests right</b>
              {a.questions.map((q) => (
                <label key={q.id} className="field">
                  <span>
                    {q.question} <span className="hint">({q.why})</span>
                  </span>
                  <input value={answers[q.id] ?? ""} onChange={(e) => setAnswers({ ...answers, [q.id]: e.target.value })} maxLength={1000} />
                </label>
              ))}
              <div className="tags">
                <button type="button" className="btn sm" onClick={() => run("answers")} disabled={busy !== null}>
                  {busy === "answers" ? <span className="spinner" aria-hidden="true" /> : null} Save answers
                </button>
                <Link href={`/app/projects/${detail.project.id}/tests`} className="btn ghost sm">
                  Continue to the test plan
                </Link>
              </div>
            </div>
          ) : null}
          <p className="small" style={{ margin: 0 }}>
            {a.limits}
          </p>
        </div>
      ) : u?.inspectedAt && !busy ? (
        ai ? (
          <div className="tags">
            <button type="button" className="btn sm" onClick={() => run("analyze")}>
              Compare with my description
            </button>
          </div>
        ) : (
          <p className="small" style={{ margin: 0 }}>
            AI comparison isn't configured on this server, so here is what was read. You can still write the test plan yourself.
          </p>
        )
      ) : null}

      {u?.inspectedAt ? (
        <div className="row">
          <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <h3 className="card-title" style={{ fontSize: 15, margin: 0 }}>
              <I.GitBranch size={15} aria-hidden="true" /> Code
            </h3>
            {repo?.status === "ok" ? (
              <dl className="kv-list">
                <dt>Repository</dt>
                <dd>{repo.repository?.fullName}</dd>
                <dt>Looks like</dt>
                <dd>{repo.frameworks?.length ? repo.frameworks.map((f) => f.name).join(", ") : "No framework detected"}</dd>
                <dt>Languages</dt>
                <dd>{repo.languages?.map((l) => `${l.name} ${l.share}%`).join(", ") || "—"}</dd>
                <dt>Pages found</dt>
                <dd>{repo.routes?.length ? `${repo.routes.length} route files` : "None recognised"}</dd>
                <dt>Read</dt>
                <dd>{repo.read?.join(", ")}</dd>
              </dl>
            ) : (
              <p className="small" style={{ margin: 0 }}>
                {repo?.reason ?? "Not read."} Nothing from the code was used.
              </p>
            )}
          </div>
          <div style={{ flex: "1 1 300px", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
            <h3 className="card-title" style={{ fontSize: 15, margin: 0 }}>
              <I.Globe size={15} aria-hidden="true" /> Live app
            </h3>
            {app?.status === "ok" ? (
              <>
                {u.screenshot ? <img className="shot-big" src={u.screenshot} alt={`The start page of ${detail.project.name}, as the browser saw it`} /> : null}
                <dl className="kv-list">
                  <dt>Pages opened</dt>
                  <dd>{app.pages?.map((p) => p.title || host(p.url)).join(" · ")}</dd>
                  <dt>Buttons</dt>
                  <dd>{app.pages?.[0]?.buttons.slice(0, 8).join(" · ") || "—"}</dd>
                  <dt>Inputs</dt>
                  <dd>{app.pages?.[0]?.inputs.map((i) => i.label || i.type).slice(0, 8).join(" · ") || "—"}</dd>
                </dl>
              </>
            ) : (
              <p className="small" style={{ margin: 0 }}>
                {app?.reason ?? "Not opened."}
              </p>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function LatestResult({ detail, openFixes }: { detail: ProjectDetail; openFixes: FixItem[] }) {
  const rec = detail.records[0];
  if (!rec) return null;
  const count = (o: string) => rec.claims.filter((c) => outcomeOf(c.status) === o).length;
  return (
    <section className="card" aria-labelledby="latest-h">
      <div className="card-head">
        <h2 id="latest-h" className="card-title lg">
          Latest test run
        </h2>
        <span className="small">{formatDateTime(rec.startedAt)}</span>
      </div>
      <div className="tags">
        <span className="outcome working">{count("working")} working</span>
        <span className="outcome not_working">{count("not_working")} not working</span>
        <span className="outcome could_not_verify">{count("could_not_verify")} could not verify</span>
      </div>
      <ul className="list">
        {rec.claims.map((c) => (
          <li key={c.id} className="list-row">
            <ResultMark status={c.status} />
            <div className="list-main">
              <b>{c.text}</b>
              <span>{OUTCOME_LABEL[outcomeOf(c.status)]}</span>
            </div>
          </li>
        ))}
      </ul>
      <div className="tags">
        <Link href={`/app/projects/${detail.project.id}/runs/${rec.id}`} className="btn sm">
          See results and evidence
        </Link>
        {openFixes.length ? (
          <Link href="/app/fixes" className="btn ghost sm">
            <I.Wrench size={14} aria-hidden="true" /> {openFixes.length} in the Fix Centre
          </Link>
        ) : null}
      </div>
    </section>
  );
}

function DetailsCard({ detail, onChanged }: { detail: ProjectDetail; onChanged: () => void }) {
  const dd = detail.details!;
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
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
  if (editing) return <DetailsForm detail={detail} onDone={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />;
  return (
    <section className="card" aria-labelledby="details-h">
      <div className="card-head">
        <h2 id="details-h" className="card-title lg">
          Project details
        </h2>
        <button type="button" className="btn ghost sm" onClick={recheck} disabled={busy || !dd.repository}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <I.RefreshCw size={14} aria-hidden="true" />} Check repository
        </button>
        <button type="button" className="btn ghost sm" onClick={() => setEditing(true)}>
          <I.Pencil size={14} aria-hidden="true" /> Edit
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

function DetailsForm({ detail, onDone, onCancel }: { detail: ProjectDetail; onDone: () => void; onCancel: () => void }) {
  const dd = detail.details!;
  const [f, setF] = useState({ repository: dd.repository ?? "https://github.com/", branch: dd.branch ?? "main", description: dd.description ?? "", purpose: dd.purpose ?? "" });
  const [creds, setCreds] = useState<"keep" | "replace" | "remove">("keep");
  const [c, setC] = useState({ username: "", password: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.updateDetails(detail.project.id, {
        repository: f.repository.trim(),
        branch: f.branch.trim() || "main",
        description: f.description.trim(),
        purpose: f.purpose.trim(),
        ...(creds === "replace" ? { credentials: c } : creds === "remove" ? { clearCredentials: true } : {}),
      });
      onDone();
    } catch (x) {
      setErr((x as Error).message);
      setBusy(false);
    }
  };
  return (
    <form className="card" aria-labelledby="edit-details-h" onSubmit={save}>
      <div className="card-head">
        <h2 id="edit-details-h" className="card-title lg">
          Edit project details
        </h2>
      </div>
      <p className="small" style={{ margin: 0 }}>
        The name and live URL are part of every test version and its fingerprint, so they change through a new test version, not here.
      </p>
      <div className="form-grid">
        <label className="field">
          <span>GitHub repository URL</span>
          <input type="url" value={f.repository} onChange={(e) => setF({ ...f, repository: e.target.value })} required />
        </label>
        <label className="field">
          <span>Branch</span>
          <input value={f.branch} onChange={(e) => setF({ ...f, branch: e.target.value })} />
        </label>
      </div>
      <label className="field">
        <span>Short description</span>
        <input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} maxLength={1000} />
      </label>
      <label className="field">
        <span>What the app should do</span>
        <textarea value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })} maxLength={4000} required />
      </label>
      <div className="field">
        <span>Test credentials</span>
        <div className="seg" role="group" aria-label="Test credentials">
          {(["keep", "replace", "remove"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={creds === k} onClick={() => setCreds(k)} disabled={k === "remove" && !dd.hasCredentials}>
              {k === "keep" ? (dd.hasCredentials ? "Keep stored" : "None") : k === "replace" ? (dd.hasCredentials ? "Replace" : "Add") : "Remove"}
            </button>
          ))}
        </div>
      </div>
      {creds === "replace" ? (
        <div className="form-grid">
          <label className="field">
            <span>Username</span>
            <input value={c.username} onChange={(e) => setC({ ...c, username: e.target.value })} autoComplete="off" />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" value={c.password} onChange={(e) => setC({ ...c, password: e.target.value })} autoComplete="new-password" />
          </label>
        </div>
      ) : null}
      {err ? (
        <p className="small" role="alert" style={{ margin: 0 }}>
          {err}
        </p>
      ) : null}
      <div className="tags">
        <button type="submit" className="btn" disabled={busy || f.purpose.trim().length < 20}>
          {busy ? <span className="spinner" aria-hidden="true" /> : null} Save and re-check repository
        </button>
        <button type="button" className="btn ghost" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </form>
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
        <Timeline steps={steps} approver={v.approval ? v.approval.identity?.username ?? v.approval.approvedBy : null} />
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
        <Fact icon={<I.Approvals size={15} />} label={v.approval ? "Approved by" : "Submitted by"} value={v.approval ? v.approval.identity?.username ?? v.approval.approvedBy : v.submittedBy} />
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
