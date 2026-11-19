# GREENLIGHT

Greenlight proves that a **deployed** application does what its **approved** requirements claim. A person approves the tests, Kane CLI runs them in a real browser against the live URL, Greenlight classifies Kane's verdicts and hands structured failure reports to Claude Code through a Skill and a Stop hook. Claude fixes the application, pushes, and Greenlight verifies again. A person can then ask the Greenlight server for a fresh, independently executed certification with a permanent public record.

BUILD → VERIFY → DETECT → FIX → RE-VERIFY → CERTIFY. The project brief is [GREENLIGHT_PROJECT_BRIEF.md](GREENLIGHT_PROJECT_BRIEF.md).

## Architecture

```
developer's repo (Claude Code works here)          Greenlight server (container with Chrome + kane-cli)
┌──────────────────────────────────────────┐       ┌───────────────────────────────────────────────┐
│ greenlight.yaml  .greenlight/tests/*.md  │       │ HTTP API v1 (src/server/http.js)              │
│ .greenlight/approval.json (local)        │       │  projects · test versions · owner approval    │
│                                          │       │  certification jobs · permanent records       │
│ greenlight CLI (src/cli)                 │ HTTPS │  public records (redacted, hash-checkable)    │
│  generate · approve · status · verify ───┼──┐    │ certify.js: fresh workspace → Kane → record   │
│  runs · check-run · publish ─────────────┼──┼──▶ │ supabase/: Postgres RPC + private Storage     │
│ Stop hook (src/hook) ── verify loop      │  │    └───────────────────────────────────────────────┘
│ Skill (skills/greenlight) ── teaches     │  │
└──────────────┬───────────────────────────┘  │     live deployment: <url>/greenlight.json = {commit, environment}
               │ subprocess                   │
               ▼                              │
           kane-cli 0.10.6 (--local, --no-adaptive-heal, always)
```

| Module | Responsibility |
|---|---|
| `src/kane/` | Run Kane as a subprocess in its own process group; parse its NDJSON stream; timeouts; the pinned version and its limitations (`capabilities.js`) |
| `src/verify/` | Classify per test from Kane's exit code and final statuses only; roll up to claims (`passed`, `failed`, `partial`, `couldnt_verify`) and the project |
| `src/evidence/` | Locate, structurally check, copy, validate (`kane-cli evidence validate`) and hash the evidence pack; write a self-hashed run manifest |
| `src/credits/` | Read the balance, estimate, authorise (cap, reserve, confirmation), reconcile the actual spend |
| `src/spec/` | `greenlight.yaml` schema, test generation, approved-test hash, local approval, recording detection and integrity |
| `src/deploy/` | Git readiness (clean, pushed), polling `/greenlight.json` for the exact commit, public-host and SSRF checks |
| `src/report/` | Failure reports (JSON, Markdown, public copy) and redaction |
| `src/hook/` | Claude Code Stop hook: when to verify, three-attempt fix limit, locking, state |
| `src/runs/` | Run history and record re-verification |
| `src/server/` | API, server-side approval, certification jobs, permanent verification records |
| `src/server/supabase/` | Production persistence: service-role RPC client, Supabase repository, evidence in private Storage, file → Supabase migration |
| `supabase/migrations/` | Schema `greenlight` (tables, constraints, immutability triggers, RLS), service-role-only RPC functions, private evidence bucket |
| `src/cli/` | Commands, `--json` output, stable error codes (`errors.js`) |

There are no runtime dependencies (Node ≥ 20). The only dev dependency is PGlite, which runs the real Supabase migrations in-process for the tests.

## Setup

Developer machine (where Claude Code works on the application):

1. Node ≥ 20 and `npm i -g @testmuai/kane-cli@0.10.6`, then `kane-cli login --oauth` (a person, once).
2. Chrome is needed by Kane (`KANE_CLI_CHROME_PATH` if it is not found).
3. In the application repository: install Greenlight, copy `skills/greenlight` to `.claude/skills/greenlight`, and register the Stop hook (`bin/greenlight-stop-hook.js`, with `"timeout": 3600`) as described in [skills/README.md](skills/README.md).
4. The deployed application must serve `/greenlight.json`: `{"commit": "<full git sha>", "environment": "preview|production"}`, written at build time from the deployed commit.

