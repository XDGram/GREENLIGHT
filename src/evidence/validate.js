// Evidence-pack validation via `kane-cli evidence validate <pack> --json`.
//
// Kane CLI 0.10.6 output (captured from the Run 1 / Run 2 packs):
//   {"valid":true,"status":"finalized","diagnostics":[{"code","severity","location","message"}, ...]}
// Documented exit codes: 0 valid, 1 invalid, 2 not found.
//
// The validator is injectable so tests never run Kane. The default runs the
// pinned Kane binary through the Step 1 runner (process group, timeout, /dev/null stdin).

import { runKane } from "../kane/runner.js";

export const VALIDATE_EXIT = Object.freeze({ VALID: 0, INVALID: 1, NOT_FOUND: 2 });

/**
 * Default validator: runs Kane.
 * @param {{command?: string|string[], timeoutMs?: number, env?: NodeJS.ProcessEnv, cwd?: string}} [opts]
 * @returns {(packPath: string) => Promise<{exitCode: number|null, stdout: string, stderr: string, timedOut: boolean, spawnError: string|null}>}
 */
export function kaneEvidenceValidator({ command, timeoutMs = 60_000, env, cwd } = {}) {
  return async (packPath) => {
    const r = await runKane({
      command,
      args: ["evidence", "validate", packPath, "--json"],
      timeoutMs,
      killGraceMs: 5_000,
      expectedVersion: null, // `evidence validate` emits no stream_start
      ...(env ? { env } : {}),
      ...(cwd ? { cwd } : {}),
    });
    return { exitCode: r.exitCode, stdout: r.stdout, stderr: r.stderr, timedOut: r.timedOut, spawnError: r.spawnError };
  };
}

/** Find the validator's JSON report in its stdout (last JSON object with a boolean `valid`). */
export function parseValidateOutput(stdout) {
  const lines = String(stdout ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const v = JSON.parse(lines[i]);
      if (v && typeof v === "object" && !Array.isArray(v) && typeof v.valid === "boolean") return v;
    } catch {
      /* not JSON */
    }
  }
  return null;
}

/**
 * Interpret a validator run. A pack is accepted only when the exit code is 0
 * AND the report says valid: true. Warnings are kept, never dropped.
 */
export function interpretValidation(raw) {
  const base = {
    exitCode: raw?.exitCode ?? null,
    timedOut: Boolean(raw?.timedOut),
    spawnError: raw?.spawnError ?? null,
    valid: false,
    status: null,
    diagnostics: [],
    warnings: [],
    errors: [],
    outcome: null,
  };
  if (raw?.spawnError || raw?.timedOut || raw?.exitCode === null || raw?.exitCode === undefined) {
    return { ...base, outcome: "validation_unavailable" };
  }
  const report = parseValidateOutput(raw.stdout);
  const diagnostics = Array.isArray(report?.diagnostics) ? report.diagnostics : [];
  const withReport = {
    ...base,
    valid: report?.valid === true,
    status: report?.status ?? null,
    diagnostics,
    warnings: diagnostics.filter((d) => d?.severity === "warning"),
    errors: diagnostics.filter((d) => d?.severity === "error"),
  };
  if (raw.exitCode === VALIDATE_EXIT.NOT_FOUND) return { ...withReport, valid: false, outcome: "not_found_by_validator" };
  if (!report) return { ...withReport, outcome: "validation_output_unreadable" };
  if (raw.exitCode === VALIDATE_EXIT.VALID && report.valid === true) return { ...withReport, outcome: "valid" };
  return { ...withReport, valid: false, outcome: "invalid" };
}
