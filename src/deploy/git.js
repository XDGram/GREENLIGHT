// Git checks before a verification: clean working tree, and the commit that
// should be deployed has been pushed.
//
// Git is run through an injectable `runGit(args) -> {code, stdout, stderr}`.
// The default runs the `git` binary only, with a fixed list of read-only
// subcommands. By default "pushed" is judged against the local upstream
// tracking ref (no network). With remoteCheck: "ls-remote", the remote is
// asked directly.

import { execFile } from "node:child_process";

const SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
const ALLOWED = new Set(["status", "rev-parse", "merge-base", "ls-remote", "symbolic-ref"]);

/** Default git runner: `git -C <cwd> <args>`, read-only subcommands only. */
export function gitRunner(cwd, { timeoutMs = 30_000 } = {}) {
  return (args) =>
    new Promise((resolve) => {
      if (!ALLOWED.has(args[0])) {
        resolve({ code: null, stdout: "", stderr: `refused git subcommand: ${args[0]}` });
        return;
      }
      execFile("git", ["-C", cwd, ...args], { timeout: timeoutMs, encoding: "utf8", env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } }, (err, stdout, stderr) => {
        resolve({ code: err ? (typeof err.code === "number" ? err.code : null) : 0, stdout: stdout ?? "", stderr: stderr ?? "", error: err && typeof err.code !== "number" ? err.message : null });
      });
    });
}

/**
 * @returns {Promise<{ok: boolean, reasons: string[], head: string|null, branch: string|null,
 *   upstream: string|null, remoteCommit: string|null, dirtyFiles: string[]}>}
 */
export async function checkGit({ runGit, expectedCommit, remoteCheck = "tracking-ref" }) {
  const reasons = [];
  const out = { head: null, branch: null, upstream: null, remoteCommit: null, dirtyFiles: [] };

  const status = await runGit(["status", "--porcelain=v1", "--untracked-files=all"]);
  if (status.code !== 0) return { ok: false, reasons: ["git_status_failed"], ...out };
  out.dirtyFiles = status.stdout.split("\n").filter((l) => l.trim() !== "").map((l) => l.slice(3));
  if (out.dirtyFiles.length) reasons.push("dirty_working_tree");

  const head = await runGit(["rev-parse", "HEAD"]);
  const headSha = head.stdout.trim();
  if (head.code !== 0 || !SHA.test(headSha)) return { ok: false, reasons: [...reasons, "no_head_commit"], ...out };
  out.head = headSha;
  if (expectedCommit !== undefined && expectedCommit !== headSha) reasons.push("head_is_not_expected_commit");

  const branch = await runGit(["symbolic-ref", "--short", "-q", "HEAD"]);
  if (branch.code !== 0 || !branch.stdout.trim()) return { ok: false, reasons: [...reasons, "detached_head"], ...out };
  out.branch = branch.stdout.trim();

  const up = await runGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (up.code !== 0 || !up.stdout.trim()) return { ok: false, reasons: [...reasons, "no_upstream"], ...out };
  out.upstream = up.stdout.trim();

  let remoteSha;
  if (remoteCheck === "ls-remote") {
    const slash = out.upstream.indexOf("/");
    const remote = out.upstream.slice(0, slash);
    const remoteBranch = out.upstream.slice(slash + 1);
    const ls = await runGit(["ls-remote", "--exit-code", remote, `refs/heads/${remoteBranch}`]);
    if (ls.code !== 0) return { ok: false, reasons: [...reasons, ls.code === 2 ? "remote_branch_missing" : "remote_unreachable"], ...out };
    remoteSha = ls.stdout.trim().split(/\s+/)[0];
  } else {
    const r = await runGit(["rev-parse", "@{u}"]);
    remoteSha = r.code === 0 ? r.stdout.trim() : null;
  }
  if (!SHA.test(remoteSha ?? "")) return { ok: false, reasons: [...reasons, "remote_commit_unknown"], ...out };
  out.remoteCommit = remoteSha;

  if (remoteSha !== headSha) {
    const anc = await runGit(["merge-base", "--is-ancestor", headSha, remoteSha]);
    if (anc.code === 0) reasons.push("remote_ahead_of_local"); // someone pushed more: local HEAD is not what deploys
    else reasons.push("unpushed_commit");
  }
  return { ok: reasons.length === 0, reasons, ...out };
}
