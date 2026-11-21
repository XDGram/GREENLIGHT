// Guest demo API (/app/api/guest/*): explore Greenlight without signing up.
//
// A guest is a random id in a signed, HttpOnly, 30-day cookie (__Host-gl_guest), so the browser
// is remembered. Guests can read the sample project, add their own apps (tests from the form or
// written by the AI), approve their own tests and run a capped number of demo checks (guest-check.js:
// an HTTP read of the start page; never Kane, never credits). Their data is kept apart from the
// certification tables, so nothing a guest does can certify anything.
//
//   GET  /app/api/guest/me                       guest (or null), limits, what is available
//   POST /app/api/guest/start                    create the guest (sets the cookie)
//   GET  /app/api/guest/sample                   the sample project (read-only)
//   POST /app/api/guest/draft                    AI: requirements -> claims and tests (not saved)
//   POST /app/api/guest/preview                  structured tests -> greenlight.yaml, hash, estimate
//   GET  /app/api/guest/projects                 the guest's apps
//   POST /app/api/guest/projects                 save an app with its tests
//   GET  /app/api/guest/projects/:id             one app: tests, approval, runs
//   POST /app/api/guest/projects/:id/approve     approve the tests (type the hash back)
//   POST /app/api/guest/projects/:id/runs        run a demo check (no browser, no credits; limits apply)
//
// Every POST must come from this site (Origin and Sec-Fetch-Site) as JSON.

import { createHmac, randomBytes } from "node:crypto";
import { GreenlightError, errorBody, ERRORS } from "../cli/errors.js";
import { catalogFromSpec } from "../report/failure-report.js";
import { signValue, verifyValue } from "./approval-web.js";
import { sendJson, projectDetail } from "./app-api.js";
import { buildSpecYaml, checkGuestSpec, guestUrl, GUEST_LIMITS } from "./guest-spec.js";
import { draftTests } from "./guest-ai.js";

export const GUEST_PREFIX = "/app/api/guest/";
const COOKIE = "__Host-gl_guest";
const COOKIE_TTL_S = 30 * 24 * 3600;
const PROJECT = /^\/app\/api\/guest\/projects\/(gpj_[0-9a-f]{32})(\/approve|\/runs)?$/;
const HEX64 = /^[0-9a-f]{64}$/;

const hex32 = () => randomBytes(16).toString("hex");

