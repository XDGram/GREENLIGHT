// Reads the Kane credit balance with `kane-cli balance`.
//
// Kane CLI 0.10.6 prints, on stdout:  "Available credits: 11090.8815"  (exit 0)
// The reader is injectable so tests never run Kane. The default uses the Step 1
// runner with a fixed argument list: this module can only ever run `balance`,
// never a test.

import { runKane } from "../kane/runner.js";

const BALANCE_LINE = /Available credits:\s*(-?\d+(?:\.\d+)?)\b/;

/** Kane subcommands that would execute tests. The accountant must never run them. */
const TEST_COMMANDS = new Set(["run", "testmd", "testrun", "explore", "design", "context", "generate", "cover", "maintain"]);

export function assertNotATestCommand(args) {
  if (!Array.isArray(args) || args.length === 0) throw new TypeError("args must be a non-empty array");
  if (TEST_COMMANDS.has(args[0]) || args[0] !== "balance") {
    throw new Error(`credit accountant may only run 'kane-cli balance', not '${args.join(" ")}'`);
  }
}

/** Parse `kane-cli balance` stdout. Returns a number, or null when no balance line is present. */
export function parseBalanceOutput(stdout) {
  const m = BALANCE_LINE.exec(String(stdout ?? ""));
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Default balance reader: runs `kane-cli balance`.
 * @returns {() => Promise<{exitCode: number|null, stdout: string, stderr: string, timedOut: boolean, spawnError: string|null}>}
 */
export function kaneBalanceReader({ command, timeoutMs = 30_000, env, cwd } = {}) {
  const args = ["balance"];
  assertNotATestCommand(args);
  return async () => {
    const r = await runKane({
      command,
      args,
      timeoutMs,
      killGraceMs: 5_000,
      expectedVersion: null, // `balance` emits no stream_start
      ...(env ? { env } : {}),
      ...(cwd ? { cwd } : {}),
    });
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut, spawnError: r.spawnError };
  };
}

/**
 * Read the balance. Never throws for Kane-side problems; returns {ok: false, reason}.
 * @param {() => Promise<object>} [reader]
 */
export async function readBalance(reader = kaneBalanceReader()) {
  let raw;
  try {
    raw = await reader();
  } catch (err) {
    return { ok: false, balance: null, reason: "reader_failed", detail: err?.message ?? String(err) };
  }
  if (raw?.spawnError) return { ok: false, balance: null, reason: "spawn_failed", detail: raw.spawnError };
  if (raw?.timedOut) return { ok: false, balance: null, reason: "timed_out", detail: null };
  if (raw?.exitCode !== 0) {
    return { ok: false, balance: null, reason: "nonzero_exit", detail: `exit ${raw?.exitCode}: ${String(raw?.stderr ?? "").trim().slice(0, 300)}` };
  }
  const balance = parseBalanceOutput(raw.stdout);
  if (balance === null) return { ok: false, balance: null, reason: "unparseable_output", detail: String(raw.stdout ?? "").slice(0, 300) };
  if (balance < 0) return { ok: false, balance, reason: "negative_balance", detail: null };
  return { ok: true, balance, reason: null, detail: null };
}
