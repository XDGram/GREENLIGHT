# Greenlight on Supabase

Supabase is Greenlight's production persistence: Postgres for every record, Storage for evidence. The server (`bin/greenlight-server.js`) refuses to start without it. The file-backed store is kept only for automated tests and as the source of a migration.

## Status of the connected Supabase organisation

| | |
|---|---|
| Organisation | `Z3r0_K3rneL` (`jluughszqtsrtvblcail`), **free plan** |
| Existing projects | `sentinel` and `ceaser` (active, other applications); `AetherClock`, `DEFI SCOUT`, `zecrow` (paused) |
| Greenlight project | **not created yet.** `create_project` was refused: the free plan allows 2 active projects per admin, and both slots are in use |
| Migrations applied remotely | **none.** Nothing has been written to any Supabase project |

To finish, a person must choose one of these:

- **Free a slot and create a `greenlight` project** in `eu-west-1`: pause or delete `sentinel` or `ceaser`, or upgrade the organisation. Then apply the three migrations. This is the recommended option.
- **Use an existing active project.** The migrations only create the private `greenlight` schema, `public.greenlight_*` functions and the `greenlight-evidence` bucket, so they do not touch other tables. It still shares one database, one service key and one backup policy with another application.

Apply the migrations in order, with the Supabase CLI (`supabase db push`) from this repository or the dashboard's SQL editor:

1. `supabase/migrations/20261119140000_greenlight_schema.sql`
2. `supabase/migrations/20261119140100_greenlight_rpc.sql`
3. `supabase/migrations/20261119140200_greenlight_evidence_bucket.sql`

All three run unchanged in the test suite on real PostgreSQL (PGlite). They are additive. The bucket migration never overwrites an existing bucket, and refuses to continue if a bucket with that name exists and is public.

## Configuration (server environment only)

| Variable | Value |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` (https only) |
| `SUPABASE_SERVICE_ROLE_KEY` | the project's service-role key (Project Settings → API). **A secret, server-side only.** Never commit it, never give it to a frontend, never put it in `NEXT_PUBLIC_*`/`VITE_*` or similar variables |
| `GREENLIGHT_EVIDENCE_BUCKET` | optional, default `greenlight-evidence` |
| `GREENLIGHT_WORK_DIR` | optional local scratch for Kane workspaces and in-flight evidence, default `<tmp>/greenlight-work` |

The key is stored as a non-enumerable config property, so serialised config, logs and errors never contain it. Errors from Supabase are scrubbed of it. The frontend never talks to Supabase directly: it uses the Greenlight API with Greenlight tokens. The anon key is not needed, and it has no access to anything Greenlight stores.

## Data model

Every table is in the private schema `greenlight`. The schema is not exposed through the Supabase Data API, `anon` and `authenticated` have no privileges on it, and RLS is enabled on every table with no policies (deny all).

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

Immutability is enforced by triggers (UPDATE, DELETE and TRUNCATE are refused with SQLSTATE `GLIMM`), not by application code.

Access goes only through `public.greenlight_*` functions: `SECURITY DEFINER`, `search_path = ''`, and `EXECUTE` granted to `service_role` only. Each function is one transaction. Several safeguards are enforced by the database, independently of the server:

- An approval is refused unless its hash equals the version's (`GLHSH`) and it is a certifiable owner approval.
- `greenlight_put_record` writes the run, record, claims and test results together. It refuses `certified = true` unless the status is `passed`, the run and manifest are `certification` runs, the evidence was `stored`, and a valid approval for exactly that hash exists (`GLCRT`).
- A job can only be marked `succeeded` if its record exists, and only while it is still running.

| SQLSTATE | API error code |
|---|---|
| `GLNFD` | `not_found` |
| `GLCON`, `GLIMM` | `conflict` |
| `GLLIM` | `job_limit_reached` |
| `GLHSH` | `approval_hash_mismatch` |
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

## Operational notes

- One server process should run jobs at a time. The per-project single-active-job rule holds across instances (database index), but `GREENLIGHT_MAX_CONCURRENT_JOBS` and rate limits are per process, and on start a process settles every job it finds queued or running.
- A job left `running` by a crash is completed from its record if the record was committed; otherwise it is marked `failed` (`interrupted`). Nothing is re-run.
- Back up the database and the bucket together: a record without its objects fails evidence verification.
