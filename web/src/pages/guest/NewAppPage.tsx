import { useEffect, useRef, useState } from "react";
import { ApiError, guestApi } from "../../api";
import { Pill } from "../../components/Bits";
import * as I from "../../components/Icons";
import { TopBar } from "../../components/Shell";
import { credits, shortHash } from "../../format";
import { useRouter } from "../../router";
import type { DraftSpec, GuestLimits, SpecCheck } from "../../types";
import { emptyDraft, newKey, SpecEditor } from "./SpecEditor";

type Mode = "ai" | "form";

/** Server drafts refer to claims by CLM ids; the editor uses its own keys. */
function fromServer(d: DraftSpec): DraftSpec {
  const keys = new Map(d.claims.map((c) => [c.id, newKey()]));
  return {
    ...d,
    claims: d.claims.map((c) => ({ id: keys.get(c.id)!, text: c.text })),
    tests: d.tests.map((t) => ({ ...t, claims: t.claims.map((k) => keys.get(k)).filter((k): k is string => Boolean(k)) })),
  };
}

export function NewAppPage({ limits }: { limits: GuestLimits | null }) {
  const { navigate } = useRouter();
  const [mode, setMode] = useState<Mode>(limits?.aiAvailable === false ? "form" : "ai");
  const [name, setName] = useState("");
  const [url, setUrl] = useState("https://");
  const [requirements, setRequirements] = useState("");
  // Without AI, the form is the only way in: open it straight away.
  const [draft, setDraft] = useState<DraftSpec | null>(limits?.aiAvailable === false ? emptyDraft() : null);
  const [notes, setNotes] = useState<string | null>(null);
  const [check, setCheck] = useState<SpecCheck | null>(null);
  const [busy, setBusy] = useState<"draft" | "save" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<number | undefined>(undefined);

  // Live check of the draft (rules, hash, credit estimate) a moment after each edit.
  useEffect(() => {
    if (!draft) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      guestApi.preview({ ...draft, name: draft.name || name || "My app", url: draft.url || url }).then(setCheck, (e: ApiError) => setCheck({ ok: false, problems: e.problems.length ? e.problems : [e.message] }));
    }, 450);
    return () => window.clearTimeout(timer.current);
  }, [draft, name, url]);

  const write = async () => {
    setError(null);
    setBusy("draft");
    try {
      const r = await guestApi.draft({ name: name.trim() || "My app", url: url.trim(), requirements });
      setDraft(fromServer(r.draft));
      setNotes([r.notes, r.pageRead ? null : "The start page could not be read, so expected texts are best guesses: check them against your app."].filter(Boolean).join(" ") || null);
      setCheck(r.check);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const startForm = () => {
    setMode("form");
    if (!draft) setDraft({ ...emptyDraft(), name, url });
  };

  const save = async () => {
    if (!draft) return;
    setError(null);
    setBusy("save");
    try {
      const p = await guestApi.create({ ...draft, name: draft.name || name, url: draft.url || url, source: mode, notes });
      navigate(`/app/try/${p.id}`);
    } catch (e) {
      const err = e as ApiError;
      setError(err.problems?.length ? `${err.message} ${err.problems.join(" ")}` : err.message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <TopBar title="Test your app" eyebrow="Guest workspace · nothing to sign up for">
        <Pill form="outline" icon={<I.Play size={14} />} title={`${limits?.runsLeft ?? 0} demo checks left`} sub="Free · no credits are spent" />
      </TopBar>

      <section className="card" aria-labelledby="app-h">
        <div className="card-head">
          <h2 id="app-h" className="card-title lg">
            1. Your app
          </h2>
          <div className="seg" role="group" aria-label="How to write the tests">
            <button type="button" aria-pressed={mode === "ai"} disabled={limits?.aiAvailable === false} onClick={() => setMode("ai")}>
              Describe it (AI)
            </button>
            <button type="button" aria-pressed={mode === "form"} onClick={startForm}>
              Write tests myself
            </button>
          </div>
        </div>
        <div className="form-grid">
          <label className="field">
            <span>App name</span>
            <input id="app-name" value={draft?.name ?? name} onChange={(e) => (draft ? setDraft({ ...draft, name: e.target.value }) : setName(e.target.value))} placeholder="e.g. Watchdog" maxLength={80} />
          </label>
          <label className="field">
            <span>Public address (your live site)</span>
            <input id="app-url" type="url" inputMode="url" value={draft?.url ?? url} onChange={(e) => (draft ? setDraft({ ...draft, url: e.target.value }) : setUrl(e.target.value))} placeholder="https://your-app.example.com/" />
          </label>
        </div>
        {mode === "ai" && !draft ? (
          <>
            <label className="field">
              <span>What does the app do? Plain English is fine.</span>
              <textarea
                id="app-requirements"
                value={requirements}
                maxLength={4000}
                onChange={(e) => setRequirements(e.target.value)}
                placeholder={"e.g. Users paste a link or wallet address and Watchdog says whether it is dangerous. A demo page shows a simulated wallet being protected. The threat memory page lists verified attackers."}
              />
              <span className="hint">
                Claude reads your start page and writes claims and tests from this. {limits ? `${limits.aiLeft} of ${limits.aiPerGuest} AI drafts left.` : ""}
              </span>
            </label>
            <div className="tags">
              <button type="button" className="btn" disabled={busy !== null || requirements.trim().length < 20 || !/^https?:\/\/.+\..+/.test(url)} onClick={write}>
                {busy === "draft" ? <span className="spinner" aria-hidden="true" /> : <I.FileText size={15} aria-hidden="true" />}
                {busy === "draft" ? "Writing tests…" : "Write my tests"}
              </button>
              <button type="button" className="btn ghost" onClick={startForm}>
                Or write them myself
              </button>
            </div>
          </>
        ) : null}
        {error ? (
          <div className="notice" role="alert">
            <I.CircleAlert size={18} aria-hidden="true" />
            <p>{error}</p>
          </div>
        ) : null}
      </section>

      {draft ? (
        <section className="card" aria-labelledby="tests-edit-h">
          <div className="card-head">
            <h2 id="tests-edit-h" className="card-title lg">
              2. Claims and tests
            </h2>
            {mode === "ai" ? (
              <button type="button" className="btn ghost sm" onClick={() => setDraft(null)}>
                Start over
              </button>
            ) : null}
          </div>
          {notes ? (
            <p className="small" style={{ margin: 0 }}>
              <b style={{ color: "var(--ink)", fontWeight: 600 }}>Note from the AI:</b> {notes}
            </p>
          ) : null}
          <p className="small" style={{ margin: 0 }}>
            “Do” steps are actions. “Expect text” steps name text that must be on the page, exactly as it appears. Every test needs at least one.
          </p>
          <SpecEditor value={draft} onChange={setDraft} maxClaims={limits?.maxClaims ?? 8} maxTests={limits?.maxTests ?? 4} />
        </section>
      ) : null}

      {draft ? (
        <section className="card-dark" aria-labelledby="save-h">
          <div className="card-head">
            <h2 id="save-h" className="card-title">
              3. Check and save
            </h2>
            {check?.estimate ? (
              <span style={{ fontSize: 12, color: "var(--on-dark-muted)" }}>
                A real run would cost ~{credits(check.estimate.credits)} credits · the demo spends 0
              </span>
            ) : null}
          </div>
          {check && !check.ok ? (
            <ul className="problems" style={{ borderColor: "var(--on-dark)" }} aria-live="polite">
              {check.problems.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          ) : check?.ok ? (
            <p style={{ margin: 0, fontSize: 13, color: "var(--on-dark-muted)" }} aria-live="polite">
              <I.Check size={14} aria-hidden="true" /> Follows Greenlight’s rules. Fingerprint <span className="mono">{shortHash(check.hash)}</span>, {check.tests?.length} tests,{" "}
              {check.tests?.reduce((n, t) => n + t.steps.length, 0)} steps.
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 13, color: "var(--on-dark-muted)" }}>Checking…</p>
          )}
          <div className="tags">
            <button type="button" className="btn on-dark" disabled={busy !== null || !check?.ok} onClick={save}>
              {busy === "save" ? <span className="spinner" aria-hidden="true" /> : null}
              Save app
            </button>
          </div>
          <p style={{ margin: 0, fontSize: 12, color: "var(--on-dark-muted)" }}>Saving doesn’t run anything. You review and approve the tests next, then run a free demo check.</p>
        </section>
      ) : null}
    </>
  );
}