function parseCookies(header) {
  const out = {};
  for (const part of String(header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

async function readJson(req, maxBytes = 64 * 1024) {
  if (!/^application\/json\b/i.test(String(req.headers["content-type"] ?? ""))) throw new GreenlightError("invalid_request", "Send JSON.");
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > maxBytes) throw new GreenlightError("payload_too_large", "Request too large.");
    chunks.push(c);
  }
  try {
    const v = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("not an object");
    return v;
  } catch {
    throw new GreenlightError("invalid_request", "Invalid JSON.");
  }
}

function testsView(spec) {
  return catalogFromSpec(spec).tests.map((t) => ({ file: t.file, title: t.title, claims: t.claims, steps: t.steps.map((s) => ({ name: s.name, kind: s.kind, text: s.text })) }));
}

function projectView(p, runs = null, config) {
  let tests = [];
  let claims = [];
  let estimate = null;
  try {
    const { derived, estimate: e } = checkGuestSpec(p.specText, config);
    tests = testsView(derived.spec);
    claims = derived.spec.claims.map((c) => ({ id: c.id, text: c.text }));
    estimate = { credits: e.credits, runOverhead: e.runOverhead, breakdown: e.breakdown.map((b) => ({ file: b.file, steps: b.steps, credits: b.credits })), cap: config.guest.maxCreditsPerRun };
  } catch {
    // a spec that no longer passes is shown without tests
  }
  return {
    id: p.id,
    name: p.name,
    url: p.url,
    description: p.description ?? null,
    createdAt: p.createdAt,
    approvedTestHash: p.approvedTestHash,
    approvedAt: p.approvedAt ?? null,
    source: p.source ?? "form",
    notes: p.notes ?? null,
    specText: p.specText,
    claims,
    tests,
    estimate,
    runs: runs?.map(runView) ?? undefined,
  };
}

const runView = (r) => ({
  id: r.id,
  status: r.status,
  refunded: r.refunded === true,
  createdAt: r.createdAt,
  startedAt: r.startedAt ?? null,
  finishedAt: r.finishedAt ?? null,
  error: r.error ?? null,
  result: r.result ?? null,
});

/**
 * @param {object} p
 * @param {object} p.config      loadConfig() result (config.guest set)
 * @param {object} p.store       SupabaseStore
 * @param {(runId: string) => Promise<void>} p.startRun  hands a queued run to the runner
 * @param {() => Date} [p.now]
 * @param {object} [p.ai]        test seam: { client, fetchImpl }
 */
export function createGuestApi({ config, store, startRun, now = () => new Date(), log = () => {}, ai = {} }) {
  const g = config.guest;
  const base = config.publicBaseUrl.replace(/\/+$/, "");
  const origin = new URL(base).origin;
  const key = createHmac("sha256", String(config.supabase.serviceRoleKey)).update("greenlight-guest-v1").digest();

  const cookie = (value, maxAge) => `${COOKIE}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
  const guestFrom = (req) => {
    const v = verifyValue(key, parseCookies(req.headers.cookie)[COOKIE], now().getTime());
    return v && v.kind === "guest" && /^gst_[0-9a-f]{32}$/.test(v.id) ? v.id : null;
  };
  const sameOrigin = (req) => {
    const site = req.headers["sec-fetch-site"];
    if (site !== undefined && site !== "same-origin") return false;
    return String(req.headers.origin ?? "") === origin;
  };
  const ipHash = (req) => {
    const ip = String(req.headers["x-real-ip"] ?? String(req.headers["x-forwarded-for"] ?? "").split(",")[0] ?? "").trim() || req.socket?.remoteAddress || "unknown";
    return createHmac("sha256", key).update(`ip|${ip}`).digest("hex");
  };

  let paused = false;
  async function limits(guest) {
    const today = await store.guestRunsToday();
    paused = await guestPaused();
    return {
      runsPerGuest: g.runsPerGuest,
      runsLeft: guest ? Math.max(0, g.runsPerGuest - guest.runsUsed) : g.runsPerGuest,
      runsPerDay: g.runsPerDay,
      runsLeftToday: Math.max(0, g.runsPerDay - today),
      maxCreditsPerRun: g.maxCreditsPerRun,
      demoCheck: true,
      paused: paused === true,
      projectsPerGuest: g.projectsPerGuest,
      aiPerGuest: g.aiPerGuest,
      aiLeft: guest ? Math.max(0, g.aiPerGuest - guest.aiUsed) : g.aiPerGuest,
      aiAvailable: Boolean(config.ai?.apiKey ?? g.anthropicApiKey) || Boolean(ai.client),
      maxTests: GUEST_LIMITS.tests,
      maxClaims: GUEST_LIMITS.claims,
    };
  }

  /** Administrator switch (admin console): settings key guest.checks_paused. */
  async function guestPaused() {
    if (typeof store.getSettings !== "function") return false;
    try {
      return (await store.getSettings())?.["guest.checks_paused"] === true;
    } catch {
      return false; // settings table not migrated yet: not paused
    }
  }

  async function requireGuest(req) {
    const id = guestFrom(req);
    if (!id) throw new GreenlightError("unauthorized", "Start a guest session first.");
    try {
      return await store.guestGet(id);
    } catch (err) {
      if (err?.code === "not_found") throw new GreenlightError("unauthorized", "Your guest session has ended; start a new one.");
      throw err;
    }
  }

  async function route(req, res, url) {
    const path = url.pathname;
    const isPost = req.method === "POST";
    if (isPost && !sameOrigin(req)) throw new GreenlightError("forbidden", "Cross-site request.");
    if (!isPost && req.method !== "GET") throw new GreenlightError("invalid_request", "Unsupported method.");

    if (path === "/app/api/guest/me" && !isPost) {
      const id = guestFrom(req);
      const guest = id ? await store.guestGet(id).catch(() => null) : null;
      return sendJson(res, 200, { guest: guest ? { id: guest.id, createdAt: guest.createdAt, projects: guest.projects } : null, limits: await limits(guest), sample: Boolean(g.sampleProjectId) });
    }
    if (path === "/app/api/guest/start" && isPost) {
      const existing = guestFrom(req);
      if (existing) {
        const guest = await store.guestGet(existing).catch(() => null);
        if (guest) return sendJson(res, 200, { guest: { id: guest.id, createdAt: guest.createdAt, projects: guest.projects }, limits: await limits(guest) });
      }
      const id = `gst_${hex32()}`;
      const guest = await store.guestCreate(id, ipHash(req), g.sessionsPerIpHour);
      log({ event: "guest_started", guest: id });
      return sendJson(res, 201, { guest: { id: guest.id, createdAt: guest.createdAt, projects: 0 }, limits: await limits(guest) }, { "set-cookie": cookie(signValue(key, { kind: "guest", id, exp: now().getTime() + COOKIE_TTL_S * 1000 }), COOKIE_TTL_S) });
    }
    if (path === "/app/api/guest/sample" && !isPost) {
      if (!g.sampleProjectId) throw new GreenlightError("not_found", "No sample project is set up.");
      const project = await store.getProject(g.sampleProjectId);
      return sendJson(res, 200, await projectDetail(config, store, project, { publicView: true }));
    }

    const guest = await requireGuest(req);

    if (path === "/app/api/guest/draft" && isPost) {
      const body = await readJson(req);
      const name = String(body.name ?? "").trim().slice(0, GUEST_LIMITS.name) || "My app";
      const appUrl = guestUrl(body.url);
      const requirements = String(body.requirements ?? "").trim();
      if (requirements.length < 20) throw new GreenlightError("invalid_request", "Describe what the app does in a sentence or two (at least 20 characters).");
      if (requirements.length > 4000) throw new GreenlightError("invalid_request", "Keep the description under 4,000 characters.");
      if (!(config.ai?.apiKey ?? g.anthropicApiKey) && !ai.client) throw new GreenlightError("ai_unavailable", "AI test writing is not configured on this server; use the form.");
      await store.guestUseAi(guest.id, g.aiPerGuest);
      const { draft, pageRead } = await draftTests({ name, url: appUrl, requirements, config, client: ai.client, fetchImpl: ai.fetchImpl });
      const structured = { name: draft.name?.trim() || name, url: appUrl, description: draft.description ?? null, claims: draft.claims ?? [], tests: draft.tests ?? [] };
      return sendJson(res, 200, { draft: structured, notes: draft.notes ?? null, pageRead, check: preview(structured) });
    }
    if (path === "/app/api/guest/preview" && isPost) {
      return sendJson(res, 200, preview(await readJson(req)));
    }
    if (path === "/app/api/guest/projects" && !isPost) {
      return sendJson(res, 200, { projects: (await store.guestListProjects(guest.id)).map((p) => projectView(p, null, config)) });
    }
    if (path === "/app/api/guest/projects" && isPost) {
      const body = await readJson(req);
      const specText = buildSpecYaml(body);
      const { derived } = checkGuestSpec(specText, config);
      const doc = {
        id: `gpj_${hex32()}`,
        guestId: guest.id,
        name: derived.spec.project.name,
        url: derived.spec.project.url,
        approvedTestHash: derived.hash,
        description: derived.spec.project.description ?? null,
        specText,
        specFileSha256: derived.specFileSha256,
        source: body.source === "ai" ? "ai" : "form",
        notes: typeof body.notes === "string" ? body.notes.slice(0, 600) : null,
      };
      const p = await store.guestCreateProject(doc, g.projectsPerGuest);
      return sendJson(res, 201, projectView(p, [], config));
    }
    const m = PROJECT.exec(path);
    if (m) {
      const [, id, action] = m;
      if (!action && !isPost) {
        const p = await store.guestGetProject(id, guest.id);
        return sendJson(res, 200, { project: projectView(p, await store.guestListRuns(id), config), limits: await limits(guest) });
      }
      if (action === "/approve" && isPost) {
        const body = await readJson(req);
        const typed = String(body.confirmHash ?? "").trim();
        if (!HEX64.test(typed)) throw new GreenlightError("approval_hash_mismatch", "Type the full 64-character hash shown above the tests.");
        const p = await store.guestApprove(id, guest.id, typed);
        return sendJson(res, 200, { project: projectView(p, await store.guestListRuns(id), config) });
      }
      if (action === "/runs" && isPost) {
        if (await guestPaused()) throw new GreenlightError("guest_limit_reached", "Demo checks are paused by the administrator right now. Everything else in the demo still works.");
        const p = await store.guestGetProject(id, guest.id);
        checkGuestSpec(p.specText, config); // still within the demo's rules and credit cap
        const run = await store.guestStartRun({ id: `grn_${hex32()}`, projectId: id, guestId: guest.id, status: "queued", kind: "demo_check", approvedTestHash: p.approvedTestHash }, g.runsPerGuest, g.runsPerDay);
        log({ event: "guest_run_started", guest: guest.id, run: run.id, project: id });
        try {
          await startRun(run.id);
        } catch (err) {
          log({ event: "guest_run_dispatch_failed", run: run.id, error: String(err?.message ?? err) });
          await store.guestUpdateRun(run.id, "failed", { error: errorBody("internal_error", "The demo check could not be started; it does not count against your limit.") }, { refund: true }).catch(() => {});
        }
        return sendJson(res, 202, { run: runView(await store.guestGetRun(run.id)), limits: await limits(await store.guestGet(guest.id)) });
      }
    }
    throw new GreenlightError("not_found", "Not found.");
  }

  function preview(body) {
    try {
      const specText = buildSpecYaml(body);
      const { derived, estimate } = checkGuestSpec(specText, config);
      return { ok: true, specText, hash: derived.hash, claims: derived.spec.claims.map((c) => ({ id: c.id, text: c.text })), tests: testsView(derived.spec), estimate: { credits: estimate.credits, cap: g.maxCreditsPerRun }, problems: [] };
    } catch (err) {
      if (err instanceof GreenlightError) return { ok: false, problems: err.details?.problems ?? [err.message] };
      throw err;
    }
  }

  return async function handle(req, res, url) {
    if (!url.pathname.startsWith(GUEST_PREFIX)) return false;
    try {
      await route(req, res, url);
    } catch (err) {
      if (err instanceof GreenlightError) {
        const status = ERRORS[err.code]?.http ?? 400;
        sendJson(res, status, { error: errorBody(err.code, err.message, err.details) });
      } else {
        log({ event: "guest_api_error", path: url.pathname, error: String(err?.stack ?? err) });
        sendJson(res, 500, { error: { code: "internal_error", message: "Internal error." } });
      }
    }
    return true;
  };
}
