// Greenlight Kane runner (Phase 1, Step 1).
//
// Runs Kane CLI as a separate process, captures stdout / stderr / exit code,
// parses the NDJSON stream incrementally, enforces a timeout (SIGINT, then
// SIGKILL), and reports whether the stream was complete.
//
// It does NOT classify results. Callers get Kane's own per-test reports and a
// completeness assessment; Step 2 turns those into Greenlight statuses.
//
// Process handling notes (Kane CLI 0.10.6):
// - `kane-cli` is a launcher that re-spawns the real CLI on a bundled Node with
//   inherited stdio, and ignores SIGINT itself. The real CLI shares the
//   launcher's process group. We therefore start Kane in its own process group
//   (detached) and signal the whole group, so the signal reaches the real CLI.
// - stdin is /dev/null ("ignore"): `testrun run` only emits NDJSON when stdin is
//   not a TTY, and agent runs must never wait on a prompt.

import { spawn } from "node:child_process";
import { NdjsonDecoder } from "./ndjson.js";
import { TestrunStream, assessCompleteness } from "./testrun-stream.js";

export const KANE_CLI_VERSION = "0.10.6";
export const KANE_NPM_PACKAGE = "@testmuai/kane-cli";
export const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_KILL_GRACE_MS = 15 * 1000;

// Kane options that write to Test Manager / the cloud, re-author approved tests,
// or move execution off this machine. Greenlight never passes them.
export const REMOTE_BACKEND = "hyper";
export const FORBIDDEN_KANE_ARGS = Object.freeze(["--push", "--author", "--remote", "--code-export", "--evidence-publish"]);

/**
 * Build the argument list for a Greenlight verification run.
 * --local (no Test Manager upload) and --no-adaptive-heal (no silent test
 * rewrites) are mandatory: asking to turn either off throws, as does any
 * upload/re-author option in extraArgs.
 */
