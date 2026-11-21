import { useEffect, useRef, useState } from "react";
import { ApiError, api, type SignInRequired } from "../api";
import { ErrorNotice, FormError, LoadingRows, Notice, Tag } from "../components/Bits";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
import { Stepper } from "../components/Stepper";
import { credits, shortHash } from "../format";
import { Link, useRouter } from "../router";
import type { DraftSpec, ProjectDetail, Session, SpecCheck, VersionView } from "../types";
import { useData } from "../useData";
import { emptyDraft, newKey, SpecEditor } from "./guest/SpecEditor";

/** Server drafts and versions refer to claims by id (CLM-001); the editor uses its own keys. */
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
        <TopBar title="Claims and tests" eyebrow={<Link href="/app/projects">Projects</Link>} />
        <LoadingRows />
      </>
    );
  }
  if (value.state === "error") {
    return (
      <>
        <TopBar title="Claims and tests" eyebrow={<Link href="/app/projects">Projects</Link>} />
        <ErrorNotice error={value.error} onRetry={reload} />
      </>
    );
  }
  return <Editor detail={value.data} session={session} onSaved={onSaved} />;
}

function Editor({ detail, session, onSaved }: { detail: ProjectDetail; session: Session; onSaved: () => void }) {
  const { navigate } = useRouter();
  const latest = detail.versions[0];
  const purpose = detail.details?.purpose ?? "";
  const [draft, setDraft] = useState<DraftSpec | null>(() => (latest ? fromVersion(detail, latest) : session.features.ai ? null : { ...emptyDraft(), name: detail.project.name, url: detail.project.url }));
  const [requirements, setRequirements] = useState(purpose);
  const [notes, setNotes] = useState<string | null>(null);
  const [check, setCheck] = useState<SpecCheck | null>(null);
  const [busy, setBusy] = useState<"draft" | "save" | null>(null);
  const [error, setError] = useState<{ message: string; problems?: string[] } | null>(null);
  const [saved, setSaved] = useState<VersionView | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const unchanged = Boolean(latest && check?.hash && check.hash === latest.approvedTestHash);

  useEffect(() => {
    if (!draft) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      api.preview(detail.project.id, { draft }).then(setCheck, (e: ApiError) => setCheck({ ok: false, problems: e.problems.length ? e.problems : [e.message] }));
    }, 450);
    return () => window.clearTimeout(timer.current);
  }, [draft, detail.project.id]);

  const write = async () => {
    setBusy("draft");
    setError(null);
    try {
      const r = await api.draft(detail.project.id, requirements.trim());
      setDraft(toEditor(r.draft));
      setNotes([r.notes, r.pageRead ? null : "The start page could not be read without a browser, so expected texts are best guesses: check them against the live site."].filter(Boolean).join(" ") || null);
      setCheck(r.check);
    } catch (e) {
      const a = e as ApiError;
      setError({ message: a.message, problems: a.problems });
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy("save");
    setError(null);
    try {
      const r = await api.propose(detail.project.id, { draft });
      setSaved(r.version);
      onSaved();
    } catch (e) {
      const a = e as ApiError;
      setError({ message: a.message, problems: a.problems });
    } finally {
      setBusy(null);
    }
  };

  if (saved) {
    return (
      <>
        <TopBar title="Tests saved" eyebrow={<Link href={`/app/projects/${detail.project.id}`}>{detail.project.name}</Link>}>
          <Stepper current="approve" projectId={detail.project.id} done={["project", "tests"]} />
        </TopBar>
        <section className="card" aria-labelledby="saved-h">
          <h2 id="saved-h" className="card-title lg">
            Version {saved.version} is waiting for your approval
          </h2>
          <p style={{ margin: 0, maxWidth: "70ch" }}>
            This version is immutable: its claims and tests are fixed under the fingerprint below. Approving means typing that fingerprint back on a secure page, signed in. Nothing runs until you approve, and later edits become a new version that needs its own approval.
          </p>
          <div className="hash-box" aria-label="Test fingerprint">
            {saved.approvedTestHash}
          </div>
          <div className="tags">
            <Tag>{saved.claims.length} claims</Tag>
            <Tag>{saved.tests.length} tests</Tag>
            {saved.estimate ? <Tag>About {credits(saved.estimate.credits)} credits per run</Tag> : null}
          </div>
          <div className="tags">
            <a className="btn" href={saved.approveUrl ?? `/approve/${detail.project.id}/${saved.version}`}>
              <I.Approvals size={15} aria-hidden="true" /> Review and approve
            </a>
            <Link className="btn ghost" href={`/app/projects/${detail.project.id}`}>
              Back to the project
            </Link>
          </div>
        </section>
      </>
    );
  }

  return (
    <>
      <TopBar title="Claims and tests" eyebrow={<Link href={`/app/projects/${detail.project.id}`}>{detail.project.name}</Link>}>
        <Stepper current="tests" projectId={detail.project.id} done={["project"]} />
      </TopBar>

      {latest ? (
        <Notice icon={<I.Hash size={18} aria-hidden="true" />}>
          Editing starts from version {latest.version} ({latest.status === "approved" ? "approved" : "waiting for approval"}). Saving creates version {latest.version + 1}; version {latest.version} and its results stay as they are.
        </Notice>
      ) : null}

      <div className="split">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", minWidth: 0 }}>
          {session.features.ai || !draft ? (
          <section className="card" aria-labelledby="ai-h">
            <div className="card-head">
              <h2 id="ai-h" className="card-title lg">
                {draft ? "Draft again from the description" : "Draft claims and tests"}
              </h2>
              {!draft ? (
                <button type="button" className="btn ghost sm" onClick={() => setDraft({ ...emptyDraft(), name: detail.project.name, url: detail.project.url })}>
                  <I.Pencil size={14} aria-hidden="true" /> Write them myself
                </button>
              ) : null}
            </div>
            {session.features.ai ? (
              <>
                <label className="field">
                  <span>What the app should do</span>
                  <textarea value={requirements} onChange={(e) => setRequirements(e.target.value)} maxLength={4000} />
                  <span className="hint">Claude reads your live start page and this description, and drafts claims with browser tests. {draft ? "This replaces the tests below." : ""}</span>
                </label>
                <div className="tags">
                  <button type="button" className={draft ? "btn ghost" : "btn"} disabled={busy !== null || requirements.trim().length < 20} onClick={write}>
                    {busy === "draft" ? <span className="spinner" aria-hidden="true" /> : <I.FileText size={15} aria-hidden="true" />}
                    {busy === "draft" ? "Drafting…" : draft ? "Replace with a new draft" : "Draft with Claude"}
                  </button>
                </div>
              </>
            ) : (
              <p className="small" style={{ margin: 0 }}>
                AI drafting isn’t configured on this server (no Claude API key), so write the claims and tests yourself. They follow the same rules either way.
              </p>
            )}
          </section>
          ) : null}

          {draft ? (
            <section className="card" aria-labelledby="edit-h">
              <div className="card-head">
                <h2 id="edit-h" className="card-title lg">
                  Claims and tests
                </h2>
                <span className="small">Exactly what the browser will do</span>
              </div>
              {notes ? (
                <p className="small" style={{ margin: 0 }}>
                  <b style={{ color: "var(--ink)", fontWeight: 600 }}>Note from Claude:</b> {notes}
                </p>
              ) : null}
              <p className="small" style={{ margin: 0 }}>
                A claim is something the app does, in plain words. Each test checks one or more claims: “do” steps are actions, “expect text” steps name text that must be visible afterwards, exactly as written.
              </p>
              <SpecEditor value={draft} onChange={setDraft} maxClaims={30} maxTests={20} maxSteps={12} />
            </section>
          ) : null}
        </div>

        <aside className="card-dark sticky" aria-labelledby="check-h">
          <h2 id="check-h" className="card-title">
            Check and save
          </h2>
          {!draft ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--on-dark-muted)" }}>Draft with Claude or write the tests yourself; the rules check runs as you edit.</p>
          ) : !check ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--on-dark-muted)" }}>Checking…</p>
          ) : check.ok ? (
            <>
              <dl className="kv-list" style={{ color: "var(--on-dark)" }} aria-live="polite">
                <dt style={{ color: "var(--on-dark-muted)" }}>Rules</dt>
                <dd>
                  <I.Check size={13} aria-hidden="true" /> Follows Greenlight’s rules
                </dd>
                <dt style={{ color: "var(--on-dark-muted)" }}>Fingerprint</dt>
                <dd className="mono" title={check.hash}>
                  {shortHash(check.hash)}
                </dd>
                <dt style={{ color: "var(--on-dark-muted)" }}>Size</dt>
                <dd>
                  {check.claims?.length} claims · {check.tests?.length} tests · {check.tests?.reduce((n, t) => n + t.steps.length, 0)} steps
                </dd>
                <dt style={{ color: "var(--on-dark-muted)" }}>Estimate</dt>
                <dd>
                  ~{credits(check.estimate?.credits)} credits per run{check.estimate?.cap != null ? ` (limit ${check.estimate.cap})` : ""}
                </dd>
              </dl>
              {check.warnings?.length ? (
                <ul className="problems" style={{ borderColor: "var(--on-dark)" }}>
                  {check.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </>
          ) : (
            <ul className="problems" style={{ borderColor: "var(--on-dark)" }} aria-live="polite">
              {check.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          )}
          <FormError error={error} />
          <button type="button" className="btn on-dark" disabled={!draft || busy !== null || !check?.ok || unchanged} onClick={save}>
            {busy === "save" ? <span className="spinner" aria-hidden="true" /> : null}
            {latest ? `Save as version ${latest.version + 1}` : "Save version 1"}
          </button>
          <p style={{ margin: 0, fontSize: 12, color: "var(--on-dark-muted)" }}>
            {unchanged ? "These are exactly the tests of version " + latest!.version + "; change something to save a new version." : "Saving doesn’t run anything. You approve the exact tests next."}
          </p>
          <button type="button" className="btn ghost sm" style={{ color: "var(--on-dark)", borderColor: "var(--on-dark-line)" }} onClick={() => navigate(`/app/projects/${detail.project.id}`)}>
            Cancel
          </button>
        </aside>
      </div>
    </>
  );
}