Server (certification): a container or dedicated host with Chrome and an authenticated `kane-cli` 0.10.6. Not a serverless function. It persists to Supabase: apply `supabase/migrations/`, then run `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node bin/greenlight-server.js` behind a TLS reverse proxy, and issue tokens with `greenlight-admin`. See [docs/SUPABASE.md](docs/SUPABASE.md) and [docs/API.md](docs/API.md).

## CLI

| Command | What it does | Exit codes |
|---|---|---|
| `greenlight init` | Starter `greenlight.yaml` (never overwrites) | 0, 4 |
| `greenlight generate` | Validate the spec, write `.greenlight/tests/*_test.md`, print the approved-test hash | 0, 4 |
| `greenlight approve` | **A person**, at an interactive terminal, types the first 12 characters of the hash. Refused for agents/CI. | 0, 4 |
| `greenlight approve --relayed <hash>` | Controlled tests only (`GREENLIGHT_RELAYED_APPROVAL=1`): records an approval a person gave in chat. **Never certifiable.** | 0, 4 |
| `greenlight status` | Spec, approval, generated tests, recording cache, Kane limitations | 0, 4 |
| `greenlight verify` | Gates → deployment → credits → Kane → classification → evidence → report | 0 pass, 1 app failures, 3 could not verify, 4 blocked, 130 interrupted |
| `greenlight runs` | Run history with every record's integrity re-checked | 0, 3 |
| `greenlight check-run <run-id>` | Re-check one run record and its files against their hashes | 0, 3, 4 |
| `greenlight publish --project <id> --version <n> --confirm-spend <credits>` | **A person** asks the server for a fresh certification run. Refused for agents/CI and relayed approvals. | 0 certified, 1 not certified, 3, 4 |

