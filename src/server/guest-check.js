// The guest demo's "demo check": a quick, free look at a guest's approved tests against the live
// start page. It never runs Kane, never opens a browser and never spends verification credits.
//
// The server fetches the app's start page itself (public addresses only, redirects re-checked,
// size and time limits: guest-ai.js readStartPage) and checks the "expect text" steps that come
// before the first real interaction. Anything after a click or a typed value is reported as
// "not checked": only a real browser run can perform actions. Results are labelled as a demo
// check everywhere and are written only to greenlight.guest_runs, so they can never certify.

import { projectFromText } from "../spec/generate.js";
import { catalogFromSpec } from "../report/failure-report.js";
import { GreenlightError, errorBody } from "../cli/errors.js";
import { readStartPage } from "./guest-ai.js";

/** A "do" step that only opens the start page (it does not interact with it). */
const OPENS_START = /^\s*(open|go to|visit|load|navigate to)\b(?!.*\b(click|type|enter|press|select|choose|fill|submit|scroll)\b)/i;
const norm = (s) => String(s).replace(/\s+/g, " ").trim().toLowerCase();

/**
 * Check a spec's tests against the start page's visible text (or null when it could not be read).
 * Pure: exported for tests.
 */
export function checkAgainstPage(spec, pageText) {
  const page = pageText == null ? null : norm(pageText);
  const tests = catalogFromSpec(spec).tests.map((t) => {
    let interacted = false;
    const steps = t.steps.map((s, i) => {
      if (s.kind !== "expect_text") {
        const opening = i === 0 && OPENS_START.test(s.text);
        if (!opening) interacted = true;
        return { name: s.name, kind: s.kind, text: s.text, result: opening ? "start_page_loaded" : "action_not_performed" };
      }
      if (page === null) return { name: s.name, kind: s.kind, text: s.text, result: "not_checked" };
      if (interacted) return { name: s.name, kind: s.kind, text: s.text, result: "not_checked" };
      return { name: s.name, kind: s.kind, text: s.text, result: page.includes(norm(s.text)) ? "found" : "missing" };
    });
    const expects = steps.filter((s) => s.kind === "expect_text");
    let status;
    if (expects.some((s) => s.result === "missing")) status = "failed";
    else if (expects.length && expects.every((s) => s.result === "found")) status = "passed";
    else if (expects.some((s) => s.result === "found")) status = "partly_checked";
    else status = "not_checked";
    return { file: t.file, title: t.title, claims: t.claims, status, steps };
  });
  const claims = spec.claims.map((c) => {
    const mine = tests.filter((t) => t.claims.includes(c.id));
    let status = "couldnt_verify";
    if (mine.some((t) => t.status === "failed")) status = "failed";
    else if (mine.length && mine.every((t) => t.status === "passed")) status = "passed";
    return { id: c.id, text: c.text, status };
  });
  let status = "couldnt_verify";
  if (claims.some((c) => c.status === "failed")) status = "failed";
  else if (claims.length && claims.every((c) => c.status === "passed")) status = "passed";
  else if (tests.some((t) => t.status === "passed" || t.status === "partly_checked")) status = "partly_checked";
  return { status, claims, tests };
}

/**
 * Run one queued demo check to completion. A failure before the check is refunded.
 * @returns {Promise<object>} the settled guest run
 */
export async function runDemoCheck({ store, runId, now = () => new Date(), log = () => {}, fetchImpl, checkHost }) {
  let run = await store.guestGetRun(runId);
  if (run.status !== "queued") return run;
  run = await store.guestUpdateRun(runId, "running", {});
  try {
    const project = await store.guestGetProject(run.projectId, null);
    if (!project.approvedAt) throw new GreenlightError("approval_not_certifiable", "Approve the tests first.");
    let derived;
    try {
      derived = projectFromText(project.specText);
    } catch {
      throw new GreenlightError("spec_invalid", "The stored tests no longer parse.");
    }
    if (derived.hash !== project.approvedTestHash) throw new GreenlightError("approval_hash_mismatch", "The stored tests do not match the approved hash.");
    const startedAt = now().toISOString();
    const opts = {};
    if (fetchImpl) opts.fetchImpl = fetchImpl;
    if (checkHost) opts.checkHost = checkHost;
    const pageText = await readStartPage(project.url, opts);
    const checked = checkAgainstPage(derived.spec, pageText);
    const result = {
      kind: "demo_check",
      status: checked.status,
      page: { url: project.url, read: pageText != null, characters: pageText?.length ?? 0 },
      claims: checked.claims,
      tests: checked.tests,
      credits: { estimate: 0, actual: 0 },
      startedAt,
      endedAt: now().toISOString(),
      approvedTestHash: derived.hash,
      certified: false,
      notCertifiedBecause: ["guest_demo_check"],
    };
    return await store.guestUpdateRun(runId, "succeeded", { result });
  } catch (err) {
    const e = err instanceof GreenlightError ? errorBody(err.code, err.message, err.details) : errorBody("internal_error", "The demo check failed unexpectedly.");
    if (!(err instanceof GreenlightError)) log({ event: "guest_check_error", runId, error: String(err?.stack ?? err) });
    return store.guestUpdateRun(runId, "failed", { error: e }, { refund: true });
  }
}
