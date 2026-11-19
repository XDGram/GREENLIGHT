#!/usr/bin/env node
// Stand-in for `kane-cli balance`. Never runs Kane.
//   FAKE_BALANCE_FILE  file whose contents are printed (a real captured balance output)
//   FAKE_BALANCE_EXIT  exit code (default 0)
//   FAKE_BALANCE_MODE  "hang" never exits; "not_logged_in" prints Kane's auth error and exits 1
// Records every argument list it was called with to FAKE_BALANCE_LOG, if set.

import { readFileSync, appendFileSync } from "node:fs";

if (process.env.FAKE_BALANCE_LOG) appendFileSync(process.env.FAKE_BALANCE_LOG, JSON.stringify(process.argv.slice(2)) + "\n");
if (process.argv[2] !== "balance") {
  process.stderr.write(`refusing: fake balance only answers 'balance', got ${process.argv.slice(2).join(" ")}\n`);
  process.exit(98);
}
process.stderr.write("Skill update available: not installed → 0.1.4\n");
const mode = process.env.FAKE_BALANCE_MODE;
if (mode === "hang") {
  setInterval(() => {}, 1000);
} else if (mode === "not_logged_in") {
  process.stderr.write("Not authenticated. Run: kane-cli login --oauth\n");
  process.exit(1);
} else {
  process.stdout.write(readFileSync(process.env.FAKE_BALANCE_FILE, "utf8"));
  process.exit(Number(process.env.FAKE_BALANCE_EXIT ?? 0));
}