Every command accepts `--json` (one `greenlight.cli-result/v1` document on stdout; human lines on stderr). Errors carry stable codes; see [docs/API.md](docs/API.md#error-codes).

`verify` options: `--url`, `--environment`, `--max-credits` (default 60), `--reserve` (default 500), `--kane`, `--kane-timeout-minutes` (30), `--deploy-timeout-seconds` (600), `--deploy-interval-seconds` (10), `--confirm-spend` (relayed only), `--estimate-margin` (≥ 1).

## Configuration and environment

| Variable | Used by | Meaning |
|---|---|---|
| `GREENLIGHT_KANE_BIN` | CLI | Kane binary (default `kane-cli`) |
| `GREENLIGHT_RELAYED_APPROVAL=1` | CLI | Enables relayed approval for controlled tests (never certifiable) |
| `GREENLIGHT_URL` | Stop hook | Live URL to verify instead of `project.url` (e.g. the preview URL) |
| `GREENLIGHT_CONFIRM_SPEND` | Stop hook | Relayed mode: the spend a person approved for this one invocation |
| `GREENLIGHT_API_URL`, `GREENLIGHT_API_TOKEN` | `publish` | Server URL and an **owner** token |
| `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `AI_AGENT`, `CI`, `GITHUB_ACTIONS`, `GREENLIGHT_AGENT` | CLI | Detected as an agent/CI: approval, spend confirmation and publish are refused |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret), `GREENLIGHT_EVIDENCE_BUCKET`, `GREENLIGHT_WORK_DIR` | server, admin, migration | Production persistence ([docs/SUPABASE.md](docs/SUPABASE.md)) |
| `GREENLIGHT_API_TOKENS`, `GREENLIGHT_PORT`, `GREENLIGHT_HOST`, `GREENLIGHT_PUBLIC_BASE_URL`, `GREENLIGHT_MAX_CONCURRENT_JOBS`, `GREENLIGHT_MAX_QUEUED_JOBS`, `GREENLIGHT_MAX_CREDITS_PER_RUN`, `GREENLIGHT_CREDIT_RESERVE`, `GREENLIGHT_RATE_LIMIT_PER_MINUTE`, `GREENLIGHT_KANE_TIMEOUT_MINUTES`, `GREENLIGHT_DEPLOY_TIMEOUT_SECONDS` | server | See `src/server/config.js` |

## Verification lifecycle (developer side)

1. `greenlight.yaml` → `generate` → a person reviews `.greenlight/tests/` and runs `approve`. Any later change to the spec or a generated file invalidates the approval (the hash is recomputed every time).
2. Claude changes the app, commits and **pushes**. The Stop hook runs when Claude finishes:
   - asks for commit/push once per commit, skips commits that only touch Greenlight/Claude files, never re-runs a commit with a result;
   - runs `greenlight verify`, which takes the verify lock (one verification at a time, hook or person), checks the recording cache, waits for `/greenlight.json` to report HEAD, estimates and authorises credits **before Kane starts**, runs Kane, classifies, stores and validates evidence, reconciles the actual spend and writes `.greenlight/reports/latest.{json,md}` and a run record under `.greenlight/runs/<run-id>/`;
   - an infrastructure failure (no app failures, not an interruption) is retried **once**, only within what is left of the same credit limit and with a new confirmation if it authors;
   - exit 1 (app failures) blocks Claude with the report (exit 2 of the hook), up to **three** automatic fix attempts; then a person must review and run `greenlight-stop-hook reset`. The attempt count is also rebuilt from the immutable run records, and an unreadable state file stops the loop, so neither restarting the hook nor deleting `state.json` resets it.
3. Statuses stay distinct: `passed`, `failed`, `couldnt_verify` (infrastructure, deployment, broken runs — never sent to the fix loop), `interrupted` (never trusted).

## Approval and certification rules

- Claude may propose tests and changes; only a person approves. Locally: an interactive terminal, agent/CI refused. On the server: an `owner` token and the full hash typed back. `agent` tokens can propose but never approve or certify.
- Relayed approvals are explicitly `certifiable: false` and are refused by `publish`. The server never accepts local approvals at all.
- Developer-side runs and reports are `runKind: "iteration"`, `certification: false`, always. There is no API to upload them.
- A certification exists only as a server VerificationRecord from the server's own fresh run: hash re-derived from the stored spec, owner approval for exactly that hash, deployed commit confirmed, empty workspace (nothing cached), spend confirmed and capped, evidence stored and validated, all claims passed. Failed runs get permanent records too, with `certified: false`.
- Records are write-once with a self-hash; the public view is redacted and carries a recomputable `publicSha256`; a tampered record is refused.
- Every URL must be a public deployed URL: localhost, private, link-local (cloud metadata) and reserved addresses are refused; the server also resolves DNS and refuses private answers.

## Known limitations

- **Kane 0.10.6 keeps no recordings in local mode.** Greenlight never enables Test Manager uploads, and in `--local` Kane writes the replayable `execution.json` only through its upload pipeline, which needs a Test Manager test id. So every run authors every test afresh (≈ 37 credits per test of up to 3 steps, +20 per run; E1 actually cost 76.64 for two tests), cross-run replay is impossible, and a `recording_not_retained` warning is raised. Because fresh authoring needs explicit spend confirmation, **the Stop-hook fix loop cannot run unattended** except in relayed mode with a per-invocation `GREENLIGHT_CONFIRM_SPEND`. Lifting this needs a Kane release that persists recordings under `--local`, or a decision to allow uploads (see `src/kane/capabilities.js`).
- Local approval, state and run records are guardrails, not security: someone with write access to the checkout can forge them. Certification does not depend on any of them; the server is the authority.
- Kane's own session logs undercount spend (E1: 61.70 logged vs 76.64 by balance); the balance difference is the only actual spend and the discrepancy is always recorded.
- Supabase persistence is implemented and tested against the real migrations on PGlite with a mocked Data API and Storage, but **no Supabase project has the schema yet** (see [docs/SUPABASE.md](docs/SUPABASE.md)). Rate limits and the job concurrency limit are per server process. The server has not yet run against real Kane, a real deployment or real credits. Requirement analysis by AI (brief §3) is done by Claude writing `greenlight.yaml`; there is no server-side analysis.
- Certification runs are not retried automatically (each attempt spends credits); a person starts another.

## Development

`npm test` runs the whole suite with mocks only: no Kane, network, deployments or credits (a booby-trapped `kane-cli` on `PATH` fails the run if anything tries). Real captured Kane 0.10.6 output lives in `test/fixtures/kane/`.
