-- Greenlight persistence (6/6): guest accounts with capped real runs, and the Fix Centre.
--
-- Additive only.
--   * A guest (no sign-up) gets an anonymous account (slug v-<hash>) with one owner user. Guest
--     accounts can never certify (enforced by the server); their real Kane runs are capped here,
--     atomically, per guest and per rolling 24 hours across all guests.
--   * fix_items: one per failed test of a run: the plain-English explanation, the conversation
--     about it, the proposed fix, and what a coding agent reported back. Status only moves forward
--     through what actually happened; "fixed" is set only by a passing re-run.
-- SQLSTATEs reused: GLNFD, GLCON, GLINV, GLQTA.

create table greenlight.guest_run_reservations (
  id bigint generated always as identity primary key,
  account_id uuid not null references greenlight.accounts (id) on delete restrict,
  job_id text check (job_id is null or job_id ~ '^job_[0-9a-f]{32}$'),
  created_at timestamptz not null default now()
);
create index guest_run_reservations_created_idx on greenlight.guest_run_reservations (created_at desc);

create table greenlight.fix_items (
  id text primary key check (id ~ '^fx_[0-9a-f]{32}$'),
  project_id text not null references greenlight.projects (id) on delete restrict,
  record_id text not null references greenlight.certification_records (id) on delete restrict,
  test_file text not null check (char_length(test_file) between 1 and 200),
  status text not null check (status in ('open', 'task_ready', 'sent_to_agent', 'agent_working', 'agent_reported', 'fixed', 'still_failing', 'dismissed')),
  doc jsonb not null default '{}'::jsonb,
  messages jsonb not null default '[]'::jsonb check (jsonb_typeof(messages) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (record_id, test_file)
);
create index fix_items_project_idx on greenlight.fix_items (project_id, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['guest_run_reservations', 'fix_items'] loop
    execute format('alter table greenlight.%I enable row level security', t);
    execute format('revoke all on greenlight.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on greenlight.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on greenlight.%I from authenticated', t); end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- guest accounts

create or replace function greenlight_api.greenlight_guest_account(p_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_account uuid;
begin
  if p_slug !~ '^v-[0-9a-f]{24}$' then raise exception 'greenlight: bad guest account' using errcode = 'GLINV'; end if;
  insert into greenlight.accounts (slug) values (p_slug) on conflict (slug) do nothing;
  select id into v_account from greenlight.accounts where slug = p_slug;
  insert into greenlight.users (account_id, name, role) values (v_account, 'owner', 'owner') on conflict (account_id, name) do nothing;
  return jsonb_build_object('account', p_slug, 'user', 'owner');
end $$;

-- Runs that count: reserved in the last 5 minutes and not yet attached to a job, and attached
-- jobs, except jobs that failed before Kane could start (no record and a pre-Kane error code).
create or replace function greenlight.guest_run_counts(p_account_id uuid) returns table (mine integer, today integer)
language sql stable security definer set search_path = '' as $$
  with live as (
    select r.account_id, r.created_at from greenlight.guest_run_reservations r
    left join greenlight.jobs j on j.id = r.job_id
    where (r.job_id is null and r.created_at > now() - interval '5 minutes')
       or (r.job_id is not null and not (j.status = 'failed' and j.record_id is null and coalesce(j.doc -> 'error' ->> 'code', '') in
           ('deployment_not_ready', 'url_not_allowed', 'credit_check_refused', 'balance_unavailable', 'confirmation_required', 'approval_not_certifiable',
            'approval_hash_mismatch', 'spec_invalid', 'sandbox_dispatch_failed', 'sandbox_setup_failed', 'invalid_request')))
  )
  select (select count(*)::integer from live where account_id = p_account_id),
         (select count(*)::integer from live where created_at > now() - interval '24 hours')
$$;

create or replace function greenlight_api.greenlight_reserve_guest_run(p_account text, p_per_account integer, p_per_day integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_account uuid; c record; v_id bigint;
begin
  if p_account !~ '^v-[0-9a-f]{24}$' then raise exception 'greenlight: not a guest account' using errcode = 'GLINV'; end if;
  perform pg_advisory_xact_lock(hashtext('greenlight_guest_real_runs'));
  select id into v_account from greenlight.accounts where slug = p_account;
  if v_account is null then raise exception 'greenlight: no such account' using errcode = 'GLNFD'; end if;
  select * into c from greenlight.guest_run_counts(v_account);
  if c.mine >= p_per_account then raise exception 'greenlight: guest run limit reached' using errcode = 'GLQTA'; end if;
  if c.today >= p_per_day then raise exception 'greenlight: daily guest run limit reached' using errcode = 'GLQTA'; end if;
  insert into greenlight.guest_run_reservations (account_id) values (v_account) returning id into v_id;
  return jsonb_build_object('reservation', v_id, 'usedByYou', c.mine + 1, 'usedToday', c.today + 1);
end $$;

create or replace function greenlight_api.greenlight_attach_guest_run(p_reservation bigint, p_job_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  update greenlight.guest_run_reservations set job_id = p_job_id where id = p_reservation and job_id is null;
  return found;
end $$;

-- A reservation whose job was never created (refused before submission) is released.
create or replace function greenlight_api.greenlight_release_guest_run(p_reservation bigint) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  delete from greenlight.guest_run_reservations where id = p_reservation and job_id is null;
  return found;
end $$;

create or replace function greenlight_api.greenlight_guest_run_usage(p_account text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_account uuid; c record;
begin
  select id into v_account from greenlight.accounts where slug = p_account;
  select * into c from greenlight.guest_run_counts(v_account);
  return jsonb_build_object('usedByYou', coalesce(c.mine, 0), 'usedToday', coalesce(c.today, 0));
end $$;

-- ---------------------------------------------------------------- fix centre

create or replace function greenlight.fix_json(f greenlight.fix_items) returns jsonb
language sql stable security definer set search_path = '' as $$
  select f.doc || jsonb_build_object('id', f.id, 'projectId', f.project_id, 'recordId', f.record_id, 'testFile', f.test_file, 'status', f.status,
    'messages', f.messages, 'createdAt', f.created_at, 'updatedAt', f.updated_at)
$$;

-- Create the fix item for a failed test of a record (idempotent: returns the existing one).
create or replace function greenlight_api.greenlight_fix_open(p_id text, p_project_id text, p_account text, p_record_id text, p_test_file text, p_doc jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v greenlight.fix_items;
begin
  if not exists (select 1 from greenlight.projects p join greenlight.accounts a on a.id = p.account_id where p.id = p_project_id and a.slug = p_account) then
    raise exception 'greenlight: no such project' using errcode = 'GLNFD';
  end if;
  if not exists (select 1 from greenlight.certification_records r where r.id = p_record_id and r.project_id = p_project_id) then
    raise exception 'greenlight: no such record' using errcode = 'GLNFD';
  end if;
  insert into greenlight.fix_items (id, project_id, record_id, test_file, status, doc) values (p_id, p_project_id, p_record_id, p_test_file, 'open', coalesce(p_doc, '{}'::jsonb))
  on conflict (record_id, test_file) do nothing;
  select * into v from greenlight.fix_items where record_id = p_record_id and test_file = p_test_file;
  return greenlight.fix_json(v);
end $$;

create or replace function greenlight_api.greenlight_fix_get(p_id text, p_account text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v greenlight.fix_items;
begin
  select f.* into v from greenlight.fix_items f join greenlight.projects p on p.id = f.project_id join greenlight.accounts a on a.id = p.account_id
  where f.id = p_id and a.slug = p_account;
  if v.id is null then raise exception 'greenlight: no such fix item' using errcode = 'GLNFD'; end if;
  return greenlight.fix_json(v);
end $$;

create or replace function greenlight_api.greenlight_fix_list(p_account text, p_project_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(greenlight.fix_json(f) - 'messages' || jsonb_build_object('messageCount', jsonb_array_length(f.messages)) order by f.created_at desc), '[]'::jsonb)
  from greenlight.fix_items f join greenlight.projects p on p.id = f.project_id join greenlight.accounts a on a.id = p.account_id
  where a.slug = p_account and (p_project_id is null or f.project_id = p_project_id)
$$;

-- Merge p_patch into doc and optionally move the status. Allowed moves only.
create or replace function greenlight_api.greenlight_fix_update(p_id text, p_account text, p_status text, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v greenlight.fix_items; ok boolean;
begin
  select f.* into v from greenlight.fix_items f join greenlight.projects p on p.id = f.project_id join greenlight.accounts a on a.id = p.account_id
  where f.id = p_id and a.slug = p_account for update of f;
  if v.id is null then raise exception 'greenlight: no such fix item' using errcode = 'GLNFD'; end if;
  if p_status is not null and p_status <> v.status then
    ok := case v.status
      when 'open' then p_status in ('task_ready', 'dismissed', 'fixed', 'still_failing')
      when 'task_ready' then p_status in ('sent_to_agent', 'open', 'dismissed', 'fixed', 'still_failing')
      when 'sent_to_agent' then p_status in ('agent_working', 'agent_reported', 'task_ready', 'fixed', 'still_failing')
      when 'agent_working' then p_status in ('agent_reported', 'fixed', 'still_failing')
      when 'agent_reported' then p_status in ('fixed', 'still_failing')
      when 'still_failing' then p_status in ('task_ready', 'sent_to_agent', 'fixed', 'dismissed')
      when 'dismissed' then p_status in ('open')
      else false end;
    if not ok then raise exception 'greenlight: fix status % -> % is not allowed', v.status, p_status using errcode = 'GLCON'; end if;
  end if;
  update greenlight.fix_items set status = coalesce(p_status, status), doc = doc || coalesce(p_patch, '{}'::jsonb), updated_at = now()
  where id = p_id returning * into v;
  return greenlight.fix_json(v);
end $$;

-- Append conversation messages (at most 80 kept per item).
create or replace function greenlight_api.greenlight_fix_append(p_id text, p_account text, p_messages jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v greenlight.fix_items;
begin
  if jsonb_typeof(p_messages) <> 'array' then raise exception 'greenlight: messages must be an array' using errcode = 'GLINV'; end if;
  select f.* into v from greenlight.fix_items f join greenlight.projects p on p.id = f.project_id join greenlight.accounts a on a.id = p.account_id
  where f.id = p_id and a.slug = p_account for update of f;
  if v.id is null then raise exception 'greenlight: no such fix item' using errcode = 'GLNFD'; end if;
  if jsonb_array_length(v.messages) + jsonb_array_length(p_messages) > 80 then raise exception 'greenlight: conversation is full' using errcode = 'GLQTA'; end if;
  update greenlight.fix_items set messages = messages || p_messages, updated_at = now() where id = p_id returning * into v;
  return greenlight.fix_json(v);
end $$;

-- ---------------------------------------------------------------- privileges: service_role only

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, n.nspname as schema from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'greenlight_api' and p.proname in ('greenlight_guest_account', 'greenlight_reserve_guest_run', 'greenlight_attach_guest_run', 'greenlight_release_guest_run',
      'greenlight_guest_run_usage', 'greenlight_fix_open', 'greenlight_fix_get', 'greenlight_fix_list', 'greenlight_fix_update', 'greenlight_fix_append'))
      or (n.nspname = 'greenlight' and p.proname in ('guest_run_counts', 'fix_json'))
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;
    -- Internal helpers (schema greenlight) run only inside the RPCs, as their owner.
    if f.schema = 'greenlight_api' and exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
end $$;
