// The Anthropic SDK, loaded on first use rather than at import time. The job worker that runs in
// a Vercel Sandbox ships only Greenlight's own files (plus Kane), not node_modules, and it
// imports modules that also contain AI helpers it never calls; a top-level import there would
// crash the worker before it could even record the job as failed.

let sdk = null;

/** The SDK's default export (the Anthropic class with its error classes). */
export async function loadAnthropic() {
  sdk ??= (await import("@anthropic-ai/sdk")).default;
  return sdk;
}

/** The SDK if it has been loaded already, otherwise null (for synchronous error mapping). */
export const loadedAnthropic = () => sdk;
