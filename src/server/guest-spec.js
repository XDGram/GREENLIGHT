// Guest specifications: structured input (from the form or the AI) -> greenlight.yaml text.
//
// Every string is written as a JSON-escaped double-quoted scalar, which Greenlight's YAML subset
// reads back exactly, so no input can change the document's structure. The result is then
// validated by the normal spec rules (projectFromText), and checked against the demo's limits.

import { projectFromText } from "../spec/generate.js";
import { SpecError } from "../spec/schema.js";
import { GreenlightError } from "../cli/errors.js";
import { isLocalOrPrivateHost } from "../deploy/host.js";
import { guestEstimate } from "./guest-run.js";

export const GUEST_LIMITS = Object.freeze({ claims: 8, tests: 4, steps: 8, text: 400, name: 80, description: 400 });
/** Signed-in users: larger specs (the per-run credit cap still applies at certification). */
export const USER_LIMITS = Object.freeze({ claims: 30, tests: 20, steps: 12, text: 400, name: 120, description: 1000 });

const q = (s) => JSON.stringify(String(s));
const str = (v, max, field) => {
  if (typeof v !== "string" || !v.trim()) throw new GreenlightError("invalid_request", `${field} is required.`);
  const t = v.trim();
  if (t.length > max) throw new GreenlightError("invalid_request", `${field} is longer than ${max} characters.`);
  return t;
};

/** A public http(s) URL with a trailing slash on the bare origin. */
export function guestUrl(v) {
  let u;
  try {
    u = new URL(String(v ?? "").trim());
  } catch {
    throw new GreenlightError("invalid_request", "Enter the app's full address, starting with https://");
  }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new GreenlightError("invalid_request", "Enter an http(s) address without a username or password.");
  if (isLocalOrPrivateHost(u.hostname)) throw new GreenlightError("url_not_allowed", "Use the app's public address; localhost and private addresses are never tested.");
  u.hash = "";
  return u.toString();
}

/**
 * @param {object} input {name, url, description?, claims:[{id?,text}], tests:[{id?,title,claims:[id],steps:[{name,kind,text}]}]}
 * @returns {string} greenlight.yaml
 */
export function buildSpecYaml(input, L = GUEST_LIMITS) {
  const name = str(input?.name, L.name, "App name");
  const url = guestUrl(input?.url);
  const description = typeof input?.description === "string" && input.description.trim() ? str(input.description, L.description, "Description") : null;
  const claimsIn = Array.isArray(input?.claims) ? input.claims : [];
  const testsIn = Array.isArray(input?.tests) ? input.tests : [];
  if (!claimsIn.length) throw new GreenlightError("invalid_request", "Add at least one claim.");
  if (!testsIn.length) throw new GreenlightError("invalid_request", "Add at least one test.");
  if (claimsIn.length > L.claims) throw new GreenlightError("invalid_request", `At most ${L.claims} claims are allowed here.`);
  if (testsIn.length > L.tests) throw new GreenlightError("invalid_request", `At most ${L.tests} tests are allowed here.`);

  // Claim ids are assigned in order (CLM-001...); tests refer to claims by id or by position.
  const claims = claimsIn.map((c, i) => ({ given: typeof c?.id === "string" ? c.id.trim() : null, id: `CLM-${String(i + 1).padStart(3, "0")}`, text: str(c?.text, L.text, `Claim ${i + 1}`) }));
  const claimId = (ref) => claims.find((c) => c.given === ref || c.id === ref)?.id ?? null;
  const usedIds = new Set();
  const lines = ["version: 1", "project:", `  name: ${q(name)}`];
  if (description) lines.push(`  description: ${q(description)}`);
  lines.push(`  url: ${q(url)}`, "claims:");
  for (const c of claims) lines.push(`  - id: ${c.id}`, `    text: ${q(c.text)}`);
  lines.push("tests:");
  testsIn.forEach((t, i) => {
    const title = str(t?.title, L.text, `Test ${i + 1} title`);
    let id = String(t?.id ?? title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50).replace(/-+$/g, "") || `test-${i + 1}`;
    while (usedIds.has(id)) id = `${id.slice(0, 46)}-${i + 1}`.replace(/-+/g, "-");
    usedIds.add(id);
    const refs = (Array.isArray(t?.claims) ? t.claims : []).map(claimId).filter(Boolean);
    if (!refs.length) throw new GreenlightError("invalid_request", `Test ${i + 1} must check at least one claim.`);
    const steps = Array.isArray(t?.steps) ? t.steps : [];
    if (!steps.length) throw new GreenlightError("invalid_request", `Test ${i + 1} needs steps.`);
    if (steps.length > L.steps) throw new GreenlightError("invalid_request", `Test ${i + 1} has more than ${L.steps} steps.`);
    lines.push(`  - id: ${id}`, `    title: ${q(title)}`, `    claims: [${[...new Set(refs)].join(", ")}]`, "    steps:");
    steps.forEach((s, n) => {
      const kind = s?.kind === "expect_text" ? "expect_text" : s?.kind === "do" ? "do" : s?.kind === "check" ? "check" : null;
      if (!kind) throw new GreenlightError("invalid_request", `Test ${i + 1}, step ${n + 1}: choose "do" or "expect text".`);
      const sName = typeof s?.name === "string" && s.name.trim() ? s.name.trim().slice(0, 80) : `Step ${n + 1}`;
      lines.push(`      - name: ${q(sName)}`, `        ${kind}: ${q(str(s?.text, L.text, `Test ${i + 1}, step ${n + 1}`))}`);
    });
  });
  return `${lines.join("\n")}\n`;
}

/**
 * Validate a guest spec with the normal rules and the demo's credit cap.
 * @returns {{derived, estimate}} or throws spec_invalid with the problems
 */
export function checkGuestSpec(specText, config) {
  let derived;
  try {
    derived = projectFromText(specText);
  } catch (err) {
    if (err instanceof SpecError) throw new GreenlightError("spec_invalid", "The tests don't follow Greenlight's rules yet.", { problems: err.errors });
    throw new GreenlightError("spec_invalid", "The tests could not be read.", { problems: [String(err?.message ?? err)] });
  }
  const estimate = guestEstimate(derived.spec, config);
  if (estimate.credits > config.guest.maxCreditsPerRun) {
    throw new GreenlightError("spec_invalid", `These tests would cost about ${estimate.credits} credits; the demo allows ${config.guest.maxCreditsPerRun} per run.`, {
      problems: [`Estimated ${estimate.credits} credits is over the demo's ${config.guest.maxCreditsPerRun}. Use fewer tests (at most 3 of up to 3 steps fits) or fewer steps.`],
    });
  }
  return { derived, estimate };
}
