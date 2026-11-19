// Secret redaction for failure reports. Applied to every free-text value that
// came from Kane, the deployment or the page (messages, URLs, notes).

const URL_RE = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;

/** origin + path; "?REDACTED" if there was a query; no credentials or fragment. */
export function redactUrl(input) {
  let u;
  try {
    u = new URL(String(input));
  } catch {
    return "REDACTED_URL";
  }
  return `${u.protocol}//${u.host}${u.pathname}${u.search ? "?REDACTED" : ""}`;
}

const RULES = [
  // Authorization schemes
  [/\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 REDACTED"],
  // JWTs
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, "REDACTED_JWT"],
  // key=value / key: value for sensitive keys
  [
    /\b((?:x-vercel-protection-bypass|access[_-]?key|api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret|password|passwd|token|authorization|cookie|session[_-]?id))(\s*[:=]\s*)("?)[^\s"&,;]+/gi,
    "$1$2$3REDACTED",
  ],
  // Common provider token shapes
  [/\b(ghp|gho|ghs|ghu|github_pat|sk|pk|rk|xox[abpr])[-_][A-Za-z0-9_-]{16,}/g, "REDACTED_TOKEN"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "REDACTED_TOKEN"],
];

/**
 * Redact secrets in free text. `extraSecrets` are exact strings that must never
 * appear (e.g. a known account name or bypass value).
 */
export function redactText(value, extraSecrets = []) {
  if (value === null || value === undefined) return value;
  let out = String(value);
  for (const s of [...extraSecrets].filter((x) => typeof x === "string" && x.length >= 3).sort((a, b) => b.length - a.length)) {
    out = out.split(s).join("REDACTED");
  }
  out = out.replace(URL_RE, (m) => {
    const trail = /[.,;:!?]+$/.exec(m)?.[0] ?? "";
    return redactUrl(m.slice(0, m.length - trail.length)) + trail;
  });
  for (const [re, rep] of RULES) out = out.replace(re, rep);
  return out;
}

// Public outputs (latest.public.json, certification records) must not reveal the
// machine they ran on or who ran them: local paths and email addresses are
// removed on top of the secret rules above.
const PATH_RE = /(?:[A-Za-z]:\\[^\s"'<>|]+|(?<![\w.:/])\/(?:home|Users|root|tmp|var|private|opt|mnt|srv|etc|usr|run|workspace|github|builds?)\/[^\s"'<>)\]]*)/g;
const EMAIL_RE = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;

/** redactText() plus local filesystem paths and email addresses. */
export function redactPublicText(value, extraSecrets = []) {
  if (value === null || value === undefined) return value;
  return redactText(value, extraSecrets)
    .replace(PATH_RE, (m) => {
      const trail = /[.,;:!?]+$/.exec(m)?.[0] ?? "";
      return `<local-path>${trail}`;
    })
    .replace(EMAIL_RE, "REDACTED_EMAIL");
}

/** Apply redactPublicText to every string in a JSON-like value (keys untouched). */
export function redactPublicDeep(value, extraSecrets = []) {
  if (typeof value === "string") return redactPublicText(value, extraSecrets);
  if (Array.isArray(value)) return value.map((v) => redactPublicDeep(v, extraSecrets));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactPublicDeep(v, extraSecrets)]));
  return value;
}
