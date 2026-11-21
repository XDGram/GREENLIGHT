-- Greenlight persistence (1/3): tables, constraints, indexes, immutability.
--
-- Everything lives in the private schema "greenlight". It is NOT exposed through
-- the Supabase Data API: the anon and authenticated roles have no access to the
-- schema or its tables, RLS is enabled with no policies (deny all), and the
-- Greenlight server reaches the data only through the service-role-only RPC
-- functions in migration 2/3.

create schema if not exists greenlight;
revoke all on schema greenlight from public;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema greenlight from anon'; end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then execute 'revoke all on schema greenlight from authenticated'; end if;
end $$;

-- ---------------------------------------------------------------- accounts, users, roles, tokens

create table greenlight.accounts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9_-]{0,62}$'),
  created_at timestamptz not null default now()
);

create table greenlight.users (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references greenlight.accounts (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 100),
  role text not null check (role in ('owner', 'agent')),
  created_at timestamptz not null default now(),
  unique (account_id, name)
);

-- Only the SHA-256 of a token is ever stored.
create table greenlight.api_tokens (
  token_sha256 text primary key check (token_sha256 ~ '^[0-9a-f]{64}$'),
  user_id uuid not null references greenlight.users (id) on delete restrict,
  label text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create index api_tokens_user_idx on greenlight.api_tokens (user_id);

-- ---------------------------------------------------------------- projects and test versions

create table greenlight.projects (
  id text primary key check (id ~ '^prj_[0-9a-f]{32}$'),
  account_id uuid not null references greenlight.accounts (id) on delete restrict,
  name text not null check (char_length(name) between 1 and 200),
  url text not null check (url ~ '^https?://'),
  created_by text not null,
  created_at timestamptz not null,
  doc jsonb not null
);
create index projects_account_idx on greenlight.projects (account_id, created_at);

create table greenlight.test_versions (
  project_id text not null references greenlight.projects (id) on delete restrict,
  version integer not null check (version >= 1),
  approved_test_hash text not null check (approved_test_hash ~ '^[0-9a-f]{64}$'),
  spec_text text not null,
  spec_sha256 text not null check (spec_sha256 ~ '^[0-9a-f]{64}$'),
  submitted_by text not null,
  submitted_at timestamptz not null,
  doc jsonb not null,
  primary key (project_id, version)
);

-- One approval per version, ever. Only a server owner approval exists here.
create table greenlight.approvals (
  project_id text not null,
  version integer not null,
  approved_test_hash text not null check (approved_test_hash ~ '^[0-9a-f]{64}$'),
  approved_by text not null,
  approved_at timestamptz not null,
  method text not null check (method = 'server-owner'),
  certifiable boolean not null check (certifiable),
  record_sha256 text not null check (record_sha256 ~ '^[0-9a-f]{64}$'),
  doc jsonb not null,
  primary key (project_id, version),
  foreign key (project_id, version) references greenlight.test_versions (project_id, version) on delete restrict
);

-- ---------------------------------------------------------------- jobs, runs, certification records

create table greenlight.jobs (
  id text primary key check (id ~ '^job_[0-9a-f]{32}$'),
  kind text not null check (kind = 'certification'),
  project_id text not null,
  version integer not null,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed')),
  outcome text,
  requested_by text not null,
  created_at timestamptz not null,
  started_at timestamptz,
  finished_at timestamptz,
  record_id text check (record_id is null or record_id ~ '^vr_[0-9a-f]{32}$'),
  doc jsonb not null,
  foreign key (project_id, version) references greenlight.test_versions (project_id, version) on delete restrict,
  check ((status in ('succeeded', 'failed')) = (finished_at is not null)),
  check (status <> 'succeeded' or record_id is not null)
);
-- At most one queued or running certification per project, across every server instance.
create unique index jobs_one_active_per_project on greenlight.jobs (project_id) where status in ('queued', 'running');
create index jobs_status_idx on greenlight.jobs (status);
create index jobs_project_idx on greenlight.jobs (project_id, created_at);

-- Run history: one row per Kane execution the server performed.
create table greenlight.runs (
  run_id text primary key check (run_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'),
  job_id text not null references greenlight.jobs (id) on delete restrict,
  project_id text not null references greenlight.projects (id) on delete restrict,
  run_kind text not null check (run_kind = 'certification'),
  manifest jsonb not null,
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_status text not null,
  evidence_sha256 text check (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$'),
  evidence_bytes bigint,
  storage_prefix text not null, -- private object prefix in the evidence bucket; never returned by public APIs
  files jsonb not null,          -- [{name, sha256, bytes}] verified after upload
  created_at timestamptz not null
);
create index runs_project_idx on greenlight.runs (project_id, created_at);

create table greenlight.certification_records (
  id text primary key check (id ~ '^vr_[0-9a-f]{32}$'),
  project_id text not null references greenlight.projects (id) on delete restrict,
  version integer not null,
  job_id text not null unique references greenlight.jobs (id) on delete restrict,
  run_id text not null unique references greenlight.runs (run_id) on delete restrict,
  status text not null check (status in ('passed', 'failed', 'couldnt_verify')),
  certified boolean not null,
  approved_test_hash text not null check (approved_test_hash ~ '^[0-9a-f]{64}$'),
  deployed_commit text not null check (deployed_commit ~ '^[0-9a-f]{40}([0-9a-f]{24})?$'),
  record_sha256 text not null check (record_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null,
  doc jsonb not null,
  foreign key (project_id, version) references greenlight.test_versions (project_id, version) on delete restrict,
  -- A certification is always a passing run (the full rule is enforced in greenlight_put_record).
  check (not certified or status = 'passed')
);
create index certification_records_project_idx on greenlight.certification_records (project_id, created_at);

create table greenlight.record_claims (
  record_id text not null references greenlight.certification_records (id) on delete restrict,
  claim_id text not null check (claim_id ~ '^CLM-[0-9]{3,}$'),
  text text,
  status text not null check (status in ('passed', 'failed', 'partial', 'couldnt_verify')),
  primary key (record_id, claim_id)
);

create table greenlight.record_tests (
  record_id text not null,
  claim_id text not null,
  file text not null check (file ~ '^[a-z0-9-]+_test\.md$'),
  status text not null check (status in ('passed', 'app_failure', 'couldnt_verify')),
  primary key (record_id, claim_id, file),
  foreign key (record_id, claim_id) references greenlight.record_claims (record_id, claim_id) on delete restrict
);

-- ---------------------------------------------------------------- immutability

create or replace function greenlight.forbid_change() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception 'greenlight: % rows are immutable (% refused)', tg_table_name, tg_op using errcode = 'GLIMM';
end $$;

do $$
declare t text;
begin
  foreach t in array array['test_versions', 'approvals', 'runs', 'certification_records', 'record_claims', 'record_tests'] loop
    execute format('create trigger %I before update or delete on greenlight.%I for each row execute function greenlight.forbid_change()', t || '_immutable', t);
    execute format('create trigger %I before truncate on greenlight.%I for each statement execute function greenlight.forbid_change()', t || '_no_truncate', t);
  end loop;
end $$;

-- Jobs only move forward: queued -> running -> succeeded|failed, queued -> failed.
-- A finished job never changes again; its identity fields never change.
create or replace function greenlight.job_transition() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'greenlight: jobs are kept as history' using errcode = 'GLIMM';
  end if;
  if old.status in ('succeeded', 'failed') then
    raise exception 'greenlight: job % is finished and immutable', old.id using errcode = 'GLIMM';
  end if;
  if new.id <> old.id or new.project_id <> old.project_id or new.version <> old.version or new.kind <> old.kind
     or new.created_at <> old.created_at or new.requested_by <> old.requested_by
     or (new.doc -> 'request') is distinct from (old.doc -> 'request') then
    raise exception 'greenlight: job identity fields are immutable' using errcode = 'GLIMM';
  end if;
  if not ((old.status = 'queued' and new.status in ('queued', 'running', 'failed'))
       or (old.status = 'running' and new.status in ('running', 'succeeded', 'failed'))) then
    raise exception 'greenlight: job status % -> % is not allowed', old.status, new.status using errcode = 'GLIMM';
  end if;
  return new;
end $$;
create trigger jobs_transition before update or delete on greenlight.jobs for each row execute function greenlight.job_transition();
create trigger jobs_no_truncate before truncate on greenlight.jobs for each statement execute function greenlight.forbid_change();

-- ---------------------------------------------------------------- row level security: deny all to API roles

do $$
declare t text;
begin
  foreach t in array array['accounts', 'users', 'api_tokens', 'projects', 'test_versions', 'approvals', 'jobs', 'runs', 'certification_records', 'record_claims', 'record_tests'] loop
    execute format('alter table greenlight.%I enable row level security', t);
    execute format('revoke all on greenlight.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on greenlight.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on greenlight.%I from authenticated', t); end if;
  end loop;
end $$;
