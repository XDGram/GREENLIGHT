#!/usr/bin/env node
// Greenlight CLI (Phase 1, Step 5 subset): generate, approve, status.
// The full CLI comes in a later step.

import { writeGenerated, approve, checkApproval, SpecError } from "../src/spec/index.js";

const USAGE = `Usage: greenlight <command>

  generate   Validate greenlight.yaml and write .greenlight/tests/*_test.md
  approve    Approve the generated tests (a person, at an interactive terminal)
  status     Show whether the current tests are approved
`;

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (rest.length) {
    process.stderr.write(`unexpected arguments: ${rest.join(" ")}\n${USAGE}`);
    return 2;
  }
  const root = process.cwd();
  switch (cmd) {
    case "generate": {
      try {
        const r = await writeGenerated(root);
        for (const f of r.written) process.stdout.write(`wrote      .greenlight/tests/${f}\n`);
        for (const f of r.unchanged) process.stdout.write(`unchanged  .greenlight/tests/${f}\n`);
        for (const f of r.unexpected) process.stdout.write(`unexpected .greenlight/tests/${f} (not in greenlight.yaml)\n`);
        process.stdout.write(`approved-test hash (not yet approved): ${r.hash}\n`);
        return r.unexpected.length ? 1 : 0;
      } catch (err) {
        if (err instanceof SpecError) {
          process.stderr.write(`${err.message}\n`);
          return 1;
        }
        throw err;
      }
    }
    case "approve": {
      const r = await approve({ root });
      return r.approved ? 0 : 1;
    }
    case "status": {
      const s = await checkApproval(root);
      process.stdout.write(`status: ${s.status}\n`);
      if (s.currentHash) process.stdout.write(`current hash:  ${s.currentHash}\n`);
      if (s.approvedHash) process.stdout.write(`approved hash: ${s.approvedHash}\n`);
      for (const r of s.reasons ?? []) process.stdout.write(`  - ${r}\n`);
      return s.status === "approved" ? 0 : 1;
    }
    default:
      process.stderr.write(USAGE);
      return 2;
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err) => {
    process.stderr.write(`greenlight: ${err?.stack ?? err}\n`);
    process.exit(1);
  },
);
