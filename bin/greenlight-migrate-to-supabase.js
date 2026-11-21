#!/usr/bin/env node
// Copy a file-backed Greenlight data directory into Supabase.
//
//   greenlight-migrate-to-supabase --from /var/lib/greenlight            (dry run: reads and compares only)
//   greenlight-migrate-to-supabase --from /var/lib/greenlight --apply    (writes; never overwrites)
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-side; never printed).
// Stop the file-backed server first. The source directory is only read.
// Prints a JSON report: imported / wouldImport / skippedIdentical / conflicts / refused.

import path from "node:path";
import { loadConfig } from "../src/server/config.js";
import { FileStore } from "../src/server/store.js";
import { SupabaseStore } from "../src/server/supabase/store.js";
import { migrateFileStoreToSupabase } from "../src/server/supabase/migrate.js";

const args = process.argv.slice(2);
const from = args[args.indexOf("--from") + 1];
const apply = args.includes("--apply");
if (!args.includes("--from") || !from || !path.isAbsolute(from)) {
  process.stderr.write("usage: greenlight-migrate-to-supabase --from <absolute data dir> [--apply]\n");
  process.exit(2);
}
let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  process.stderr.write(`greenlight-migrate-to-supabase: ${err.message}\n`);
  process.exit(2);
}
if (config.store !== "supabase") {
  process.stderr.write("greenlight-migrate-to-supabase: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY\n");
  process.exit(2);
}
const source = new FileStore(from);
const target = new SupabaseStore({ url: config.supabase.url, serviceRoleKey: config.supabase.serviceRoleKey, bucket: config.supabase.bucket, workRoot: config.workDir });
const report = await migrateFileStoreToSupabase({ source, target, apply, log: (e) => process.stderr.write(`${JSON.stringify(e)}\n`) });
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
process.exit(report.conflicts.length || report.refused.length ? 1 : 0);
