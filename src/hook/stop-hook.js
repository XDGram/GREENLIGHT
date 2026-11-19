// Claude Code Stop hook (Phase 1, Step 9).
//
// When Claude tries to stop, decide whether the work needs verifying, run
// `greenlight verify` (which keeps every approval, deployment and credit gate),
// and tell Claude what to do:
//
//   exit 0  let Claude stop (nothing to verify, verified, or nothing Claude can do)
//   exit 2  block the stop; stderr goes to Claude (app failure to fix, or
//           uncommitted / unpushed work that must be committed and pushed first)
//   exit 1  let Claude stop, but show the user a blocker (could not verify,
//           a gate needs a person, fix-attempt limit reached, hook problem)
//
// Loop protection: verification runs at most once per commit (an interrupted
// or crashed run may be retried); a failed commit is reported to Claude once;
// "commit/push first" is asked once per commit; at most MAX_FIX_ATTEMPTS
// automatic fix attempts per failure streak; one hook run at a time (lock).

import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkGit } from "../deploy/git.js";
import { checkApproval } from "../spec/approval.js";
import { REPORTS_DIR } from "../report/failure-report.js";
import { redactText } from "../report/redact.js";
import { loadState, saveState, acquireLock, ensureGreenlightGitignore, deriveFixAttempts, MAX_FIX_ATTEMPTS } from "./state.js";

export const HOOK_EXIT = Object.freeze({ ALLOW: 0, BLOCKER: 1, BLOCK: 2 });
const CLI = fileURLToPath(new URL("../../bin/greenlight.js", import.meta.url));
const MAX_MESSAGE = 8000;

// Changes to these never need a new verification.
const IRRELEVANT = [/^\.greenlight\//, /^\.claude\//, /^\.testmuai\//];
export const isRelevantPath = (p) => !IRRELEVANT.some((re) => re.test(p));

const GIT_ALLOWED = new Set(["status", "rev-parse", "merge-base", "ls-remote", "symbolic-ref", "diff"]);

/** Read-only git runner for the hook (adds `diff` to the deploy checker's set). */
export function hookGitRunner(cwd) {
  return (args) =>
    new Promise((resolve) => {
      if (!GIT_ALLOWED.has(args[0])) return resolve({ code: null, stdout: "", stderr: `refused git subcommand: ${args[0]}` });
      execFile("git", ["-C", cwd, ...args], { timeout: 30_000, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) =>
        resolve({ code: err ? (typeof err.code === "number" ? err.code : null) : 0, stdout: stdout ?? "", stderr: stderr ?? "" }),
      );
    });
}

/**
 * Default verifier: runs `greenlight verify` non-interactively (so it can never
 * approve tests or confirm credit spending) and returns its exit code and output.
 */
export function cliVerifier({ timeoutMs = 60 * 60_000, extraArgs = [] } = {}) {
  return ({ cwd, env, signal }) =>
    new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, "verify", ...extraArgs], { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (c) => (out += c));
      child.stderr.on("data", (c) => (err += c));
      const stop = () => {
        child.kill("SIGINT");
        setTimeout(() => child.kill("SIGKILL"), 20_000).unref();
      };
      const timer = setTimeout(stop, timeoutMs);
      signal?.addEventListener?.("abort", stop, { once: true });
      child.on("error", (e) => {
        clearTimeout(timer);
        resolve({ exitCode: null, stdout: out, stderr: `${err}${e.message}`, aborted: Boolean(signal?.aborted) });
      });
      child.on("close", (code, sig) => {
        clearTimeout(timer);
        signal?.removeEventListener?.("abort", stop);
        resolve({ exitCode: code ?? (sig === "SIGINT" ? 130 : null), stdout: out, stderr: err, aborted: Boolean(signal?.aborted) });
      });
    });
}

