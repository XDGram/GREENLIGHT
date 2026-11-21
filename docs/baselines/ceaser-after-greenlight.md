# Ceaser after the Greenlight migrations

Applied and verified on 2026-11-19 in project `ceaser` (`ncbrsrklofofdqdftwjw`). Compare with
[ceaser-before-greenlight.md](ceaser-before-greenlight.md). Read-only check queries:
[greenlight-isolation-check.sql](greenlight-isolation-check.sql).

## Migrations applied

Applied in order with the Supabase migration tool. Each stored statement is byte-identical to the
reviewed file (md5 of the file without its trailing newline). Supabase records its own version
timestamps, not the file names'.

| File | Recorded version | Name | md5 |
|---|---|---|---|
| `20261119140000_greenlight_schema.sql` | `20261119153101` | `greenlight_schema` | `5b21a2da78d9661a41921cedbba65a00` |
| `20261119140100_greenlight_rpc.sql` | `20261119153804` | `greenlight_rpc` | `139bdfd8d8915c25e6ae5f751609ddbb` |
| `20261119140200_greenlight_evidence_bucket.sql` | `20261119153814` | `greenlight_evidence_bucket` | `c0215978595bf8a415b315fc068a1c65` |

Ceaser's four migrations are unchanged (same versions, names and statement md5s).

## Greenlight objects

| Check | Result |
|---|---|
| `greenlight` tables | 11, RLS on, 0 policies, owner `postgres`, ACL `postgres` only |
| Constraints / indexes | 11 PK, 14 FK, 4 unique, 34 check; 22 indexes (incl. one-active-job partial unique) |
| Triggers | 14: `*_immutable` + `*_no_truncate` on the 6 immutable tables, `jobs_transition` + `jobs_no_truncate` |
| `greenlight` functions | `forbid_change`, `job_transition`: `search_path=''`, EXECUTE `postgres` only |
| `greenlight_api` functions | 20, all `SECURITY DEFINER`, `search_path=''`, EXECUTE `postgres` + `service_role` only |
| Schema ACLs | `greenlight`: `postgres` only · `greenlight_api`: `postgres`, `service_role=U` |
| Bucket | `greenlight-evidence`, `public = false`, 100 MB limit; `storage.buckets`/`objects` RLS on, 0 storage policies |

## Access

| Role | Result |
|---|---|
| `anon`, `authenticated` (SQL `set role`) | no USAGE on either schema; 0 table privileges; 0 executable functions; reading a table or calling an RPC → `42501 permission denied` |
| `anon` over the Data API (publishable key) | `Content-Profile: greenlight_api` RPC → `401 42501 permission denied for schema greenlight_api`; `greenlight` → `406 PGRST106` (not exposed) |
| `anon` over Storage | bucket info and public URL → `Bucket not found`; object list → `[]`; `storage.buckets` shows 0 rows to `anon` |
| `service_role` | USAGE on `greenlight_api`; EXECUTE on all 20 RPCs (call succeeds); no direct table privileges; sees the bucket |
| `PUBLIC` | 0 function grants |
| Data API exposed schemas | `public, graphql_public, greenlight_api` (from PostgREST's `PGRST106` hint) |

Ceaser's own `anon` read of `public.communities` still succeeds.

## Security advisors

- INFO `rls_enabled_no_policy` × 11 on the `greenlight` tables: intended (deny all; access only through service-role functions).
- ERROR `security_definer_view` on `public.post_stats`: Ceaser's pre-existing finding, unchanged.
- No other findings.

## Ceaser comparison

Identical to the baseline and to a pre-migration snapshot taken minutes before applying: the four
`public` tables and RLS flags, `post_stats` definition md5 `6636f08353595ca11af8716a0a3015f0`, no
`public` functions or triggers, 11 policies (full text md5 unchanged), table and column ACLs, `public`
schema ACL, other schemas and ACLs, roles, default privileges outside Greenlight's schemas,
extensions, row counts (3 / 124 / 140 / 6), six data hashes, no other buckets, storage objects and
policies, Ceaser's 4 migrations.

Catalog row ages confirm nothing of Ceaser's was created, altered, renamed or re-granted: every
Greenlight catalog row is at most 8 transactions old, while the youngest Ceaser rows are 41
(relations, columns), 182 (constraints), 187 (policies), 331 (view rule), 334 (`public` schema) and
402 (other default privileges) transactions old. All `public` constraint and relation OIDs are lower
than every Greenlight OID.

Notes:
- The baseline's data md5 `50da6dad050eb274001333a6aeb0e898` could not be reproduced because the
  query that produced it was not recorded. Row counts and every structural value match, and six data
  hashes were identical before and after the migrations.
- One pre-migration fingerprint (constraints) used `order by 1` inside `string_agg`, which orders by a
  constant, so its value depends on scan order and changed when Greenlight's constraints were added.
  The check file uses explicit ordering throughout.

## Reference values for `greenlight-isolation-check.sql`

Section 1 (Ceaser fingerprint, deterministic ordering) returned, after the migrations:

| Field | Value |
|---|---|
| `policies_md5` | `af4e21def394e9fa4a7e25e39440004a` |
| `relacl_md5` | `a1a6ea5a0e2dc659e34a36a05d4a7fdd` |
| `constraints_md5` | `9321d1dda41f89f833125f30880bdfe8` |
| `indexes_md5` | `f403d00cdd1131c5011d95f680b02328` |
| `default_acl_md5` (outside Greenlight's schemas) | `d62aac914c4c2c0a062008beb5e97bb1` |
| `views` | `post_stats` → `6636f08353595ca11af8716a0a3015f0` |
| `ceaser_migrations` | the four listed in the baseline |

Sections 2 and 3 returned the Greenlight and access values in the tables above.
