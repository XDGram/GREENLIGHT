# Greenlight end-to-end verification on Ceaser

Run on 2026-11-20 in project `ceaser` (`ncbrsrklofofdqdftwjw`), through the Supabase SQL connector as
`service_role` (`set local role service_role`). The server's secret key was not available to this
environment, so the HTTP paths (PostgREST and Storage with the key) are covered by
`test/server/supabase-live.test.js`, which runs as soon as the key is set (see
[../SUPABASE.md](../SUPABASE.md#testing-against-the-real-project)).

## Method

1. The live test suite ran on the PGlite stand-in (real migrations, fake PostgREST/Storage) and every RPC
   request the real server code sent was captured: **102 calls covering all 20 `greenlight_api` functions**,
   with the exact JSON documents the server builds (projects, test versions with full test contents,
   approvals, jobs, a failed certification run with its manifest and file hashes, the record).
2. The same calls were replayed in one transaction on Ceaser and, separately, on PGlite as the reference.
   Each call's SQLSTATE and `md5(result::text)` were compared.
   - Calls 0–35 (accounts, users, tokens, a project, two versions, an approval, reads, isolation reads) were
     **committed**.
   - Calls 36–101 (job queued → running → succeeded, `put_record` with run, claims and tests, record and run
     reads, account-isolation reads, a second account's project, the restart reads, refused job and record
     changes, revocation) ran inside a sub-transaction that was **rolled back**, so no run row exists that
     points at evidence objects that were never uploaded.
3. A separate session read the committed data back, and the test tokens were revoked.

## Results

| Check | Result |
|---|---|
| Error codes | identical: `GLCON` (second approval, write-once), 5 × `GLNFD` (other account reading a project/job), `23514` (finished job moved back to `running`), `GLINV` (record rewritten as `certified: true`) |
| Results | 97 of 102 byte-identical fingerprints; the 5 others (`ensure_account` × 2, `create_user` × 3) differ only in database-generated UUIDs and timestamps, same fields and values otherwise |
| Read-back in a new session (persistence) | project, versions `[1, 2]`, approval hash `68d811b0…`, version 1 fingerprint identical to the in-transaction read |
| Isolation | `greenlight-e2e-b` lists no projects of `greenlight-e2e-a` and gets `GLNFD` for them |
| Rolled-back phase | 0 jobs, 0 runs, 0 records, 0 storage objects |
| Revocation | all 3 test tokens revoked; `greenlight_authenticate` returns null for each in a new statement (the function is `STABLE`, so within the revoking statement it still sees the old snapshot; every API request is its own statement) |
| Ceaser | `policies_md5`, `relacl_md5`, `constraints_md5`, `indexes_md5` equal the reference values in [ceaser-after-greenlight.md](ceaser-after-greenlight.md); `communities` 3, `posts` 124 |

## Rows left in Greenlight's tables (permanent by design)

Accounts `greenlight-e2e-a`, `greenlight-e2e-b`; users `e2e-owner`, `e2e-agent`, `e2e-other`; 3 revoked
tokens; project `prj_834501c8031744a3a449f357343a158c` with versions 1 and 2 and the approval of version 1.
No jobs, runs, records or evidence objects. No certification.
