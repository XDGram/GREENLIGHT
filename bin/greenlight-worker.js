#!/usr/bin/env node
// Runs ONE certification job inside a Vercel Sandbox (started by src/server/sandbox.js):
//   greenlight-worker <jobId>                  run the queued job with the normal pipeline
//   greenlight-worker --fail <jobId> <reason>  mark it failed when sandbox setup failed
// Configuration comes from the command's environment (Supabase, GREENLIGHT_KANE_REMOTE=hyper).

import { loadConfig, createStore, serverDeps, JobRunner, checkRuntime } from "../src/server/index.js";
import { errorBody } from "../src/cli/errors.js";
import { finishedSignature } from "../src/server/sandbox.js";

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

/** Tell the API the job is settled so it stops this sandbox (it may stop us mid-request: fine). */
async function reportFinished(jobId) {
  const url = process.env.GREENLIGHT_SANDBOX_FINISHED_URL;
  if (!url) return;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId, signature: finishedSignature(config.supabase.serviceRoleKey, jobId) }),
      signal: AbortSignal.timeout(20_000),
    });
    log({ event: "sandbox_finished_reported", jobId, status: res.status });
  } catch (err) {
    log({ event: "sandbox_finished_report_failed", jobId, error: String(err?.name ?? "error") });
  }
}

if (args[0] === "--fail") {
  const [, jobId, reason = "setup"] = args;
  if (!ID.test(jobId ?? "")) process.exit(2);
  const job = await store.getJob(jobId).catch(() => null);
  if (job && (job.status === "queued" || job.status === "running")) {
    await store.putJob({ ...job, status: "failed", finishedAt: new Date().toISOString(), error: errorBody("sandbox_setup_failed", `Sandbox setup failed (${String(reason).replace(/[^a-z_]/g, "").slice(0, 40)}); Kane did not run.`) });
  }
  log({ event: "worker_setup_failed", jobId, reason });
  await reportFinished(jobId);
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
  await reportFinished(jobId);
  process.exit(1);
}
const job = await store.getJob(jobId);
if (job.status !== "queued") {
  log({ event: "worker_skip", jobId, status: job.status });
  await reportFinished(jobId);
  process.exit(0);
}
const runner = new JobRunner({ store, config, deps: serverDeps(config), log });
const done = await runner.execute(job);
log({ event: "worker_done", jobId, status: done.status, outcome: done.outcome ?? null, error: done.error?.code ?? null });
await reportFinished(jobId);
process.exit(done.status === "succeeded" ? 0 : 1);
