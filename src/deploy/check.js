// Live deployment checker (Phase 1, Step 6).
//
// Before Kane may run, the deployed application must be serving exactly the
// commit Greenlight expects:
//   1. git: clean working tree, HEAD is the expected commit, and it is pushed;
//   2. poll <deployed URL>/greenlight.json until {"commit": <expected>} appears,
//      with a valid environment, within a bounded time.
//
// Final states:
//   ready             commit and environment match: Kane may run
//   stale_deployment  the URL kept serving another commit until the timeout
//   couldnt_verify    git not ready, endpoint missing/unreadable/protected,
//                     HTTP errors, wrong environment, bad URL, timeout
// "pending" is the per-attempt state while polling.
//
// Independent of Kane and of credit accounting: this module never imports
// them and never starts any process other than `git`.

import { checkGit, gitRunner } from "./git.js";
import { endpointFor, redactUrl, redactText } from "./url.js";

export const DEPLOY_STATE = Object.freeze({
  READY: "ready",
  PENDING: "pending",
  STALE: "stale_deployment",
  COULDNT_VERIFY: "couldnt_verify",
});

export const DEFAULT_ALLOWED_ENVIRONMENTS = Object.freeze(["preview", "production"]);
const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const MAX_BODY_BYTES = 64 * 1024;

export class DeploymentNotReadyError extends Error {
  constructor(result) {
    super(`deployment is not ready (${result?.state ?? "unknown"}: ${(result?.reasons ?? []).join(", ")}); Kane must not run`);
    this.name = "DeploymentNotReadyError";
    this.result = result;
  }
}

/** Gate for callers that launch Kane. Throws unless the check said ready. */
export function requireReady(result) {
  if (!result || result.state !== DEPLOY_STATE.READY || result.safeToRunKane !== true) throw new DeploymentNotReadyError(result);
  return result;
}

async function readBody(res) {
  const reader = res.body?.getReader?.();
  if (!reader) return { text: await res.text(), tooLarge: false };
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_BODY_BYTES) {
      // Not awaited: cancelling a tee'd body can wait forever for the other branch.
      reader.cancel().catch(() => {});
      return { text: null, tooLarge: true };
    }
    chunks.push(value);
  }
  return { text: Buffer.concat(chunks.map((c) => Buffer.from(c))).toString("utf8"), tooLarge: false };
}

/**
 * One request to /greenlight.json.
 * outcome: ready | pending (retry) | stale (retry) | fatal (stop now)
 */
