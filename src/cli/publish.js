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

export const PUBLISH_OPTIONS = Object.freeze({
  "--project": "string",
  "--version": "number",
  "--confirm-spend": "number",
  "--url": "string",
  "--environment": "string",
  "--wait-minutes": "number",
});

const TERMINAL = new Set(["succeeded", "failed"]);

async function api(ctx, method, path, body) {
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
  if (!o.project || !o.version || !o["confirm-spend"]) return ctx.fail("usage_error", "publish needs --project <id> --version <n> --confirm-spend <credits>.");

  const approval = await checkApproval(ctx.cwd);
  if (approval.status !== "approved") return ctx.fail("tests_not_approved", `Local tests are not approved (${approval.status}); publish the version a person approved.`);
  if (approval.method === RELAYED_METHOD) return ctx.fail("approval_not_certifiable", "These tests have a relayed approval, which can never be published or certified.");

  const git = await checkGit({ runGit: ctx.deps.runGit ?? gitRunner(ctx.cwd) });
  if (!git.ok) return ctx.fail("deployment_not_ready", `Commit and push first (${git.reasons.join(", ")}).`, { reasons: git.reasons });

  // The server is the authority: its approved version must be exactly these tests.
  const v = await api(ctx, "GET", `/v1/projects/${encodeURIComponent(o.project)}/versions/${o.version}`);
  if (!v.ok) return ctx.fail(v.error.code in { not_found: 1, unauthorized: 1, forbidden: 1, server_unreachable: 1 } ? v.error.code : "internal_error", v.error.message);
  if (v.body.status !== "approved") return ctx.fail("approval_not_certifiable", `Server test version ${o.version} is not approved by a person on the server.`);
  if (v.body.approvedTestHash !== approval.approvedHash) {
    return ctx.fail("approval_hash_mismatch", `Server version ${o.version} (${v.body.approvedTestHash.slice(0, 12)}…) is not the local approved tests (${approval.approvedHash.slice(0, 12)}…).`);
  }

  const started = await api(ctx, "POST", `/v1/projects/${encodeURIComponent(o.project)}/certifications`, {
    version: o.version,
    commit: git.head,
    confirmSpend: o["confirm-spend"],
    approvedTestHash: approval.approvedHash,
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
