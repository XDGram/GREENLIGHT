import { useEffect, useState } from "react";
import { api } from "../api";
import * as I from "./Icons";
import { Link } from "../router";
import type { AgentRequest } from "../types";

const WHAT: Record<string, string> = {
  understand: "compare your description with what Greenlight found",
  draft_plan: "draft a test plan",
  revise_plan: "revise the test plan",
  explain_failure: "explain this failure",
  answer_question: "answer your question",
  propose_fix: "prepare a fix proposal",
};

/**
 * A request waiting for the developer's own coding agent (Claude Code over MCP). Polls until the
 * agent answers, then hands the finished request back. Greenlight itself calls no AI here.
 */
export function AgentWait({ request, connected, onDone, onClear }: { request: AgentRequest; connected: boolean; onDone: (r: AgentRequest) => void; onClear: () => void }) {
  const [r, setR] = useState(request);
  useEffect(() => {
    if (r.status === "done" || r.status === "failed" || r.status === "cancelled") return;
    const t = window.setInterval(async () => {
      try {
        const next = await api.agentRequest(r.id);
        setR(next);
        if (next.status === "done") onDone(next);
      } catch {
        // keep waiting; a passing network error is not an answer
      }
    }, 3000);
    return () => window.clearInterval(t);
  }, [r.id, r.status, onDone]);

  if (r.status === "failed") {
    return (
      <div className="confirm-box" role="status">
        <b style={{ fontWeight: 600 }}>Your coding agent couldn't do this</b>
        <p style={{ margin: 0, fontSize: 13 }}>{r.error}</p>
        <div>
          <button type="button" className="btn ghost sm" onClick={onClear}>
            OK
          </button>
        </div>
      </div>
    );
  }
  if (r.status === "done" || r.status === "cancelled") return null;
  return (
    <div className="confirm-box agent-wait" role="status" aria-live="polite">
      <b style={{ fontWeight: 600, display: "flex", alignItems: "center", gap: 8 }}>
        <span className="spinner" aria-hidden="true" />
        {r.status === "claimed" ? `Your coding agent is working on it (${WHAT[r.kind]})` : `Waiting for your coding agent to ${WHAT[r.kind]}`}
      </b>
      {connected ? (
        <p style={{ margin: 0, fontSize: 13 }}>
          In Claude Code, connected to Greenlight, say: <span className="mono">Handle my Greenlight requests</span>. Its answer appears here by itself, for you to review. It runs in Claude Code on your machine, with your own Claude account.
        </p>
      ) : (
        <p style={{ margin: 0, fontSize: 13 }}>
          No coding agent is connected yet. <Link href="/app/integrations">Connect Claude Code</Link> (a two-minute setup with an agent token), then ask it to handle your Greenlight requests.
        </p>
      )}
      <div>
        <button
          type="button"
          className="btn ghost sm"
          onClick={async () => {
            await api.cancelAgentRequest(r.id).catch(() => {});
            onClear();
          }}
        >
          <I.X size={13} aria-hidden="true" /> Cancel
        </button>
      </div>
    </div>
  );
}
