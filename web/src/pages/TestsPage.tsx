import { useEffect, useRef, useState } from "react";
import { ApiError, api, type SignInRequired } from "../api";
import { ErrorNotice, FormError, LoadingRows, Notice } from "../components/Bits";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
import { credits, formatDateTime } from "../format";
import { Link } from "../router";
import type { DraftSpec, DraftStep, DraftTest, ProjectDetail, Session, SpecCheck, VersionView } from "../types";
import { useData } from "../useData";
import { newKey } from "./guest/SpecEditor";

/** Server drafts and versions refer to claims by id; the editor uses its own keys. */
function toEditor(d: { name: string; url: string; description: string | null; claims: { id: string; text: string }[]; tests: { title: string | null; claims: string[]; steps: { name: string; kind: string; text: string }[] }[] }): DraftSpec {
  const keys = new Map(d.claims.map((c) => [c.id, newKey()]));
  return {
    name: d.name,
    url: d.url,
    description: d.description,
    claims: d.claims.map((c) => ({ id: keys.get(c.id)!, text: c.text })),
    tests: d.tests.map((t) => ({
      title: t.title ?? "",
      claims: t.claims.map((k) => keys.get(k)).filter((k): k is string => Boolean(k)),
      steps: t.steps.map((s) => ({ name: s.name, kind: s.kind === "expect_text" ? "expect_text" : "do", text: s.text })),
    })),
  };
}
const fromVersion = (d: ProjectDetail, v: VersionView): DraftSpec => toEditor({ name: d.project.name, url: v.url ?? d.project.url, description: v.description, claims: v.claims, tests: v.tests });

export function TestsPage({ id, session, onSignIn, onSaved }: { id: string; session: Session; onSignIn: (e: SignInRequired) => void; onSaved: () => void }) {
  const { value, reload } = useData(() => api.project(id), [id], { onSignIn, refreshMs: 300_000 });
  if (value.state === "loading") {
    return (
      <>
        <TopBar title="Test plan" eyebrow={<Link href="/app/projects">My projects</Link>} />
        <LoadingRows />
      </>
    );
  }
  if (value.state === "error") {
    return (
      <>
        <TopBar title="Test plan" eyebrow={<Link href="/app/projects">My projects</Link>} />
        <ErrorNotice error={value.error} onRetry={reload} />
      </>
    );
  }
  return <Plan key={value.data.versions[0]?.version ?? 0} detail={value.data} session={session} reload={reload} onSaved={onSaved} />;
}

