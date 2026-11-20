# Greenlight API and data contract (v1)

Persistence is Supabase (Postgres and private Storage); see [SUPABASE.md](SUPABASE.md). Clients never talk to Supabase: they use this API.

This is the integration contract for a frontend or any other client. It covers
the HTTP API served by `greenlight-server`, the JSON documents the CLI emits with
`--json`, the persisted data models, and the stable error codes.

Conventions:

- JSON in and out (`Content-Type: application/json`), UTF-8, request bodies at most 256 kB.
- Every persisted document has a `schema` string such as `greenlight.project/v1`. A shape change gets a new schema version; existing fields never change meaning.
- Timestamps are ISO 8601 UTC strings. Hashes are lowercase hex SHA-256 unless stated otherwise. Git commits are full 40-character (or 64-character) lowercase hashes.
- Errors are always `{"error": {"code", "message", "action", "details"?}}`. **Branch on `code`**, show `message` and `action` to people. Codes are listed at the end and never change meaning.

## Authentication and roles

`Authorization: Bearer <token>`. The server stores only the SHA-256 of each token (`GREENLIGHT_API_TOKENS`). A token belongs to one **account** and has one **role**:

| Role | read | propose (projects, test versions) | approve test versions | certify |
|---|---|---|---|---|
| `owner` (the developer, a person) | yes | yes | yes | yes |
| `agent` (Claude Code or automation) | yes | yes | **no** | **no** |

Accounts are isolated: a project of another account returns `404 not_found`, never `403`, so ids cannot be probed. Give Claude an `agent` token at most; an `owner` token must stay with the person.

Rate limit: `GREENLIGHT_RATE_LIMIT_PER_MINUTE` per token, per client IP for anonymous requests (`429 rate_limited`, `Retry-After` header). Behind a reverse proxy, apply a per-client limit at the proxy as well, because the server sees the proxy's address.

## Endpoints

| Method and path | Permission | Request body | Success |
|---|---|---|---|
| `GET /v1/health` | none | | `200 {ok: true}` (liveness: the process answers) |
| `GET /v1/ready` | none | | `200 {ok: true, store, database: "ok", storage: "ok"}` when the database API and the private evidence bucket work with the server key; otherwise `503` with codes only (`unauthorized`, `schema_not_exposed`, `unreachable`, `bucket_missing`, `bucket_public`). Never URLs, keys or paths |
| `POST /v1/projects` | propose | `{name, url}` | `201` Project |
| `GET /v1/projects` | read | | `200 {projects: Project[]}` |
| `GET /v1/projects/:projectId` | read | | `200` Project |
| `POST /v1/projects/:projectId/versions` | propose | `{specText}` | `201` TestVersion summary, `status: "pending_approval"` |
| `GET /v1/projects/:projectId/versions` | read | | `200 {versions: [...]}` with `status` and `approval` |
| `GET /v1/projects/:projectId/versions/:n` | read | | `200` TestVersion **with each test's full `content` and the `specText`**, for review |
| `POST /v1/projects/:projectId/versions/:n/approval` | approve (owner) | `{confirmHash}` | `201` Approval |
| `POST /v1/projects/:projectId/certifications` | certify (owner) | `{version, commit, confirmSpend, url?, environment?, approvedTestHash?}` | `202` Job |
| `GET /v1/jobs/:jobId` | read | | `200` Job |
| `GET /v1/projects/:projectId/records` | read | | `200 {records: VerificationRecord[]}`, each with `integrity` |
| `GET /v1/projects/:projectId/records/:recordId/evidence` | read | | `200` EvidenceIntegrity: stored evidence re-downloaded and re-hashed |
| `GET /v1/public/records/:recordId` | none | | `200` PublicVerification |

### Projects

`POST /v1/projects` `{"name": "Shop", "url": "https://shop.example.com/"}`. `url` must be http(s), public, without credentials, query or fragment. Localhost, private, link-local (cloud metadata) and reserved addresses are refused (`422 url_not_allowed`).

### Test versions (proposals)

`POST .../versions` `{"specText": "<the full greenlight.yaml>"}`. The server parses and renders the spec itself and computes `approvedTestHash`. A hash in the request is ignored. An invalid spec returns `422 spec_invalid` with `details.problems: string[]`. Versions are numbered 1, 2, … and never change. A changed spec is a new version that needs its own approval.

### Approval (a person)

`POST .../versions/:n/approval` `{"confirmHash": "<full 64-char approvedTestHash>"}`, with an owner token. The frontend must show the person the tests (`GET .../versions/:n`) and have them confirm the hash. Sending a hash the client computed by itself defeats the purpose. A wrong or partial hash returns `409 approval_hash_mismatch`. An approval is write-once: approving the same version again returns `409 conflict`.

