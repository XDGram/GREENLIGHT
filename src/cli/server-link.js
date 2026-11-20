// The CLI side of the server's project and approval API (brief §2B, Phase 3):
//
//   greenlight submit           propose greenlight.yaml as a new server test version
//                               (agent or owner token; creates the server project once)
//   greenlight server-approve   a PERSON approves that version on the server (owner token,
//                               interactive terminal, full hash typed back; agents/CI refused)
//
// .greenlight/server.json records the server project id and the submitted version so that
// `greenlight publish` needs only --confirm-spend. It holds no secrets and is meant for git.
// The server re-derives every hash from the submitted spec; nothing local is trusted there.

import path from "node:path";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { createInterface } from "node:readline";
import { loadProject, SPEC_FILE } from "../spec/generate.js";
import { SpecError } from "../spec/schema.js";
import { detectAgentEnvironment } from "../spec/approval.js";
import { EXIT } from "./errors.js";
import { api } from "./publish.js";

export const SERVER_LINK_FILE = path.join(".greenlight", "server.json");
export const SERVER_LINK_SCHEMA = "greenlight.server-link/v1";
const PROJECT_ID = /^prj_[0-9a-f]{32}$/;

export async function readServerLink(root) {
  try {
    const j = JSON.parse(await readFile(path.join(root, SERVER_LINK_FILE), "utf8"));
    if (j?.schema !== SERVER_LINK_SCHEMA || !PROJECT_ID.test(j.projectId ?? "")) return null;
    return { projectId: j.projectId, version: Number.isInteger(j.version) && j.version > 0 ? j.version : undefined, approvedTestHash: j.approvedTestHash ?? null };
  } catch {
    return null;
  }
}

