// Administrator API (/app/api/admin/*). Only sessions with role "admin" reach this module: Sign in
// with Vercel by a subject listed in GREENLIGHT_APPROVERS (src/server/approval-web.js). Google users
// can never get that role. Every change is written to the append-only admin_events table.
//
// It cannot approve tests, start certifications, change records or reveal secrets: the controls
// here are operational (pause the guest demo checks, revoke API tokens).
//
//   GET  /app/api/admin/overview            counts, credits, jobs by status, guest activity
//   GET  /app/api/admin/health              database, evidence bucket, runtime, configuration flags
//   GET  /app/api/admin/list/:kind          users | projects | jobs | records | tokens | events | guests
//   GET  /app/api/admin/settings
//   POST /app/api/admin/settings            {key, value}   (allow-listed keys only)
//   POST /app/api/admin/tokens/:id/revoke

import { GreenlightError } from "../cli/errors.js";

const LIST = /^\/app\/api\/admin\/list\/(users|projects|jobs|records|tokens|events|guests)$/;
const REVOKE = /^\/app\/api\/admin\/tokens\/([0-9a-f]{16})\/revoke$/;
/** Settings an administrator may change, with their value check. */
const SETTINGS = Object.freeze({
  "guest.checks_paused": (v) => typeof v === "boolean",
});

export async function handleAdminApi({ req, res, url, s, store, config, jobs, now, log, sendJson, readJson }) {
  const path = url.pathname;
  const isPost = req.method === "POST";
  if (typeof store.adminOverview !== "function") throw new GreenlightError("server_not_configured", "The admin console needs the Supabase store.");
  const actor = `${s.username ?? s.user}@vercel`;

  if (path === "/app/api/admin/overview" && !isPost) {
    const o = await store.adminOverview();
    return sendJson(res, 200, { overview: o, limits: { maxCreditsPerRun: config.maxCreditsPerRun ?? null, reserve: config.reserve ?? null, maxQueuedJobs: config.maxQueuedJobs ?? null, guest: config.guest ? { runsPerGuest: config.guest.runsPerGuest, runsPerDay: config.guest.runsPerDay, projectsPerGuest: config.guest.projectsPerGuest, aiPerGuest: config.guest.aiPerGuest } : null }, at: now().toISOString() });
  }

  if (path === "/app/api/admin/health" && !isPost) {
    let h;
    try {
      h = await store.health();
    } catch {
      h = { ok: false, database: "unreachable", storage: "unreachable" };
    }
    let stuck = [];
    try {
      const active = await store.listJobs({ statuses: ["queued", "running"] });
      const t = now().getTime();
      stuck = active.filter((j) => t - Date.parse(j.startedAt ?? j.createdAt) > 45 * 60_000).map((j) => ({ id: j.id, projectId: j.projectId, status: j.status, since: j.startedAt ?? j.createdAt }));
    } catch {
      stuck = [];
    }
    return sendJson(res, 200, {
      database: h.database,
      storage: h.storage,
      ok: Boolean(h.ok),
      execution: config.execution ?? (config.sandbox ? "sandbox" : "local"),
      stuckJobs: stuck,
      configuration: {
        publicBaseUrl: config.publicBaseUrl ?? null,
        signInWithGoogle: Boolean(config.google),
        administratorSignIn: Boolean(config.webApproval),
        approvalSigning: Boolean(config.approvalSigningKey),
        claudeApi: Boolean(config.ai?.apiKey),
        guestDemo: Boolean(config.guest),
        kaneCredentials: Boolean(config.kaneCredentials),
      },
      checkedAt: now().toISOString(),
    });
  }

  const lm = LIST.exec(path);
  if (lm && !isPost) {
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get("limit")) || 100));
    return sendJson(res, 200, { kind: lm[1], items: await store.adminList(lm[1], limit) });
  }

  if (path === "/app/api/admin/settings" && !isPost) {
    return sendJson(res, 200, { settings: await store.getSettings(), editable: Object.keys(SETTINGS) });
  }
  if (path === "/app/api/admin/settings" && isPost) {
    const body = await readJson(req);
    const check = SETTINGS[body.key];
    if (!check) throw new GreenlightError("invalid_request", "That setting cannot be changed here.");
    if (!check(body.value)) throw new GreenlightError("invalid_request", "Invalid value for that setting.");
    const out = await store.setSetting(body.key, body.value, actor);
    log({ event: "admin_setting_changed", actor, key: body.key });
    return sendJson(res, 200, out);
  }

  const rm = REVOKE.exec(path);
  if (rm && isPost) {
    await store.adminRevokeToken(rm[1], actor);
    log({ event: "admin_token_revoked", actor, id: rm[1] });
    return sendJson(res, 200, { revoked: rm[1] });
  }

  return sendJson(res, 404, { error: { code: "not_found", message: "Not found." } });
}