const short = (sha) => (sha ? sha.slice(0, 12) : "unknown");
const clip = (s) => (s.length > MAX_MESSAGE ? `${s.slice(0, MAX_MESSAGE)}\n… (truncated; see .greenlight/reports/latest.md)` : s);
const tail = (s, n = 20) => String(s ?? "").trim().split("\n").slice(-n).join("\n");

/**
 * Warnings from the report THIS verification wrote (latest.json generated at or
 * after `since`); an older report's warnings are never repeated.
 */
export async function readRunWarnings(cwd, since) {
  try {
    const r = JSON.parse(await readFile(path.join(cwd, REPORTS_DIR, "latest.json"), "utf8"));
    if (!r?.generatedAt || Date.parse(r.generatedAt) < since.getTime()) return [];
    return Array.isArray(r.warnings) ? r.warnings.filter((w) => w && typeof w.code === "string") : [];
  } catch {
    return [];
  }
}

const warningText = (warnings) =>
  warnings.length ? `${warnings.map((w) => `Greenlight warning (${w.code}): ${w.message ?? ""}`.trim()).join("\n")}\n\n` : "";

/**
 * Run the Stop hook once.
 * @param {object} p
 * @param {object} [p.input]   parsed hook JSON from stdin
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string, decision: string, state?: object}>}
 */