async function writeServerLink(root, link) {
  const file = path.join(root, SERVER_LINK_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ schema: SERVER_LINK_SCHEMA, ...link }, null, 2)}\n`);
  await rename(tmp, file);
}

function needServer(ctx) {
  if (!ctx.env.GREENLIGHT_API_URL || !ctx.env.GREENLIGHT_API_TOKEN) return ctx.fail("server_not_configured", "Set GREENLIGHT_API_URL and GREENLIGHT_API_TOKEN.");
  return null;
}
const apiFail = (ctx, r) => ctx.fail(r.error?.code ?? "internal_error", r.error?.message ?? `HTTP ${r.status}`, r.error?.details);

async function localSpec(ctx) {
  try {
    const p = await loadProject(ctx.cwd);
    return { project: p, specText: await readFile(p.specPath, "utf8") };
  } catch (err) {
    if (err instanceof SpecError) return { exit: ctx.fail("spec_invalid", err.message, { problems: err.errors }) };
    if (err.code === "ENOENT") return { exit: ctx.fail("spec_not_found", `${SPEC_FILE} not found. Run greenlight init to create one.`) };
    throw err;
  }
}

export async function cmdSubmit(ctx) {
  const missing = needServer(ctx);
  if (missing !== null) return missing;
  const local = await localSpec(ctx);
  if (!local.project) return local.exit;
  const { spec, hash } = local.project;

  let link = await readServerLink(ctx.cwd);
  let projectId = ctx.options.project ?? link?.projectId;
  if (projectId) {
    const p = await api(ctx, "GET", `/v1/projects/${encodeURIComponent(projectId)}`);
    if (!p.ok) return apiFail(ctx, p);
  } else {
    const p = await api(ctx, "POST", "/v1/projects", { name: spec.project.name, url: spec.project.url });
    if (!p.ok) return apiFail(ctx, p);
    projectId = p.body.id;
    ctx.out(`Created server project ${projectId} (${spec.project.name}).`);
  }

  // Re-use a version with exactly these tests instead of proposing a duplicate.
  const list = await api(ctx, "GET", `/v1/projects/${encodeURIComponent(projectId)}/versions`);
  if (!list.ok) return apiFail(ctx, list);
  let v = list.body.versions.find((x) => x.approvedTestHash === hash);
  if (v) {
    ctx.out(`Server version ${v.version} already has these tests (${v.status}).`);
  } else {
    const r = await api(ctx, "POST", `/v1/projects/${encodeURIComponent(projectId)}/versions`, { specText: local.specText });
    if (!r.ok) return apiFail(ctx, r);
    v = r.body;
    ctx.out(`Proposed server version ${v.version}.`);
  }
  if (v.approvedTestHash !== hash) return ctx.fail("approval_hash_mismatch", `The server derived hash ${v.approvedTestHash.slice(0, 12)}… but the local tests hash to ${hash.slice(0, 12)}…; nothing was linked.`);
  await writeServerLink(ctx.cwd, { projectId, version: v.version, approvedTestHash: hash });
  ctx.data({ projectId, version: v.version, approvedTestHash: hash, status: v.status });
  ctx.out(`Approved-test hash: ${hash}`);
  ctx.out(v.status === "approved" ? "Approved on the server. A person can now run greenlight publish." : "Pending approval: a person runs greenlight server-approve (owner token) to approve it on the server.");
  return EXIT.OK;
}

async function ask(ctx, question) {
  if (ctx.deps.ask) return ctx.deps.ask(question);
  const out = ctx.json ? process.stderr : ctx.stdout;
  const rl = createInterface({ input: ctx.stdin, output: out, terminal: false });
  return new Promise((resolve) => {
    let done = false;
    rl.question(question, (a) => {
      done = true;
      rl.close();
      resolve(a);
    });
    rl.on("close", () => !done && resolve(null));
  });
}

export async function cmdServerApprove(ctx) {
  const markers = detectAgentEnvironment(ctx.env);
  if (markers.length) return ctx.fail("forbidden", `Only a person approves tests (${markers.join(", ")} set). Tell the user to run greenlight server-approve at their terminal.`);
  if (!ctx.deps.ask && (!ctx.stdin.isTTY || !ctx.stdout.isTTY)) return ctx.fail("approval_refused", "server-approve needs an interactive terminal.");
  const missing = needServer(ctx);
  if (missing !== null) return missing;
  const link = await readServerLink(ctx.cwd);
  const projectId = ctx.options.project ?? link?.projectId;
  const version = ctx.options.version ?? link?.version;
  if (!projectId || !version) return ctx.fail("usage_error", `Run greenlight submit first, or pass --project <id> --version <n>.`);
  const local = await localSpec(ctx);
  if (!local.project) return local.exit;

  const v = await api(ctx, "GET", `/v1/projects/${encodeURIComponent(projectId)}/versions/${version}`);
  if (!v.ok) return apiFail(ctx, v);
  if (v.body.status === "approved") {
    ctx.data({ projectId, version, approvedTestHash: v.body.approvedTestHash, status: "approved" });
    ctx.out(`Server version ${version} is already approved.`);
    return EXIT.OK;
  }
  if (v.body.approvedTestHash !== local.project.hash) {
    return ctx.fail("approval_hash_mismatch", `Server version ${version} is not the current ${SPEC_FILE} (run greenlight submit to propose the current tests).`);
  }
  ctx.out(`Server version ${version} of ${projectId}: ${v.body.tests.length} test(s). Review them before approving:`);
  for (const t of v.body.tests) {
    ctx.out(`\n===== ${t.file}  [${t.claims.join(", ")}]  sha256 ${t.sha256}`);
    ctx.out(t.content.trimEnd());
  }
  ctx.out(`\nApproved-test hash: ${v.body.approvedTestHash}`);
  const answer = await ask(ctx, "Type the full approved-test hash to approve these exact tests on the server (anything else cancels): ");
  if ((answer ?? "").trim() !== v.body.approvedTestHash) return ctx.fail("approval_refused", "Not approved: the hash was not typed back exactly. Nothing changed.");
  const a = await api(ctx, "POST", `/v1/projects/${encodeURIComponent(projectId)}/versions/${version}/approval`, { confirmHash: v.body.approvedTestHash });
  if (!a.ok) return apiFail(ctx, a);
  ctx.data({ projectId, version, approvedTestHash: v.body.approvedTestHash, status: "approved", approvedBy: a.body.approvedBy });
  ctx.out(`Approved server version ${version} (${a.body.approvedBy}).`);
  return EXIT.OK;
}
