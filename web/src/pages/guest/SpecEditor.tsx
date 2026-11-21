import type { DraftSpec, DraftStep, DraftTest } from "../../types";
import * as I from "../../components/Icons";

let seq = 0;
export const newKey = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

export function emptyDraft(): DraftSpec {
  const c = newKey();
  return {
    name: "",
    url: "https://",
    description: null,
    claims: [{ id: c, text: "" }],
    tests: [
      {
        title: "",
        claims: [c],
        steps: [
          { name: "Open the app", kind: "do", text: "Open the start page." },
          { name: "See the result", kind: "expect_text", text: "" },
        ],
      },
    ],
  };
}

/** Editable claims and tests. Every change goes back up through onChange (a new object). */
export function SpecEditor({ value, onChange, maxClaims, maxTests, maxSteps = 8 }: { value: DraftSpec; onChange: (v: DraftSpec) => void; maxClaims: number; maxTests: number; maxSteps?: number }) {
  const set = (patch: Partial<DraftSpec>) => onChange({ ...value, ...patch });
  const setTest = (i: number, t: DraftTest) => set({ tests: value.tests.map((x, n) => (n === i ? t : x)) });
  const setStep = (i: number, j: number, s: DraftStep) => setTest(i, { ...value.tests[i]!, steps: value.tests[i]!.steps.map((x, n) => (n === j ? s : x)) });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section className="editor-block" aria-labelledby="claims-edit">
        <div className="card-head">
          <h3 id="claims-edit" className="card-title" style={{ fontSize: 15 }}>
            Claims <span className="small">· what the app does, in plain words</span>
          </h3>
          <button type="button" className="btn ghost sm" disabled={value.claims.length >= maxClaims} onClick={() => set({ claims: [...value.claims, { id: newKey(), text: "" }] })}>
            Add claim
          </button>
        </div>
        {value.claims.map((c, i) => (
          <div key={c.id} className="editor-row">
            <span className="tag" style={{ marginTop: 9 }}>
              CLM-{String(i + 1).padStart(3, "0")}
            </span>
            <label className="field" style={{ flex: "1 1 300px" }}>
              <span className="sr-only">Claim {i + 1}</span>
              <input value={c.text} placeholder="e.g. A pasted phishing link is rated Dangerous." onChange={(e) => set({ claims: value.claims.map((x) => (x.id === c.id ? { ...x, text: e.target.value } : x)) })} />
            </label>
            <button
              type="button"
              className="icon-x"
              aria-label={`Remove claim ${i + 1}`}
              disabled={value.claims.length <= 1}
              onClick={() => set({ claims: value.claims.filter((x) => x.id !== c.id), tests: value.tests.map((t) => ({ ...t, claims: t.claims.filter((k) => k !== c.id) })) })}
            >
              <I.X size={15} aria-hidden="true" />
            </button>
          </div>
        ))}
      </section>

      {value.tests.map((t, i) => (
        <section key={i} className="editor-block" aria-label={`Test ${i + 1}`}>
          <div className="editor-row">
            <label className="field">
              <span>Test {i + 1} title</span>
              <input value={t.title} placeholder="e.g. Check a known phishing link" onChange={(e) => setTest(i, { ...t, title: e.target.value })} />
            </label>
            <button type="button" className="icon-x" style={{ marginTop: 26 }} aria-label={`Remove test ${i + 1}`} disabled={value.tests.length <= 1} onClick={() => set({ tests: value.tests.filter((_, n) => n !== i) })}>
              <I.X size={15} aria-hidden="true" />
            </button>
          </div>
          <div role="group" aria-label="Claims this test checks" className="tags">
            <span className="small" style={{ alignSelf: "center" }}>
              Checks:
            </span>
            {value.claims.map((c, n) => (
              <label key={c.id} className="check-chip">
                <input
                  type="checkbox"
                  checked={t.claims.includes(c.id)}
                  onChange={(e) => setTest(i, { ...t, claims: e.target.checked ? [...t.claims, c.id] : t.claims.filter((k) => k !== c.id) })}
                />
                CLM-{String(n + 1).padStart(3, "0")}
              </label>
            ))}
          </div>
          <ol className="list" style={{ gap: 8 }}>
            {t.steps.map((s, j) => (
              <li key={j} className="step-edit">
                <span className="step-n" aria-hidden="true" style={s.kind === "expect_text" ? { background: "var(--ink)", color: "var(--on-dark)", borderColor: "var(--ink)" } : undefined}>
                  {j + 1}
                </span>
                <select aria-label={`Step ${j + 1} type`} value={s.kind} onChange={(e) => setStep(i, j, { ...s, kind: e.target.value as DraftStep["kind"] })}>
                  <option value="do">Do (an action)</option>
                  <option value="expect_text">Expect text</option>
                </select>
                <input aria-label={`Step ${j + 1} name`} value={s.name} placeholder="Step name" onChange={(e) => setStep(i, j, { ...s, name: e.target.value })} />
                <input
                  aria-label={`Step ${j + 1} ${s.kind === "do" ? "action" : "exact visible text"}`}
                  className={s.kind === "expect_text" ? "mono" : undefined}
                  value={s.text}
                  placeholder={s.kind === "do" ? 'e.g. Click the "Check a link" button.' : "Exact text on the page, e.g. Dangerous"}
                  onChange={(e) => setStep(i, j, { ...s, text: e.target.value })}
                />
                <button type="button" className="icon-x" aria-label={`Remove step ${j + 1}`} disabled={t.steps.length <= 1} onClick={() => setTest(i, { ...t, steps: t.steps.filter((_, n) => n !== j) })}>
                  <I.X size={15} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ol>
          <div className="tags">
            <button type="button" className="btn ghost sm" disabled={t.steps.length >= maxSteps} onClick={() => setTest(i, { ...t, steps: [...t.steps, { name: `Step ${t.steps.length + 1}`, kind: "do", text: "" }] })}>
              Add action
            </button>
            <button type="button" className="btn ghost sm" disabled={t.steps.length >= maxSteps} onClick={() => setTest(i, { ...t, steps: [...t.steps, { name: "Check the page", kind: "expect_text", text: "" }] })}>
              Add expected text
            </button>
          </div>
        </section>
      ))}
      <div>
        <button
          type="button"
          className="btn ghost"
          disabled={value.tests.length >= maxTests}
          onClick={() => set({ tests: [...value.tests, { title: "", claims: value.claims[0] ? [value.claims[0].id] : [], steps: [{ name: "Open the app", kind: "do", text: "Open the start page." }, { name: "See the result", kind: "expect_text", text: "" }] }] })}
        >
          Add test
        </button>
      </div>
    </div>
  );
}
