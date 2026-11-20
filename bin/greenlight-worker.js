#!/usr/bin/env node
// Runs ONE certification job inside a Vercel Sandbox (started by src/server/sandbox.js):
//   greenlight-worker <jobId>                  run the queued job with the normal pipeline
//   greenlight-worker --fail <jobId> <reason>  mark it failed when sandbox setup failed
// Configuration comes from the command's environment (Supabase, GREENLIGHT_KANE_REMOTE=hyper).

import { loadConfig, createStore, serverDeps, JobRunner, checkRuntime } from "../src/server/index.js";
import { errorBody } from "../src/cli/errors.js";

const log = (entry) => process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
const args = process.argv.slice(2);
const ID = /^job_[0-9a-f]{32}$/;

let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  log({ event: "worker_config_error", error: err.message });
  process.exit(2);
}
if (config.store !== "supabase") {
  log({ event: "worker_config_error", error: "the worker needs Supabase persistence" });
  process.exit(2);
}
const store = createStore(config);

if (args[0] === "--fail") {
  const [, jobId, reason = "setup"] = args;
  if (!ID.test(jobId ?? "")) process.exit(2);
  const job = await store.getJob(jobId).catch(() => null);
  if (job && (job.status === "queued" || job.status === "running")) {
    await store.putJob({ ...job, status: "failed", finishedAt: new Date().toISOString(), error: errorBody("sandbox_setup_failed", `Sandbox setup failed (${String(reason).replace(/[^a-z_]/g, "").slice(0, 40)}); Kane did not run.`) });
  }
  log({ event: "worker_setup_failed", jobId, reason });
  process.exit(1);
}

const jobId = args[0];
if (!ID.test(jobId ?? "")) {
  log({ event: "worker_usage", error: "greenlight-worker <jobId> | --fail <jobId> <reason>" });
  process.exit(2);
}
const runtime = await checkRuntime({ kaneBin: config.kaneBin, requireChrome: !config.kaneRemote });
if (!runtime.ok) {
  log({ event: "worker_not_ready", kane: runtime.kane, chrome: runtime.chrome });
  const job = await store.getJob(jobId).catch(() => null);
  if (job?.status === "queued") await store.putJob({ ...job, status: "failed", finishedAt: new Date().toISOString(), error: errorBody("sandbox_setup_failed", `Kane is not usable in the sandbox (${runtime.kane}).`) });
  process.exit(1);
}
const job = await store.getJob(jobId);
if (job.status !== "queued") {
  log({ event: "worker_skip", jobId, status: job.status });
  process.exit(0);
}
const runner = new JobRunner({ store, config, deps: serverDeps(config), log });
const done = await runner.execute(job);
log({ event: "worker_done", jobId, status: done.status, outcome: done.outcome ?? null, error: done.error?.code ?? null });
process.exit(done.status === "succeeded" ? 0 : 1);
