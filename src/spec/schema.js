// greenlight.yaml schema (version 1) and validation.
//
//   version: 1
//   project:
//     name: Greenlight Test App              # required
//     description: ...                        # optional
//     url: https://app.example.com/           # required: live application base URL
//   claims:                                   # required, non-empty
//     - id: CLM-001                           # required, stable: CLM-NNN, never reused
//       text: Users can add items to the cart.
//       requirement: ...                      # optional source requirement text
//   tests:                                    # required, non-empty
//     - id: cart-add-two                      # required, stable: becomes cart-add-two_test.md
//       title: Add two items to the cart
//       claims: [CLM-001]                     # one or more claim ids
//       start_path: /                         # optional, relative to project.url
//       mode: testing                         # optional: testing (default) | action
//       max_steps: 15                         # optional, 1-50
//       steps:
//         - name: Open the app
//           do: Open the start page.          # an action, in plain English
//         - name: Check the count
//           expect_text: "Items in cart: 2"   # exact visible text that must be on the page
//
// Verification rules (from the Kane smoke test, where a vision-only check
// misread the page): every test needs at least one `expect_text` step;
// `do` steps may not verify anything; visual-only checks are rejected.

import { parseYamlSubset, YamlSubsetError } from "./yaml-subset.js";
import { isLocalOrPrivateHost } from "../deploy/host.js";

export const SPEC_VERSION = 1;
export const CLAIM_ID = /^CLM-\d{3,}$/;
export const TEST_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TEST_ID = 60;

const TOP_KEYS = new Set(["version", "project", "claims", "tests"]);
const PROJECT_KEYS = new Set(["name", "description", "url"]);
const CLAIM_KEYS = new Set(["id", "text", "requirement"]);
const TEST_KEYS = new Set(["id", "title", "claims", "start_path", "mode", "max_steps", "steps"]);
const STEP_KEYS = new Set(["name", "do", "expect_text"]);
const VISUAL_KEYS = new Set(["expect", "expect_visual", "expect_screenshot", "visual", "looks_like", "see", "screenshot", "expect_image"]);

// Words that make a `do` step a verification. Verification must be expect_text.
const VERIFY_WORDS = /\b(verify|verifies|verified|assert|asserts|confirm|confirms|ensure|ensures|validate|validates|make sure|should|expect|expects)\b/i;

export class SpecError extends Error {
  constructor(errors) {
    super(`greenlight.yaml is invalid:\n  - ${errors.join("\n  - ")}`);
    this.name = "SpecError";
    this.errors = errors;
  }
}

