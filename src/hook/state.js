// Verification state (.greenlight/state.json), a lock against concurrent hook
// runs, and the .greenlight/.gitignore that keeps Greenlight's own local files
// out of git (otherwise every hook run would leave the working tree dirty and
// the deployment checker would refuse to verify).

import path from "node:path";
import { readFile, writeFile, rename, open, unlink, mkdir, link, readdir } from "node:fs/promises";

export const STATE_FILE = path.join(".greenlight", "state.json");
export const LOCK_FILE = path.join(".greenlight", "hook.lock");
// Held by `greenlight verify` for the whole run, whoever started it (hook or person),
// so two verifications can never run Kane (and spend credits) at the same time.
// It lives under runs/ because every existing .greenlight/.gitignore already
// ignores runs/ (the file is never rewritten), so the lock cannot dirty the tree.
export const VERIFY_LOCK_FILE = path.join(".greenlight", "runs", "verify.lock");
export const GREENLIGHT_GITIGNORE = path.join(".greenlight", ".gitignore");
export const STATE_SCHEMA = "greenlight.state/v1";
export const MAX_FIX_ATTEMPTS = 3;

// Local-only files. approval.json, the generated *_test.md files and
// greenlight.yaml are NOT listed: they belong in git.
export const GITIGNORE_CONTENT = `# Written by Greenlight. Local files only; do not commit these.
.gitignore
state.json
hook.lock
*.lock.stale-*
recordings.json
runs/
reports/
tests/output-*/
tests/helper-output-*/
tests/.testmuai/
`;

/** Create .greenlight/.gitignore if missing (never overwrites). */
export async function ensureGreenlightGitignore(root) {
  await mkdir(path.join(root, ".greenlight"), { recursive: true });
  try {
    await writeFile(path.join(root, GREENLIGHT_GITIGNORE), GITIGNORE_CONTENT, { flag: "wx" });
    return true;
  } catch (err) {
    if (err.code === "EEXIST") return false;
    throw err;
  }
}

export function emptyState() {
  return {
    schema: STATE_SCHEMA,
    createdAt: null,
    updatedAt: null,
    currentCommit: null,
    approvedHash: null,
    lastVerified: null, // { commit, at } - last commit that fully passed
    lastRun: null, // { commit, result, exitCode, at, durationMs }
    lastReport: null, // { commit, path, at }
    lastBlock: null, // { commit, reason, at } - last time Claude was asked to act
    fixAttempts: 0,
    maxFixAttempts: MAX_FIX_ATTEMPTS,
    humanNeeded: false,
    resetAt: null, // last human reset (greenlight-stop-hook reset); runs before it are not counted
    history: [], // last 20 runs: { commit, result, at }
  };
}

/**
 * Fix attempts recomputed from the run records in .greenlight/runs/ (written once,
 * never edited), so deleting or editing state.json cannot reset the limit.
 * Counts DISTINCT deployed commits whose run failed with app failures, for the
 * given approved hash, after the last passing run and after `since` (a human reset).
 * @returns {Promise<{failedCommits: number, runsSeen: number}>}
 */
export async function deriveFixAttempts(root, { approvedHash, since = null } = {}) {
  const runsDir = path.join(root, ".greenlight", "runs");
  let names = [];
  try {
    names = await readdir(runsDir, { withFileTypes: true });
  } catch {
    return { failedCommits: 0, runsSeen: 0 };
  }
  const runs = [];
  for (const d of names) {
    if (!d.isDirectory()) continue;
    try {
      const m = JSON.parse(await readFile(path.join(runsDir, d.name, "manifest.json"), "utf8"));
      if (m?.approvedTestHash !== approvedHash || typeof m.createdAt !== "string") continue;
      if (since && !(Date.parse(m.createdAt) > Date.parse(since))) continue;
      runs.push({ at: Date.parse(m.createdAt), commit: m.deployedCommit, project: m.result?.project ?? null });
    } catch {
      /* unreadable record: not counted here; verifyRunRecord reports it */
    }
  }
  runs.sort((a, b) => a.at - b.at);
  const failed = new Set();
  for (const r of runs) {
    if (r.project === "passed") failed.clear();
    else if (r.project === "failed") failed.add(r.commit);
  }
  return { failedCommits: failed.size, runsSeen: runs.length };
}

/** Read state. A missing file gives a fresh state; an unreadable one is reported. */
export async function loadState(root) {
  let text;
  try {
    text = await readFile(path.join(root, STATE_FILE), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { state: emptyState(), problem: null };
    throw err;
  }
  try {
    const s = JSON.parse(text);
    if (s?.schema !== STATE_SCHEMA) return { state: emptyState(), problem: "state_schema_unknown" };
    return { state: { ...emptyState(), ...s }, problem: null };
  } catch {
    return { state: emptyState(), problem: "state_unreadable" };
  }
}

export async function saveState(root, state, now = new Date()) {
  const s = { ...state, updatedAt: now.toISOString(), createdAt: state.createdAt ?? now.toISOString() };
  s.history = (s.history ?? []).slice(-20);
  const file = path.join(root, STATE_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(`${file}.tmp`, JSON.stringify(s, null, 2) + "\n");
  await rename(`${file}.tmp`, file);
  return s;
}

function defaultIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === "EPERM";
  }
}

/**
 * Exclusive lock (default: the hook lock; pass `file` for another one).
 * A lock left by a dead process, or older than staleMs, is taken over atomically:
 * the stale file is renamed away (only one contender can win that rename), and a
 * contender that finds a FRESH lock under the renamed name puts it back and loses.
 * @returns {Promise<{acquired: true, release: () => Promise<void>} | {acquired: false, holder: object}>}
 */
export async function acquireLock(root, { file: lockRel = LOCK_FILE, pid = process.pid, now = () => new Date(), staleMs = 2 * 60 * 60 * 1000, isAlive = defaultIsAlive } = {}) {
  const file = path.join(root, lockRel);
  await mkdir(path.dirname(file), { recursive: true });
  const token = `${pid}-${now().getTime()}-${Math.random().toString(36).slice(2)}`;
  const readHolder = async (f) => {
    try {
      return JSON.parse(await readFile(f, "utf8"));
    } catch {
      return null;
    }
  };
  const isStale = (holder) => {
    const age = holder?.at ? now().getTime() - new Date(holder.at).getTime() : Infinity;
    return !holder || !Number.isInteger(holder.pid) || !isAlive(holder.pid) || !(age < staleMs);
  };
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const fh = await open(file, "wx");
      await fh.writeFile(JSON.stringify({ pid, at: now().toISOString(), token }));
      await fh.close();
      let released = false;
      return {
        acquired: true,
        release: async () => {
          if (released) return;
          released = true;
          const holder = await readHolder(file);
          if (holder?.token === token) await unlink(file).catch(() => {});
        },
      };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      const holder = await readHolder(file);
      if (!isStale(holder) || attempt === 2) return { acquired: false, holder };
      // Take over: move the stale lock aside. Losing this rename means someone else did.
      const aside = `${file}.stale-${token}`;
      try {
        await rename(file, aside);
      } catch (e) {
        if (e.code === "ENOENT") continue;
        throw e;
      }
      const moved = await readHolder(aside);
      if (moved && !isStale(moved)) {
        // We moved a lock someone took between our read and our rename: restore it.
        await link(aside, file).catch(() => {});
        await unlink(aside).catch(() => {});
        return { acquired: false, holder: moved };
      }
      await unlink(aside).catch(() => {});
    }
  }
  return { acquired: false, holder: null };
}
