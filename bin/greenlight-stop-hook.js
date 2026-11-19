#!/usr/bin/env node
// Greenlight Claude Code Stop hook. Register it in .claude/settings.json:
//
//   {
//     "hooks": {
//       "Stop": [
//         { "hooks": [ { "type": "command",
//                        "command": "node ./node_modules/greenlight/bin/greenlight-stop-hook.js",
//                        "timeout": 3600 } ] }
//       ]
//     }
//   }
//
// The timeout matters: Claude Code's default is 600 seconds, and a verification
// (deployment wait + Kane) can take longer.
//
// Optional: GREENLIGHT_URL=<live preview URL> overrides project.url for verify.
//
// After a person has reviewed a stopped fix loop:  greenlight-stop-hook reset
//
// Exit 0: allow stop · 2: block, stderr goes to Claude · 1: allow stop, show blocker.

import { runStopHook, resetStreak } from "../src/hook/stop-hook.js";

async function readStdin() {
  if (process.stdin.isTTY) return "";
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

async function main() {
  if (process.argv[2] === "reset") {
    const r = await resetStreak({ cwd: process.cwd() });
    process.stdout.write(r.ok ? "Greenlight: fix-attempt counter reset.\n" : "Greenlight: a verification is running; try again later.\n");
    return r.ok ? 0 : 1;
  }
  if (process.argv.length > 2) {
    process.stderr.write("usage: greenlight-stop-hook [reset]\n");
    return 1;
  }
  let input = {};
  const raw = await readStdin();
  if (raw.trim()) {
    try {
      input = JSON.parse(raw);
    } catch {
      process.stderr.write("Greenlight Stop hook: could not parse hook input; skipping verification.\n");
      return 1;
    }
  }
  const controller = new AbortController();
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => controller.abort());
  const r = await runStopHook({ input, cwd: input.cwd ?? process.cwd(), signal: controller.signal });
  if (r.stdout) process.stdout.write(`${r.stdout}\n`);
  if (r.stderr) process.stderr.write(`${r.stderr}\n`);
  return r.exitCode;
}

main().then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`Greenlight Stop hook error: ${err?.message ?? err}\n`);
    process.exit(1);
  },
);
