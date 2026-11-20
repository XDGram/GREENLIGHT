// Greenlight server: wiring of config, store, job runner and HTTP API.
export { loadConfig, authenticate, can, sha256Hex, ROLES } from "./config.js";
export { FileStore, newId, ID } from "./store.js";
export { SupabaseStore } from "./supabase/store.js";
export { createSupabaseClient } from "./supabase/client.js";
export { JobRunner } from "./jobs.js";
export { createApp, startServer, RateLimiter } from "./http.js";
export { checkRuntime, findChrome, CHROME_PATHS } from "./runtime.js";
export { prepareCertification, runCertification } from "./certify.js";
export { SCHEMAS, JOB_STATUS, SERVER_APPROVAL_METHOD, buildApproval, approvalValidFor, buildVerificationRecord, publicRecord, publicHash, verifyRecordIntegrity, selfHash } from "./models.js";

import { runKane } from "../kane/runner.js";
import { readBalance, kaneBalanceReader } from "../credits/balance.js";
import { kaneEvidenceValidator } from "../evidence/validate.js";
import { verifyLiveDeployment } from "../deploy/check.js";
import { FileStore } from "./store.js";
import { SupabaseStore } from "./supabase/store.js";
import { JobRunner } from "./jobs.js";

/** Real external effects for the server. Tests pass their own. */
export function serverDeps(config) {
  const command = config.kaneBin;
  return {
    runKane: (opts) => runKane({ command, ...opts }),
    readBalance: () => readBalance(kaneBalanceReader({ command })),
    validator: kaneEvidenceValidator({ command }),
    verifyLiveDeployment,
    now: () => new Date(),
  };
}

/**
 * The configured store. Supabase is the production store; the file store is only
 * for tests and as a migration source (bin/greenlight-server.js refuses it).
 */
export function createStore(config, { fetchImpl } = {}) {
  if (config.store === "supabase") {
    return new SupabaseStore({ url: config.supabase.url, serviceRoleKey: config.supabase.serviceRoleKey, bucket: config.supabase.bucket, workRoot: config.workDir, fetchImpl });
  }
  return new FileStore(config.dataDir);
}

/** Build the store and job runner, and settle any job a previous process left running. */
export async function createServerContext({ config, deps = serverDeps(config), log = () => {}, store = createStore(config) }) {
  const jobs = new JobRunner({ store, config, deps, log });
  await jobs.recover();
  return { store, jobs, deps };
}
