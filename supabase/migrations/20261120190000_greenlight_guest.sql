-- Greenlight persistence (4/4): guest demo workspaces.
--
-- Guests (no sign-up; a signed browser cookie names their session) can add an app, write or
-- generate tests, approve them themselves and start a capped number of real Kane runs. Their
-- data lives ONLY in these tables: guest approvals, runs and results never touch
-- greenlight.approvals, jobs, runs or certification_records, so a guest can never produce a
-- certification. Additive: nothing existing is changed.
--
-- Limits are enforced here, in one transaction under an advisory lock, so concurrent requests
-- cannot exceed them: sessions per IP hash per hour, projects and AI generations per guest,
-- real runs per guest and per rolling 24 hours across all guests.
-- New SQLSTATE: GLQTA quota reached (API: guest_limit_reached).

create table greenlight.guest_sessions (
  id text primary key check (id ~ '^gst_[0-9a-f]{32}$'),
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  runs_used integer not null default 0 check (runs_used >= 0),
  ai_used integer not null default 0 check (ai_used >= 0)
);
create index guest_sessions_ip_idx on greenlight.guest_sessions (ip_hash, created_at);

create table greenlight.guest_projects (
  id text primary key check (id ~ '^gpj_[0-9a-f]{32}$'),
  guest_id text not null references greenlight.guest_sessions (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  url text not null check (url ~ '^https?://'),
  approved_test_hash text not null check (approved_test_hash ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  doc jsonb not null
);
create index guest_projects_guest_idx on greenlight.guest_projects (guest_id, created_at);

create table greenlight.guest_runs (
  id text primary key check (id ~ '^grn_[0-9a-f]{32}$'),
  project_id text not null references greenlight.guest_projects (id) on delete cascade,
  guest_id text not null references greenlight.guest_sessions (id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'succeeded', 'failed')),
  refunded boolean not null default false,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  doc jsonb not null,
  check ((status in ('succeeded', 'failed')) = (finished_at is not null))
);
create index guest_runs_created_idx on greenlight.guest_runs (created_at);
create index guest_runs_project_idx on greenlight.guest_runs (project_id, created_at);

do $$
declare t text;
begin
  foreach t in array array['guest_sessions', 'guest_projects', 'guest_runs'] loop
    execute format('alter table greenlight.%I enable row level security', t);
    execute format('revoke all on greenlight.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on greenlight.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on greenlight.%I from authenticated', t); end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- views returned to the server

create or replace function greenlight.guest_session_json(v greenlight.guest_sessions) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', v.id, 'createdAt', v.created_at, 'lastSeenAt', v.last_seen_at, 'runsUsed', v.runs_used, 'aiUsed', v.ai_used,
    'projects', (select count(*) from greenlight.guest_projects p where p.guest_id = v.id));
$$;

create or replace function greenlight.guest_run_json(v greenlight.guest_runs) returns jsonb
language sql stable set search_path = '' as $$
  select v.doc || jsonb_build_object('id', v.id, 'projectId', v.project_id, 'guestId', v.guest_id, 'status', v.status, 'refunded', v.refunded,
    'createdAt', v.created_at, 'startedAt', v.started_at, 'finishedAt', v.finished_at);
$$;

create or replace function greenlight.guest_project_json(v greenlight.guest_projects) returns jsonb
language sql stable set search_path = '' as $$
  select v.doc || jsonb_build_object('id', v.id, 'guestId', v.guest_id, 'name', v.name, 'url', v.url, 'approvedTestHash', v.approved_test_hash,
    'approvedAt', v.approved_at, 'createdAt', v.created_at);
$$;

-- ---------------------------------------------------------------- sessions

