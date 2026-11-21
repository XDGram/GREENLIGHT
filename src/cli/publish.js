// `greenlight publish`: ask the Greenlight server for a fresh certification run
// (brief §11). The CLI never certifies anything itself and never uploads local
// results: it only checks preconditions locally and starts the server's run.
//
//   GREENLIGHT_API_URL     server base URL, e.g. https://greenlight.example.com
//   GREENLIGHT_API_TOKEN   an OWNER token (agent tokens cannot certify)
//
// Refused when an AI agent or CI is detected: publishing spends credits and
// creates a permanent public record, so a person starts it.

import { checkApproval, detectAgentEnvironment, RELAYED_METHOD } from "../spec/approval.js";
import { checkGit, gitRunner } from "../deploy/git.js";
import { EXIT } from "./errors.js";
import { webApprovalValidFor } from "../server/models.js";
import { readServerLink, SERVER_LINK_FILE } from "./server-link.js";

export const PUBLISH_OPTIONS = Object.freeze({
  "--project": "string",
  "--version": "number",
  "--confirm-spend": "number",
  "--url": "string",
  "--environment": "string",
  "--wait-minutes": "number",
});

const TERMINAL = new Set(["succeeded", "failed"]);

export async function api(ctx, method, path, body) {
  const base = ctx.env.GREENLIGHT_API_URL.replace(/\/+$/, "");
  let res;
  try {
    res = await ctx.deps.fetch(`${base}${path}`, {
      method,
      headers: { authorization: `Bearer ${ctx.env.GREENLIGHT_API_TOKEN}`, "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    return { ok: false, status: 0, error: { code: "server_unreachable", message: `Greenlight server unreachable: ${err?.message ?? err}` } };
  }
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON */
  }
  if (!res.ok) return { ok: false, status: res.status, error: payload?.error ?? { code: "internal_error", message: `HTTP ${res.status}` } };
  return { ok: true, status: res.status, body: payload };
}

export async function cmdPublish(ctx) {
  const o = ctx.options;
  const markers = detectAgentEnvironment(ctx.env);
  if (markers.length) {
    return ctx.fail("forbidden", `Publishing creates a permanent public record and spends credits, so a person must start it from their own terminal (${markers.join(", ")} set). Tell the user to run greenlight publish.`);
  }
  if (!ctx.env.GREENLIGHT_API_URL || !ctx.env.GREENLIGHT_API_TOKEN) return ctx.fail("server_not_configured", "Set GREENLIGHT_API_URL and GREENLIGHT_API_TOKEN (an owner token) to publish.");
  const link = await readServerLink(ctx.cwd);
  o.project ??= link?.projectId;
  o.version ??= link?.version;
  if (!o.project || !o.version || !o["confirm-spend"]) return ctx.fail("usage_error", `publish needs --confirm-spend <credits>, and --project <id> --version <n> unless ${SERVER_LINK_FILE} has them (greenlight submit).`);

  // Which human approval vouches for the local tests:
  //  - a local terminal approval (greenlight approve), or
  //  - when there is no local approval at all, the server's browser approval by a verified person
  //    (Sign in with Vercel), whose confirmed test-specification hash must equal the local one.
  // A relayed (agent) approval is never accepted, and never silently replaced.
  const approval = await checkApproval(ctx.cwd);
  if (approval.method === RELAYED_METHOD) return ctx.fail("approval_not_certifiable", "These tests have a relayed approval, which can never be published or certified.");
  let localHash;
  let viaServer = false;
  if (approval.status === "approved") localHash = approval.approvedHash;
  else if (approval.status === "not_approved" && approval.generated?.clean) {
    localHash = approval.currentHash;
    viaServer = true;
  } else return ctx.fail("tests_not_approved", `Local tests are not approved (${approval.status}); publish the version a person approved.`);

  const git = await checkGit({ runGit: ctx.deps.runGit ?? gitRunner(ctx.cwd) });
  if (!git.ok) return ctx.fail("deployment_not_ready", `Commit and push first (${git.reasons.join(", ")}).`, { reasons: git.reasons });

  // The server is the authority: its approved version must be exactly these tests.
  const v = await api(ctx, "GET", `/v1/projects/${encodeURIComponent(o.project)}/versions/${o.version}`);
  if (!v.ok) return ctx.fail(v.error.code in { not_found: 1, unauthorized: 1, forbidden: 1, server_unreachable: 1 } ? v.error.code : "internal_error", v.error.message);
  if (v.body.status !== "approved") return ctx.fail("approval_not_certifiable", `Server test version ${o.version} is not approved by a person on the server.`);
  if (v.body.approvedTestHash !== localHash) {
    return ctx.fail("approval_hash_mismatch", `Server version ${o.version} (${v.body.approvedTestHash.slice(0, 12)}…) is not the local approved tests (${localHash.slice(0, 12)}…).`);
  }
  // The record's shape is checked here; its signature only by the server (it alone holds the key).
  if (viaServer && (!webApprovalValidFor(v.body.approval, localHash) || v.body.approvalVerification?.browserApproval !== true)) {
    return ctx.fail("tests_not_approved", "Local tests have no terminal approval, and the server version has no verified browser approval (Sign in with Vercel) of exactly these tests.");
  }
  if (viaServer) ctx.out(`Approved in the browser by ${v.body.approval.approvedBy} (Vercel subject ${v.body.approval.identity.subject}) for exactly these tests.`);

  const started = await api(ctx, "POST", `/v1/projects/${encodeURIComponent(o.project)}/certifications`, {
    version: o.version,
    commit: git.head,
    confirmSpend: o["confirm-spend"],
    approvedTestHash: localHash,
    ...(o.url ? { url: o.url } : {}),
    ...(o.environment ? { environment: o.environment } : {}),
  });
  if (!started.ok) return ctx.fail(started.error.code ?? "internal_error", started.error.message, started.error.details);
  let job = started.body;
  ctx.out(`Certification job ${job.id} started for commit ${git.head.slice(0, 12)} (fresh server-side run; local results are never used).`);
  ctx.data({ jobId: job.id, commit: git.head });

  const deadline = Date.now() + (o["wait-minutes"] ?? 60) * 60_000;
  const sleep = ctx.deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  while (!TERMINAL.has(job.status)) {
    if (ctx.signal.aborted) return ctx.fail("interrupted", `Stopped waiting; job ${job.id} keeps running on the server.`);
    if (Date.now() > deadline) return ctx.fail("server_unreachable", `Still running after ${o["wait-minutes"] ?? 60} minutes; check job ${job.id} later.`, { jobId: job.id });
    await sleep(10_000);
    const j = await api(ctx, "GET", `/v1/jobs/${job.id}`);
    if (j.ok) job = j.body;
  }
  ctx.data({ job });
  if (job.status === "failed") return ctx.fail(job.error?.code ?? "internal_error", `Certification job failed: ${job.error?.message ?? "unknown"}`, job.error?.details);
  const rec = await api(ctx, "GET", `/v1/public/records/${job.recordId}`);
  if (!rec.ok) return ctx.fail(rec.error.code ?? "internal_error", rec.error.message);
  ctx.data({ record: rec.body });
  ctx.out(`Verification record ${rec.body.id}: ${rec.body.status}${rec.body.certified ? " — CERTIFIED" : " — not certified"}`);
  if (rec.body.publicUrl) ctx.out(`Public URL: ${rec.body.publicUrl}`);
  for (const c of rec.body.claims) ctx.out(`  ${c.status.padEnd(14)} ${c.id}`);
  return rec.body.certified ? EXIT.OK : ctx.fail("certification_failed", `Not certified (${rec.body.notCertifiedBecause.join(", ")}). The record is kept as history.`);
}
