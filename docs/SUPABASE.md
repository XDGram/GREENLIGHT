# Greenlight on Supabase

Supabase is Greenlight's production persistence: Postgres for every record, Storage for evidence. The server (`bin/greenlight-server.js`) refuses to start without it. The file-backed store is kept only for automated tests and as the source of a migration.

## Where Greenlight lives: the Ceaser project

Greenlight shares the existing Supabase project **`ceaser`** (`ncbrsrklofofdqdftwjw`, `eu-west-1`) with the Ceaser community-feed application. The organisation's free plan allows no further active project, and the owner chose this option. Greenlight is kept fully separate:

| Greenlight adds | Purpose | Reachable by Ceaser's keys? |
|---|---|---|
| schema `greenlight` | all 14 tables (RLS on, no policies), 2 trigger functions and 3 guest view helpers | no: no USAGE for `anon`/`authenticated` |
| schema `greenlight_api` | the 32 RPC functions (20 core, 12 guest demo) | no: no USAGE and no EXECUTE for `anon`/`authenticated`; only `service_role` |
| bucket `greenlight-evidence` | private evidence, no storage policies | no: only the service role |

Greenlight creates **nothing in `public`** and alters no existing object, policy, grant, setting or row. This is enforced by a test that snapshots a Ceaser-like `public` schema (tables, RLS flags, ACLs, policies, function definitions and ACLs, views, triggers, default privileges, data and other buckets) before and after the migrations and requires them to be identical. Because no Greenlight function lives in `public`, Ceaser's default privileges on `public`, or a future `grant … on all functions in schema public to anon`, can never reach Greenlight. Another test runs exactly that grant and proves Ceaser's anon key still gets `permission denied`.

The two applications still share one database, one service-role key, one backup policy and one set of project settings. Anyone holding Ceaser's service-role key can also read Greenlight's data. Keep that key server-side for both.

### One dashboard setting: expose `greenlight_api`

The server calls its functions through the Supabase Data API with `Content-Profile: greenlight_api`. The Data API only serves schemas listed under **Exposed schemas**. Exposing `greenlight_api` grants nothing by itself: database permissions still decide, and only `service_role` has any.

1. Open the Supabase dashboard and select the project **ceaser**.
2. Go to **Project Settings → Data API** (also labelled **API → Data API settings** in some dashboard versions).
3. In **Exposed schemas**, keep everything already listed (normally `public` and `graphql_public`). **Add** `greenlight_api`, and nothing else. Do **not** add `greenlight`: the tables stay unexposed.
4. Leave **Extra search path** and **Max rows** unchanged. Click **Save**.

Without this, every server call fails with `server_not_configured`: "Supabase does not expose the greenlight_api schema …".

### Applying the migrations

Apply in order, with the Supabase CLI (`supabase db push`) or the dashboard's SQL editor:

1. `supabase/migrations/20261119140000_greenlight_schema.sql`
2. `supabase/migrations/20261119140100_greenlight_rpc.sql`
3. `supabase/migrations/20261119140200_greenlight_evidence_bucket.sql`
4. `supabase/migrations/20261120190000_greenlight_guest.sql` (guest demo: three new tables, additive; nothing existing changes)
5. `supabase/migrations/20261121090000_greenlight_platform.sql` (web platform: Google identities, project details, settings, admin events; additive)

All five run unchanged in the test suite on real PostgreSQL (PGlite), next to a Ceaser-like application. They are additive. The bucket migration never overwrites an existing bucket, and refuses to continue if a bucket with that name exists and is public.