export async function checkOnce({ endpoint, expectedCommit, expectedEnvironment, allowedEnvironments, fetchImpl, requestTimeoutMs, baseUrl }) {
  let res;
  try {
    res = await fetchImpl(endpoint.requestUrl, {
      method: "GET",
      headers: endpoint.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
  } catch (err) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return { outcome: "pending", reason: timedOut ? "request_timeout" : "network_error", error: redactText(err?.message ?? String(err), baseUrl), httpStatus: null };
  }
  const httpStatus = res.status;
  if (httpStatus >= 300 && httpStatus < 400) return { outcome: "fatal", reason: "redirected_possibly_protected", httpStatus };
  if (httpStatus === 401 || httpStatus === 403) return { outcome: "fatal", reason: "deployment_protected", httpStatus };
  if (httpStatus === 404) return { outcome: "pending", reason: "endpoint_missing", httpStatus };
  if (httpStatus === 429 || httpStatus >= 500) return { outcome: "pending", reason: `http_${httpStatus}`, httpStatus };
  if (httpStatus !== 200) return { outcome: "fatal", reason: `http_${httpStatus}`, httpStatus };

  let body;
  try {
    body = await readBody(res);
  } catch (err) {
    return { outcome: "pending", reason: "body_read_failed", error: redactText(err?.message ?? String(err), baseUrl), httpStatus };
  }
  if (body.tooLarge) return { outcome: "fatal", reason: "response_too_large", httpStatus };
  let doc;
  try {
    doc = JSON.parse(body.text);
  } catch {
    return { outcome: "fatal", reason: "malformed_json", httpStatus };
  }
  if (doc === null || typeof doc !== "object" || Array.isArray(doc)) return { outcome: "fatal", reason: "malformed_json", httpStatus };
  const deployedCommit = typeof doc.commit === "string" ? doc.commit.trim().toLowerCase() : null;
  if (!deployedCommit || !SHA.test(deployedCommit)) return { outcome: "fatal", reason: "commit_missing_or_invalid", httpStatus };
  const environment = typeof doc.environment === "string" ? doc.environment : null;

  if (deployedCommit !== expectedCommit) {
    return { outcome: "stale", reason: "commit_mismatch", httpStatus, deployedCommit, environment };
  }
  if (environment === null) return { outcome: "fatal", reason: "environment_missing", httpStatus, deployedCommit };
  if (!allowedEnvironments.includes(environment)) return { outcome: "fatal", reason: "environment_not_allowed", httpStatus, deployedCommit, environment };
  if (expectedEnvironment !== undefined && environment !== expectedEnvironment) {
    return { outcome: "fatal", reason: "environment_mismatch", httpStatus, deployedCommit, environment };
  }
  return { outcome: "ready", reason: null, httpStatus, deployedCommit, environment };
}

/**
 * Full check: git first, then bounded polling.
 *
 * @param {object} p
 * @param {string} p.url                   live deployed base URL (e.g. the preview URL)
 * @param {string} [p.cwd]                 repository (for the default git runner)
 * @param {string} [p.expectedCommit]      defaults to HEAD; must equal HEAD when given
 * @param {string} [p.expectedEnvironment] e.g. "preview"
 * @param {string[]} [p.allowedEnvironments]
 * @param {number} [p.intervalMs]          time between attempts (default 10 s)
 * @param {number} [p.timeoutMs]           overall polling limit (default 10 min)
 * @param {number} [p.requestTimeoutMs]    per-request limit (default 15 s)
 * @param {"tracking-ref"|"ls-remote"} [p.remoteCheck]
 * @param {(args: string[]) => Promise<object>} [p.runGit]
 * @param {typeof fetch} [p.fetchImpl]
 * @param {(ms: number) => Promise<void>} [p.sleep]
 * @param {() => number} [p.clock]
 * @param {(entry: object) => void} [p.log]  receives redacted progress entries
 */
export async function verifyDeployment({
  url,
  cwd = process.cwd(),
  expectedCommit,
  expectedEnvironment,
  allowedEnvironments = DEFAULT_ALLOWED_ENVIRONMENTS,
  intervalMs = 10_000,
  timeoutMs = 10 * 60_000,
  requestTimeoutMs = 15_000,
  remoteCheck = "tracking-ref",
  runGit = gitRunner(cwd),
  fetchImpl = globalThis.fetch,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
  clock = Date.now,
  log = () => {},
}) {
  if (!(Number.isFinite(intervalMs) && intervalMs >= 0)) throw new TypeError("intervalMs must be a non-negative number");
  if (!(Number.isFinite(timeoutMs) && timeoutMs >= 0)) throw new TypeError("timeoutMs must be a non-negative number");
  if (!(Number.isFinite(requestTimeoutMs) && requestTimeoutMs > 0)) throw new TypeError("requestTimeoutMs must be positive");
  if (expectedCommit !== undefined && !SHA.test(String(expectedCommit))) throw new TypeError("expectedCommit must be a full lowercase commit hash");

  const started = clock();
  const display = redactUrl(url);
  const result = (state, reasons, extra = {}) => {
    const r = {
      state,
      reasons,
      safeToRunKane: state === DEPLOY_STATE.READY,
      url: display,
      endpoint: extra.endpoint ?? null,
      expectedCommit: extra.expectedCommit ?? expectedCommit ?? null,
      deployedCommit: extra.deployedCommit ?? null,
      environment: extra.environment ?? null,
      git: extra.git ?? null,
      attempts: extra.attempts ?? [],
      elapsedMs: clock() - started,
    };
    log({ event: "result", state: r.state, reasons: r.reasons, url: r.url });
    return r;
  };

  const endpoint = endpointFor(url);
  if (!endpoint.ok) return result(DEPLOY_STATE.COULDNT_VERIFY, [endpoint.reason]);

  const git = await checkGit({ runGit, expectedCommit, remoteCheck });
  const commit = expectedCommit ?? git.head;
  if (!git.ok) return result(DEPLOY_STATE.COULDNT_VERIFY, git.reasons, { git, endpoint: endpoint.display, expectedCommit: commit });

  const attempts = [];
  const deadline = started + timeoutMs;
  let last = null;
  for (let n = 1; ; n++) {
    const a = await checkOnce({
      endpoint,
      expectedCommit: commit,
      expectedEnvironment,
      allowedEnvironments,
      fetchImpl,
      requestTimeoutMs,
      baseUrl: url,
    });
    const entry = {
      n,
      atMs: clock() - started,
      state: a.outcome === "ready" ? DEPLOY_STATE.READY : a.outcome === "fatal" ? DEPLOY_STATE.COULDNT_VERIFY : DEPLOY_STATE.PENDING,
      reason: a.reason,
      httpStatus: a.httpStatus ?? null,
      deployedCommit: a.deployedCommit ?? null,
      environment: a.environment ?? null,
      ...(a.error ? { error: a.error } : {}),
    };
    attempts.push(entry);
    log({ event: "attempt", ...entry, endpoint: endpoint.display });
    last = a;

    const extra = { git, endpoint: endpoint.display, expectedCommit: commit, attempts, deployedCommit: a.deployedCommit, environment: a.environment };
    if (a.outcome === "ready") return result(DEPLOY_STATE.READY, [], extra);
    if (a.outcome === "fatal") return result(DEPLOY_STATE.COULDNT_VERIFY, [a.reason], extra);
    if (clock() + intervalMs > deadline) {
      if (last.outcome === "stale") return result(DEPLOY_STATE.STALE, ["commit_mismatch", "timed_out"], extra);
      return result(DEPLOY_STATE.COULDNT_VERIFY, [a.reason, "timed_out"], extra);
    }
    await sleep(intervalMs);
  }
}
