// Model Context Protocol endpoint (POST /mcp): Greenlight as tools for Claude Code and other MCP
// clients. Streamable HTTP transport, JSON responses (no server-initiated streams), JSON-RPC 2.0.
//
// Authorisation: the same bearer API tokens as /v1 (created in the web app under Integrations,
// stored hashed, scoped to one account, revocable). Each tool states the permission it needs and
// the token's role must have it. An agent token can read and propose; no tool approves tests,
// starts a certification or publishes anything: those stay with a person in the browser.

import { GreenlightError } from "../cli/errors.js";
import { resolvePrincipal, can } from "./config.js";
import { projectDetail, proposeVersion, recordView, jobView } from "./app-api.js";
import { probeDeployment } from "./repo.js";

export const MCP_PATH = "/mcp";
const PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const PRJ = { type: "string", pattern: "^prj_[0-9a-f]{32}$", description: "Greenlight project id (prj_...)" };

const TOOLS = [
  {
    name: "greenlight_list_projects",
    permission: "read",
    description: "List the account's Greenlight projects with their latest test version, approval state and last verification result.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "greenlight_get_project",
    permission: "read",
    description: "One project: every immutable test version (claims, tests with exact steps, hash, approval state, credit estimate), verification jobs and verification records.",
    inputSchema: { type: "object", properties: { projectId: PRJ }, required: ["projectId"], additionalProperties: false },
  },
  {
    name: "greenlight_get_spec",
    permission: "read",
    description: "The exact greenlight.yaml of a test version, to edit and propose again.",
    inputSchema: { type: "object", properties: { projectId: PRJ, version: { type: "integer", minimum: 1 } }, required: ["projectId", "version"], additionalProperties: false },
  },
  {
    name: "greenlight_propose_tests",
    permission: "propose",
    description: "Propose a new test version from greenlight.yaml text. It is stored pending human approval; the result contains the approval link a person must open in the browser. Nothing runs and no credits are spent.",
    inputSchema: { type: "object", properties: { projectId: PRJ, specText: { type: "string", description: "Full greenlight.yaml" } }, required: ["projectId", "specText"], additionalProperties: false },
  },
  {
    name: "greenlight_get_job",
    permission: "read",
    description: "Progress and outcome of a verification job.",
    inputSchema: { type: "object", properties: { jobId: { type: "string", pattern: "^job_[0-9a-f]{32}$" } }, required: ["jobId"], additionalProperties: false },
  },
  {
    name: "greenlight_get_record",
    permission: "read",
    description: "A verification record: overall status, claim-by-claim results, verified commit, credits and whether it certified.",
    inputSchema: { type: "object", properties: { projectId: PRJ, recordId: { type: "string", pattern: "^vr_[0-9a-f]{32}$" } }, required: ["projectId", "recordId"], additionalProperties: false },
  },
  {
    name: "greenlight_check_deployment",
    permission: "read",
    description: "Read <live URL>/greenlight.json once and report which commit the deployment says it is serving.",
    inputSchema: { type: "object", properties: { projectId: PRJ }, required: ["projectId"], additionalProperties: false },
  },
];

const rpcError = (id, code, message, data) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message, ...(data ? { data } : {}) } });

