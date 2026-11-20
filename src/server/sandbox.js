// Sandbox execution: the API runs on Vercel Functions, and each certification job runs in its
// own Vercel Sandbox (a short-lived microVM) instead of on a persistent server. Inside the
// sandbox, bin/greenlight-worker.js runs the SAME job pipeline (JobRunner.execute ->
// runCertification) against Supabase, with Kane in remote mode: the browser runs on TestMu
// HyperExecute (--remote hyper), still with --local and --no-adaptive-heal.
//
// Secrets (Supabase server key, Kane credentials) go only into the detached command's
// environment, never into files, sandbox defaults, logs or the job document.

import path from "node:path";
import { createHmac, timingSafeEqual } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { errorBody, GreenlightError } from "../cli/errors.js";
import { KANE_CLI_VERSION } from "../kane/runner.js";
import { JobRunner } from "./jobs.js";
import { JOB_STATUS } from "./models.js";

export const SANDBOX_APP_DIR = "/vercel/sandbox/greenlight";
const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Settings the worker needs, copied from the API's environment (secrets marked). */
const FORWARD = ["SUPABASE_URL", "GREENLIGHT_EVIDENCE_BUCKET", "GREENLIGHT_PUBLIC_BASE_URL", "GREENLIGHT_MAX_CREDITS_PER_RUN", "GREENLIGHT_CREDIT_RESERVE", "GREENLIGHT_KANE_TIMEOUT_MINUTES", "GREENLIGHT_DEPLOY_TIMEOUT_SECONDS", "GREENLIGHT_KANE_PROJECT_ID", "GREENLIGHT_KANE_FOLDER_ID", "GREENLIGHT_GUEST_MODE", "GREENLIGHT_GUEST_MAX_CREDITS_PER_RUN", "GREENLIGHT_GUEST_SAMPLE_PROJECT"];
const SECRET_FORWARD = ["SUPABASE_SERVICE_ROLE_KEY", "GREENLIGHT_KANE_USERNAME", "GREENLIGHT_KANE_ACCESS_KEY"];

/** Sandbox lifetime (validated in loadConfig to fit the job and the plan's limit). */
export const sandboxTimeoutMs = (config) => config.sandboxTimeoutMs;
/**
 * Signature a sandbox sends with "job settled" for one job: HMAC-SHA256 of the job id keyed with
 * the Supabase server key the sandbox already holds. It authorises nothing but stopping that
 * job's sandbox, and only once the database says the job is finished.
 */
export const finishedSignature = (serverKey, jobId) => createHmac("sha256", String(serverKey)).update(`greenlight-sandbox-finished:${jobId}`).digest("hex");
export const SANDBOX_FINISHED_PATH = "/v1/sandbox/finished";

/** Each job's sandbox is named after it, so the API can find and stop it. */
export const sandboxName = (jobId) => `greenlight-${jobId.replace(/_/g, "-")}`;

/** Bootstrap run inside the sandbox: install the pinned Kane and its remote plugin, log in, run the job. */
export const BOOTSTRAP = `#!/bin/bash
set -euo pipefail
JOB="$1"
cd ${SANDBOX_APP_DIR}
fail() { unset GREENLIGHT_KANE_USERNAME GREENLIGHT_KANE_ACCESS_KEY; node bin/greenlight-worker.js --fail "$JOB" "$1" || true; exit 1; }
trap 'fail setup' ERR
npm install --no-save --no-audit --no-fund --loglevel=error @testmuai/kane-cli@${KANE_CLI_VERSION} >/dev/null
export GREENLIGHT_KANE_BIN="$PWD/node_modules/.bin/kane-cli"
test "$("$GREENLIGHT_KANE_BIN" --version)" = "${KANE_CLI_VERSION}" || fail kane_version
"$GREENLIGHT_KANE_BIN" plugin install remote-execution </dev/null >/dev/null || fail remote_plugin
LOGIN=(login --username "$GREENLIGHT_KANE_USERNAME" --access-key "$GREENLIGHT_KANE_ACCESS_KEY")
[ -n "\${GREENLIGHT_KANE_PROJECT_ID:-}" ] && LOGIN+=(--project-id "$GREENLIGHT_KANE_PROJECT_ID")
[ -n "\${GREENLIGHT_KANE_FOLDER_ID:-}" ] && LOGIN+=(--folder-id "$GREENLIGHT_KANE_FOLDER_ID")
"$GREENLIGHT_KANE_BIN" "\${LOGIN[@]}" </dev/null >/dev/null 2>&1 || fail kane_login
unset GREENLIGHT_KANE_USERNAME GREENLIGHT_KANE_ACCESS_KEY LOGIN
trap - ERR
exec node bin/greenlight-worker.js "$JOB"
`;