export function buildTestrunArgs({
  testFiles,
  startUrl,
  runName,
  headless = true,
  local = true,
  noAdaptiveHeal = true,
  remote = null,
  extraArgs = [],
}) {
  if (!Array.isArray(testFiles) || testFiles.length === 0) {
    throw new TypeError("buildTestrunArgs: testFiles must be a non-empty array");
  }
  for (const f of testFiles) {
    if (typeof f !== "string" || !f.endsWith("_test.md")) {
      throw new TypeError(`buildTestrunArgs: not a *_test.md file: ${f}`);
    }
  }
  if (local !== true) throw new TypeError("buildTestrunArgs: --local is mandatory (Test Manager uploads are never enabled)");
  if (noAdaptiveHeal !== true) throw new TypeError("buildTestrunArgs: --no-adaptive-heal is mandatory (approved tests must not be rewritten)");
  if (!Array.isArray(extraArgs) || extraArgs.some((a) => typeof a !== "string")) throw new TypeError("buildTestrunArgs: extraArgs must be strings");
  // Remote execution only through this option, only on TestMu HyperExecute ("hyper"), and still
  // with --local and --no-adaptive-heal: the browser runs on the grid, nothing is uploaded to
  // Test Manager, and the sealed evidence pack comes back to this machine.
  if (remote !== null && remote !== REMOTE_BACKEND) throw new TypeError(`buildTestrunArgs: the only remote backend is ${REMOTE_BACKEND}`);
  const forbidden = extraArgs.filter((a) => FORBIDDEN_KANE_ARGS.includes(a.split("=")[0]));
  if (forbidden.length) throw new TypeError(`buildTestrunArgs: forbidden Kane option(s): ${forbidden.join(", ")}`);
  const args = ["testrun", "run", ...testFiles, "--agent"];
  if (headless && !remote) args.push("--headless");
  if (noAdaptiveHeal) args.push("--no-adaptive-heal");
  if (local) args.push("--local");
  if (remote) args.push("--remote", remote);
  if (startUrl !== undefined) {
    let url;
    try {
      url = new URL(startUrl);
    } catch {
      throw new TypeError(`buildTestrunArgs: invalid startUrl: ${startUrl}`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new TypeError(`buildTestrunArgs: startUrl must be http(s): ${startUrl}`);
    }
    args.push("--override-start-url", startUrl);
  }
  if (runName !== undefined) {
    if (!/^[A-Za-z0-9_-]+$/.test(runName)) throw new TypeError(`buildTestrunArgs: invalid runName: ${runName}`);
    args.push("--name", runName);
  }
  args.push(...extraArgs);
  return args;
}

/** Resolve the Kane command. A string is a binary path; an array is [bin, ...prefixArgs]. */
function normaliseCommand(command) {
  if (Array.isArray(command) && command.length > 0) return { bin: command[0], prefix: command.slice(1) };
  if (typeof command === "string" && command.length > 0) return { bin: command, prefix: [] };
  return { bin: process.env.GREENLIGHT_KANE_BIN || "kane-cli", prefix: [] };
}

/**
 * Run Kane once.
 *
 * @param {object} opts
 * @param {string|string[]} [opts.command]   Kane binary (default: $GREENLIGHT_KANE_BIN or "kane-cli").
 * @param {string[]} opts.args              Arguments, e.g. from buildTestrunArgs().
 * @param {string} [opts.cwd]
 * @param {NodeJS.ProcessEnv} [opts.env]
 * @param {number} [opts.timeoutMs]         Overall time limit. SIGINT is sent when it expires.
 * @param {number} [opts.killGraceMs]       Time between SIGINT and SIGKILL.
 * @param {string|null} [opts.expectedVersion]  Pinned Kane version; null disables the check.
 * @param {boolean} [opts.abortOnVersionMismatch]  Stop the run (SIGINT) if stream_start reports another version.
 * @param {(event: object) => void} [opts.onEvent]  Called for every parsed event, as it arrives.
 * @param {AbortSignal} [opts.abortSignal]  Aborting stops Kane like a timeout (SIGINT, then SIGKILL).
 * @returns {Promise<KaneRunResult>}
 */
/** Server secrets Kane (a third-party CLI) never needs; they are removed from its environment. */
const SERVER_SECRETS = /^(SUPABASE_SERVICE_ROLE_KEY|GREENLIGHT_APPROVAL_SIGNING_KEY|GREENLIGHT_KANE_USERNAME|GREENLIGHT_KANE_ACCESS_KEY|ANTHROPIC_API_KEY|GREENLIGHT_GOOGLE_CLIENT_SECRET|GREENLIGHT_VERCEL_APP_CLIENT_SECRET|GREENLIGHT_GITHUB_TOKEN|VERCEL_TOKEN|VERCEL_OIDC_TOKEN)$/;

/** The environment Kane runs with: this process's, minus server secrets. Exported for tests. */
export function kaneEnv(env = process.env) {
  const out = {};
  for (const [k, v] of Object.entries(env)) if (!SERVER_SECRETS.test(k)) out[k] = v;
  return out;
}

export function runKane({
  command,
  args,
  cwd = process.cwd(),
  env = kaneEnv(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
  killGraceMs = DEFAULT_KILL_GRACE_MS,
  expectedVersion = KANE_CLI_VERSION,
  abortOnVersionMismatch = true,
  onEvent = () => {},
  abortSignal,
} = {}) {
  if (!Array.isArray(args)) throw new TypeError("runKane: args must be an array");
  const { bin, prefix } = normaliseCommand(command);
  const fullArgs = [...prefix, ...args];

  const stream = new TestrunStream();
  const nonJsonLines = [];
  const stdoutChunks = [];
  const stderrChunks = [];
  const signalsSent = [];
  let timedOut = false;
  let aborted = false;
  let versionMismatch = false;
  let spawnError = null;
  let callbackErrors = 0;

  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  return new Promise((resolve) => {
    let child;
    let timeoutTimer = null;
    let killTimer = null;
    let settled = false;

    const decoder = new NdjsonDecoder({
      onEvent: (event) => {
        stream.apply(event);
        if (
          event.type === "stream_start" &&
          expectedVersion !== null &&
          event.cli_version !== expectedVersion &&
          !versionMismatch
        ) {
          versionMismatch = true;
          if (abortOnVersionMismatch) stop("version_mismatch");
        }
        try {
          onEvent(event);
        } catch {
          callbackErrors += 1;
        }
      },
      onNonJson: (line, lineNumber, reason) => nonJsonLines.push({ lineNumber, reason, line: line.slice(0, 500) }),
    });

    const sendSignal = (signal, reason) => {
      if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
      signalsSent.push({ signal, reason, atMs: Date.now() - startedAtMs });
      try {
        process.kill(-child.pid, signal); // whole process group
      } catch {
        try {
          child.kill(signal);
        } catch {
          /* already gone */
        }
      }
    };

    // Graceful stop: SIGINT now, SIGKILL after the grace period.
    function stop(reason) {
      if (killTimer) return;
      sendSignal("SIGINT", reason);
      killTimer = setTimeout(() => sendSignal("SIGKILL", `${reason}:grace_expired`), killGraceMs);
    }

    const finish = (exitCode, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      decoder.end();
      const endedAtMs = Date.now();
      const snapshot = stream.snapshot();
      abortSignal?.removeEventListener?.("abort", onAbort);
      const proc = { exitCode, signal, timedOut, versionMismatch, spawnError, aborted };
      resolve({
        kaneVersionPinned: expectedVersion,
        command: [bin, ...fullArgs],
        cwd,
        startedAt,
        endedAt: new Date(endedAtMs).toISOString(),
        durationMs: endedAtMs - startedAtMs,
        exitCode,
        signal,
        spawnError,
        timedOut,
        aborted,
        versionMismatch,
        signalsSent,
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        nonJsonLines,
        callbackErrors,
        stream: snapshot,
        completeness: assessCompleteness(snapshot, proc),
      });
    };

    function onAbort() {
      aborted = true;
      stop("aborted");
    }
    if (abortSignal?.aborted) {
      aborted = true;
      finish(null, null); // never started
      return;
    }
    abortSignal?.addEventListener?.("abort", onAbort, { once: true });

    try {
      child = spawn(bin, fullArgs, {
        cwd,
        env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: true,
      });
    } catch (err) {
      spawnError = err?.message ?? String(err);
      finish(null, null);
      return;
    }

    child.stdout.on("data", (chunk) => {
      stdoutChunks.push(chunk);
      decoder.push(chunk);
    });
    child.stderr.on("data", (chunk) => stderrChunks.push(chunk));

    child.on("error", (err) => {
      spawnError = err?.message ?? String(err);
      // If the process never started, 'close' may not follow.
      if (!child.pid) finish(null, null);
    });
    child.on("close", (code, signal) => finish(code, signal));

    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timeoutTimer = setTimeout(() => {
        timedOut = true;
        stop("timeout");
      }, timeoutMs);
    }
  });
}

/**
 * @typedef {object} KaneRunResult
 * @property {string|null} kaneVersionPinned
 * @property {string[]} command
 * @property {string} cwd
 * @property {string} startedAt
 * @property {string} endedAt
 * @property {number} durationMs
 * @property {number|null} exitCode      null when the process was killed by a signal or never started
 * @property {string|null} signal
 * @property {string|null} spawnError
 * @property {boolean} timedOut
 * @property {boolean} aborted        stopped through abortSignal (e.g. Ctrl-C in the CLI)
 * @property {boolean} versionMismatch
 * @property {{signal: string, reason: string, atMs: number}[]} signalsSent
 * @property {string} stdout             raw, byte-for-byte as received (UTF-8 decoded)
 * @property {string} stderr
 * @property {{lineNumber: number, reason: string, line: string}[]} nonJsonLines
 * @property {number} callbackErrors
 * @property {ReturnType<TestrunStream["snapshot"]>} stream
 * @property {ReturnType<typeof assessCompleteness>} completeness
 */
