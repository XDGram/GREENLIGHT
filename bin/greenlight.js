#!/usr/bin/env node
// Greenlight CLI entry point. All logic lives in src/cli/main.js.

import { main, EXIT } from "../src/cli/main.js";

const controller = new AbortController();
let interrupts = 0;
// SIGTERM/SIGHUP (e.g. the Stop hook's timeout, a closed terminal) must stop Kane
// exactly like Ctrl-C: Kane runs in its own process group, so dying without
// aborting would leave it running and spending credits.
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(sig, () => {
    interrupts += 1;
    if (interrupts > 1) process.exit(EXIT.INTERRUPTED);
    process.stderr.write(`\nInterrupting (${sig})… (send it again to quit immediately)\n`);
    controller.abort();
  });
}

main(process.argv.slice(2), { signal: controller.signal }).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`greenlight: ${err?.message ?? err}\n`);
    process.exit(EXIT.COULDNT_VERIFY);
  },
);
