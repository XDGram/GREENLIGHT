#!/usr/bin/env node
// Greenlight server: certification runs and the v1 API. Configuration is read
// from the environment only; see src/server/config.js and docs/SUPABASE.md.
// Persistence is Supabase (Postgres + Storage); the file-backed store is for
// tests only and is refused here. It needs Chrome and an authenticated kane-cli
// on this machine, and must not run as a serverless function (brief §13).

import { loadConfig, createServerContext, startServer } from "../src/server/index.js";

const log = (entry) => process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  process.stderr.write(`greenlight-server: ${err.message}\n`);
  process.exit(2);
}
if (config.store !== "supabase") {
  process.stderr.write("greenlight-server: production persistence is Supabase; set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The file store is for tests only.\n");
  process.exit(2);
}
const { store, jobs, deps } = await createServerContext({ config, log });
const server = await startServer({ config, store, jobs, now: deps.now, log });
log({ event: "listening", host: config.host, port: server.address().port, store: config.store, supabase: config.supabase.url, bucket: config.supabase.bucket });

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (stopping) process.exit(130);
    stopping = true;
    log({ event: "stopping", signal: sig, note: "running jobs finish; queued jobs are settled at next start" });
    server.close();
    await jobs.idle();
    process.exit(0);
  });
}
