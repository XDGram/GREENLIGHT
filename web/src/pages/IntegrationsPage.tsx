import { useState } from "react";
import { ApiError, api, type SignInRequired } from "../api";
import { CodeBlock, CopyButton, Empty, ErrorNotice, FormError, LoadingRows, Notice, Tag } from "../components/Bits";
import * as I from "../components/Icons";
import { TopBar } from "../components/Shell";
import { formatDateTime } from "../format";
import type { ApiToken, Integrations } from "../types";
import { useData } from "../useData";

export function IntegrationsPage({ onSignIn }: { onSignIn: (e: SignInRequired) => void }) {
  const info = useData(() => api.integrations(), [], { onSignIn, refreshMs: 120_000 });
  const tokens = useData(() => api.tokens(), [], { onSignIn, refreshMs: 120_000 });
  const [fresh, setFresh] = useState<{ token: string; label: string } | null>(null);

  return (
    <>
      <TopBar title="Integrations" eyebrow="Claude API · Claude Code · MCP" />
      {info.value.state === "loading" ? <LoadingRows /> : null}
      {info.value.state === "error" ? <ErrorNotice error={info.value.error} onRetry={info.reload} /> : null}
      {info.value.state === "ready" ? (
        <>
          <ClaudeApi i={info.value.data} />
          <ClaudeCode i={info.value.data} token={fresh?.token ?? null} />
          <Mcp i={info.value.data} token={fresh?.token ?? null} />
        </>
      ) : null}
      <Tokens
        tokens={tokens.value.state === "ready" ? tokens.value.data : null}
        error={tokens.value.state === "error" ? tokens.value.error : null}
        reload={() => {
          void tokens.reload();
          void info.reload();
        }}
        fresh={fresh}
        onCreated={setFresh}
      />
    </>
  );
}

function ClaudeApi({ i }: { i: Integrations }) {
  return (
    <section className="card" aria-labelledby="capi-h">
      <div className="card-head">
        <h2 id="capi-h" className="card-title lg">
          Claude API
        </h2>
        <Tag form={i.claudeApi.configured ? "solid" : "dashed"}>{i.claudeApi.configured ? "Connected" : "Not configured"}</Tag>
      </div>
      <p style={{ margin: 0, maxWidth: "75ch" }}>{i.claudeApi.usedFor}</p>
      <dl className="kv-list">
        <dt>Status</dt>
        <dd>{i.claudeApi.configured ? "The server has an API key. It is stored only in the server’s secret settings and never sent to browsers." : "No API key is set on the server. Claims and tests can still be written by hand."}</dd>
        <dt>Model</dt>
        <dd className="mono">{i.claudeApi.model ?? "—"}</dd>
      </dl>
    </section>
  );
}

