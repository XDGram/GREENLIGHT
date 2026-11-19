#!/usr/bin/env node
// Stand-in for `kane-cli evidence validate <pack> --json`. Never runs Kane.
//   FAKE_VALIDATE_OUTPUT  file whose contents are printed as the report (default: valid, no diagnostics)
//   FAKE_VALIDATE_EXIT    exit code (default 0)
//   FAKE_VALIDATE_MODE    "hang" to never exit; "garbage" to print non-JSON
// A pack path that does not exist exits 2, matching Kane's documented "not found".

import { existsSync, readFileSync } from "node:fs";

const [, , cmd, sub, pack, flag] = process.argv;
if (cmd !== "evidence" || sub !== "validate" || flag !== "--json") {
  process.stderr.write(`unexpected args: ${process.argv.slice(2).join(" ")}\n`);
  process.exit(99);
}
process.stderr.write("Skill update available: not installed → 0.1.4\n");
if (process.env.FAKE_VALIDATE_MODE === "hang") {
  setInterval(() => {}, 1000);
} else if (!existsSync(pack)) {
  process.stderr.write(`error: evidence not found: ${pack}\n`);
  process.exit(2);
} else if (process.env.FAKE_VALIDATE_MODE === "garbage") {
  process.stdout.write("validation complete (no JSON here)\n");
  process.exit(Number(process.env.FAKE_VALIDATE_EXIT ?? 0));
} else {
  const report = process.env.FAKE_VALIDATE_OUTPUT
    ? readFileSync(process.env.FAKE_VALIDATE_OUTPUT, "utf8").trim()
    : '{"valid":true,"status":"finalized","diagnostics":[]}';
  process.stdout.write(report + "\n");
  process.exit(Number(process.env.FAKE_VALIDATE_EXIT ?? 0));
}
