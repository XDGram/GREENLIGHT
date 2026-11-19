-- Greenlight persistence (2/3): the only way in. Service-role-only RPC functions.
--
-- The functions live in their own schema, greenlight_api, never in public:
-- nothing Greenlight owns is added to the schema an existing application's
-- frontend credentials (anon / authenticated) talk to, and that application's
-- default privileges or grants on public can never reach Greenlight.
--
-- greenlight_api must be added to the project's Data API "Exposed schemas" so the
-- server can call it (PostgREST, Content-Profile: greenlight_api). Exposing it
-- grants nothing: only service_role has USAGE on the schema and EXECUTE on its
-- functions; anon and authenticated have neither.
--
-- Every function is SECURITY DEFINER with an empty search_path and runs as one
-- transaction. Errors use stable SQLSTATEs the server maps to API error codes:
--   GLNFD not found · GLCON conflict/exists · GLLIM job limit · GLINV invalid
--   GLHSH approval hash mismatch · GLCRT certification rule violated · GLIMM immutable

create schema if not exists greenlight_api;
revoke all on schema greenlight_api from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema greenlight_api from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema greenlight_api from authenticated'; end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then execute 'grant usage on schema greenlight_api to service_role'; end if;
end $$;
-- Functions created later in these schemas never start out executable by PUBLIC.
alter default privileges in schema greenlight_api revoke execute on functions from public;
alter default privileges in schema greenlight revoke execute on functions from public;

-- ---------------------------------------------------------------- accounts, users, tokens (admin)