### Certification (a fresh server-side run)

`POST .../certifications`:

```json
{
  "version": 1,
  "commit": "dc6150b46a46a85efb4255113f0eddc5370621c8",
  "confirmSpend": 100,
  "url": "https://preview-123.vercel.app/",
  "environment": "preview",
  "approvedTestHash": "68d811b0…"
}
```

- `confirmSpend` is the most credits the owner accepts for this one run. The server also applies `GREENLIGHT_MAX_CREDITS_PER_RUN` and `GREENLIGHT_CREDIT_RESERVE`. All of them are checked **before Kane starts**.
- `url` is optional and defaults to the spec's `project.url`. It must be public and is DNS-checked before any request.
- `approvedTestHash` is optional. When sent, it must equal the approved version's hash (clients send their local hash to catch drift).
- Returns `202` and a Job. Poll `GET /v1/jobs/:jobId` until `status` is `succeeded` or `failed`.
- Only one certification per project runs at a time, and the queue is bounded (`429 job_limit_reached`).

What the server does: it re-derives the hash from the stored spec text, checks the stored owner approval for exactly that hash, waits until `<url>/greenlight.json` reports `commit`, writes the approved tests into an **empty workspace** (no recordings, nothing cached), checks credits, runs Kane (`--local --no-adaptive-heal`, always), classifies from Kane's verdicts only, validates and hashes the evidence pack, and writes a permanent VerificationRecord.

Job outcomes:

| Job `status` | `outcome` | Meaning |
|---|---|---|
| `succeeded` | `certified` | The run passed and is certified; `recordId` is set |
| `succeeded` | `not_certified:failed` / `not_certified:couldnt_verify` | Kane ran; the record keeps the result as history |
| `failed` | — | Stopped **before** Kane (gate refused: `error.code`), or an internal error; no record, no spend |

A job that was queued or running when the server stopped is marked `failed` with `error.code: "interrupted"` at the next start. It is never re-run automatically.

## Data models

### Project — `greenlight.project/v1`

```json
{ "schema": "greenlight.project/v1", "id": "prj_<32 hex>", "name": "Shop", "url": "https://shop.example.com/",
  "account": "acme", "createdBy": "dev", "createdAt": "…" }
```

### TestVersion — `greenlight.test-version/v1`

```json
{ "schema": "greenlight.test-version/v1", "projectId": "prj_…", "version": 1, "approvedTestHash": "<sha256>",
  "project": {"name", "url"}, "claims": [{"id": "CLM-001", "text": "…"}],
  "tests": [{"file": "cart-add-two_test.md", "claims": ["CLM-001"], "sha256": "…", "content": "…(single-version view only)"}],
  "submittedBy": "claude", "submittedAt": "…", "status": "pending_approval|approved" }
```

### Approval — `greenlight.server-approval/v1`

```json
{ "schema": "greenlight.server-approval/v1", "projectId": "prj_…", "version": 1, "approvedTestHash": "…",
  "approvedBy": "dev", "approvedAt": "…", "method": "server-owner", "certifiable": true, "recordSha256": "…" }
```

`recordSha256` is the SHA-256 of the canonical JSON of the document without `recordSha256`. Only `method: "server-owner"` approvals can certify. Local approvals (`local-terminal-confirmation`) and relayed approvals (`relayed-by-agent`, always `certifiable: false`) exist only in a developer's checkout and are never accepted by the server.

### Job — `greenlight.job/v1`

```json
{ "schema": "greenlight.job/v1", "id": "job_<32 hex>", "kind": "certification", "projectId": "prj_…", "version": 1,
  "status": "queued|running|succeeded|failed", "outcome": "certified|not_certified:<status>|null",
  "request": {"commit", "confirmSpend", "url", "environment", "approvedTestHash"}, "requestedBy": "dev",
  "createdAt": "…", "startedAt": "…", "finishedAt": "…", "recordId": "vr_…|null", "error": {"code", "message", "action", "details"}|null }
```

### VerificationRecord — `greenlight.verification-record/v1` (permanent, write-once)

