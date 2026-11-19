// Greenlight server: wiring of config, store, job runner and HTTP API.
export { loadConfig, authenticate, can, sha256Hex, ROLES } from "./config.js";
export { FileStore, newId, ID } from "./store.js";
export { JobRunner } from "./jobs.js";
export { createApp, startServer, RateLimiter } from "./http.js";
export { prepareCertification, runCertification } from "./certify.js";
export { SCHEMAS, JOB_STATUS, SERVER_APPROVAL_METHOD, buildApproval, approvalValidFor, buildVerificationRecord, publicRecord, publicHash, verifyRecordIntegrity, selfHash } from "./models.js";

import { runKane } from "../kane/runner.js";
import { readBalance, kaneBalanceReader } from "../credits/balance.js";
import { kaneEvidenceValidator } from "../evidence/validate.js";
import { verifyLiveDeployment } from "../deploy/check.js";
import { FileStore } from "./store.js";
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

/** Build the store and job runner, and fail any job a previous process left running. */
export async function createServerContext({ config, deps = serverDeps(config), log = () => {} }) {
  const store = new FileStore(config.dataDir);
  const jobs = new JobRunner({ store, config, deps, log });
  await jobs.recover();
  return { store, jobs, deps };
}
