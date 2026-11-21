-- Greenlight persistence (6/6): guest accounts with capped real runs, the Fix Centre, and requests
-- for the developer's own coding agent.
--
-- Additive only.
--   * A guest (no sign-up) gets an anonymous account (slug v-<hash>) with one owner user. Guest
--     accounts can never certify (enforced by the server); their real Kane runs are capped here,
--     atomically, under one lock: runs per guest, runs per rolling 24 hours, and a credit budget per
--     rolling 24 hours across all guests (each reservation holds its estimated credits until the
--     run's actual spend is recorded).
--   * agent_requests: work Greenlight asks the developer's coding agent (Claude Code, over MCP with
--     the account's agent token) to do: understand the app, draft or revise a test plan, explain a
--     failure, answer a question, propose a fix. The server never calls an AI provider for these.
--   * fix_items: one per failed test of a run: the plain-English explanation, the conversation
--     about it, the proposed fix, and what a coding agent reported back. Status only moves forward
--     through what actually happened; "fixed" is set only by a passing re-run.
-- SQLSTATEs reused: GLNFD, GLCON, GLINV, GLQTA.

create table greenlight.guest_run_reservations (
  id bigint generated always as identity primary key,
  account_id uuid not null references greenlight.accounts (id) on delete restrict,
  job_id text check (job_id is null or job_id ~ '^job_[0-9a-f]{32}$'),
  credits numeric not null check (credits > 0 and credits <= 1000),
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

create table greenlight.agent_requests (
  id text primary key check (id ~ '^ar_[0-9a-f]{32}$'),
  account_id uuid not null references greenlight.accounts (id) on delete restrict,
  project_id text not null references greenlight.projects (id) on delete restrict,
  fix_id text references greenlight.fix_items (id) on delete restrict,
  kind text not null check (kind in ('understand', 'draft_plan', 'revise_plan', 'explain_failure', 'answer_question', 'propose_fix')),
  status text not null check (status in ('queued', 'claimed', 'done', 'failed', 'cancelled')),
  input jsonb not null,
  result jsonb,
  error text check (error is null or char_length(error) <= 2000),
  created_at timestamptz not null default now(),
  claimed_at timestamptz,
  completed_at timestamptz,
  check ((status in ('done', 'failed', 'cancelled')) = (completed_at is not null))
);
create index agent_requests_account_idx on greenlight.agent_requests (account_id, status, created_at desc);

do $$
declare t text;
begin
  foreach t in array array['guest_run_reservations', 'fix_items', 'agent_requests'] loop
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

-- What counts: reservations from the last 5 minutes not yet attached to a job, and attached jobs,
-- except jobs that failed before Kane could start (no record and a pre-Kane error code). Credits
-- count the larger of the reserved estimate and the run's recorded actual spend, so a missing or
-- low balance reading can never free budget.
create or replace function greenlight.guest_run_counts(p_account_id uuid) returns table (mine integer, today integer, credits_today numeric)
language sql stable security definer set search_path = '' as $$
  with live as (
    select r.account_id, r.created_at,
      greatest(r.credits, coalesce((rec.doc -> 'credits' ->> 'actualSpend')::numeric, 0)) as credits
    from greenlight.guest_run_reservations r
    left join greenlight.jobs j on j.id = r.job_id
    left join greenlight.certification_records rec on rec.id = j.record_id
    where (r.job_id is null and r.created_at > now() - interval '5 minutes')
       or (r.job_id is not null and not (j.status = 'failed' and j.record_id is null and coalesce(j.doc -> 'error' ->> 'code', '') in
           ('deployment_not_ready', 'url_not_allowed', 'credit_check_refused', 'balance_unavailable', 'confirmation_required', 'approval_not_certifiable',
            'approval_hash_mismatch', 'spec_invalid', 'sandbox_dispatch_failed', 'sandbox_setup_failed', 'invalid_request')))
  )
  select (select count(*)::integer from live where account_id = p_account_id),
         (select count(*)::integer from live where created_at > now() - interval '24 hours'),
         (select coalesce(sum(credits), 0) from live where created_at > now() - interval '24 hours')
$$;

-- One lock for all guest runs: concurrent requests cannot both pass the checks.
create or replace function greenlight_api.greenlight_reserve_guest_run(p_account text, p_credits numeric, p_per_account integer, p_per_day integer, p_daily_credits numeric, p_max_per_run numeric) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_account uuid; c record; v_id bigint;
begin
  if p_account !~ '^v-[0-9a-f]{24}$' then raise exception 'greenlight: not a guest account' using errcode = 'GLINV'; end if;
  if p_credits is null or p_credits <= 0 then raise exception 'greenlight: bad credit estimate' using errcode = 'GLINV'; end if;
  if p_credits > p_max_per_run then raise exception 'greenlight: this run would cost more than the per-run limit for visitors' using errcode = 'GLQTA'; end if;
  perform pg_advisory_xact_lock(hashtext('greenlight_guest_real_runs'));
  select id into v_account from greenlight.accounts where slug = p_account;
  if v_account is null then raise exception 'greenlight: no such account' using errcode = 'GLNFD'; end if;
  select * into c from greenlight.guest_run_counts(v_account);
  if c.mine >= p_per_account then raise exception 'greenlight: guest run limit reached' using errcode = 'GLQTA'; end if;
  if c.today >= p_per_day then raise exception 'greenlight: daily guest run limit reached' using errcode = 'GLQTA'; end if;
  if c.credits_today + p_credits > p_daily_credits then raise exception 'greenlight: daily guest credit budget reached' using errcode = 'GLQTA'; end if;
  insert into greenlight.guest_run_reservations (account_id, credits) values (v_account, p_credits) returning id into v_id;
  return jsonb_build_object('reservation', v_id, 'usedByYou', c.mine + 1, 'usedToday', c.today + 1, 'creditsToday', c.credits_today + p_credits);
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
  return jsonb_build_object('usedByYou', coalesce(c.mine, 0), 'usedToday', coalesce(c.today, 0), 'creditsToday', coalesce(c.credits_today, 0));
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

-- ---------------------------------------------------------------- requests for the developer's coding agent

create or replace function greenlight.agent_request_json(r greenlight.agent_requests) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'projectId', r.project_id, 'fixId', r.fix_id, 'kind', r.kind, 'status', r.status, 'input', r.input, 'result', r.result,
    'error', r.error, 'createdAt', r.created_at, 'claimedAt', r.claimed_at, 'completedAt', r.completed_at)
$$;

-- Queue a request (at most p_max_open open per account).
create or replace function greenlight_api.greenlight_agent_request_create(p_id text, p_account text, p_project_id text, p_fix_id text, p_kind text, p_input jsonb, p_max_open integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_account uuid; v greenlight.agent_requests;
begin
  select a.id into v_account from greenlight.projects p join greenlight.accounts a on a.id = p.account_id where p.id = p_project_id and a.slug = p_account;
  if v_account is null then raise exception 'greenlight: no such project' using errcode = 'GLNFD'; end if;
  if p_fix_id is not null and not exists (select 1 from greenlight.fix_items f where f.id = p_fix_id and f.project_id = p_project_id) then
    raise exception 'greenlight: no such fix item' using errcode = 'GLNFD';
  end if;
  perform pg_advisory_xact_lock(hashtext('greenlight_agent_requests:' || v_account::text));
  if (select count(*) from greenlight.agent_requests where account_id = v_account and status in ('queued', 'claimed')) >= p_max_open then
    raise exception 'greenlight: too many requests are waiting for your agent' using errcode = 'GLQTA';
  end if;
  insert into greenlight.agent_requests (id, account_id, project_id, fix_id, kind, status, input) values (p_id, v_account, p_project_id, p_fix_id, p_kind, 'queued', p_input) returning * into v;
  return greenlight.agent_request_json(v);
end $$;

create or replace function greenlight_api.greenlight_agent_request_get(p_id text, p_account text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v greenlight.agent_requests;
begin
  select r.* into v from greenlight.agent_requests r join greenlight.accounts a on a.id = r.account_id where r.id = p_id and a.slug = p_account;
  if v.id is null then raise exception 'greenlight: no such request' using errcode = 'GLNFD'; end if;
  return greenlight.agent_request_json(v);
end $$;

-- Open requests of an account (oldest first), or every request of one project (newest first).
create or replace function greenlight_api.greenlight_agent_request_list(p_account text, p_project_id text, p_open_only boolean) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(greenlight.agent_request_json(r) - 'input' order by case when p_open_only then r.created_at end asc, r.created_at desc), '[]'::jsonb)
  from (select r.* from greenlight.agent_requests r join greenlight.accounts a on a.id = r.account_id
        where a.slug = p_account and (p_project_id is null or r.project_id = p_project_id) and (not p_open_only or r.status in ('queued', 'claimed'))
        order by r.created_at desc limit 50) r
$$;

-- The agent takes a request. A claim older than 15 minutes can be taken again.
create or replace function greenlight_api.greenlight_agent_request_claim(p_id text, p_account text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v greenlight.agent_requests;
begin
  select r.* into v from greenlight.agent_requests r join greenlight.accounts a on a.id = r.account_id where r.id = p_id and a.slug = p_account for update of r;
  if v.id is null then raise exception 'greenlight: no such request' using errcode = 'GLNFD'; end if;
  if not (v.status = 'queued' or (v.status = 'claimed' and v.claimed_at < now() - interval '15 minutes')) then
    raise exception 'greenlight: this request is %', v.status using errcode = 'GLCON';
  end if;
  update greenlight.agent_requests set status = 'claimed', claimed_at = now() where id = p_id returning * into v;
  return greenlight.agent_request_json(v);
end $$;

-- Finish a claimed request: done with a (server-validated) result, or failed with a reason.
create or replace function greenlight_api.greenlight_agent_request_complete(p_id text, p_account text, p_status text, p_result jsonb, p_error text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v greenlight.agent_requests;
begin
  if p_status not in ('done', 'failed') then raise exception 'greenlight: bad status' using errcode = 'GLINV'; end if;
  select r.* into v from greenlight.agent_requests r join greenlight.accounts a on a.id = r.account_id where r.id = p_id and a.slug = p_account for update of r;
  if v.id is null then raise exception 'greenlight: no such request' using errcode = 'GLNFD'; end if;
  if v.status <> 'claimed' then raise exception 'greenlight: claim the request first (it is %)', v.status using errcode = 'GLCON'; end if;
  update greenlight.agent_requests set status = p_status, result = case when p_status = 'done' then p_result else null end, error = case when p_status = 'failed' then left(p_error, 2000) else null end, completed_at = now()
  where id = p_id returning * into v;
  return greenlight.agent_request_json(v);
end $$;

create or replace function greenlight_api.greenlight_agent_request_cancel(p_id text, p_account text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v greenlight.agent_requests;
begin
  select r.* into v from greenlight.agent_requests r join greenlight.accounts a on a.id = r.account_id where r.id = p_id and a.slug = p_account for update of r;
  if v.id is null then raise exception 'greenlight: no such request' using errcode = 'GLNFD'; end if;
  if v.status not in ('queued', 'claimed') then return greenlight.agent_request_json(v); end if;
  update greenlight.agent_requests set status = 'cancelled', completed_at = now() where id = p_id returning * into v;
  return greenlight.agent_request_json(v);
end $$;

-- ---------------------------------------------------------------- privileges: service_role only

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, n.nspname as schema from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where (n.nspname = 'greenlight_api' and p.proname in ('greenlight_guest_account', 'greenlight_reserve_guest_run', 'greenlight_attach_guest_run', 'greenlight_release_guest_run',
      'greenlight_guest_run_usage', 'greenlight_fix_open', 'greenlight_fix_get', 'greenlight_fix_list', 'greenlight_fix_update', 'greenlight_fix_append',
      'greenlight_agent_request_create', 'greenlight_agent_request_get', 'greenlight_agent_request_list', 'greenlight_agent_request_claim',
      'greenlight_agent_request_complete', 'greenlight_agent_request_cancel'))
      or (n.nspname = 'greenlight' and p.proname in ('guest_run_counts', 'fix_json', 'agent_request_json'))
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;
    -- Internal helpers (schema greenlight) run only inside the RPCs, as their owner.
    if f.schema = 'greenlight_api' and exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
end $$;
