// URL handling for the deployment checker.
// Logs and reports never contain credentials, query strings or fragments:
// a query can carry a deployment-protection bypass token.

import { isLocalOrPrivateHost } from "./host.js";

/** origin + path, with "?REDACTED" when a query was present. Never throws. */
export function redactUrl(input) {
  let u;
  try {
    u = new URL(String(input));
  } catch {
    return "<invalid url>";
  }
  return `${u.protocol}//${u.host}${u.pathname}${u.search ? "?REDACTED" : ""}`;
}

/** Replace any occurrence of the secret-bearing parts of `url` in `text`. */
export function redactText(text, url) {
  let out = String(text ?? "");
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return out;
  }
  const secrets = [String(url), u.href, u.search.slice(1), u.hash.slice(1), u.username, u.password, decodeURIComponent(u.password || "")];
  for (const s of secrets.filter((x) => x && x.length >= 3).sort((a, b) => b.length - a.length)) {
    out = out.split(s).join("REDACTED");
  }
  return out;
}

/**
 * Build the /greenlight.json request for a deployed base URL.
 * Credentials move to an Authorization header (fetch refuses them in the URL);
 * the query string is kept on the request (it may hold a bypass token) but
 * never logged; the fragment is dropped.
 * @returns {{ok: true, requestUrl: string, headers: object, display: string} | {ok: false, reason: string}}
 */
export function endpointFor(baseUrl) {
  let u;
  try {
    u = new URL(String(baseUrl));
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, reason: "url_not_http" };
  if (isLocalOrPrivateHost(u.hostname)) return { ok: false, reason: "localhost_not_allowed" };
  const headers = { accept: "application/json", "cache-control": "no-cache", pragma: "no-cache" };
  if (u.username || u.password) {
    headers.authorization = `Basic ${Buffer.from(`${decodeURIComponent(u.username)}:${decodeURIComponent(u.password)}`).toString("base64")}`;
  }
  const endpoint = new URL("/greenlight.json", `${u.protocol}//${u.host}`);
  endpoint.search = u.search;
  return { ok: true, requestUrl: endpoint.href, headers, display: redactUrl(endpoint.href) };
}