async function listJs(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listJs(p)));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

/** The files the worker needs: Greenlight's src/ and the worker entry point (no dependencies). */
export async function sandboxFiles(root = ROOT) {
  const files = [
    { path: `${SANDBOX_APP_DIR}/package.json`, content: Buffer.from(`${JSON.stringify({ name: "greenlight-worker", private: true, type: "module" })}\n`) },
    { path: `${SANDBOX_APP_DIR}/run-job.sh`, content: Buffer.from(BOOTSTRAP), mode: 0o755 },
    { path: `${SANDBOX_APP_DIR}/bin/greenlight-worker.js`, content: await readFile(path.join(root, "bin", "greenlight-worker.js")) },
  ];
  for (const f of await listJs(path.join(root, "src"))) {
    files.push({ path: `${SANDBOX_APP_DIR}/${path.relative(root, f).split(path.sep).join("/")}`, content: await readFile(f) });
  }
  return files;
}

/**
 * @param {object} p
 * @param {object} p.config   loadConfig() result (execution "sandbox")
 * @param {object} [p.env]    the API's environment (source of forwarded settings and secrets)
 * @param {object} [p.Sandbox] @vercel/sandbox's Sandbox class (tests inject a fake)
 */
export function createSandboxDispatcher({ config, env = process.env, Sandbox, root = ROOT, log = () => {} }) {
  return {
    async dispatch(job) {
      const SandboxClass = Sandbox ?? (await import("@vercel/sandbox")).Sandbox;
      const commandEnv = { GREENLIGHT_KANE_REMOTE: "hyper", GREENLIGHT_WORK_DIR: "/tmp/greenlight-work", GREENLIGHT_SANDBOX_FINISHED_URL: `${config.publicBaseUrl.replace(/\/+$/, "")}${SANDBOX_FINISHED_PATH}` };
      for (const k of [...FORWARD, ...SECRET_FORWARD]) if (env[k]) commandEnv[k] = env[k];
      // Outside Vercel (no OIDC token), the SDK reads VERCEL_TOKEN / VERCEL_TEAM_ID / VERCEL_PROJECT_ID.
      const sbx = await SandboxClass.create({ name: sandboxName(job.id), persistent: false, runtime: "node22", timeout: sandboxTimeoutMs(config), resources: { vcpus: 2 } });
      try {
        await sbx.writeFiles(await sandboxFiles(root));
        const cmd = await sbx.runCommand({ cmd: "bash", args: [`${SANDBOX_APP_DIR}/run-job.sh`, job.id], cwd: SANDBOX_APP_DIR, env: commandEnv, detached: true });
        log({ event: "sandbox_dispatched", jobId: job.id, sandboxId: sbx.sandboxId ?? null, cmdId: cmd?.cmdId ?? null });
        return { sandboxId: sbx.sandboxId ?? null, cmdId: cmd?.cmdId ?? null };
      } catch (err) {
        await sbx.stop?.().catch(() => {});
        throw err;
      }
    },
    /** Stop a job's sandbox (no-op if it is already stopped or gone). */
    async stop(jobId) {
      const SandboxClass = Sandbox ?? (await import("@vercel/sandbox")).Sandbox;
      try {
        const sbx = await SandboxClass.get({ name: sandboxName(jobId), resume: false });
        await sbx.stop();
        log({ event: "sandbox_stopped", jobId });
        return true;
      } catch {
        return false;
      }
    },
  };
}