## Configuration (server environment only)

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` (https only) |
| `SUPABASE_SERVICE_ROLE_KEY` | the project's server-side key: a **secret key** `sb_secret_…` (Project Settings → API Keys, recommended) or the legacy `service_role` JWT. **A secret, server-side only.** Never commit it, never give it to a frontend, never put it in `NEXT_PUBLIC_*`/`VITE_*` or similar variables |
| `GREENLIGHT_EVIDENCE_BUCKET` | optional, default `greenlight-evidence` |
| `GREENLIGHT_WORK_DIR` | optional local scratch for Kane workspaces and in-flight evidence, default `<tmp>/greenlight-work` |

**Which key.** The server needs the project's **secret** key. In the Supabase dashboard: project
`ceaser` → **Project Settings** → **API Keys** → **Secret keys** (`sb_secret_…`; reveal the default key or
create one named e.g. `greenlight-server` so it can be rotated on its own). The **publishable** key
(`sb_publishable_…`, same page) is public and has no access to Greenlight; the server refuses it, and an
anon JWT, as `SUPABASE_SERVICE_ROLE_KEY`. `.env.example` lists the variable names.

Header handling follows the key type: a `sb_secret_…` key is not a JWT, so it is sent only in the `apikey`
header (Supabase rejects it as a `Bearer` token); a legacy `service_role` JWT is sent in `apikey` and
`Authorization`. Where an egress proxy injects the key into the `apikey` header for the Supabase host, set
`SUPABASE_SERVICE_ROLE_KEY` to a placeholder of the same form (for example `sb_secret_placeholder…`): the
proxy replaces it and the real key never enters the process. Node's built-in `fetch` ignores
`HTTPS_PROXY` unless `NODE_USE_ENV_PROXY=1` is set (Node ≥ 22.21 / 24): without it, requests go direct,
carry only the placeholder, and readiness reports `database: unauthorized`. (Do not run the publishable-key
suite through such a proxy: the proxy would put the server key on its requests too; the suite detects this
and refuses to run, and `npm run test:live` starts it without `NODE_USE_ENV_PROXY`.)

The key is stored as a non-enumerable config property, so serialised config, logs and errors never contain it. Errors from Supabase are scrubbed of it. The frontend never talks to Supabase directly: it uses the Greenlight API with Greenlight tokens. The anon key is not needed, and it has no access to anything Greenlight stores.

## Data model

Every table is in the private schema `greenlight`. It is not exposed through the Supabase Data API, `anon` and `authenticated` have no privileges on it, and RLS is enabled on every table with no policies (deny all).

| Table | Holds | Notes |
|---|---|---|
| `accounts` | tenants (`slug`) | |
| `users` | `name`, `role` (`owner` or `agent`), per account | unique `(account_id, name)` |
| `api_tokens` | `token_sha256` → user, `revoked_at` | only hashes are stored |
| `projects` | id, account, name, url, `doc` | index `(account_id, created_at)` |
| `test_versions` | `(project_id, version)`, spec text, approved-test hash | **immutable**; numbering is atomic |
| `approvals` | one per version, `method = 'server-owner'`, `certifiable = true` | **write-once**; hash must equal the version's |
| `jobs` | certification jobs | forward-only status; **one queued/running job per project** (partial unique index); finished jobs immutable; never deleted |
| `runs` | run history: manifest, hashes, evidence status, private `storage_prefix`, verified `files` | **immutable** |
| `certification_records` | permanent verification records (`doc` is the API document) | **write-once**; `certified ⇒ status = 'passed'` |
| `record_claims` | per-record claim results | **immutable** |
| `record_tests` | per-record, per-claim test results | **immutable** |
| `guest_sessions` | guest demo sessions: id (in a signed cookie), hashed network address, runs and AI uses | limits enforced in the RPCs under an advisory lock |
| `guest_projects` | a guest's app: url, spec text, hash, the guest's own approval | **never** used for certification; approval write-once |
| `guest_runs` | a guest's demo checks (an HTTP read of the start page; no Kane, no credits) and their results | forward-only status; per-guest and 24-hour caps; refunded when the check never started |
| `web_identities` | Sign in with Google identities: provider, subject, their account (`g-<hash>`) and owner user, email, last sign-in | one account per Google identity; no admin role exists here |
| `project_details` | editable project details: GitHub repository, branch, description, what the app should do, last repository check, AES-GCM-encrypted test credentials | the original `projects.doc` never changes; credentials are never returned by the API |
| `settings` | operational switches changed in the admin console (e.g. `guest.checks_paused`) | every change is also written to `admin_events` |
| `admin_events` | administrator actions (settings, token revocations) | **append-only** |

Immutability is enforced by triggers (UPDATE, DELETE and TRUNCATE are refused with SQLSTATE `GLIMM`), not by application code.

Access goes only through the `greenlight_api.greenlight_*` functions: `SECURITY DEFINER`, `search_path = ''`, `EXECUTE` granted to `service_role` only, and the schema itself usable only by `service_role`. Default privileges in both schemas revoke `EXECUTE` from `PUBLIC`, so no future function starts out callable. Each function is one transaction. Several safeguards are enforced by the database, independently of the server:

- An approval is refused unless its hash equals the version's (`GLHSH`) and it is a certifiable owner approval.
- `greenlight_put_record` writes the run, record, claims and test results together. It refuses `certified = true` unless the status is `passed`, the run and manifest are `certification` runs, the evidence was `stored`, and a valid approval for exactly that hash exists (`GLCRT`).
- A job can only be marked `succeeded` if its record exists, and only while it is still running.

| SQLSTATE | API error code |
|---|---|
| `GLNFD` | `not_found` |
| `GLCON`, `GLIMM` | `conflict` |
| `GLLIM` | `job_limit_reached` |
| `GLHSH` | `approval_hash_mismatch` |
| `GLQTA` | `guest_limit_reached` |
| `GLINV`, `GLCRT`, other | `internal_error` |

## Evidence in Supabase Storage

The bucket `greenlight-evidence` is private (`public = false`, 100 MB per object, no storage policies), so only the service role can read or write it. Each run's files are written under `projects/<projectId>/runs/<runId>/`: `manifest.json`, `manifest.sha256`, `kane-stdout.ndjson`, `kane-stderr.txt` and `evidence/<executionId>.evidence`.

1. The run directory is re-verified against its own manifest hashes.
2. Every file is uploaded with `x-upsert: false`, so an existing object is never overwritten.
3. Every file is downloaded again and its SHA-256 and size are compared.
4. Only then are the run row and record written, in one transaction.

If any step fails, nothing is written to the database and the local copy is kept for recovery. `GET /v1/projects/:projectId/records/:recordId/evidence` repeats step 3 at any time. Storage paths never appear in any API response or public record.

## Accounts, users and tokens

```sh
export SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=…     # in the operator's shell, never in a file in the repo
greenlight-admin create-account acme
greenlight-admin create-user acme dev owner
greenlight-admin create-user acme claude agent
greenlight-admin issue-token acme dev "dev laptop"    # prints a new token once; only its SHA-256 is stored
greenlight-admin revoke-token < token.txt
```

The account of every request comes from its token, never from the request body. `GREENLIGHT_API_TOKENS` (hashed, in the environment) still works as a bootstrap; tokens in the database are preferred.

## Migrating file-backed data

```sh
greenlight-migrate-to-supabase --from /var/lib/greenlight            # dry run: reads and compares only
greenlight-migrate-to-supabase --from /var/lib/greenlight --apply    # imports; never overwrites
```

- **What is imported:** projects, test versions (with their numbers), approvals, finished jobs, and verification records with their evidence. Evidence is uploaded and verified like a live run. Ids and timestamps are preserved.
- **Never overwritten:** anything already in Supabase is compared. Identical items are skipped; different ones are reported as `conflicts` and left untouched, and nothing dependent is attached to a conflicting project or version.
- **Never dropped silently:** items that cannot be imported are listed under `refused` with a reason (record hash mismatch, missing evidence, unfinished job, no job). The source directory is only read. Re-running is safe and idempotent.
- **Exit code:** 1 when there are conflicts or refusals.

## Health, readiness and startup

- `GET /v1/health`: liveness, no dependencies.
- `GET /v1/ready`: readiness. Calls `greenlight_authenticate` with an all-zero hash (proves the key is
  accepted, `greenlight_api` is exposed and its RPCs run as `service_role`) and reads the bucket's metadata
  (exists and `public = false`). `200` when both are `ok`, else `503`. The body holds codes only.
- `bin/greenlight-server.js` runs the same check before listening. It retries only while Supabase is
  unreachable (5 attempts, backoff) and exits with code 2 and a `not_ready` log line otherwise. It refuses
  to start on the file store.

### Troubleshooting

| `database` / `storage` code | Cause and fix |
|---|---|
| `unauthorized` | Wrong or revoked key, or a `sb_secret_` key sent as a Bearer token by another client. Use the project's secret key |
| `schema_not_exposed` | Add `greenlight_api` to Project Settings → API → Exposed schemas |
| `unreachable` | Network or DNS to `<ref>.supabase.co`; the host must be allowed by the server's egress rules |
| `bucket_missing` | Apply `20261119140200_greenlight_evidence_bucket.sql`, or fix `GREENLIGHT_EVIDENCE_BUCKET` |
| `bucket_public` | Someone made the bucket public: set it private again before serving |

## Testing against the real project

Two live suites, both skipped unless `GREENLIGHT_LIVE_SUPABASE=1`:

- `test/server/supabase-anon-live.test.js` needs only `SUPABASE_URL` and the **publishable** key
  (`SUPABASE_PUBLISHABLE_KEY`, public). Over the real Data API and Storage API it proves that the public key
  reaches nothing of Greenlight's: every `greenlight_api` RPC → `42501`, the `greenlight` schema → `PGRST106`
  (not exposed), no Greenlight function in `public`, the evidence bucket → not found (info, list, public URL,
  upload). It also checks that the server refuses a publishable or anon key as `SUPABASE_SERVICE_ROLE_KEY`.
  **Passed against Ceaser on 2026-11-20.**
- `test/server/supabase-live.test.js` needs the **secret** key and runs the real server (HTTP API, job runner, certification pipeline,
`SupabaseStore`) against the real RPCs and the real private bucket. Kane, the credit balance, the
evidence validator and the deployment check are fakes, so no Kane run and no credits. It is skipped unless
the key is present:

```sh
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_PUBLISHABLE_KEY=sb_publishable_... SUPABASE_SERVICE_ROLE_KEY=<secret key> npm run test:live
```

It writes only to the dedicated accounts `greenlight-e2e-a` and `greenlight-e2e-b` (rows are permanent: the
tables are immutable), creates a new project per run, issues fresh tokens and revokes them at the end, and
stores only a **failed** run (`certified: false`): it never creates a certification. It covers readiness,
token authentication, roles, account isolation, projects, versions, write-once approvals, a job through to
its record and run, evidence upload, download, SHA-256 verification and refused overwrites, the public
view's redaction, a restart (new store and job runner, `recover()`), refused changes to finished jobs and
records, and revocation.

**Both suites passed against Ceaser on 2026-11-20** with the secret key injected by the session's egress
proxy (7/7), and the server binary started, reported ready, refused unauthenticated requests and restarted
cleanly with nothing secret in its logs. Earlier database-level verification of all 20 RPCs: see
[baselines/greenlight-e2e-verification.md](baselines/greenlight-e2e-verification.md).

## Operational notes

- One server process should run jobs at a time. The per-project single-active-job rule holds across instances (database index), but `GREENLIGHT_MAX_CONCURRENT_JOBS` and rate limits are per process, and on start a process settles every job it finds queued or running.
- A job left `running` by a crash is completed from its record if the record was committed; otherwise it is marked `failed` (`interrupted`). Nothing is re-run.
- Back up the database and the bucket together: a record without its objects fails evidence verification.
