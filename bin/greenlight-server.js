#!/usr/bin/env node
// Greenlight server: certification runs and the v1 API. Configuration is read
// from the environment only; see src/server/config.js and docs/API.md.
// It needs Chrome and an authenticated kane-cli on this machine, and must not
// run as a serverless function (brief §13).

import { loadConfig, createServerContext, startServer } from "../src/server/index.js";

const log = (entry) => process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  process.stderr.write(`greenlight-server: ${err.message}\n`);
  process.exit(2);
}
if (config.tokens.length === 0) process.stderr.write("greenlight-server: warning: no API tokens configured; only public endpoints will work.\n");
const { store, jobs, deps } = await createServerContext({ config, log });
const server = await startServer({ config, store, jobs, now: deps.now, log });
log({ event: "listening", host: config.host, port: server.address().port });

let stopping = false;
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    if (stopping) process.exit(130);
    stopping = true;
    log({ event: "stopping", signal: sig, note: "running jobs finish; queued jobs are marked failed at next start" });
    server.close();
    await jobs.idle();
    process.exit(0);
  });
}
