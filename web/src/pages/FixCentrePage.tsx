import { useEffect, useRef, useState } from "react";
import { ApiError, api, type SignInRequired } from "../api";
import { AgentWait } from "../components/AgentWait";
import { CodeBlock, Empty, ErrorNotice, FormError, LoadingRows, Notice, Tag } from "../components/Bits";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
import { formatDateTime, relative } from "../format";
import { FIX_STATUS_LABEL } from "../plain";
import { Link } from "../router";
import type { AgentRequest, FixItem, RunDetail, Session } from "../types";
import { useData } from "../useData";

const SUPPORT: Record<string, string> = {
  supported_by_evidence: "Supported by the evidence",
  plausible_guess: "A plausible guess: check it",
  unknown: "Not determined",
};
const QUESTIONS = ["Why did this happen?", "Could another part of the application be responsible?", "Explain the proposed fix.", "Is there another way to solve this?", "What might this change affect?"];

export function FixCentrePage({ onSignIn }: { onSignIn: (e: SignInRequired) => void }) {
  const { value, reload } = useData(() => api.fixes(), [], { onSignIn, refreshMs: 30_000 });
  const items = value.state === "ready" ? value.data : [];
  const open = items.filter((f) => !["fixed", "dismissed"].includes(f.status));
  const done = items.filter((f) => ["fixed", "dismissed"].includes(f.status));
  return (
    <>
      <TopBar title="Fix Centre" eyebrow="Every failed test, explained, with a way to fix it" />
      {value.state === "loading" ? <LoadingRows /> : null}
      {value.state === "error" ? <ErrorNotice error={value.error} onRetry={reload} /> : null}
      {value.state === "ready" && !items.length ? (
        <section className="card">
          <Empty title="Nothing to fix yet">
            <span>When a test doesn't work, open it from the results and it appears here with an explanation and a suggested fix.</span>
            <Link href="/app/records" className="btn ghost sm">
              See test results
            </Link>
          </Empty>
        </section>
      ) : null}
      {[
        ["Open", open],
        ["Resolved", done],
      ].map(([title, list]) =>
        (list as FixItem[]).length ? (
          <section key={title as string} className="card" aria-label={title as string}>
            <h2 className="card-title lg">{title as string}</h2>
            <ul className="list">
              {(list as FixItem[]).map((f) => (
                <li key={f.id} className="list-row">
                  <span className={`outcome ${f.status === "fixed" ? "working" : f.status === "dismissed" ? "could_not_verify" : "not_working"}`}>{FIX_STATUS_LABEL[f.status]}</span>
                  <div className="list-main">
                    <b>
                      <Link href={`/app/fixes/${f.id}`}>{f.test?.title ?? f.testFile}</Link>
                    </b>
                    <span>
                      {f.project?.name} · opened {relative(f.createdAt)}
                      {f.messageCount ? ` · ${f.messageCount} messages` : ""}
                    </span>
                  </div>
                  <Link href={`/app/fixes/${f.id}`} className="btn ghost sm">
                    Open <I.ChevronRight size={14} aria-hidden="true" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null,
      )}
    </>
  );
}

export function FixPage({ id, session, onSignIn }: { id: string; session: Session; onSignIn: (e: SignInRequired) => void }) {
  const { value, reload } = useData(() => api.fix(id), [id], { onSignIn, refreshMs: 20_000 });
  const [fix, setFix] = useState<FixItem | null>(null);
  useEffect(() => {
    if (value.state === "ready") setFix(value.data);
  }, [value]);
  if (value.state === "loading" && !fix) {
    return (
      <>
        <TopBar title="Fix Centre" eyebrow={<Link href="/app/fixes">Fix Centre</Link>} />
        <LoadingRows />
      </>
    );
  }
  if (value.state === "error" && !fix) {
    return (
      <>
        <TopBar title="Fix Centre" eyebrow={<Link href="/app/fixes">Fix Centre</Link>} />
        <ErrorNotice error={value.error} onRetry={reload} />
      </>
    );
  }
  return fix ? <Fix fix={fix} setFix={setFix} session={session} /> : null;
}

function Fix({ fix, setFix, session }: { fix: FixItem; setFix: (f: FixItem) => void; session: Session }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string } | null>(null);
  const ai = session.features.ai;
  const agentMode = session.features.aiMode !== "server";
  const connected = Boolean(session.features.agentConnected);
  const [waiting, setWaiting] = useState<AgentRequest | null>(null);
  // Requests for this failure still waiting for the agent (e.g. after a reload) are picked up again.
  useEffect(() => {
    if (!agentMode) return;
    api.agentRequests(fix.projectId).then((rs) => {
      const open = rs.find((r) => r.fixId === fix.id && r.kind !== "answer_question" && (r.status === "queued" || r.status === "claimed"));
      if (open) setWaiting(open);
    }, () => {});
  }, [agentMode, fix.projectId, fix.id]);
  const refresh = async () => {
    setWaiting(null);
    setFix(await api.fix(fix.id));
  };
  const e = fix.explanation;
  const act = async (action: "explain" | "proposal" | "send" | "dismiss" | "reopen") => {
    setBusy(action);
    setError(null);
    try {
      const r = await api.fixAction(fix.id, action);
      setFix(r.fix);
      if (r.agentRequest) setWaiting(r.agentRequest);
    } catch (err) {
      setError({ message: (err as ApiError).message });
    } finally {
      setBusy(null);
    }
  };
  const rerun = `/app/projects/${fix.projectId}/verify?tests=${encodeURIComponent(fix.testFile)}`;
  return (
    <>
      <TopBar
        title={fix.test?.title ?? fix.testFile}
        eyebrow={
          <>
            <Link href="/app/fixes">Fix Centre</Link>
            <I.ChevronRight size={13} aria-hidden="true" />
            <Link href={`/app/projects/${fix.projectId}`}>{fix.project?.name ?? "Project"}</Link>
          </>
        }
      >
        <span className={`outcome ${fix.status === "fixed" ? "working" : "not_working"}`}>{FIX_STATUS_LABEL[fix.status]}</span>
        <Link href={rerun} className="btn ghost">
          <I.RefreshCw size={14} aria-hidden="true" /> Re-run this test
        </Link>
      </TopBar>

      <div className="split split-chat">
        <div style={{ display: "flex", flexDirection: "column", gap: "var(--gap)", minWidth: 0 }}>
          <section className="card" aria-labelledby="explain-h">
            <div className="card-head">
              <h2 id="explain-h" className="card-title lg">
                What went wrong
              </h2>
              <button type="button" className="btn ghost sm" onClick={() => act("explain")} disabled={busy !== null}>
                {busy === "explain" ? <span className="spinner" aria-hidden="true" /> : <I.RefreshCw size={14} aria-hidden="true" />} {agentMode ? (fix.explanation?.source === "facts_only" ? "Ask my agent to explain" : "Ask my agent again") : "Explain again"}
              </button>
            </div>
            {e ? (
              <dl className="kv-list">
                <dt>What Greenlight tested</dt>
                <dd>{e.whatWeTested}</dd>
                <dt>What actually happened</dt>
                <dd>{e.whatHappened}</dd>
                <dt>What should have happened</dt>
                <dd>{e.whatShouldHaveHappened}</dd>
                <dt>Likely cause</dt>
                <dd>
                  {e.likelyCause} <Tag form={e.causeSupport === "supported_by_evidence" ? "solid" : "dashed"}>{SUPPORT[e.causeSupport]}</Tag>
                </dd>
                <dt>Suggested solution</dt>
                <dd>{e.suggestedFix}</dd>
                {e.otherPossibilities?.length ? (
                  <>
                    <dt>Also possible</dt>
                    <dd>{e.otherPossibilities.join(" · ")}</dd>
                  </>
                ) : null}
              </dl>
            ) : (
              <p className="small">No explanation yet.</p>
            )}
            {e?.source === "facts_only" ? <p className="small" style={{ margin: 0 }}>These are the facts from the run. {agentMode ? "Ask your coding agent for a likely cause and a fix." : ""}</p> : null}
            {e?.source === "agent" ? <p className="small" style={{ margin: 0 }}>Explained by your coding agent.</p> : null}
            {fix.explanationError ? <p className="small" style={{ margin: 0 }}>The AI explanation failed ({fix.explanationError}); the facts above come straight from the run.</p> : null}
          </section>

          <Evidence fix={fix} />

          <section className="card" aria-labelledby="impl-h">
            <h2 id="impl-h" className="card-title lg">
              Fix it
            </h2>
            <ol className="stepper" aria-label="Fix steps">
              {[
                ["Explain", Boolean(e)],
                ["Suggest", Boolean(e?.suggestedFix)],
                ["Generate fix", Boolean(fix.proposal)],
                ["Send to coding agent", ["sent_to_agent", "agent_working", "agent_reported", "fixed", "still_failing"].includes(fix.status)],
                ["Verify again", fix.status === "fixed"],
              ].map(([label, done], i) => (
                <li key={label as string} className={done ? "done" : undefined}>
                  <span className="step-n" aria-hidden="true">
                    {i + 1}
                  </span>
                  {label as string}
                </li>
              ))}
            </ol>
            {!fix.proposal ? (
              <>
                <p style={{ margin: 0, fontSize: 13.5 }}>Generate an implementation proposal: the change to make, where to look, what it might affect, and a task written for your coding agent. Nothing in your code changes.</p>
                <div>
                  <button type="button" className="btn" onClick={() => act("proposal")} disabled={busy !== null || !ai || waiting !== null}>
                    {busy === "proposal" ? <span className="spinner" aria-hidden="true" /> : <I.FileText size={15} aria-hidden="true" />} {agentMode ? "Ask my agent to generate a fix" : "Generate fix"}
                  </button>
                </div>
              </>
            ) : (
              <Proposal fix={fix} />
            )}
            {fix.proposal && fix.status === "task_ready" ? (
              <div className="confirm-box">
                <b style={{ fontWeight: 600 }}>Send this task to your coding agent</b>
                <p style={{ margin: 0, fontSize: 13 }}>Greenlight doesn't change your code. Your own coding agent (Claude Code) picks the task up through Greenlight's MCP connection, makes the change in your repository and reports back with its commit.</p>
                <div className="tags">
                  <button type="button" className="btn" onClick={() => act("send")} disabled={busy !== null}>
                    {busy === "send" ? <span className="spinner" aria-hidden="true" /> : <I.Send size={15} aria-hidden="true" />} Send to coding agent
                  </button>
                  <Link href="/app/integrations" className="btn ghost">
                    Connect Claude Code
                  </Link>
                </div>
              </div>
            ) : null}
            <AgentStatus fix={fix} rerun={rerun} />
            {waiting ? <AgentWait request={waiting} connected={connected} onDone={refresh} onClear={() => setWaiting(null)} /> : null}
            <FormError error={error} />
            <div className="tags">
              {fix.status === "dismissed" ? (
                <button type="button" className="btn ghost sm" onClick={() => act("reopen")} disabled={busy !== null}>
                  Reopen
                </button>
              ) : fix.status !== "fixed" ? (
                <button type="button" className="btn ghost sm" onClick={() => act("dismiss")} disabled={busy !== null}>
                  Dismiss (the test is wrong, or this won't be fixed)
                </button>
              ) : null}
            </div>
          </section>
        </div>
        <Conversation fix={fix} setFix={setFix} ai={ai} agentMode={agentMode} connected={connected} />
      </div>
    </>
  );
}

function Evidence({ fix }: { fix: FixItem }) {
  const [run, setRun] = useState<RunDetail | null>(null);
  useEffect(() => {
    api.run(fix.projectId, fix.recordId).then(setRun, () => setRun(null));
  }, [fix.projectId, fix.recordId]);
  const images = run?.files.filter((f) => f.kind === "image") ?? [];
  const t = fix.test;
  return (
    <section className="card" aria-labelledby="ev-h">
      <div className="card-head">
        <h2 id="ev-h" className="card-title lg">
          Evidence
        </h2>
        <Link href={`/app/projects/${fix.projectId}/runs/${fix.recordId}`} className="small">
          Full results and files
        </Link>
      </div>
      <ol className="step-list" style={{ padding: 0 }}>
        {(t?.steps ?? []).map((s, n) => (
          <li key={n} className={`step ${s.kind === "expect_text" ? "expect" : ""}`} style={t?.failedStep?.index === n + 1 ? { outline: "1.5px solid var(--ink)", borderRadius: 14, padding: 6 } : undefined}>
            <span className="step-n" aria-hidden="true">
              {n + 1}
            </span>
            <div>
              <div className="step-name">
                {s.kind === "expect_text" ? "Page should show" : "Greenlight does"}
                {t?.failedStep?.index === n + 1 ? " · stopped here" : ""}
              </div>
              <div className="step-text">{s.kind === "expect_text" ? `“${s.text}”` : s.text}</div>
            </div>
          </li>
        ))}
      </ol>
      {t?.failureMessage ? (
        <p style={{ margin: 0, fontSize: 13 }}>
          <b style={{ fontWeight: 500 }}>What the browser reported:</b> {t.failureMessage}
        </p>
      ) : null}
      {images.length ? (
        <div className="shots">
          {images.map((f) => (
            <a key={f.name} className="shot" href={api.fileUrl(fix.projectId, fix.recordId, f.name)} target="_blank" rel="noopener noreferrer">
              <img src={api.fileUrl(fix.projectId, fix.recordId, f.name)} alt={`Screenshot ${f.name}`} loading="lazy" />
              <span className="mono">{f.name}</span>
            </a>
          ))}
        </div>
      ) : (
        <p className="small" style={{ margin: 0 }}>
          The browser's screenshots and recording are in the run's evidence pack (download it from the full results). The run was on {fix.run?.commitSource === "branch_head_unconfirmed" ? "the latest code on the branch (unconfirmed)" : "the code version your live site reported"}
          {fix.run?.commit ? ` (${fix.run.commit.slice(0, 7)})` : ""}, {formatDateTime(fix.run?.startedAt)}.
        </p>
      )}
    </section>
  );
}

function Proposal({ fix }: { fix: FixItem }) {
  const p = fix.proposal!;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ margin: 0 }}>
        <b style={{ fontWeight: 600 }}>Proposed fix:</b> {p.summary}
      </p>
      <dl className="kv-list">
        <dt>Steps</dt>
        <dd>
          <ol style={{ margin: 0, paddingLeft: 18 }}>
            {p.steps.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        </dd>
        <dt>Where to look</dt>
        <dd>{p.whereToLook.join(" · ") || "—"} <span className="small">(suggestions, not certainties)</span></dd>
        <dt>Might affect</dt>
        <dd>{p.risks.join(" · ") || "—"}</dd>
        <dt>How to confirm</dt>
        <dd>{p.howToVerify}</dd>
      </dl>
      <CodeBlock title="Task for your coding agent" code={p.agentTask} />
    </div>
  );
}

function AgentStatus({ fix, rerun }: { fix: FixItem; rerun: string }) {
  if (["open", "task_ready", "dismissed"].includes(fix.status)) return null;
  return (
    <div className="confirm-box" aria-live="polite">
      {fix.status === "sent_to_agent" ? (
        <>
          <b style={{ fontWeight: 600 }}>Waiting for your coding agent</b>
          <p style={{ margin: 0, fontSize: 13 }}>
            In Claude Code (connected to Greenlight with an agent token), ask: <span className="mono">Get my Greenlight fix tasks and fix {fix.id}</span>. Greenlight will show here when the agent picks it up and when it reports back.
          </p>
        </>
      ) : null}
      {fix.status === "agent_working" ? <b style={{ fontWeight: 600 }}>Your coding agent picked up the task and is working on it.</b> : null}
      {fix.agentReport ? (
        <>
          <b style={{ fontWeight: 600 }}>{fix.status === "fixed" ? "Fix confirmed" : "Your coding agent reports the fix is done"}</b>
          <p style={{ margin: 0, fontSize: 13 }}>
            “{fix.agentReport.summary}” · commit <span className="mono">{fix.agentReport.commit.slice(0, 7)}</span> · {formatDateTime(fix.agentReport.at)}
          </p>
        </>
      ) : null}
      {fix.status === "agent_reported" ? (
        <>
          <p style={{ margin: 0, fontSize: 13 }}>Not confirmed yet: once the change is deployed, re-run this test. It's marked fixed only if it passes in the browser.</p>
          <div>
            <Link href={rerun} className="btn">
              <I.RefreshCw size={14} aria-hidden="true" /> Re-run this test
            </Link>
          </div>
        </>
      ) : null}
      {fix.status === "fixed" ? <p style={{ margin: 0, fontSize: 13 }}>A new browser run passed this test{fix.resolvedBy?.at ? ` on ${formatDateTime(fix.resolvedBy.at)}` : ""}.</p> : null}
      {fix.status === "still_failing" ? <p style={{ margin: 0, fontSize: 13 }}>The test still fails after the reported fix. Ask why below, generate a new fix, or send it again.</p> : null}
    </div>
  );
}

function Conversation({ fix, setFix, ai, agentMode, connected }: { fix: FixItem; setFix: (f: FixItem) => void; ai: boolean; agentMode: boolean; connected: boolean }) {
  const [waiting, setWaiting] = useState<AgentRequest | null>(null);
  useEffect(() => {
    if (!agentMode) return;
    api.agentRequests(fix.projectId).then((rs) => {
      const open = rs.find((r) => r.fixId === fix.id && r.kind === "answer_question" && (r.status === "queued" || r.status === "claimed"));
      if (open) setWaiting(open);
    }, () => {});
  }, [agentMode, fix.projectId, fix.id]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string } | null>(null);
  const end = useRef<HTMLDivElement | null>(null);
  const msgs = fix.messages ?? [];
  useEffect(() => {
    end.current?.scrollIntoView({ block: "nearest" });
  }, [msgs.length]);
  const ask = async (q: string) => {
    if (!q.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.askFix(fix.id, q.trim());
      setFix(r.fix);
      if (r.agentRequest) setWaiting(r.agentRequest);
      setText("");
    } catch (e) {
      setError({ message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <aside className="card sticky" aria-labelledby="chat-h" style={{ gap: 12 }}>
      <h2 id="chat-h" className="card-title lg">
        <I.MessageSquare size={17} aria-hidden="true" /> Ask about this failure
      </h2>
      {!ai ? (
        <Notice>The conversation needs AI, which isn't configured on this server.</Notice>
      ) : (
        <>
          <div className="chat" style={{ maxHeight: 460, overflowY: "auto" }}>
            {msgs.length === 0 ? (
              <p className="small" style={{ margin: 0 }}>
                {agentMode
                  ? "Your coding agent answers, with this failure's details and the conversation so far. It can also look at your code."
                  : "Claude knows this test, what happened, and what Greenlight learned about your app. Ask anything about this failure."}
              </p>
            ) : null}
            {msgs.map((m, i) => (
              <div key={i} className={`msg ${m.role}`}>
                {m.content}
              </div>
            ))}
            {waiting ? (
              <AgentWait
                request={waiting}
                connected={connected}
                onDone={async () => {
                  setWaiting(null);
                  setFix(await api.fix(fix.id));
                }}
                onClear={() => setWaiting(null)}
              />
            ) : null}
            {busy ? (
              <div className="msg assistant" aria-live="polite">
                <span className="spinner" aria-hidden="true" /> Thinking…
              </div>
            ) : null}
            <div ref={end} />
          </div>
          <div className="suggestions">
            {QUESTIONS.map((q) => (
              <button key={q} type="button" onClick={() => ask(q)} disabled={busy}>
                {q}
              </button>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(text);
            }}
            style={{ display: "flex", gap: 8 }}
          >
            <label className="field" style={{ flex: 1 }}>
              <span className="sr-only">Your question</span>
              <input value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder="Ask a follow-up question" />
            </label>
            <button type="submit" className="btn" disabled={busy || !text.trim()} aria-label="Send question">
              <I.Send size={15} aria-hidden="true" />
            </button>
          </form>
          <FormError error={error} />
        </>
      )}
    </aside>
  );
}
