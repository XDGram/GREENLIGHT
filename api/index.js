// Vercel Function entry for the Greenlight API (GREENLIGHT_EXECUTION=sandbox). The API itself is
// the unchanged createApp(); certification jobs are dispatched to Vercel Sandboxes, so nothing
// long-running happens in this function. vercel.json rewrites /v1/* here.

import { loadConfig, createStore, createApp } from "../src/server/index.js";
import { SandboxJobRunner, createSandboxDispatcher } from "../src/server/sandbox.js";

const log = (entry) => process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);

export function createHandler({ env = process.env, Sandbox, fetchImpl } = {}) {
  let app;
  const init = async () => {
    const config = loadConfig(env);
    if (config.execution !== "sandbox") throw new Error("set GREENLIGHT_EXECUTION=sandbox for the Vercel deployment");
    const store = createStore(config, { fetchImpl });
    const deps = { now: () => new Date() };
    const jobs = new SandboxJobRunner({ store, config, deps, log, dispatcher: createSandboxDispatcher({ config, env, Sandbox, log }) });
    return createApp({ config, store, jobs, log });
  };
  return async function handler(req, res) {
    app ??= init().catch((err) => {
      app = undefined;
      throw err;
    });
    let handle;
    try {
      handle = await app;
    } catch (err) {
      log({ event: "not_configured", error: err.message });
      res.statusCode = 503;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ error: { code: "server_not_configured", message: "The Greenlight API is not configured." } }));
      return;
    }
    return handle(req, res);
  };
}

export default createHandler();