create or replace function greenlight_api.greenlight_ensure_account(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v greenlight.accounts;
begin
  insert into greenlight.accounts (slug) values (p_slug) on conflict (slug) do nothing;
  select * into v from greenlight.accounts where slug = p_slug;
  return jsonb_build_object('id', v.id, 'slug', v.slug, 'createdAt', v.created_at);
end $$;

create or replace function greenlight_api.greenlight_create_user(p_account text, p_name text, p_role text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_account uuid; v greenlight.users;
begin
  select id into v_account from greenlight.accounts where slug = p_account;
  if v_account is null then raise exception 'greenlight: no such account' using errcode = 'GLNFD'; end if;
  insert into greenlight.users (account_id, name, role) values (v_account, p_name, p_role) returning * into v;
  return jsonb_build_object('id', v.id, 'account', p_account, 'name', v.name, 'role', v.role);
exception when unique_violation then
  raise exception 'greenlight: user exists' using errcode = 'GLCON';
end $$;

create or replace function greenlight_api.greenlight_add_token(p_account text, p_user text, p_token_sha256 text, p_label text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  select u.id into v_user from greenlight.users u join greenlight.accounts a on a.id = u.account_id where a.slug = p_account and u.name = p_user;
  if v_user is null then raise exception 'greenlight: no such user' using errcode = 'GLNFD'; end if;
  insert into greenlight.api_tokens (token_sha256, user_id, label) values (p_token_sha256, v_user, p_label);
  return jsonb_build_object('account', p_account, 'user', p_user, 'label', p_label);
exception when unique_violation then
  raise exception 'greenlight: token exists' using errcode = 'GLCON';
end $$;

create or replace function greenlight_api.greenlight_revoke_token(p_token_sha256 text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update greenlight.api_tokens set revoked_at = now() where token_sha256 = p_token_sha256 and revoked_at is null;
  return found;
end $$;

-- Token hash -> principal. The account comes from the token, never from the client.
create or replace function greenlight_api.greenlight_authenticate(p_token_sha256 text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', u.name, 'role', u.role, 'account', a.slug)
  from greenlight.api_tokens t
  join greenlight.users u on u.id = t.user_id
  join greenlight.accounts a on a.id = u.account_id
  where t.token_sha256 = p_token_sha256 and t.revoked_at is null
$$;

-- ---------------------------------------------------------------- projects

create or replace function greenlight_api.greenlight_create_project(p_doc jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_account uuid;
begin
  select id into v_account from greenlight.accounts where slug = p_doc ->> 'account';
  if v_account is null then raise exception 'greenlight: no such account' using errcode = 'GLNFD'; end if;
  insert into greenlight.projects (id, account_id, name, url, created_by, created_at, doc)
  values (p_doc ->> 'id', v_account, p_doc ->> 'name', p_doc ->> 'url', p_doc ->> 'createdBy', (p_doc ->> 'createdAt')::timestamptz, p_doc);
  return p_doc;
exception when unique_violation then
  raise exception 'greenlight: project exists' using errcode = 'GLCON';
end $$;

-- p_account null = no scoping (server-internal use only, e.g. job execution).
create or replace function greenlight_api.greenlight_get_project(p_id text, p_account text default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  select p.doc into v from greenlight.projects p join greenlight.accounts a on a.id = p.account_id
  where p.id = p_id and (p_account is null or a.slug = p_account);
  if v is null then raise exception 'greenlight: no such project' using errcode = 'GLNFD'; end if;
  return v;
end $$;

create or replace function greenlight_api.greenlight_list_projects(p_account text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(p.doc order by p.created_at, p.id), '[]'::jsonb)
  from greenlight.projects p join greenlight.accounts a on a.id = p.account_id
  where a.slug = p_account
$$;

-- ---------------------------------------------------------------- test versions

-- Atomic numbering: the project row is locked, so concurrent proposals get 1, 2, 3 …
create or replace function greenlight_api.greenlight_add_version(p_project_id text, p_doc jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_doc jsonb;
begin
  perform 1 from greenlight.projects where id = p_project_id for update;
  if not found then raise exception 'greenlight: no such project' using errcode = 'GLNFD'; end if;
  if coalesce(p_doc ->> 'projectId', '') <> p_project_id then raise exception 'greenlight: projectId mismatch' using errcode = 'GLINV'; end if;
  select coalesce(max(version), 0) + 1 into v_n from greenlight.test_versions where project_id = p_project_id;
  v_doc := p_doc || jsonb_build_object('version', v_n);
  insert into greenlight.test_versions (project_id, version, approved_test_hash, spec_text, spec_sha256, submitted_by, submitted_at, doc)
  values (p_project_id, v_n, v_doc ->> 'approvedTestHash', v_doc ->> 'specText', v_doc ->> 'specFileSha256', v_doc ->> 'submittedBy', (v_doc ->> 'submittedAt')::timestamptz, v_doc);
  return v_doc;
end $$;

create or replace function greenlight_api.greenlight_get_version(p_project_id text, p_version integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  select doc into v from greenlight.test_versions where project_id = p_project_id and version = p_version;
  if v is null then raise exception 'greenlight: no such test version' using errcode = 'GLNFD'; end if;
  return v;
end $$;

create or replace function greenlight_api.greenlight_list_versions(p_project_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(doc order by version), '[]'::jsonb) from greenlight.test_versions where project_id = p_project_id
$$;

-- ---------------------------------------------------------------- approvals (write-once)

create or replace function greenlight_api.greenlight_put_approval(p_doc jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_hash text;
begin
  select approved_test_hash into v_hash from greenlight.test_versions
  where project_id = p_doc ->> 'projectId' and version = (p_doc ->> 'version')::integer;
  if v_hash is null then raise exception 'greenlight: no such test version' using errcode = 'GLNFD'; end if;
  -- The database itself refuses an approval for other tests than the version's.
  if v_hash <> p_doc ->> 'approvedTestHash' then raise exception 'greenlight: approval hash does not match the version' using errcode = 'GLHSH'; end if;
  if p_doc ->> 'method' <> 'server-owner' or (p_doc ->> 'certifiable')::boolean is not true then
    raise exception 'greenlight: only certifiable server-owner approvals are stored' using errcode = 'GLINV';
  end if;
  insert into greenlight.approvals (project_id, version, approved_test_hash, approved_by, approved_at, method, certifiable, record_sha256, doc)
  values (p_doc ->> 'projectId', (p_doc ->> 'version')::integer, p_doc ->> 'approvedTestHash', p_doc ->> 'approvedBy', (p_doc ->> 'approvedAt')::timestamptz,
          p_doc ->> 'method', true, p_doc ->> 'recordSha256', p_doc);
  return p_doc;
exception when unique_violation then
  raise exception 'greenlight: this version is already approved; approvals are write-once' using errcode = 'GLCON';
end $$;

create or replace function greenlight_api.greenlight_get_approval(p_project_id text, p_version integer) returns jsonb
language sql stable security definer set search_path = '' as $$
  select doc from greenlight.approvals where project_id = p_project_id and version = p_version
$$;

-- ---------------------------------------------------------------- jobs

create or replace function greenlight_api.greenlight_put_job(p_doc jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_status text := p_doc ->> 'status'; v_record text := p_doc ->> 'recordId';
begin
  if v_status = 'succeeded' and not exists (
    select 1 from greenlight.certification_records where id = v_record and job_id = p_doc ->> 'id'
  ) then
    raise exception 'greenlight: a succeeded job must point at its stored record' using errcode = 'GLINV';
  end if;
  insert into greenlight.jobs (id, kind, project_id, version, status, outcome, requested_by, created_at, started_at, finished_at, record_id, doc)
  values (p_doc ->> 'id', p_doc ->> 'kind', p_doc ->> 'projectId', (p_doc ->> 'version')::integer, v_status, p_doc ->> 'outcome', p_doc ->> 'requestedBy',
          (p_doc ->> 'createdAt')::timestamptz, (p_doc ->> 'startedAt')::timestamptz, (p_doc ->> 'finishedAt')::timestamptz, v_record, p_doc)
  on conflict (id) do update set
    status = excluded.status, outcome = excluded.outcome, started_at = excluded.started_at,
    finished_at = excluded.finished_at, record_id = excluded.record_id, doc = excluded.doc;
  return p_doc;
exception when unique_violation then
  raise exception 'greenlight: a certification for this project is already queued or running' using errcode = 'GLLIM';
end $$;

create or replace function greenlight_api.greenlight_get_job(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  select doc into v from greenlight.jobs where id = p_id;
  if v is null then raise exception 'greenlight: no such job' using errcode = 'GLNFD'; end if;
  return v;
end $$;

create or replace function greenlight_api.greenlight_list_jobs(p_statuses text[] default null) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(doc order by created_at, id), '[]'::jsonb) from greenlight.jobs
  where p_statuses is null or status = any (p_statuses)
$$;

-- ---------------------------------------------------------------- runs and certification records (write-once, one transaction)

create or replace function greenlight_api.greenlight_put_record(p_record jsonb, p_run jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_job greenlight.jobs;
  v_version_hash text;
  v_approval greenlight.approvals;
  v_certified boolean := (p_record ->> 'certified')::boolean;
  v_claim jsonb;
  v_test jsonb;
begin
  select * into v_job from greenlight.jobs where id = p_run ->> 'jobId';
  if v_job.id is null then raise exception 'greenlight: no such job' using errcode = 'GLNFD'; end if;
  if v_job.status <> 'running' then raise exception 'greenlight: records are only written by a running job' using errcode = 'GLINV'; end if;
  if v_job.project_id <> p_record ->> 'projectId' or v_job.version <> (p_record ->> 'testVersion')::integer then
    raise exception 'greenlight: record does not belong to its job' using errcode = 'GLINV';
  end if;
  select approved_test_hash into v_version_hash from greenlight.test_versions where project_id = v_job.project_id and version = v_job.version;
  if v_version_hash <> p_record ->> 'approvedTestHash' then raise exception 'greenlight: record is for other tests than the version' using errcode = 'GLHSH'; end if;

  -- Certification rule, enforced by the database as well as the server.
  if v_certified then
    select * into v_approval from greenlight.approvals where project_id = v_job.project_id and version = v_job.version;
    if p_record ->> 'status' <> 'passed'
       or p_run ->> 'runKind' <> 'certification'
       or p_run -> 'manifest' ->> 'runKind' <> 'certification'
       or p_run ->> 'evidenceStatus' <> 'stored'
       or v_approval.project_id is null
       or not v_approval.certifiable
       or v_approval.approved_test_hash <> v_version_hash
       or v_approval.record_sha256 <> p_record -> 'approval' ->> 'recordSha256' then
      raise exception 'greenlight: certified=true violates the certification rule' using errcode = 'GLCRT';
    end if;
  end if;

  insert into greenlight.runs (run_id, job_id, project_id, run_kind, manifest, manifest_sha256, evidence_status, evidence_sha256, evidence_bytes, storage_prefix, files, created_at)
  values (p_run ->> 'runId', v_job.id, v_job.project_id, p_run ->> 'runKind', p_run -> 'manifest', p_run ->> 'manifestSha256', p_run ->> 'evidenceStatus',
          p_run ->> 'evidenceSha256', (p_run ->> 'evidenceBytes')::bigint, p_run ->> 'storagePrefix', p_run -> 'files', (p_run ->> 'createdAt')::timestamptz);

  insert into greenlight.certification_records (id, project_id, version, job_id, run_id, status, certified, approved_test_hash, deployed_commit, record_sha256, created_at, doc)
  values (p_record ->> 'id', v_job.project_id, v_job.version, v_job.id, p_run ->> 'runId', p_record ->> 'status', v_certified, p_record ->> 'approvedTestHash',
          p_record -> 'deployment' ->> 'commit', p_record ->> 'recordSha256', (p_record ->> 'createdAt')::timestamptz, p_record);

  for v_claim in select * from jsonb_array_elements(coalesce(p_record -> 'claims', '[]'::jsonb)) loop
    insert into greenlight.record_claims (record_id, claim_id, text, status) values (p_record ->> 'id', v_claim ->> 'id', v_claim ->> 'text', v_claim ->> 'status');
    for v_test in select * from jsonb_array_elements(coalesce(v_claim -> 'tests', '[]'::jsonb)) loop
      insert into greenlight.record_tests (record_id, claim_id, file, status) values (p_record ->> 'id', v_claim ->> 'id', v_test ->> 'file', v_test ->> 'status');
    end loop;
  end loop;
  return p_record;
exception when unique_violation then
  raise exception 'greenlight: that record or run already exists and is immutable' using errcode = 'GLCON';
end $$;

create or replace function greenlight_api.greenlight_get_record(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  select doc into v from greenlight.certification_records where id = p_id;
  if v is null then raise exception 'greenlight: no such verification record' using errcode = 'GLNFD'; end if;
  return v;
end $$;

create or replace function greenlight_api.greenlight_list_records(p_project_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(doc order by created_at, id), '[]'::jsonb) from greenlight.certification_records where project_id = p_project_id
$$;

-- Private run row (storage prefix, file hashes) for evidence integrity checks. Never public.
create or replace function greenlight_api.greenlight_get_run(p_run_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v greenlight.runs;
begin
  select * into v from greenlight.runs where run_id = p_run_id;
  if v.run_id is null then raise exception 'greenlight: no such run' using errcode = 'GLNFD'; end if;
  return jsonb_build_object('runId', v.run_id, 'jobId', v.job_id, 'projectId', v.project_id, 'runKind', v.run_kind, 'manifestSha256', v.manifest_sha256,
    'evidenceStatus', v.evidence_status, 'evidenceSha256', v.evidence_sha256, 'evidenceBytes', v.evidence_bytes, 'storagePrefix', v.storage_prefix, 'files', v.files, 'createdAt', v.created_at);
end $$;

-- ---------------------------------------------------------------- privileges: service_role only

do $$
declare f record;
begin
  -- Revoke everything from PUBLIC/anon/authenticated on every Greenlight function
  -- (including the trigger functions in "greenlight"); grant EXECUTE to
  -- service_role on the RPC functions in "greenlight_api" only.
  for f in
    select p.oid::regprocedure as sig, n.nspname as schema from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('greenlight_api', 'greenlight')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;
    if f.schema = 'greenlight_api' and exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
end $$;