export function createMcpHandler({ config, store, now = () => new Date(), log = () => {}, fetchImpl }) {
  const base = config.publicBaseUrl ? config.publicBaseUrl.replace(/\/+$/, "") : "";

  async function callTool(principal, name, args) {
    const tool = TOOLS.find((t) => t.name === name);
    if (!tool) throw Object.assign(new Error(`Unknown tool: ${name}`), { rpc: -32602 });
    if (!can(principal, tool.permission)) throw new GreenlightError("forbidden", `This token (role ${principal.role}) may not ${tool.permission}.`);
    const a = args && typeof args === "object" ? args : {};
    switch (name) {
      case "greenlight_list_projects": {
        const projects = await store.listProjects(principal.account);
        return { projects: projects.map((p) => ({ id: p.id, name: p.name, url: p.url, createdAt: p.createdAt, app: `${base}/app/projects/${p.id}` })) };
      }
      case "greenlight_get_project": {
        const project = await store.getProject(String(a.projectId), principal.account);
        const d = await projectDetail(config, store, project);
        for (const v of d.versions) if (v.approveUrl) v.approveUrl = `${base}${v.approveUrl}`;
        return d;
      }
      case "greenlight_get_spec": {
        const project = await store.getProject(String(a.projectId), principal.account);
        const v = await store.getVersion(project.id, a.version);
        return { projectId: project.id, version: v.version, approvedTestHash: v.approvedTestHash, specText: v.specText };
      }
      case "greenlight_propose_tests": {
        const project = await store.getProject(String(a.projectId), principal.account);
        if (typeof a.specText !== "string" || a.specText.length > 200_000) throw new GreenlightError("invalid_request", "specText: the full greenlight.yaml (at most 200 kB).");
        const v = await proposeVersion({ store, project, specText: a.specText, by: principal.name, now });
        log({ event: "mcp_version_proposed", account: principal.account, projectId: project.id, version: v.version });
        return {
          version: v.version,
          approvedTestHash: v.approvedTestHash,
          status: "pending_approval",
          approveUrl: `${base}/approve/${project.id}/${v.version}`,
          next: "Ask the person to open approveUrl, review the tests and approve them. Agents cannot approve.",
        };
      }
      case "greenlight_get_job": {
        const job = await store.getJob(String(a.jobId));
        await store.getProject(job.projectId, principal.account);
        return jobView(job);
      }
      case "greenlight_get_record": {
        const project = await store.getProject(String(a.projectId), principal.account);
        const r = await store.getRecord(String(a.recordId));
        if (r.projectId !== project.id) throw new GreenlightError("not_found", "No such record.");
        return recordView(r, config);
      }
      case "greenlight_check_deployment": {
        const project = await store.getProject(String(a.projectId), principal.account);
        return probeDeployment({ url: project.url, now, ...(fetchImpl ? { fetchImpl } : {}) });
      }
      default:
        throw Object.assign(new Error(`Unknown tool: ${name}`), { rpc: -32602 });
    }
  }

  async function dispatch(principal, msg) {
    const { id, method, params } = msg ?? {};
    if (msg?.jsonrpc !== "2.0" || typeof method !== "string") return rpcError(id, -32600, "Invalid request");
    const isNotification = id === undefined;
    if (isNotification) return null;
    switch (method) {
      case "initialize": {
        const asked = params?.protocolVersion;
        return {
          jsonrpc: "2.0",
          id,
          result: {
            protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "greenlight", version: "1.0.0" },
            instructions: "Greenlight verifies a deployed web app against human-approved claims. Use these tools to read projects and results and to propose tests. A person approves tests and starts paid verification runs in the Greenlight web app; never claim a project is verified unless a record says certified: true.",
          },
        };
      }
      case "ping":
        return { jsonrpc: "2.0", id, result: {} };
      case "tools/list":
        return { jsonrpc: "2.0", id, result: { tools: TOOLS.filter((t) => can(principal, t.permission)).map(({ permission, ...t }) => t) } };
      case "tools/call": {
        try {
          const out = await callTool(principal, params?.name, params?.arguments);
          return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false } };
        } catch (err) {
          if (err?.rpc) return rpcError(id, err.rpc, err.message);
          if (err instanceof GreenlightError) {
            return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: `${err.code}: ${err.message}${err.details?.problems ? `\n- ${err.details.problems.join("\n- ")}` : ""}` }], isError: true } };
          }
          log({ event: "mcp_tool_error", tool: params?.name, error: String(err?.stack ?? err) });
          return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: "internal_error: the tool failed." }], isError: true } };
        }
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  }

  return async function handle(req, res, url) {
    if (url.pathname !== MCP_PATH) return false;
    const send = (status, body, headers = {}) => {
      res.statusCode = status;
      res.setHeader("cache-control", "no-store");
      res.setHeader("x-content-type-options", "nosniff");
      for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
      if (body === null) return res.end();
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify(body));
    };
    if (req.method !== "POST") {
      send(405, rpcError(null, -32000, "Use POST (this server does not open event streams)."), { allow: "POST" });
      return true;
    }
    // Browsers may not call this endpoint with ambient credentials: bearer tokens only.
    if (req.headers.origin && config.publicBaseUrl && req.headers.origin !== new URL(config.publicBaseUrl).origin) {
      send(403, rpcError(null, -32000, "Cross-origin requests are refused."));
      return true;
    }
    let principal = null;
    try {
      principal = await resolvePrincipal(config, store, req.headers.authorization);
    } catch {
      send(503, rpcError(null, -32000, "Authentication is temporarily unavailable."));
      return true;
    }
    if (!principal) {
      send(401, rpcError(null, -32001, "A Greenlight API token is required (Authorization: Bearer <token>). Create one in the web app under Integrations."), { "www-authenticate": 'Bearer realm="greenlight"' });
      return true;
    }
    let body;
    try {
      if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) throw new Error("content type");
      let size = 0;
      const chunks = [];
      for await (const c of req) {
        size += c.length;
        if (size > 512 * 1024) throw new Error("too large");
        chunks.push(c);
      }
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      send(400, rpcError(null, -32700, "Parse error: send one JSON-RPC message as application/json."));
      return true;
    }
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => dispatch(principal, m)))).filter(Boolean);
      send(out.length ? 200 : 202, out.length ? out : null);
    } else {
      const out = await dispatch(principal, body);
      send(out ? 200 : 202, out);
    }
    log({ event: "mcp_request", account: principal.account, method: Array.isArray(body) ? "batch" : body?.method ?? null });
    return true;
  };
}