export async function runStopHook({
  input = {},
  cwd = input.cwd ?? process.cwd(),
  env = process.env,
  runGit = hookGitRunner(cwd),
  runVerify = cliVerifier({
    extraArgs: [
      ...(env.GREENLIGHT_URL ? ["--url", env.GREENLIGHT_URL] : []),
      // Relayed controlled tests only: the per-run spend confirmation for this one invocation.
      ...(env.GREENLIGHT_CONFIRM_SPEND ? ["--confirm-spend", env.GREENLIGHT_CONFIRM_SPEND] : []),
    ],
  }),
  now = () => new Date(),
  lockOptions = {},
  signal,
  maxFixAttempts = MAX_FIX_ATTEMPTS,
} = {}) {
  const result = (exitCode, decision, { stdout = "", stderr = "" } = {}) => ({ exitCode, decision, stdout, stderr: redactText(stderr) });

  if (input.hook_event_name && input.hook_event_name !== "Stop" && input.hook_event_name !== "SubagentStop") {
    return result(HOOK_EXIT.ALLOW, "not_a_stop_event");
  }
  try {
    await access(path.join(cwd, "greenlight.yaml"));
  } catch {
    return result(HOOK_EXIT.ALLOW, "not_a_greenlight_project");
  }

  await ensureGreenlightGitignore(cwd);
  const lock = await acquireLock(cwd, { now, ...lockOptions });
  if (!lock.acquired) {
    return result(HOOK_EXIT.ALLOW, "already_running", { stdout: `Greenlight: another verification is already running (pid ${lock.holder?.pid ?? "?"}); not starting a second one.` });
  }

  const { state, problem } = await loadState(cwd);
  const at = () => now().toISOString();
  const block = (reason, commit) => {
    state.lastBlock = { commit, reason, at: at() };
  };
  let outcome;
  try {
    outcome = await decide();
  } finally {
    await saveState(cwd, state, now());
    await lock.release();
  }
  return { ...outcome, state };

  async function decide() {
    // A state file that exists but cannot be read (corrupt, unknown schema) could
    // only have been damaged or edited: fail closed, never start a fresh streak.
    if (problem) {
      state.humanNeeded = true;
      state.lastBlock = { commit: null, reason: problem, at: at() };
      return result(HOOK_EXIT.BLOCKER, "state_unreadable", {
        stderr: `Greenlight: .greenlight/state.json is unreadable (${problem}), so the automatic fix-attempt count cannot be trusted. Automatic verification is stopped until a person reviews it and runs greenlight-stop-hook reset.`,
      });
    }

    // Approved tests changed by a human: start a new streak.
    const approval = await checkApproval(cwd);
    if (approval.status === "approved" && approval.approvedHash !== state.approvedHash) {
      if (state.approvedHash) {
        state.fixAttempts = 0;
        state.humanNeeded = false;
      }
      state.approvedHash = approval.approvedHash;
    }

    const git = await checkGit({ runGit });
    const head = git.head;
    state.currentCommit = head;
    if (!head) return result(HOOK_EXIT.BLOCKER, "git_unavailable", { stderr: `Greenlight could not read the git state (${git.reasons.join(", ")}); verification skipped.` });

    // 1. Uncommitted relevant work: ask Claude to commit and push (once per commit).
    const dirty = git.dirtyFiles.filter(isRelevantPath);
    if (dirty.length) {
      return askOnce("uncommitted_changes", head, `Greenlight needs your changes committed and pushed before it can verify the deployed app.\nUncommitted: ${dirty.slice(0, 10).join(", ")}${dirty.length > 10 ? " …" : ""}\nCommit and push, then finish again.`);
    }

    // 2. Nothing new since the last passing verification.
    if (state.lastVerified?.commit === head) return result(HOOK_EXIT.ALLOW, "already_verified");
    if (state.lastVerified?.commit && state.lastRun?.result === "passed") {
      const diff = await runGit(["diff", "--name-only", state.lastVerified.commit, head]);
      if (diff.code === 0 && diff.stdout.split("\n").filter(Boolean).filter(isRelevantPath).length === 0) {
        return result(HOOK_EXIT.ALLOW, "no_relevant_changes");
      }
    }

    // 3. Committed but not pushed: ask Claude to push (once per commit).
    if (git.reasons.includes("unpushed_commit")) {
      return askOnce("unpushed_commit", head, `Greenlight verifies the deployed app, so commit ${short(head)} must be pushed first. Push it, then finish again.`);
    }
    const gitBlockers = git.reasons.filter((r) => r !== "dirty_working_tree");
    if (gitBlockers.length) {
      return result(HOOK_EXIT.BLOCKER, "git_not_ready", { stderr: `Greenlight cannot verify: ${gitBlockers.join(", ")}. A person needs to fix the repository setup.` });
    }

    // 4. Never re-run the same commit (interrupted or crashed runs excepted).
    const final = ["passed", "failed", "couldnt_verify", "blocked"];
    if (state.lastRun?.commit === head && final.includes(state.lastRun.result)) {
      return result(HOOK_EXIT.BLOCKER, "same_commit_already_run", {
        stderr: `Greenlight already verified commit ${short(head)} (${state.lastRun.result}) and will not run it again. Make a new commit, or run greenlight verify yourself.`,
      });
    }

    // 5. Fix-attempt limit reached in this streak. The count can never be lower than
    // what the immutable run records show (deleting state.json does not reset it).
    if (approval.status === "approved") {
      const derived = await deriveFixAttempts(cwd, { approvedHash: approval.approvedHash, since: state.resetAt });
      if (derived.failedCommits > state.fixAttempts) state.fixAttempts = derived.failedCommits;
      // Same rule as a live failure below: the third fix is still verified; a failed
      // commit beyond the limit (failedCommits > max) means a person is needed.
      if (derived.failedCommits > maxFixAttempts) state.humanNeeded = true;
    }
    if (state.humanNeeded) {
      return result(HOOK_EXIT.BLOCKER, "human_needed", {
        stderr: `Greenlight stopped automatic fixing after ${state.maxFixAttempts} attempts. A person needs to review .greenlight/reports/latest.md. Run greenlight-stop-hook reset after reviewing to re-enable it.`,
      });
    }

    // 6. Verify (all gates live inside `greenlight verify`).
    const started = now();
    const v = await runVerify({ cwd, env, signal });
    const runResult = v.aborted || v.exitCode === 130 ? "interrupted" : { 0: "passed", 1: "failed", 3: "couldnt_verify", 4: "blocked" }[v.exitCode] ?? "error";
    const warnings = await readRunWarnings(cwd, started);
    const warn = warningText(warnings);
    state.lastRun = { commit: head, result: runResult, exitCode: v.exitCode, at: at(), durationMs: now() - started, warnings: warnings.map((w) => w.code) };
    state.history.push({ commit: head, result: runResult, at: at() });

    switch (runResult) {
      case "passed":
        state.lastVerified = { commit: head, at: at() };
        state.fixAttempts = 0;
        state.humanNeeded = false;
        return withWarnings(result(HOOK_EXIT.ALLOW, "verified", { stdout: `${warn}Greenlight verified commit ${short(head)}: every approved claim passed.` }));

      case "failed": {
        let report = "";
        const reportPath = path.join(REPORTS_DIR, "latest.md");
        try {
          report = await readFile(path.join(cwd, reportPath), "utf8");
          state.lastReport = { commit: head, path: reportPath, at: at() };
        } catch {
          report = tail(v.stdout, 40);
        }
        if (state.fixAttempts >= maxFixAttempts) {
          state.humanNeeded = true;
          return withWarnings(result(HOOK_EXIT.BLOCKER, "fix_limit_reached", {
            stderr: `${warn}Greenlight: commit ${short(head)} still fails after ${maxFixAttempts} automatic fix attempts. Stopping the loop; a person needs to review ${reportPath}.`,
          }));
        }
        state.fixAttempts += 1;
        block("app_failure", head);
        return withWarnings(result(HOOK_EXIT.BLOCK, "app_failure", {
          stderr: clip(
            `Greenlight verification FAILED for commit ${short(head)} (automatic fix attempt ${state.fixAttempts} of ${maxFixAttempts}).\n\n${warn}${report.trim()}\n\n` +
              "What to do: investigate and fix the APPLICATION code so the approved claims hold, then commit and push. " +
              "Do not edit greenlight.yaml, .greenlight/tests/ or .greenlight/approval.json, and do not weaken or remove approved tests; " +
              "if you believe a test is wrong, explain why and propose the change for a person to approve.",
          ),
        }));
      }

      case "couldnt_verify":
      case "blocked":
        return withWarnings(result(HOOK_EXIT.BLOCKER, runResult, {
          stderr: `${warn}Greenlight could not ${runResult === "blocked" ? "start verification (a gate needs a person)" : "verify the deployment"} for commit ${short(head)}. This is not an application failure; do not change code for it.\n${tail(v.stderr || v.stdout)}`,
        }));

      case "interrupted":
        return withWarnings(result(HOOK_EXIT.BLOCKER, "interrupted", { stderr: `${warn}Greenlight verification of ${short(head)} was interrupted; it will run again next time.` }));

      default:
        return result(HOOK_EXIT.BLOCKER, "error", { stderr: `Greenlight verification failed to run (exit ${v.exitCode}); it will run again next time.\n${tail(v.stderr)}` });
    }
  }

  function withWarnings(r) {
    return { ...r, warnings: state.lastRun?.warnings ?? [] };
  }

  function askOnce(reason, head, message) {
    if (state.lastBlock?.commit === head && state.lastBlock.reason === reason) {
      return result(HOOK_EXIT.BLOCKER, `${reason}_unresolved`, {
        stderr: `Greenlight: ${reason.replace(/_/g, " ")} on ${short(head)} was already raised and is still unresolved; not blocking again. Verification did not run.`,
      });
    }
    block(reason, head);
    return result(HOOK_EXIT.BLOCK, reason, { stderr: message });
  }
}

/** Human-initiated reset after reviewing a stopped streak. */
export async function resetStreak({ cwd = process.cwd(), now = () => new Date() } = {}) {
  const lock = await acquireLock(cwd, { now });
  if (!lock.acquired) return { ok: false, reason: "already_running" };
  try {
    const { state } = await loadState(cwd);
    state.fixAttempts = 0;
    state.humanNeeded = false;
    state.lastRun = null;
    state.lastBlock = null;
    state.resetAt = now().toISOString();
    await saveState(cwd, state, now());
    return { ok: true };
  } finally {
    await lock.release();
  }
}
