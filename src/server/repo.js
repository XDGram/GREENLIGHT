// Repository and deployment lookups for the web app. Read-only, unauthenticated, bounded.
//
// Repository: the developer pastes a GitHub URL (no OAuth). The server asks GitHub's public REST
// API for the repository and the branch head. A private repository answers 404 exactly like a
// missing one, so both are reported as "not found or private": Greenlight never claims to know
// which. Nothing here needs or stores a GitHub credential.
//
// Deployment: one read of <live URL>/greenlight.json (the same endpoint certification checks),
// to show which commit is live before anyone spends credits.

import { GreenlightError } from "../cli/errors.js";
import { endpointFor } from "../deploy/url.js";
import { assertPublicHost } from "../deploy/host.js";
import { checkOnce } from "../deploy/check.js";

const NAME = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;
const BRANCH = /^(?!\/|.*\/\/|.*\.\.|.*@\{|.*\.lock$)[A-Za-z0-9._\/-]{1,200}$/;
const GITHUB_API = "https://api.github.com";

/** https://github.com/<owner>/<repo>[.git][/] -> {owner, repo, url}. Throws invalid_request. */
export function parseRepoUrl(input) {
  let u;
  try {
    u = new URL(String(input ?? "").trim());
  } catch {
    throw new GreenlightError("invalid_request", "Paste the repository's GitHub address, like https://github.com/owner/repo");
  }
  if (u.protocol !== "https:" || !/^(www\.)?github\.com$/i.test(u.hostname) || u.username || u.password) {
    throw new GreenlightError("invalid_request", "Only https://github.com repositories are supported.");
  }
  const parts = u.pathname.replace(/\/+$/, "").replace(/\.git$/, "").split("/").filter(Boolean);
  if (parts.length !== 2 || !NAME.test(parts[0]) || !REPO.test(parts[1]) || parts[1] === "." || parts[1] === "..") {
    throw new GreenlightError("invalid_request", "Use the repository's main address: https://github.com/owner/repo");
  }
  return { owner: parts[0], repo: parts[1], url: `https://github.com/${parts[0]}/${parts[1]}` };
}

export function checkBranch(branch) {
  const b = String(branch ?? "").trim() || "main";
  if (!BRANCH.test(b)) throw new GreenlightError("invalid_request", "That is not a valid branch name.");
  return b;
}

async function getJson(fetchImpl, path) {
  const res = await fetchImpl(`${GITHUB_API}${path}`, {
    headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "user-agent": "greenlight-repo-check" },
    redirect: "follow",
    signal: AbortSignal.timeout(8_000),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body, remaining: res.headers.get("x-ratelimit-remaining") };
}

/**
 * Look up a public repository and the head commit of a branch.
 * @returns {Promise<{status: "ok"|"not_found_or_private"|"branch_not_found"|"unavailable", ...}>}
 */
export async function checkRepository({ owner, repo, branch, fetchImpl = (...a) => globalThis.fetch(...a), now = () => new Date() }) {
  const checkedAt = now().toISOString();
  try {
    const r = await getJson(fetchImpl, `/repos/${owner}/${repo}`);
    if (r.status === 404) return { status: "not_found_or_private", checkedAt, message: "GitHub does not show this repository publicly. It may be private or the address may be wrong. Greenlight still verifies the live app; commits are read from the deployment." };
    if (r.status !== 200 || !r.body) return { status: "unavailable", checkedAt, message: r.status === 403 || r.status === 429 ? "GitHub's public API rate limit was reached; try again shortly." : `GitHub answered HTTP ${r.status}.` };
    const repoInfo = { fullName: r.body.full_name, private: r.body.private === true, defaultBranch: r.body.default_branch ?? null, htmlUrl: r.body.html_url };
    const b = await getJson(fetchImpl, `/repos/${owner}/${repo}/branches/${encodeURIComponent(branch)}`);
    if (b.status === 404) return { status: "branch_not_found", checkedAt, repo: repoInfo, message: `There is no branch "${branch}"${repoInfo.defaultBranch ? `; the default branch is "${repoInfo.defaultBranch}"` : ""}.` };
    if (b.status !== 200 || !b.body?.commit?.sha) return { status: "unavailable", checkedAt, repo: repoInfo, message: `GitHub answered HTTP ${b.status} for the branch.` };
    const c = b.body.commit;
    return {
      status: "ok",
      checkedAt,
      repo: repoInfo,
      head: {
        sha: String(c.sha).toLowerCase(),
        message: String(c.commit?.message ?? "").split("\n")[0].slice(0, 200),
        author: c.commit?.author?.name ?? null,
        date: c.commit?.author?.date ?? null,
        url: c.html_url ?? null,
      },
    };
  } catch {
    return { status: "unavailable", checkedAt, message: "GitHub could not be reached." };
  }
}

/**
 * Is `sha` a commit of this public repository? "unknown" when GitHub cannot tell us (private,
 * missing, rate limited or unreachable): Greenlight then never claims the commit is in the repo.
 * @returns {Promise<{status: "found"|"not_found"|"unknown", checkedAt, url?, message?}>}
 */
export async function checkCommit({ owner, repo, sha, fetchImpl = (...a) => globalThis.fetch(...a), now = () => new Date() }) {
  const checkedAt = now().toISOString();
  if (!/^[0-9a-f]{40}$/.test(String(sha ?? ""))) return { status: "unknown", checkedAt, message: "Not a full commit hash." };
  try {
    const r = await getJson(fetchImpl, `/repos/${owner}/${repo}/commits/${sha}`);
    if (r.status === 200 && r.body?.sha?.toLowerCase() === sha) return { status: "found", checkedAt, url: r.body.html_url ?? `https://github.com/${owner}/${repo}/commit/${sha}`, message: String(r.body.commit?.message ?? "").split("\n")[0].slice(0, 200) };
    if (r.status === 422) return { status: "not_found", checkedAt, message: "GitHub has no commit with this hash in the repository." };
    if (r.status === 404) {
      // A missing commit in a readable repository is 404 too: tell it apart from a private repository.
      const repoCheck = await getJson(fetchImpl, `/repos/${owner}/${repo}`);
      if (repoCheck.status === 200) return { status: "not_found", checkedAt, message: "GitHub has no commit with this hash in the repository." };
      return { status: "unknown", checkedAt, message: "The repository is private or not found, so the commit could not be looked up." };
    }
    return { status: "unknown", checkedAt, message: r.status === 403 || r.status === 429 ? "GitHub's public API rate limit was reached." : `GitHub answered HTTP ${r.status}.` };
  } catch {
    return { status: "unknown", checkedAt, message: "GitHub could not be reached." };
  }
}

/**
 * One read of <url>/greenlight.json: the commit the live deployment reports.
 * @returns {Promise<{status: "ok"|"missing"|"protected"|"invalid"|"unreachable", commit?, environment?, reason?}>}
 */
export async function probeDeployment({ url, fetchImpl = (...a) => globalThis.fetch(...a), checkHost = (h) => assertPublicHost(h), now = () => new Date() }) {
  const checkedAt = now().toISOString();
  const endpoint = endpointFor(url);
  if (!endpoint.ok) return { status: "invalid", checkedAt, reason: endpoint.reason };
  try {
    await checkHost(new URL(endpoint.requestUrl).hostname);
  } catch {
    return { status: "invalid", checkedAt, reason: "not_a_public_address" };
  }
  const r = await checkOnce({ endpoint, expectedCommit: "-", allowedEnvironments: ["preview", "production"], fetchImpl, requestTimeoutMs: 8_000, baseUrl: url });
  if (r.deployedCommit) return { status: "ok", checkedAt, commit: r.deployedCommit, environment: r.environment ?? null, endpoint: endpoint.display };
  const status = r.reason === "endpoint_missing" ? "missing" : r.reason === "deployment_protected" || r.reason === "redirected_possibly_protected" ? "protected" : r.reason === "network_error" || r.reason === "request_timeout" || /^http_5/.test(r.reason ?? "") ? "unreachable" : "invalid";
  return { status, checkedAt, reason: r.reason, endpoint: endpoint.display };
}
