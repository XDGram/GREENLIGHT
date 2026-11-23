// Stable error codes for the CLI and the API.
//
// A code is a contract: frontends and agents branch on it. Never rename or
// reuse one; add new codes instead. `exit` is the CLI exit code, `http` the API
// status, `action` what the person or agent should do next.

export const EXIT = Object.freeze({ OK: 0, FAILED: 1, USAGE: 2, COULDNT_VERIFY: 3, BLOCKED: 4, INTERRUPTED: 130 });

const E = (exit, http, action) => Object.freeze({ exit, http, action });

export const ERRORS = Object.freeze({
  // usage
  usage_error: E(EXIT.USAGE, 400, "Fix the command line; see greenlight --help."),
  invalid_request: E(EXIT.USAGE, 400, "Fix the request body; see the API schema."),
  // specification and generated tests
  spec_not_found: E(EXIT.BLOCKED, 404, "Run greenlight init, then edit greenlight.yaml."),
  spec_exists: E(EXIT.BLOCKED, 409, "greenlight.yaml already exists; edit it instead."),
  spec_invalid: E(EXIT.BLOCKED, 422, "Fix the listed problems in greenlight.yaml, then run greenlight generate."),
  generated_tests_unexpected: E(EXIT.BLOCKED, 409, "Remove *_test.md files in .greenlight/tests/ that greenlight.yaml does not produce."),
  generated_tests_out_of_date: E(EXIT.BLOCKED, 409, "Run greenlight generate."),
  // approval
  approval_refused: E(EXIT.BLOCKED, 403, "A person must approve at their own interactive terminal (greenlight approve)."),
  tests_not_approved: E(EXIT.BLOCKED, 409, "Run greenlight generate, review the tests, then a person runs greenlight approve."),
  relayed_mode_not_enabled: E(EXIT.BLOCKED, 403, "Relayed approval is for controlled tests only and needs GREENLIGHT_RELAYED_APPROVAL=1."),
  relayed_hash_invalid: E(EXIT.BLOCKED, 422, "Use the full 64-character approved-test hash printed by greenlight generate."),
  relayed_confirm_spend_required: E(EXIT.BLOCKED, 409, "Relayed runs need --confirm-spend <credits> approved by the person for this run."),
  confirm_spend_not_allowed: E(EXIT.BLOCKED, 409, "--confirm-spend is only for relayed approvals; a person confirms spending at their terminal."),
  approval_not_certifiable: E(EXIT.BLOCKED, 403, "Certification needs a human approval recorded on the Greenlight server; relayed and local-only approvals never certify."),
  approval_hash_mismatch: E(EXIT.BLOCKED, 409, "The submitted tests do not match the approved version; get the change approved first."),
  // recordings
  recording_cache_changed: E(EXIT.BLOCKED, 409, "Kane recordings changed outside Greenlight; delete .greenlight/tests/output-*/ to record afresh."),
  recording_cache_stale: E(EXIT.BLOCKED, 409, "Recordings belong to an older approval; delete .greenlight/tests/output-*/ to record afresh."),
  // deployment
  deployment_not_ready: E(EXIT.COULDNT_VERIFY, 409, "Commit and push, wait for the deployment, and make /greenlight.json report that commit."),
  url_not_allowed: E(EXIT.COULDNT_VERIFY, 422, "Use the public deployed URL; localhost and private addresses are never verified."),
  // credits
  credit_check_refused: E(EXIT.BLOCKED, 402, "Raise the limit only if the person who pays agrees, or wait for credits."),
  confirmation_required: E(EXIT.BLOCKED, 409, "Fresh authoring spends credits: a person must confirm at an interactive terminal."),
  confirmation_declined: E(EXIT.BLOCKED, 409, "Nothing was run. Confirm with \"yes\" to spend the credits."),
  balance_unavailable: E(EXIT.BLOCKED, 503, "Make sure kane-cli is installed and logged in (kane-cli whoami)."),
  // execution
  verify_already_running: E(EXIT.BLOCKED, 409, "Wait for the running verification to finish."),
  interrupted: E(EXIT.INTERRUPTED, 499, "Run verification again; interrupted runs are never trusted."),
  // run records
  run_not_found: E(EXIT.BLOCKED, 404, "List runs with greenlight runs."),
  run_record_invalid: E(EXIT.COULDNT_VERIFY, 409, "The run record or its files changed after the run; do not rely on it."),
  // server / API
  unauthorized: E(EXIT.BLOCKED, 401, "Send a valid API token (Authorization: Bearer <token>)."),
  forbidden: E(EXIT.BLOCKED, 403, "This token may not perform that operation."),
  not_found: E(EXIT.BLOCKED, 404, "Check the identifier."),
  conflict: E(EXIT.BLOCKED, 409, "Refresh and retry; the resource changed."),
  rate_limited: E(EXIT.BLOCKED, 429, "Slow down and retry later."),
  payload_too_large: E(EXIT.USAGE, 413, "Send a smaller request."),
  job_limit_reached: E(EXIT.BLOCKED, 429, "Wait for running verifications to finish."),
  credit_cap_reached: E(EXIT.BLOCKED, 429, "The server's total Kane credit cap is reached; no more runs can start until the operator raises it."),
  guest_limit_reached: E(EXIT.BLOCKED, 429, "The demo's limit is reached; explore the sample project, or try again tomorrow."),
  ai_unavailable: E(EXIT.BLOCKED, 503, "AI test generation is not configured on this server; write the tests with the form instead."),
  ai_failed: E(EXIT.COULDNT_VERIFY, 502, "The AI could not write tests for this description; shorten or clarify it, or use the form."),
  server_not_configured: E(EXIT.BLOCKED, 503, "Set GREENLIGHT_API_URL and GREENLIGHT_API_TOKEN (CLI) or the server's environment."),
  server_unreachable: E(EXIT.COULDNT_VERIFY, 503, "Check GREENLIGHT_API_URL and the network."),
  sandbox_dispatch_failed: E(EXIT.COULDNT_VERIFY, 503, "The job's Vercel Sandbox could not be started; check the Vercel project's Sandbox access and limits, then submit again."),
  sandbox_setup_failed: E(EXIT.COULDNT_VERIFY, 503, "Kane could not be installed or logged in inside the Vercel Sandbox; check the Kane credentials and the remote-execution plugin, then submit again."),
  certification_failed: E(EXIT.FAILED, 200, "The certification run did not pass; the record is kept as history."),
  internal_error: E(EXIT.COULDNT_VERIFY, 500, "Retry; if it persists, report it with the run id."),
});

export class GreenlightError extends Error {
  /**
   * @param {keyof typeof ERRORS} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details = undefined) {
    super(message);
    if (!ERRORS[code]) throw new TypeError(`unknown error code: ${code}`);
    this.name = "GreenlightError";
    this.code = code;
    this.details = details;
  }
}

/** Plain-object error for JSON output and API responses. */
export function errorBody(code, message, details) {
  const spec = ERRORS[code] ?? ERRORS.internal_error;
  return { code: ERRORS[code] ? code : "internal_error", message, action: spec.action, ...(details === undefined ? {} : { details }) };
}

export const exitFor = (code) => (ERRORS[code] ?? ERRORS.internal_error).exit;
export const httpFor = (code) => (ERRORS[code] ?? ERRORS.internal_error).http;