/** Next free claim id, for messages when a claim has none. */
export function nextClaimId(existingIds) {
  let max = 0;
  for (const id of existingIds) {
    const m = /^CLM-(\d+)$/.exec(id ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `CLM-${String(max + 1).padStart(3, "0")}`;
}

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isText = (v) => typeof v === "string" && v.trim() !== "";
const oneLine = (v) => typeof v === "string" && !/[\r\n]/.test(v);

function unknownKeys(obj, allowed, where, errors) {
  for (const k of Object.keys(obj)) if (!allowed.has(k)) errors.push(`${where}: unknown field "${k}"`);
}

function checkBaseUrl(url, errors) {
  let u;
  try {
    u = new URL(url);
  } catch {
    errors.push(`project.url: not a valid URL: ${url}`);
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") errors.push("project.url: must be http or https");
  if (isLocalOrPrivateHost(u.hostname)) {
    errors.push("project.url: must be a deployed URL, not localhost or a private/local address");
  }
  if (u.username || u.password) errors.push("project.url: must not contain credentials");
  if (u.search || u.hash) errors.push("project.url: must not contain a query string or fragment (they can carry secrets)");
  return u;
}

/**
 * Parse and validate greenlight.yaml text. Returns the normalised spec (defaults
 * applied, strings trimmed) or throws SpecError listing every problem found.
 */
export function parseSpec(text) {
  let doc;
  try {
    doc = parseYamlSubset(text);
  } catch (err) {
    if (err instanceof YamlSubsetError) throw new SpecError([`YAML: ${err.message}`]);
    throw err;
  }
  return validateSpec(doc);
}

export function validateSpec(doc) {
  const errors = [];
  if (!isObj(doc)) throw new SpecError(["top level must be a mapping"]);
  unknownKeys(doc, TOP_KEYS, "top level", errors);

  if (doc.version !== SPEC_VERSION) errors.push(`version: must be ${SPEC_VERSION}`);

  // project
  const project = { name: null, description: null, url: null };
  if (!isObj(doc.project)) errors.push("project: required mapping");
  else {
    unknownKeys(doc.project, PROJECT_KEYS, "project", errors);
    if (!isText(doc.project.name) || !oneLine(doc.project.name)) errors.push("project.name: required single-line text");
    else project.name = doc.project.name.trim();
    if (doc.project.description !== undefined && doc.project.description !== null) {
      if (typeof doc.project.description !== "string") errors.push("project.description: must be text");
      else project.description = doc.project.description.trim();
    }
    if (!isText(doc.project.url)) errors.push("project.url: required");
    else if (checkBaseUrl(doc.project.url.trim(), errors)) project.url = new URL(doc.project.url.trim()).href;
  }

  // claims
  const claims = [];
  const claimIds = new Set();
  if (!Array.isArray(doc.claims) || doc.claims.length === 0) errors.push("claims: required, at least one claim");
  else {
    const existing = doc.claims.map((c) => (isObj(c) ? c.id : null));
    doc.claims.forEach((c, i) => {
      const where = `claims[${i}]`;
      if (!isObj(c)) return errors.push(`${where}: must be a mapping`);
      unknownKeys(c, CLAIM_KEYS, where, errors);
      if (c.id === undefined || c.id === null) errors.push(`${where}: missing id (next free id: ${nextClaimId(existing)})`);
      else if (typeof c.id !== "string" || !CLAIM_ID.test(c.id)) errors.push(`${where}.id: must look like CLM-001, got ${JSON.stringify(c.id)}`);
      else if (claimIds.has(c.id)) errors.push(`${where}.id: duplicate claim id ${c.id}`);
      else claimIds.add(c.id);
      if (!isText(c.text) || !oneLine(c.text)) errors.push(`${where}.text: required single-line text`);
      // Claim text is written into an HTML comment in every generated test file.
      else if (c.text.includes("-->") || c.text.includes("<!--")) errors.push(`${where}.text: must not contain "<!--" or "-->"`);
      if (c.requirement !== undefined && c.requirement !== null && typeof c.requirement !== "string") {
        errors.push(`${where}.requirement: must be text`);
      }
      claims.push({ id: c.id, text: isText(c.text) ? c.text.trim() : null, requirement: typeof c.requirement === "string" ? c.requirement.trim() : null });
    });
  }

  // tests
  const tests = [];
  const testIds = new Set();
  const covered = new Set();
  if (!Array.isArray(doc.tests) || doc.tests.length === 0) errors.push("tests: required, at least one test");
  else {
    doc.tests.forEach((t, i) => {
      const where = `tests[${i}]`;
      if (!isObj(t)) return errors.push(`${where}: must be a mapping`);
      unknownKeys(t, TEST_KEYS, where, errors);
      const label = typeof t.id === "string" ? `${where} (${t.id})` : where;

      if (typeof t.id !== "string" || !TEST_ID.test(t.id) || t.id.length > MAX_TEST_ID) {
        errors.push(`${where}.id: required, lowercase words joined by hyphens (max ${MAX_TEST_ID}), got ${JSON.stringify(t.id)}`);
      } else if (testIds.has(t.id)) errors.push(`${where}.id: duplicate test id ${t.id}`);
      else testIds.add(t.id);

      if (!isText(t.title) || !oneLine(t.title)) errors.push(`${label}.title: required single-line text`);

      const tClaims = [];
      if (!Array.isArray(t.claims) || t.claims.length === 0) errors.push(`${label}.claims: required, at least one claim id`);
      else {
        const seen = new Set();
        for (const c of t.claims) {
          if (typeof c !== "string" || !claimIds.has(c)) errors.push(`${label}.claims: unknown claim ${JSON.stringify(c)}`);
          else if (seen.has(c)) errors.push(`${label}.claims: ${c} listed twice`);
          else {
            seen.add(c);
            tClaims.push(c);
            covered.add(c);
          }
        }
      }

      let startPath = "/";
      if (t.start_path !== undefined && t.start_path !== null) {
        if (typeof t.start_path !== "string" || !t.start_path.startsWith("/") || t.start_path.startsWith("//") || /[\s?#]/.test(t.start_path)) {
          errors.push(`${label}.start_path: must be a path starting with "/", without query, fragment or spaces`);
        } else startPath = t.start_path;
      }
      let mode = "testing";
      if (t.mode !== undefined && t.mode !== null) {
        if (t.mode !== "testing" && t.mode !== "action") errors.push(`${label}.mode: must be "testing" or "action"`);
        else mode = t.mode;
      }
      let maxSteps = 15;
      if (t.max_steps !== undefined && t.max_steps !== null) {
        if (!Number.isInteger(t.max_steps) || t.max_steps < 1 || t.max_steps > 50) errors.push(`${label}.max_steps: must be an integer from 1 to 50`);
        else maxSteps = t.max_steps;
      }

      const steps = [];
      if (!Array.isArray(t.steps) || t.steps.length === 0) errors.push(`${label}.steps: required, at least one step`);
      else {
        t.steps.forEach((s, j) => {
          const sw = `${label}.steps[${j}]`;
          if (!isObj(s)) return errors.push(`${sw}: must be a mapping`);
          for (const k of Object.keys(s)) {
            if (VISUAL_KEYS.has(k)) errors.push(`${sw}: visual-only check "${k}" is not allowed; use expect_text with the exact visible text`);
            else if (!STEP_KEYS.has(k)) errors.push(`${sw}: unknown field "${k}"`);
          }
          if (!isText(s.name) || !oneLine(s.name)) errors.push(`${sw}.name: required single-line text`);
          else if (/^#|^```|^@/.test(s.name.trim())) errors.push(`${sw}.name: must not start with #, @ or \`\`\``);
          const hasDo = s.do !== undefined;
          const hasExpect = s.expect_text !== undefined;
          if (hasDo === hasExpect) return errors.push(`${sw}: needs exactly one of "do" or "expect_text"`);
          if (hasDo) {
            const d = s.do;
            if (!isText(d) || !oneLine(d)) return errors.push(`${sw}.do: required single-line text`);
            if (d.length > 500) errors.push(`${sw}.do: longer than 500 characters`);
            if (VERIFY_WORDS.test(d)) errors.push(`${sw}.do: describes a verification; put the exact visible text in an expect_text step instead`);
            if (/https?:\/\//i.test(d)) errors.push(`${sw}.do: must not contain an absolute URL (navigate relative to the app so previews work)`);
            if (/\{\{|@import|^#|```/.test(d.trim())) errors.push(`${sw}.do: must not contain {{variables}}, @import, headings or code fences`);
            steps.push({ name: s.name?.trim?.() ?? null, kind: "do", text: d.trim() });
          } else {
            const e = s.expect_text;
            if (typeof e !== "string" || e.trim() === "") return errors.push(`${sw}.expect_text: required, the exact visible text`);
            if (!oneLine(e)) errors.push(`${sw}.expect_text: must be a single line`);
            if (e !== e.trim()) errors.push(`${sw}.expect_text: must not start or end with spaces`);
            if (e.includes('"')) errors.push(`${sw}.expect_text: must not contain double quotes`);
            if (e.includes("{{")) errors.push(`${sw}.expect_text: must not contain {{variables}}`);
            if (e.length > 200) errors.push(`${sw}.expect_text: longer than 200 characters`);
            steps.push({ name: s.name?.trim?.() ?? null, kind: "expect_text", text: e });
          }
        });
        if (!steps.some((s) => s.kind === "expect_text")) {
          errors.push(`${label}: needs at least one expect_text step (an exact visible-text check)`);
        }
      }
      tests.push({ id: t.id, title: isText(t.title) ? t.title.trim() : null, claims: tClaims, startPath, mode, maxSteps, steps });
    });
  }

  for (const c of claimIds) if (!covered.has(c)) errors.push(`claim ${c}: no test verifies it`);

  if (errors.length) throw new SpecError(errors);
  return { version: SPEC_VERSION, project, claims, tests };
}
