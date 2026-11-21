// Runtime readiness of the execution host: the pinned Kane CLI answers and a Chrome
// binary Kane can launch exists. Checked once at startup (spawning `kane-cli --version`
// runs no test and spends no credits); /v1/ready reports the cached result.
// Kane must run as a subprocess on a persistent host, never in a serverless function.

import { execFile } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { KANE_CLI_VERSION } from "../kane/runner.js";

// The Linux paths Kane CLI 0.10.6 searches when KANE_CLI_CHROME_PATH is not set.
export const CHROME_PATHS = Object.freeze([
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome-for-testing",
  "/usr/local/bin/google-chrome-for-testing", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium",
]);

const executable = (p) => {
  try {
    accessSync(p, constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

/** Find the Chrome binary Kane would use. Returns the path or null. */
export function findChrome(env = process.env) {
  const explicit = env.KANE_CLI_CHROME_PATH?.trim();
  if (explicit) return executable(explicit) ? explicit : null;
  return CHROME_PATHS.find(executable) ?? null;
}

function kaneVersion(bin, timeoutMs) {
  return new Promise((resolve) => {
    execFile(bin, ["--version"], { timeout: timeoutMs, env: process.env, maxBuffer: 64 * 1024 }, (err, stdout) => {
      if (err) return resolve({ ok: false, reason: err.code === "ENOENT" ? "kane_not_installed" : "kane_not_runnable" });
      const v = /\b(\d+\.\d+\.\d+)\b/.exec(String(stdout))?.[1] ?? null;
      resolve(v === KANE_CLI_VERSION ? { ok: true, version: v } : { ok: false, reason: "kane_version_mismatch", version: v });
    });
  });
}

/** {ok, kane, chrome} with codes only (paths are not exposed by the API). */
export async function checkRuntime({ kaneBin, env = process.env, timeoutMs = 20_000, requireChrome = true } = {}) {
  const k = await kaneVersion(kaneBin, timeoutMs);
  // With --remote hyper the browser runs on TestMu HyperExecute: no local Chrome is needed.
  const chrome = requireChrome ? findChrome(env) : null;
  return {
    ok: k.ok && (!requireChrome || chrome !== null),
    kane: k.ok ? "ok" : k.reason,
    kaneVersion: k.version ?? null,
    chrome: !requireChrome ? "remote" : chrome ? "ok" : "chrome_not_found",
    chromePath: chrome,
  };
}