```json
{ "schema": "greenlight.verification-record/v1", "id": "vr_<32 hex>", "projectId": "prj_…",
  "project": {"name", "url"}, "testVersion": 1, "approvedTestHash": "…",
  "approval": {"method": "server-owner", "approvedAt": "…", "recordSha256": "…"},
  "requirements": [{"id", "text"}],
  "deployment": {"url": "<origin+path, query redacted>", "commit": "…", "environment": "preview"},
  "status": "passed|failed|couldnt_verify", "certified": true, "notCertifiedBecause": [],
  "claims": [{"id", "text", "status": "passed|failed|partial|couldnt_verify", "tests": [{"file", "status"}]}],
  "execution": {"runId", "runKind": "certification", "startedAt", "endedAt", "freshAuthoring": true,
                "kane": {"version", "pinnedVersion": "0.10.6", "executionId", "exitCode", "localModeOnly": true}},
  "evidence": {"status": "stored", "packSha256", "packBytes", "validation": "valid", "kaneStdoutSha256", "runManifestSha256"},
  "credits": {"actualSpend", "kaneReportedSpend", "estimate", "status"},
  "createdAt": "<certification timestamp>", "recordSha256": "…" }
```

`certified` is `true` only when all of these hold: `status` is `passed`, the run was usable, the evidence pack was stored and validated, the run was the server's own `certification` run, and the approval is a valid owner approval for exactly `approvedTestHash`. A failed record is history of that moment, not a statement that the application is broken.

### EvidenceIntegrity — `greenlight.evidence-integrity/v1`

`{recordId, runId, ok, problems: ["hash_mismatch:<file>" | "missing:<file>" | "unreadable:<file>"], files, evidencePackSha256, record: {ok, recordSha256, computed}}`. This re-downloads every stored file of the record's run from private storage and compares SHA-256 and size with what was verified at upload. Storage locations are never returned.

### PublicVerification — `greenlight.public-verification/v1`

This is the VerificationRecord without `projectId`, the approver's identity or credit figures, with every string passed through public redaction (no secrets, query strings, local paths or email addresses), plus:

- `publicUrl`
- `integrity.recordSha256`: the stored record's hash
- `publicSha256`: SHA-256 of the canonical JSON of this public document without `publicSha256`. Anyone can recompute it.

If the stored record fails its own hash check, the endpoint returns `409 run_record_invalid` instead of the record.

Canonical JSON: object keys sorted, no whitespace, standard JSON escaping (`src/evidence/hash.js`).

## CLI `--json` contract — `greenlight.cli-result/v1`

Every command accepts `--json` and then writes exactly one document to stdout:

```json
{ "schema": "greenlight.cli-result/v1", "command": "verify", "ok": false, "exitCode": 1,
  "error": null | {"code", "message", "action", "details"?}, "data": { … } }
```

| Command | `data` |
|---|---|
| `init` | `{created}` |
| `generate` | `{hash, approved: false, tests: [{file, claims, sha256, written}], unexpected}` |
| `approve` | `{approved, hash, method, certifiable}` |
| `status` | `{spec, approval, generatedTests, recordings, kane}` |
| `verify` | `{approvedHash, approvalMethod, certifiable: false, runKind: "iteration", deployment, runId, attempts, status, claims, tests, evidence, credits, totalActualSpend, warnings, report}` |
| `runs` | `{runs: RunSummary[]}` (each with `integrity`) |
| `check-run <id>` | `{runId, ok, problems, summary}` |
| `publish` | `{jobId, commit, job, record}` |

`verify` statuses: `passed`, `failed` (app failures), `couldnt_verify`, `interrupted`. These are always distinct, never merged. Developer-side runs always have `runKind: "iteration"` and `certification: false`.

### RunSummary — `greenlight.run-summary/v1`

`{runId, runKind, certification, attempt, previousRunId, createdAt, approvedTestHash, deployedCommit, url, status, claims, evidence: {status, sha256}, credits: {actualSpend, kaneReportedSpend, discrepancy, estimate, status}, warnings: [code], approval, recordSha256, integrity?}`

### Credit record (run manifest `credits`, `latest.json` `credits`)

`{status: consistent|discrepancy|unverifiable, balanceBefore, balanceAfter, actualSpend, actualSpendSource: "balance_difference"|null, kaneReportedSpend, kaneReportedIsLowerBound: true, discrepancy, estimate, estimateDifference, reasons}`.
`actualSpend` is only ever the balance difference. It is `null` when a balance could not be read, and is never replaced by the estimate or by Kane's logs.

### Warnings

`{code, tests?, message}`. Current code: `recording_not_retained`, meaning Kane authored tests but kept no replayable recording, so the next run authors them again at full cost. This is always the case with Kane 0.10.6 in local mode.

## Error codes

