// The one-page "check my app" flow: GitHub URL + live URL + README/notes -> claims -> one Kane
// run -> verdict per claim, with Kane's own note on anything that failed.
//
// No AI is involved. Claims are taken from the lines of the README or notes (bullet points
// first), and each claim the person keeps becomes one Kane test with a single `check` step:
// Kane uses the live app and judges whether the claim is true. The person sees the exact claims
// and the cost, and the single Run click both approves those tests and confirms the spend.

import { GreenlightError } from "../cli/errors.js";
import { estimateRun } from "../credits/estimate.js";
import { buildSpecYaml } from "./guest-spec.js";

export const MAX_CLAIM_TEXT = 300;
const MAX_FOUND = 20;

/** Plain text of one markdown line: no links, images, emphasis, code marks or HTML tags. */
function plain(line) {
  return line
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/[`*_~]+/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—:;,.\s]+/, "")
    .trim();
}

/** A claim-sized sentence: a few words, mostly letters, not a heading or a command. */
function usable(t) {
  if (t.length < 8 || t.length > MAX_CLAIM_TEXT) return false;
  if (t.split(" ").length < 3) return false;
  if (!/[a-z]/i.test(t)) return false;
  if (/^(\$|npm |pnpm |yarn |npx |git |cd |docker |pip |curl |node )/i.test(t)) return false;
  if (/^(license|mit|copyright|contributing|installation|getting started|table of contents)\b/i.test(t)) return false;
  return true;
}

/**
 * The claims a README or a list of notes makes, in order. Bullet points and numbered items are
 * taken first (that is where READMEs list features); without any, each line or sentence is one.
 * Pure: exported for tests.
 * @returns {string[]}
 */
export function claimsFromText(text) {
  const src = String(text ?? "").replace(/\r/g, "");
  const bullets = [];
  const lines = [];
  let fenced = false;
  for (const raw of src.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced) continue;
    if (/^\s*#/.test(raw) || /^\s*\|/.test(raw) || /^\s*>/.test(raw) || /^\s*(-{3,}|\*{3,}|={3,})\s*$/.test(raw)) continue;
    const b = /^\s*(?:[-*+•]|\d+[.)]|\[[ xX]\])\s+(.*)$/.exec(raw);
    if (b) bullets.push(plain(b[1].replace(/^\[[ xX]\]\s+/, "")));
    else if (raw.trim()) lines.push(plain(raw));
  }
  let found = bullets.filter(usable);
  if (!found.length) {
    found = lines
      .flatMap((l) => l.split(/(?<=[.!?])\s+(?=[A-Z])/))
      .map((l) => l.trim())
      .filter(usable);
  }
  const seen = new Set();
  const out = [];
  for (const c of found) {
    const k = c.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length >= MAX_FOUND) break;
  }
  return out;
}

/** One claim as typed or kept by the person: one line, no addresses, limited length. */
export function cleanClaim(v, i) {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!t) throw new GreenlightError("invalid_request", `Claim ${i + 1} is empty.`);
  if (t.length > MAX_CLAIM_TEXT) throw new GreenlightError("invalid_request", `Claim ${i + 1} is longer than ${MAX_CLAIM_TEXT} characters.`);
  if (/https?:\/\//i.test(t)) throw new GreenlightError("invalid_request", `Claim ${i + 1} contains a web address; describe the behaviour instead (pages are reached from the live URL).`);
  if (/\{\{|@import|```/.test(t) || /^[#@]/.test(t)) throw new GreenlightError("invalid_request", `Claim ${i + 1} contains characters that can't be used in a test.`);
  return t;
}

/** Credits for a run of n claims (one single-step test each). */
export function checkCost(n, config) {
  const tests = Array.from({ length: n }, (_, i) => ({ file: `claim-${i + 1}_test.md`, author: true, steps: 1 }));
  return estimateRun({ tests }, config.rates ? { rates: config.rates } : {}).credits;
}

/** The most claims one run may hold under this person's per-run ceiling (at least 0). */
export function maxClaims(ceiling, config, hardMax = 8) {
  let n = 0;
  while (n < hardMax && checkCost(n + 1, config) <= ceiling) n += 1;
  return n;
}

/**
 * Where Kane should check a claim: in the live app, or in the code on GitHub. A first guess from the
 * wording; the person can change it before running.
 */
const CODE_WORDS = /\b(code|codebase|source|repo|repository|function|module|endpoint|api route|database|schema|table|migration|env(?:ironment)? var|dependenc(?:y|ies)|package\.json|npm|written in|implemented|typescript|javascript|python|react|next\.js|vite|tests? (?:cover|suite)|unit tests?|ci\b|github actions?|licen[cs]e|readme|commit|config(?:uration)? file|docker|server-side|backend|library|framework)\b/i;
export const guessTarget = (text) => (CODE_WORDS.test(String(text)) ? "code" : "app");

/** greenlight.yaml for a check: one test per claim, each a single `check` step Kane judges, in the app or in the repository. */
export function checkSpecYaml({ name, url, claims, limits, targets = [], repositoryUrl = null }) {
  return buildSpecYaml(
    {
      name,
      url,
      claims: claims.map((text) => ({ text })),
      tests: claims.map((text, i) => ({
        id: `claim-${i + 1}`,
        title: text.length > 120 ? `${text.slice(0, 117)}...` : text,
        claims: [`CLM-${String(i + 1).padStart(3, "0")}`],
        ...(targets[i] === "code" && repositoryUrl ? { startUrl: repositoryUrl } : {}),
        steps: [{ name: "Claim", kind: "check", text }],
      })),
    },
    limits,
  );
}