function ClaudeCode({ i, token }: { i: Integrations; token: string | null }) {
  const api = i.claudeCode.apiUrl;
  const hook = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "node ./node_modules/greenlight/bin/greenlight-stop-hook.js", timeout: 3600 }] }] } }, null, 2);
  return (
    <section className="card" aria-labelledby="cc-h">
      <div className="card-head">
        <h2 id="cc-h" className="card-title lg">
          Claude Code
        </h2>
        <Tag form={i.claudeCode.activeAgentTokens ? "solid" : "dashed"}>
          {i.claudeCode.activeAgentTokens ? `${i.claudeCode.activeAgentTokens} agent token${i.claudeCode.activeAgentTokens > 1 ? "s" : ""}` : "No agent token yet"}
        </Tag>
      </div>
      <p style={{ margin: 0, maxWidth: "75ch" }}>
        In your app’s repository, Claude Code reads <code className="mono">greenlight.yaml</code>, runs verification, and gets a structured failure report back whenever a claim fails, so it can fix the app and try again. It can propose tests but never approve them: approval stays with you, here.
      </p>
      <ol className="list" style={{ gap: 18 }}>
        <li style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <b style={{ fontWeight: 500 }}>1. Install the Greenlight CLI and the Skill</b>
          <span className="small">
            In your app’s repository. Greenlight is not on the npm registry; it installs from its source, pinned to the version this server runs. Local verification also needs Node 20+ and Kane CLI 0.10.6 signed in (<code className="mono">npm i -g @testmuai/kane-cli@0.10.6</code>, then <code className="mono">kane-cli login --oauth</code>).
          </span>
          {i.claudeCode.install ? (
            <CodeBlock title="Terminal, in your app’s repository" code={`npm install --save-dev ${i.claudeCode.install}
mkdir -p .claude/skills
cp -R node_modules/greenlight/skills/greenlight .claude/skills/greenlight`} />
          ) : (
            <Notice>This server can’t tell which source version it runs, so no install command is shown. Ask the operator for it.</Notice>
          )}
          <span className="small">Or download the Skill files on their own into <code className="mono">.claude/skills/greenlight/</code>:</span>
          <div className="tags">
            {i.claudeCode.skillFiles.map((f) => (
              <a key={f} className="btn ghost sm" href={f} download>
                <I.Download size={14} aria-hidden="true" /> {f.split("/").slice(-2).join("/").replace(/^greenlight\//, "")}
              </a>
            ))}
          </div>
        </li>
        <li style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <b style={{ fontWeight: 500 }}>2. Register the Stop hook</b>
          <span className="small">
            When Claude finishes a change, the hook runs <code className="mono">greenlight verify</code> against the live URL and, if a claim fails, blocks Claude with the structured failure report so it can fix the app (at most three automatic attempts; then a person reviews and runs <code className="mono">npx greenlight-stop-hook reset</code>). Each run authors the tests afresh and spends Kane credits, so a person confirms the spend at the terminal; unattended loops need <code className="mono">GREENLIGHT_CONFIRM_SPEND</code> set by that person for the one run.
          </span>
          <CodeBlock title=".claude/settings.json" code={hook} />
        </li>
        <li style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <b style={{ fontWeight: 500 }}>3. Connect it to this server</b>
          <span className="small">
            Create an agent token below and set it where Claude Code runs (never commit it). With it, <code className="mono">greenlight submit</code> proposes your <code className="mono">greenlight.yaml</code> here as a new version; you approve it in this app. Agent tokens cannot approve or certify.
          </span>
          <CodeBlock title="Environment" code={`GREENLIGHT_API_URL=${api}\nGREENLIGHT_API_TOKEN=${token ?? "<agent token from below>"}`} />
        </li>
      </ol>
    </section>
  );
}

function Mcp({ i, token }: { i: Integrations; token: string | null }) {
  const cmd = `claude mcp add --transport http greenlight ${i.mcp.url} \\\n  --header "Authorization: Bearer ${token ?? "<agent token>"}"`;
  return (
    <section className="card" aria-labelledby="mcp-h">
      <div className="card-head">
        <h2 id="mcp-h" className="card-title lg">
          MCP server
        </h2>
        <Tag>Streamable HTTP · bearer token</Tag>
      </div>
      <p style={{ margin: 0, maxWidth: "75ch" }}>
        Any MCP client can read your projects, results and records, check the deployed commit and propose new test versions. No tool approves tests, starts a paid run or publishes anything; proposals come back with the approval link for you.
      </p>
      <dl className="kv-list">
        <dt>Endpoint</dt>
        <dd className="mono">
          {i.mcp.url} <CopyButton text={i.mcp.url} />
        </dd>
        <dt>Tools</dt>
        <dd>list projects · get project · get spec · propose tests · get job · get record · check deployment</dd>
      </dl>
      <CodeBlock title="Add to Claude Code" code={cmd} />
    </section>
  );
}

function Tokens({ tokens, error, reload, fresh, onCreated }: { tokens: ApiToken[] | null; error: Error | null; reload: () => void; fresh: { token: string; label: string } | null; onCreated: (t: { token: string; label: string }) => void }) {
  const [label, setLabel] = useState("Claude Code");
  const [role, setRole] = useState<"agent" | "owner">("agent");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ message: string } | null>(null);
  const create = async () => {
    setBusy("create");
    setErr(null);
    try {
      const t = await api.createToken(role, label.trim());
      onCreated({ token: t.token, label: t.label });
      reload();
    } catch (e) {
      setErr({ message: (e as ApiError).message });
    } finally {
      setBusy(null);
    }
  };
  const revoke = async (t: ApiToken) => {
    if (!window.confirm(`Revoke “${t.label}”? Anything using it stops working immediately.`)) return;
    setBusy(t.id);
    try {
      await api.revokeToken(t.id);
      reload();
    } catch (e) {
      setErr({ message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };
  const active = tokens?.filter((t) => !t.revokedAt) ?? [];
  const revoked = tokens?.filter((t) => t.revokedAt) ?? [];
  return (
    <section className="card" aria-labelledby="tok-h">
      <div className="card-head">
        <h2 id="tok-h" className="card-title lg">
          API tokens
        </h2>
        <I.KeyRound size={16} aria-hidden="true" />
      </div>
      {fresh ? (
        <div className="confirm-box" role="status">
          <b style={{ fontWeight: 600 }}>Copy “{fresh.label}” now: it won’t be shown again.</b>
          <div className="hash-box">{fresh.token}</div>
          <div className="tags">
            <CopyButton text={fresh.token} label="Copy token" />
          </div>
          <span className="small">Greenlight keeps only its SHA-256. The setup snippets above now include it.</span>
        </div>
      ) : null}
      <div className="form-grid" style={{ alignItems: "end" }}>
        <label className="field">
          <span>Label</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={80} />
        </label>
        <label className="field">
          <span>Role</span>
          <select value={role} onChange={(e) => setRole(e.target.value as "agent" | "owner")}>
            <option value="agent">Agent: read and propose (Claude Code, MCP)</option>
            <option value="owner">Owner: also requests verification runs (CLI)</option>
          </select>
        </label>
        <button type="button" className="btn" onClick={create} disabled={busy !== null || !label.trim()}>
          {busy === "create" ? <span className="spinner" aria-hidden="true" /> : <I.Plus size={15} aria-hidden="true" />} Create token
        </button>
      </div>
      {role === "owner" ? <Notice>Owner tokens can start paid runs with an explicit credit limit. Your account’s approvals still happen only in the browser.</Notice> : null}
      <FormError error={err} />
      {error ? <ErrorNotice error={error} onRetry={reload} /> : null}
      {tokens && !active.length ? (
        <Empty title="No active tokens">
          <span>Create one for Claude Code or an MCP client.</span>
        </Empty>
      ) : null}
      {active.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Role</th>
                <th>Id</th>
                <th>Created</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {active.map((t) => (
                <tr key={t.id}>
                  <td>{t.label}</td>
                  <td>{t.role}</td>
                  <td className="mono">{t.id}</td>
                  <td>{formatDateTime(t.createdAt)}</td>
                  <td style={{ textAlign: "right" }}>
                    <button type="button" className="btn ghost sm" onClick={() => revoke(t)} disabled={busy !== null}>
                      {busy === t.id ? <span className="spinner" aria-hidden="true" /> : <I.Ban size={14} aria-hidden="true" />} Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
      {revoked.length ? <p className="small" style={{ margin: 0 }}>{revoked.length} revoked token{revoked.length > 1 ? "s" : ""} kept for the record.</p> : null}
    </section>
  );
}