| Code | HTTP | CLI exit | Action |
|---|---|---|---|
| `usage_error` | 400 | 2 | Fix the command line; see greenlight --help. |
| `invalid_request` | 400 | 2 | Fix the request body; see the API schema. |
| `spec_not_found` | 404 | 4 | Run greenlight init, then edit greenlight.yaml. |
| `spec_exists` | 409 | 4 | greenlight.yaml already exists; edit it instead. |
| `spec_invalid` | 422 | 4 | Fix the listed problems in greenlight.yaml, then run greenlight generate. |
| `generated_tests_unexpected` | 409 | 4 | Remove *_test.md files in .greenlight/tests/ that greenlight.yaml does not produce. |
| `generated_tests_out_of_date` | 409 | 4 | Run greenlight generate. |
| `approval_refused` | 403 | 4 | A person must approve at their own interactive terminal (greenlight approve). |
| `tests_not_approved` | 409 | 4 | Run greenlight generate, review the tests, then a person runs greenlight approve. |
| `relayed_mode_not_enabled` | 403 | 4 | Relayed approval is for controlled tests only and needs GREENLIGHT_RELAYED_APPROVAL=1. |
| `relayed_hash_invalid` | 422 | 4 | Use the full 64-character approved-test hash printed by greenlight generate. |
| `relayed_confirm_spend_required` | 409 | 4 | Relayed runs need --confirm-spend <credits> approved by the person for this run. |
| `confirm_spend_not_allowed` | 409 | 4 | --confirm-spend is only for relayed approvals; a person confirms spending at their terminal. |
| `approval_not_certifiable` | 403 | 4 | Certification needs a human approval recorded on the Greenlight server; relayed and local-only approvals never certify. |
| `approval_hash_mismatch` | 409 | 4 | The submitted tests do not match the approved version; get the change approved first. |
| `recording_cache_changed` | 409 | 4 | Kane recordings changed outside Greenlight; delete .greenlight/tests/output-*/ to record afresh. |
| `recording_cache_stale` | 409 | 4 | Recordings belong to an older approval; delete .greenlight/tests/output-*/ to record afresh. |
| `deployment_not_ready` | 409 | 3 | Commit and push, wait for the deployment, and make /greenlight.json report that commit. |
| `url_not_allowed` | 422 | 3 | Use the public deployed URL; localhost and private addresses are never verified. |
| `credit_check_refused` | 402 | 4 | Raise the limit only if the person who pays agrees, or wait for credits. |
| `confirmation_required` | 409 | 4 | Fresh authoring spends credits: a person must confirm at an interactive terminal. |
| `confirmation_declined` | 409 | 4 | Nothing was run. Confirm with "yes" to spend the credits. |
| `balance_unavailable` | 503 | 4 | Make sure kane-cli is installed and logged in (kane-cli whoami). |
| `verify_already_running` | 409 | 4 | Wait for the running verification to finish. |
| `interrupted` | 499 | 130 | Run verification again; interrupted runs are never trusted. |
| `run_not_found` | 404 | 4 | List runs with greenlight runs. |
| `run_record_invalid` | 409 | 3 | The run record or its files changed after the run; do not rely on it. |
| `unauthorized` | 401 | 4 | Send a valid API token (Authorization: Bearer <token>). |
| `forbidden` | 403 | 4 | This token may not perform that operation. |
| `not_found` | 404 | 4 | Check the identifier. |
| `conflict` | 409 | 4 | Refresh and retry; the resource changed. |
| `rate_limited` | 429 | 4 | Slow down and retry later. |
| `payload_too_large` | 413 | 2 | Send a smaller request. |
| `job_limit_reached` | 429 | 4 | Wait for running verifications to finish. |
| `server_not_configured` | 503 | 4 | Set GREENLIGHT_API_URL and GREENLIGHT_API_TOKEN (CLI) or the server's environment. |
| `server_unreachable` | 503 | 3 | Check GREENLIGHT_API_URL and the network. |
| `certification_failed` | 200 | 1 | The certification run did not pass; the record is kept as history. |
| `internal_error` | 500 | 3 | Retry; if it persists, report it with the run id. |

## Frontend integration checklist

1. Create a project (`POST /v1/projects`) and submit the spec (`POST .../versions`). Show `spec_invalid` problems inline.
2. Show the person every test's `content` (`GET .../versions/:n`) and have them confirm the full hash. Send `POST .../approval` with an **owner** token held only by that person's session.
3. Start certification (`POST .../certifications`). Show the credit confirmation (`confirmSpend`) as an explicit human choice; the expected cost is about 37 credits per test of up to 3 steps, plus 20 per run.
4. Poll the job. On `failed`, show `error.message` and `error.action`. On `succeeded`, open the record.
5. Show public records from `GET /v1/public/records/:id`. Show `certified` and `notCertifiedBecause` exactly; never infer certification from `status` alone.
6. Never send an iteration report, a run manifest or a local approval to the server: there is no endpoint for it, by design.