/**
 * The JobRunner for the API on Vercel Functions: jobs are persisted exactly as before, then each
 * is handed to its own sandbox instead of running in this (short-lived) process. Recovery only
 * settles jobs older than a sandbox's lifetime, since other sandboxes may still be running.
 */
export class SandboxJobRunner extends JobRunner {
  constructor({ dispatcher, ...rest }) {
    super(rest);
    this.dispatcher = dispatcher;
  }

  /** A finished job's sandbox is stopped as soon as the API sees the result (publish polls every 10 s). */
  async onJobRead(job) {
    if (![JOB_STATUS.SUCCEEDED, JOB_STATUS.FAILED].includes(job?.status) || this.stopped?.has(job.id)) return;
    (this.stopped ??= new Set()).add(job.id);
    await this.dispatcher.stop?.(job.id);
  }

  /** The sandbox's own "job settled" report: verify, check the database, then stop it. */
  async onSandboxFinished({ jobId, signature }) {
    if (!/^(job|grn)_[0-9a-f]{32}$/.test(jobId ?? "") || !/^[0-9a-f]{64}$/.test(signature ?? "")) throw new GreenlightError("invalid_request", "jobId and signature are required.");
    const want = Buffer.from(finishedSignature(this.config.supabase.serviceRoleKey, jobId), "hex");
    if (!timingSafeEqual(want, Buffer.from(signature, "hex"))) throw new GreenlightError("unauthorized", "Invalid signature.");
    // A guest demo run (grn_) or a certification job (job_): stop its sandbox once it is settled.
    const job = jobId.startsWith("grn_") ? await this.store.guestGetRun(jobId) : await this.store.getJob(jobId);
    if (![JOB_STATUS.SUCCEEDED, JOB_STATUS.FAILED].includes(job.status)) throw new GreenlightError("conflict", "The job is not finished.");
    (this.stopped ??= new Set()).add(jobId);
    return { jobId, stopped: (await this.dispatcher.stop?.(jobId)) === true };
  }

  staleAfterMs() {
    return sandboxTimeoutMs(this.config) + 5 * 60_000;
  }

  async recover() {
    const settled = await super.recover({ olderThanMs: this.staleAfterMs() });
    for (const id of settled ?? []) await this.dispatcher.stop?.(id);
  }

  /** A guest demo run gets its own sandbox, like a job; the worker sees the grn_ id. */
  async startGuestRun(runId) {
    await this.dispatcher.dispatch({ id: runId });
  }

  /** Persist, dispatch, and only then answer (a function may be frozen after it responds). */
  async submit(p) {
    await this.recover();
    const job = await super.submit(p);
    await this.idle();
    return (await this.store.getJob(job.id)) ?? job;
  }

  pump() {
    while (this.queue.length) {
      const job = this.queue.shift();
      this.running.add(job);
      this.#dispatch(job).finally(() => {
        this.running.delete(job);
        if (!this.running.size && !this.queue.length) for (const w of this.idleWaiters.splice(0)) w();
      });
    }
  }

  async #dispatch(job) {
    try {
      await this.dispatcher.dispatch(job);
    } catch (err) {
      this.log({ event: "sandbox_dispatch_failed", jobId: job.id, error: String(err?.message ?? err) });
      const e = err instanceof GreenlightError ? errorBody(err.code, err.message) : errorBody("sandbox_dispatch_failed", "The job's sandbox could not be started; nothing ran and no credits were spent.");
      await this.store.putJob({ ...job, status: JOB_STATUS.FAILED, finishedAt: this.deps.now().toISOString(), error: e });
    }
  }
}