function Plan({ detail, session, reload, onSaved }: { detail: ProjectDetail; session: Session; reload: () => void; onSaved: () => void }) {
  const latest = detail.versions[0] ?? null;
  const [editing, setEditing] = useState<DraftSpec | null>(null);
  const pid = detail.project.id;

  if (!latest || editing) {
    return <PlanEditor detail={detail} session={session} initial={editing} latest={latest} onCancel={latest ? () => setEditing(null) : null} onSaved={() => { setEditing(null); onSaved(); reload(); }} />;
  }

  const approved = Boolean(latest.approval);
  return (
    <>
      <TopBar title="Test plan" eyebrow={<Link href={`/app/projects/${pid}`}>{detail.project.name}</Link>}>
        <button type="button" className="btn ghost" onClick={() => setEditing(fromVersion(detail, latest))}>
          <I.Pencil size={14} aria-hidden="true" /> Change the plan
        </button>
        {approved ? (
          <Link href={`/app/projects/${pid}/verify`} className="btn">
            <I.Play size={14} aria-hidden="true" /> Test it in a browser
          </Link>
        ) : null}
      </TopBar>
      {approved ? (
        <Notice icon={<I.Check size={18} aria-hidden="true" />}>
          Approved {formatDateTime(latest.approval!.approvedAt)}. These {latest.tests.length} tests run exactly as written; changing them makes a new plan that needs approving again.
        </Notice>
      ) : (
        <Approve detail={detail} v={latest} session={session} onApproved={() => { reload(); onSaved(); }} />
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {latest.tests.map((t) => (
          <PlanCard key={t.file} title={t.title ?? t.file} claims={t.claims.map((c) => latest.claims.find((x) => x.id === c)?.text ?? c)} steps={t.steps} />
        ))}
      </div>
      <TechDetails v={latest} />
    </>
  );
}

/** One test in plain language: what it proves, what the browser does, what should happen. */
function PlanCard({ title, claims, steps, actions }: { title: string; claims: string[]; steps: { name: string; kind: string; text: string }[]; actions?: React.ReactNode }) {
  const does = steps.filter((s) => s.kind !== "expect_text");
  const expects = steps.filter((s) => s.kind === "expect_text");
  return (
    <article className="plan-card">
      <div className="card-head">
        <h3 className="card-title" style={{ fontSize: 16 }}>
          {title || "Untitled test"}
        </h3>
        {actions}
      </div>
      <div className="plan-grid">
        <div>
          <h4>Feature being tested</h4>
          <ul>
            {claims.map((c, i) => (
              <li key={i}>{c || "—"}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>What Greenlight will do</h4>
          <ol>
            {does.map((s, i) => (
              <li key={i}>{s.text || "—"}</li>
            ))}
          </ol>
        </div>
        <div>
          <h4>What should happen</h4>
          <ul>
            {expects.map((s, i) => (
              <li key={i}>The page shows “{s.text || "…"}”</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Counts as working when</h4>
          <p style={{ margin: 0, fontSize: 13 }}>Every step completes and everything under “What should happen” is visible.</p>
        </div>
      </div>
    </article>
  );
}

function Approve({ detail, v, session, onApproved }: { detail: ProjectDetail; v: VersionView; session: Session; onApproved: () => void }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string } | null>(null);
  if (session.role !== "guest") {
    return (
      <Notice
        icon={<I.Approvals size={18} aria-hidden="true" />}
        action={
          <a className="btn" href={v.approveUrl ?? `/approve/${detail.project.id}/${v.version}`}>
            Approve on the secure page
          </a>
        }
      >
        <b>This plan needs your approval before anything runs.</b> Your account can certify, so approval happens on a separate signed page.
      </Notice>
    );
  }
  const approve = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.approveInApp(detail.project.id, v.version, v.approvedTestHash);
      onApproved();
    } catch (e) {
      setError({ message: (e as Error).message });
      setBusy(false);
    }
  };
  return (
    <section className="confirm-box" aria-labelledby="approve-h">
      <h2 id="approve-h" className="card-title" style={{ fontSize: 17 }}>
        Approve this plan
      </h2>
      <p style={{ margin: 0, fontSize: 13 }}>Nothing runs until you approve. The browser will follow these {v.tests.length} tests exactly as written below. Changing them later makes a new plan.</p>
      <label className="check-line">
        <input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        <span>I've reviewed these {v.tests.length} tests and want Greenlight to run them on {detail.project.url}.</span>
      </label>
      <FormError error={error} />
      <div>
        <button type="button" className="btn" disabled={!ok || busy} onClick={approve}>
          {busy ? <span className="spinner" aria-hidden="true" /> : <I.Check size={15} aria-hidden="true" />} Approve plan
        </button>
      </div>
    </section>
  );
}

function TechDetails({ v, specText, hash }: { v?: VersionView | null; specText?: string; hash?: string }) {
  return (
    <details className="tech">
      <summary>Technical details: the test specification Greenlight runs</summary>
      <dl className="kv-list">
        <dt>Plan version</dt>
        <dd>{v ? `v${v.version}` : "not saved yet"}</dd>
        <dt>Fingerprint</dt>
        <dd className="mono">{hash ?? v?.approvedTestHash ?? "—"}</dd>
        {v?.estimate ? (
          <>
            <dt>Credit estimate</dt>
            <dd>~{credits(v.estimate.credits)} Kane credits per full run</dd>
          </>
        ) : null}
        <dt>Test files</dt>
        <dd className="mono">{v?.tests.map((t) => t.file).join(", ") ?? "—"}</dd>
      </dl>
      {specText ? <pre className="code" style={{ marginTop: 12 }}>{specText}</pre> : null}
    </details>
  );
}

const blankTest = (claimKey: string): DraftTest => ({
  title: "",
  claims: [claimKey],
  steps: [
    { name: "Open the app", kind: "do", text: "Open the start page." },
    { name: "Check the result", kind: "expect_text", text: "" },
  ],
});

function PlanEditor({ detail, session, initial, latest, onCancel, onSaved }: { detail: ProjectDetail; session: Session; initial: DraftSpec | null; latest: VersionView | null; onCancel: (() => void) | null; onSaved: () => void }) {
  const pid = detail.project.id;
  const [draft, setDraft] = useState<DraftSpec | null>(initial);
  const [open, setOpen] = useState<number | null>(null);
  const [instruction, setInstruction] = useState("");
  const [notes, setNotes] = useState<string | null>(null);
  const [check, setCheck] = useState<SpecCheck | null>(null);
  const [busy, setBusy] = useState<"draft" | "revise" | "save" | null>(null);
  const [error, setError] = useState<{ message: string; problems?: string[] } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const unchanged = Boolean(latest && check?.hash && check.hash === latest.approvedTestHash);
  const ai = session.features.ai;

  useEffect(() => {
    if (!draft) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api.preview(pid, { draft }).then(setCheck, (e: ApiError) => setCheck({ ok: false, problems: e.problems.length ? e.problems : [e.message] }));
    }, 450);
    return () => window.clearTimeout(timer.current);
  }, [draft, pid]);

  const fail = (e: unknown) => {
    const a = e as ApiError;
    setError({ message: a.message, problems: a.problems });
  };
  const propose = async () => {
    setBusy("draft");
    setError(null);
    try {
      const r = await api.draft(pid);
      setDraft(toEditor(r.draft));
      setNotes(r.notes);
      setCheck(r.check);
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const revise = async () => {
    if (!draft) return;
    setBusy("revise");
    setError(null);
    try {
      const cur = { claims: draft.claims, tests: draft.tests };
      const r = await api.revise(pid, { ...draft, ...cur }, instruction.trim());
      setDraft(toEditor(r.draft));
      setNotes(r.notes);
      setCheck(r.check);
      setInstruction("");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    if (!draft) return;
    setBusy("save");
    setError(null);
    try {
      await api.propose(pid, { draft });
      onSaved();
    } catch (e) {
      fail(e);
      setBusy(null);
    }
  };

  const setTest = (i: number, t: DraftTest) => draft && setDraft({ ...draft, tests: draft.tests.map((x, n) => (n === i ? t : x)) });
  const setClaimText = (key: string, text: string) => draft && setDraft({ ...draft, claims: draft.claims.map((c) => (c.id === key ? { ...c, text } : c)) });
  const removeTest = (i: number) => {
    if (!draft) return;
    const tests = draft.tests.filter((_, n) => n !== i);
    const used = new Set(tests.flatMap((t) => t.claims));
    setDraft({ ...draft, tests, claims: draft.claims.filter((c) => used.has(c.id)) });
    setOpen(null);
  };
  const addTest = () => {
    const base = draft ?? { name: detail.project.name, url: detail.project.url, description: null, claims: [], tests: [] };
    const key = newKey();
    setDraft({ ...base, claims: [...base.claims, { id: key, text: "" }], tests: [...base.tests, blankTest(key)] });
    setOpen(base.tests.length);
  };

  return (
    <>
      <TopBar title="Test plan" eyebrow={<Link href={`/app/projects/${pid}`}>{detail.project.name}</Link>}>
        {onCancel ? (
          <button type="button" className="btn ghost" onClick={onCancel}>
            Cancel changes
          </button>
        ) : null}
      </TopBar>

      {!draft ? (
        <section className="card">
          <h2 className="card-title lg">Let's plan the tests</h2>
          <p style={{ margin: 0, maxWidth: "70ch" }}>
            {ai
              ? "Greenlight proposes tests from your description and what it learned about the app. You can then edit, remove or add tests, or ask for changes, before approving."
              : "AI isn't configured on this server, so start with an empty test and write the plan yourself."}
          </p>
          <div className="tags">
            {ai ? (
              <button type="button" className="btn" onClick={propose} disabled={busy !== null}>
                {busy === "draft" ? <span className="spinner" aria-hidden="true" /> : <I.FileText size={15} aria-hidden="true" />}
                {busy === "draft" ? "Proposing tests…" : "Propose tests"}
              </button>
            ) : null}
            <button type="button" className={ai ? "btn ghost" : "btn"} onClick={addTest}>
              <I.Plus size={15} aria-hidden="true" /> Write a test myself
            </button>
          </div>
          {detail.details?.understanding?.analysis ? null : (
            <p className="small" style={{ margin: 0 }}>
              Tip: <Link href={`/app/projects/${pid}#understanding`}>let Greenlight learn the app</Link> first for better proposals.
            </p>
          )}
          <FormError error={error} />
        </section>
      ) : (
        <div className="split">
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            {latest ? <Notice icon={<I.Pencil size={18} aria-hidden="true" />}>You're changing the plan. Saving creates a new plan to approve; earlier results stay as they are.</Notice> : null}
            {notes ? (
              <p className="small" style={{ margin: 0 }}>
                <b style={{ color: "var(--ink)", fontWeight: 600 }}>Note from Claude:</b> {notes}
              </p>
            ) : null}
            {draft.tests.map((t, i) =>
              open === i ? (
                <TestEditor key={i} test={t} claims={draft.claims} onChange={(x) => setTest(i, x)} onClaim={setClaimText} onDone={() => setOpen(null)} onRemove={draft.tests.length > 1 ? () => removeTest(i) : null} />
              ) : (
                <PlanCard
                  key={i}
                  title={t.title}
                  claims={t.claims.map((k) => draft.claims.find((c) => c.id === k)?.text ?? "")}
                  steps={t.steps}
                  actions={
                    <span className="tags">
                      <button type="button" className="btn ghost sm" onClick={() => setOpen(i)}>
                        <I.Pencil size={13} aria-hidden="true" /> Edit
                      </button>
                      {draft.tests.length > 1 ? (
                        <button type="button" className="btn ghost sm" onClick={() => removeTest(i)}>
                          <I.X size={13} aria-hidden="true" /> Remove
                        </button>
                      ) : null}
                    </span>
                  }
                />
              ),
            )}
            <div>
              <button type="button" className="btn ghost" onClick={addTest} disabled={draft.tests.length >= 20}>
                <I.Plus size={15} aria-hidden="true" /> Add a test
              </button>
            </div>
            {ai ? (
              <section className="card tight" aria-labelledby="revise-h">
                <h3 id="revise-h" className="card-title" style={{ fontSize: 15 }}>
                  Ask Claude to revise the plan
                </h3>
                <label className="field">
                  <span className="sr-only">What should change?</span>
                  <textarea value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={1500} placeholder="e.g. Add a test for the pricing page. Drop the newsletter test. Use the exact button text “Check a link”." style={{ minHeight: 80 }} />
                </label>
                <div>
                  <button type="button" className="btn sm" disabled={busy !== null || instruction.trim().length < 5} onClick={revise}>
                    {busy === "revise" ? <span className="spinner" aria-hidden="true" /> : null} {busy === "revise" ? "Revising…" : "Revise the plan"}
                  </button>
                </div>
              </section>
            ) : null}
            <TechDetails specText={check?.specText} hash={check?.hash} v={null} />
          </div>
          <aside className="card-dark sticky" aria-labelledby="save-h">
            <h2 id="save-h" className="card-title">
              Save the plan
            </h2>
            {!check ? (
              <p style={{ margin: 0, fontSize: 13, color: "var(--on-dark-muted)" }}>Checking…</p>
            ) : check.ok ? (
              <p style={{ margin: 0, fontSize: 13 }} aria-live="polite">
                <I.Check size={13} aria-hidden="true" /> {check.tests?.length} test{check.tests?.length === 1 ? "" : "s"} ready. A full run costs about {credits(check.estimate?.credits)} credits.
              </p>
            ) : (
              <ul className="problems" style={{ borderColor: "var(--on-dark)" }} aria-live="polite">
                {check.problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
            {check?.warnings?.length ? <p style={{ margin: 0, fontSize: 12.5, color: "var(--on-dark-muted)" }}>{check.warnings.join(" ")}</p> : null}
            <FormError error={error} />
            <button type="button" className="btn on-dark" disabled={busy !== null || !check?.ok || unchanged} onClick={save}>
              {busy === "save" ? <span className="spinner" aria-hidden="true" /> : null} Save plan
            </button>
            <p style={{ margin: 0, fontSize: 12, color: "var(--on-dark-muted)" }}>{unchanged ? "Nothing changed yet." : "Saving doesn't run anything. You approve the plan next."}</p>
          </aside>
        </div>
      )}
    </>
  );
}

function TestEditor({ test, claims, onChange, onClaim, onDone, onRemove }: { test: DraftTest; claims: { id: string; text: string }[]; onChange: (t: DraftTest) => void; onClaim: (key: string, text: string) => void; onDone: () => void; onRemove: (() => void) | null }) {
  const setStep = (j: number, st: DraftStep) => onChange({ ...test, steps: test.steps.map((x, n) => (n === j ? st : x)) });
  return (
    <article className="plan-card" style={{ borderColor: "var(--ink)" }}>
      <label className="field">
        <span>Test name</span>
        <input value={test.title} onChange={(e) => onChange({ ...test, title: e.target.value })} placeholder="e.g. Check a known phishing link" />
      </label>
      {test.claims.map((k) => (
        <label key={k} className="field">
          <span>Feature being tested (what should be true)</span>
          <input value={claims.find((c) => c.id === k)?.text ?? ""} onChange={(e) => onClaim(k, e.target.value)} placeholder="e.g. A pasted phishing link is rated Dangerous." />
        </label>
      ))}
      <div className="field">
        <span>Steps: actions the browser takes, and text that should appear</span>
        <ol className="list" style={{ gap: 8 }}>
          {test.steps.map((s, j) => (
            <li key={j} className="step-edit" style={{ gridTemplateColumns: "28px 170px minmax(0, 1fr) auto" }}>
              <span className="step-n" aria-hidden="true" style={s.kind === "expect_text" ? { background: "var(--ink)", color: "var(--on-dark)", borderColor: "var(--ink)" } : undefined}>
                {j + 1}
              </span>
              <select aria-label={`Step ${j + 1} type`} value={s.kind} onChange={(e) => setStep(j, { ...s, kind: e.target.value as DraftStep["kind"], name: e.target.value === "expect_text" ? "Check the page" : `Step ${j + 1}` })}>
                <option value="do">Greenlight does</option>
                <option value="expect_text">Page should show</option>
              </select>
              <input aria-label={`Step ${j + 1}`} className={s.kind === "expect_text" ? "mono" : undefined} value={s.text} onChange={(e) => setStep(j, { ...s, text: e.target.value })} placeholder={s.kind === "do" ? 'e.g. Click the "Check a link" button.' : "Exact text, e.g. Dangerous"} />
              <button type="button" className="icon-x" aria-label={`Remove step ${j + 1}`} disabled={test.steps.length <= 1} onClick={() => onChange({ ...test, steps: test.steps.filter((_, n) => n !== j) })}>
                <I.X size={15} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className="tags">
        <button type="button" className="btn ghost sm" disabled={test.steps.length >= 12} onClick={() => onChange({ ...test, steps: [...test.steps, { name: `Step ${test.steps.length + 1}`, kind: "do", text: "" }] })}>
          Add an action
        </button>
        <button type="button" className="btn ghost sm" disabled={test.steps.length >= 12} onClick={() => onChange({ ...test, steps: [...test.steps, { name: "Check the page", kind: "expect_text", text: "" }] })}>
          Add text that should appear
        </button>
        <span style={{ flex: 1 }} />
        {onRemove ? (
          <button type="button" className="btn ghost sm" onClick={onRemove}>
            Remove test
          </button>
        ) : null}
        <button type="button" className="btn sm" onClick={onDone}>
          Done
        </button>
      </div>
    </article>
  );
}