create or replace function greenlight_api.greenlight_guest_create(p_id text, p_ip_hash text, p_max_per_ip_hour integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v greenlight.guest_sessions;
begin
  perform pg_advisory_xact_lock(hashtext('greenlight_guest_create'));
  if (select count(*) from greenlight.guest_sessions where ip_hash = p_ip_hash and created_at > now() - interval '1 hour') >= p_max_per_ip_hour then
    raise exception 'greenlight: too many new guest sessions from this network' using errcode = 'GLQTA';
  end if;
  insert into greenlight.guest_sessions (id, ip_hash) values (p_id, p_ip_hash) returning * into v;
  return greenlight.guest_session_json(v);
exception when unique_violation then
  raise exception 'greenlight: guest exists' using errcode = 'GLCON';
end $$;

create or replace function greenlight_api.greenlight_guest_get(p_id text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v greenlight.guest_sessions;
begin
  update greenlight.guest_sessions set last_seen_at = now() where id = p_id returning * into v;
  if v.id is null then raise exception 'greenlight: no such guest' using errcode = 'GLNFD'; end if;
  return greenlight.guest_session_json(v);
end $$;

create or replace function greenlight_api.greenlight_guest_use_ai(p_id text, p_max integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v greenlight.guest_sessions;
begin
  update greenlight.guest_sessions set ai_used = ai_used + 1 where id = p_id and ai_used < p_max returning * into v;
  if v.id is null then
    if exists (select 1 from greenlight.guest_sessions where id = p_id) then
      raise exception 'greenlight: AI generation limit reached' using errcode = 'GLQTA';
    end if;
    raise exception 'greenlight: no such guest' using errcode = 'GLNFD';
  end if;
  return greenlight.guest_session_json(v);
end $$;

-- ---------------------------------------------------------------- projects

create or replace function greenlight_api.greenlight_guest_create_project(p_doc jsonb, p_max_projects integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v greenlight.guest_projects;
begin
  perform pg_advisory_xact_lock(hashtext('greenlight_guest_project:' || (p_doc ->> 'guestId')));
  if not exists (select 1 from greenlight.guest_sessions where id = p_doc ->> 'guestId') then
    raise exception 'greenlight: no such guest' using errcode = 'GLNFD';
  end if;
  if (select count(*) from greenlight.guest_projects where guest_id = p_doc ->> 'guestId') >= p_max_projects then
    raise exception 'greenlight: project limit reached' using errcode = 'GLQTA';
  end if;
  insert into greenlight.guest_projects (id, guest_id, name, url, approved_test_hash, doc)
  values (p_doc ->> 'id', p_doc ->> 'guestId', p_doc ->> 'name', p_doc ->> 'url', p_doc ->> 'approvedTestHash',
          p_doc - 'id' - 'guestId' - 'name' - 'url' - 'approvedTestHash' - 'approvedAt' - 'createdAt')
  returning * into v;
  return greenlight.guest_project_json(v);
end $$;

create or replace function greenlight_api.greenlight_guest_list_projects(p_guest text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(greenlight.guest_project_json(p) order by p.created_at desc), '[]'::jsonb)
  from greenlight.guest_projects p where p.guest_id = p_guest;
$$;

-- p_guest null: the worker reading a project for a run it was given.
create or replace function greenlight_api.greenlight_guest_get_project(p_id text, p_guest text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v greenlight.guest_projects;
begin
  select * into v from greenlight.guest_projects where id = p_id and (p_guest is null or guest_id = p_guest);
  if v.id is null then raise exception 'greenlight: no such project' using errcode = 'GLNFD'; end if;
  return greenlight.guest_project_json(v);
end $$;

-- The guest's own approval: write-once, and only for the stored hash.
create or replace function greenlight_api.greenlight_guest_approve(p_id text, p_guest text, p_hash text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v greenlight.guest_projects;
begin
  select * into v from greenlight.guest_projects where id = p_id and guest_id = p_guest for update;
  if v.id is null then raise exception 'greenlight: no such project' using errcode = 'GLNFD'; end if;
  if v.approved_at is not null then raise exception 'greenlight: already approved' using errcode = 'GLCON'; end if;
  if v.approved_test_hash <> p_hash then raise exception 'greenlight: hash mismatch' using errcode = 'GLHSH'; end if;
  update greenlight.guest_projects set approved_at = now() where id = p_id returning * into v;
  return greenlight.guest_project_json(v);
end $$;

-- ---------------------------------------------------------------- runs

-- Start a real run if every limit allows it. Counted runs: not refunded.
create or replace function greenlight_api.greenlight_guest_start_run(p_doc jsonb, p_per_guest integer, p_per_day integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_project greenlight.guest_projects; v_guest greenlight.guest_sessions; v greenlight.guest_runs;
begin
  perform pg_advisory_xact_lock(hashtext('greenlight_guest_runs'));
  select * into v_project from greenlight.guest_projects where id = p_doc ->> 'projectId' and guest_id = p_doc ->> 'guestId';
  if v_project.id is null then raise exception 'greenlight: no such project' using errcode = 'GLNFD'; end if;
  if v_project.approved_at is null then raise exception 'greenlight: approve the tests first' using errcode = 'GLHSH'; end if;
  if exists (select 1 from greenlight.guest_runs where project_id = v_project.id and status in ('queued', 'running')) then
    raise exception 'greenlight: a run for this project is already in progress' using errcode = 'GLLIM';
  end if;
  select * into v_guest from greenlight.guest_sessions where id = v_project.guest_id for update;
  if v_guest.runs_used >= p_per_guest then raise exception 'greenlight: guest run limit reached' using errcode = 'GLQTA'; end if;
  if (select count(*) from greenlight.guest_runs where not refunded and created_at > now() - interval '24 hours') >= p_per_day then
    raise exception 'greenlight: daily demo run limit reached' using errcode = 'GLQTA';
  end if;
  update greenlight.guest_sessions set runs_used = runs_used + 1 where id = v_guest.id;
  insert into greenlight.guest_runs (id, project_id, guest_id, status, doc)
  values (p_doc ->> 'id', v_project.id, v_project.guest_id, 'queued', p_doc - 'id' - 'projectId' - 'guestId' - 'status')
  returning * into v;
  return greenlight.guest_run_json(v);
end $$;

-- Status moves forward only (queued -> running -> succeeded|failed, or queued -> failed). A run
-- that failed before Kane started can be refunded: it then counts against no limit.
create or replace function greenlight_api.greenlight_guest_update_run(p_id text, p_status text, p_doc jsonb, p_refund boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v greenlight.guest_runs;
begin
  select * into v from greenlight.guest_runs where id = p_id for update;
  if v.id is null then raise exception 'greenlight: no such run' using errcode = 'GLNFD'; end if;
  if not ((v.status = 'queued' and p_status in ('running', 'failed')) or (v.status = 'running' and p_status in ('succeeded', 'failed'))) then
    raise exception 'greenlight: run status % -> % is not allowed', v.status, p_status using errcode = 'GLCON';
  end if;
  if p_refund and p_status = 'failed' and not v.refunded then
    update greenlight.guest_sessions set runs_used = greatest(runs_used - 1, 0) where id = v.guest_id;
  end if;
  update greenlight.guest_runs set
    status = p_status,
    started_at = case when p_status = 'running' then now() else started_at end,
    finished_at = case when p_status in ('succeeded', 'failed') then now() else null end,
    refunded = refunded or (p_refund and p_status = 'failed'),
    doc = doc || coalesce(p_doc, '{}'::jsonb)
  where id = p_id returning * into v;
  return greenlight.guest_run_json(v);
end $$;

create or replace function greenlight_api.greenlight_guest_get_run(p_id text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v greenlight.guest_runs;
begin
  select * into v from greenlight.guest_runs where id = p_id;
  if v.id is null then raise exception 'greenlight: no such run' using errcode = 'GLNFD'; end if;
  return greenlight.guest_run_json(v);
end $$;

create or replace function greenlight_api.greenlight_guest_list_runs(p_project_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(greenlight.guest_run_json(r) order by r.created_at desc), '[]'::jsonb)
  from greenlight.guest_runs r where r.project_id = p_project_id;
$$;

create or replace function greenlight_api.greenlight_guest_runs_today() returns integer
language sql stable security definer set search_path = '' as $$
  select count(*)::integer from greenlight.guest_runs where not refunded and created_at > now() - interval '24 hours';
$$;

-- ---------------------------------------------------------------- privileges: service_role only

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, n.nspname as schema from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('greenlight_api', 'greenlight') and p.proname like '%guest%'
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;
    if f.schema = 'greenlight_api' and exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
end $$;
