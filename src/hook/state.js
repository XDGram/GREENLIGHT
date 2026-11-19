// Verification state (.greenlight/state.json), a lock against concurrent hook
// runs, and the .greenlight/.gitignore that keeps Greenlight's own local files
// out of git (otherwise every hook run would leave the working tree dirty and
// the deployment checker would refuse to verify).

import path from "node:path";
import { readFile, writeFile, rename, open, unlink, mkdir } from "node:fs/promises";

export const STATE_FILE = path.join(".greenlight", "state.json");
export const LOCK_FILE = path.join(".greenlight", "hook.lock");
export const GREENLIGHT_GITIGNORE = path.join(".greenlight", ".gitignore");
export const STATE_SCHEMA = "greenlight.state/v1";
export const MAX_FIX_ATTEMPTS = 3;

// Local-only files. approval.json, the generated *_test.md files and
// greenlight.yaml are NOT listed: they belong in git.
export const GITIGNORE_CONTENT = `# Written by Greenlight. Local files only; do not commit these.
.gitignore
state.json
hook.lock
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
    history: [], // last 20 runs: { commit, result, at }
  };
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
 * Exclusive lock. A lock left by a dead process, or older than staleMs, is taken over.
 * @returns {Promise<{acquired: true, release: () => Promise<void>} | {acquired: false, holder: object}>}
 */
export async function acquireLock(root, { pid = process.pid, now = () => new Date(), staleMs = 2 * 60 * 60 * 1000, isAlive = defaultIsAlive } = {}) {
  const file = path.join(root, LOCK_FILE);
  await mkdir(path.dirname(file), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fh = await open(file, "wx");
      await fh.writeFile(JSON.stringify({ pid, at: now().toISOString() }));
      await fh.close();
      let released = false;
      return {
        acquired: true,
        release: async () => {
          if (released) return;
          released = true;
          try {
            const holder = JSON.parse(await readFile(file, "utf8"));
            if (holder.pid === pid) await unlink(file);
          } catch {
            /* already gone */
          }
        },
      };
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      let holder = null;
      try {
        holder = JSON.parse(await readFile(file, "utf8"));
      } catch {
        /* unreadable lock: treat as stale */
      }
      const age = holder?.at ? now().getTime() - new Date(holder.at).getTime() : Infinity;
      const stale = !holder || !Number.isInteger(holder.pid) || !isAlive(holder.pid) || !(age < staleMs);
      if (!stale || attempt > 0) return { acquired: false, holder };
      await unlink(file).catch(() => {});
    }
  }
  return { acquired: false, holder: null };
}
