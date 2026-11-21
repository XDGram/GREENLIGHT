-- Greenlight persistence (5/5): users, project details, tokens from the web app, admin.
--
-- Additive only. Normal users sign in with Google; each Google identity gets its own account
-- (slug g-<hash>) with one owner user. Admins are the Vercel approvers configured on the server
-- (GREENLIGHT_APPROVERS): nothing here can make a user an admin.
-- New SQLSTATE: none (reuses GLNFD, GLCON, GLINV).

create table greenlight.web_identities (
  provider text not null check (provider in ('google')),
  subject text not null check (char_length(subject) between 1 and 255),
  account_id uuid not null references greenlight.accounts (id) on delete restrict,
  user_id uuid not null references greenlight.users (id) on delete restrict,
  email text,
  name text,
  created_at timestamptz not null default now(),
  last_sign_in_at timestamptz not null default now(),
  primary key (provider, subject)
);

-- Editable project details (repository, branch, requirements, encrypted test credentials).
-- Kept apart from projects.doc so the original project document never changes.
create table greenlight.project_details (
  project_id text primary key references greenlight.projects (id) on delete restrict,
  doc jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null
);

create table greenlight.settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_.]{0,63}$'),
  value jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by text not null
);

create table greenlight.admin_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null check (action ~ '^[a-z][a-z0-9_.]{0,63}$'),
  target text,
  detail jsonb not null default '{}'::jsonb
);
create index admin_events_at_idx on greenlight.admin_events (at desc);
create trigger admin_events_append_only before update or delete on greenlight.admin_events for each row execute function greenlight.forbid_change();

do $$
declare t text;
begin
  foreach t in array array['web_identities', 'project_details', 'settings', 'admin_events'] loop
    execute format('alter table greenlight.%I enable row level security', t);
    execute format('revoke all on greenlight.%I from public', t);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on greenlight.%I from anon', t); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on greenlight.%I from authenticated', t); end if;
  end loop;
end $$;

-- ---------------------------------------------------------------- sign-in

-- Find or create the account, owner user and identity for a signed-in Google user.
create or replace function greenlight_api.greenlight_web_sign_in(p_provider text, p_subject text, p_account text, p_email text, p_name text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_account uuid; v_user uuid; v_created boolean := false; v greenlight.web_identities;
begin
  perform pg_advisory_xact_lock(hashtext('greenlight_web_sign_in:' || p_provider || ':' || p_subject));
  select * into v from greenlight.web_identities where provider = p_provider and subject = p_subject;
  if v.subject is null then
    insert into greenlight.accounts (slug) values (p_account) on conflict (slug) do nothing;
    select id into v_account from greenlight.accounts where slug = p_account;
    insert into greenlight.users (account_id, name, role) values (v_account, 'owner', 'owner') on conflict (account_id, name) do nothing;
    select id into v_user from greenlight.users where account_id = v_account and name = 'owner';
    insert into greenlight.web_identities (provider, subject, account_id, user_id, email, name) values (p_provider, p_subject, v_account, v_user, p_email, p_name) returning * into v;
    v_created := true;
  else
    update greenlight.web_identities set last_sign_in_at = now(), email = coalesce(p_email, email), name = coalesce(p_name, name)
    where provider = p_provider and subject = p_subject returning * into v;
  end if;
  return jsonb_build_object('account', (select slug from greenlight.accounts where id = v.account_id), 'user', (select name from greenlight.users where id = v.user_id),
    'email', v.email, 'name', v.name, 'createdAt', v.created_at, 'created', v_created);
end $$;

-- ---------------------------------------------------------------- project details

create or replace function greenlight_api.greenlight_put_project_details(p_project_id text, p_account text, p_doc jsonb, p_by text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v greenlight.project_details;
begin
  if not exists (select 1 from greenlight.projects p join greenlight.accounts a on a.id = p.account_id where p.id = p_project_id and a.slug = p_account) then
    raise exception 'greenlight: no such project' using errcode = 'GLNFD';
  end if;
  insert into greenlight.project_details (project_id, doc, updated_by) values (p_project_id, p_doc, p_by)
  on conflict (project_id) do update set doc = excluded.doc, updated_at = now(), updated_by = excluded.updated_by
  returning * into v;
  return v.doc || jsonb_build_object('updatedAt', v.updated_at, 'updatedBy', v.updated_by);
end $$;

create or replace function greenlight_api.greenlight_get_project_details(p_project_id text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select d.doc || jsonb_build_object('updatedAt', d.updated_at, 'updatedBy', d.updated_by) from greenlight.project_details d where d.project_id = p_project_id
$$;

-- ---------------------------------------------------------------- API tokens from the web app

-- A token for an account's owner or agent user (the agent user is created on first use).
create or replace function greenlight_api.greenlight_issue_token(p_account text, p_role text, p_token_sha256 text, p_label text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_account uuid; v_user uuid; v_name text := case when p_role = 'owner' then 'owner' else 'agent' end;
begin
  if p_role not in ('owner', 'agent') then raise exception 'greenlight: bad role' using errcode = 'GLINV'; end if;
  select id into v_account from greenlight.accounts where slug = p_account;
  if v_account is null then raise exception 'greenlight: no such account' using errcode = 'GLNFD'; end if;
  insert into greenlight.users (account_id, name, role) values (v_account, v_name, p_role) on conflict (account_id, name) do nothing;
  select id into v_user from greenlight.users where account_id = v_account and name = v_name and role = p_role;
  if v_user is null then raise exception 'greenlight: user role mismatch' using errcode = 'GLCON'; end if;
  insert into greenlight.api_tokens (token_sha256, user_id, label) values (p_token_sha256, v_user, p_label);
  return jsonb_build_object('id', left(p_token_sha256, 16), 'role', p_role, 'user', v_name, 'label', p_label, 'createdAt', now());
end $$;

create or replace function greenlight_api.greenlight_list_account_tokens(p_account text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', left(t.token_sha256, 16), 'role', u.role, 'user', u.name, 'label', t.label, 'createdAt', t.created_at, 'revokedAt', t.revoked_at) order by t.created_at desc), '[]'::jsonb)
  from greenlight.api_tokens t join greenlight.users u on u.id = t.user_id join greenlight.accounts a on a.id = u.account_id where a.slug = p_account
$$;

-- Revoke by the public id (first 16 hex of the hash), only within the caller's account.
create or replace function greenlight_api.greenlight_revoke_account_token(p_account text, p_id text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_id !~ '^[0-9a-f]{16}$' then raise exception 'greenlight: bad token id' using errcode = 'GLNFD'; end if;
  update greenlight.api_tokens t set revoked_at = now()
  from greenlight.users u join greenlight.accounts a on a.id = u.account_id
  where u.id = t.user_id and a.slug = p_account and left(t.token_sha256, 16) = p_id and t.revoked_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'greenlight: no such token' using errcode = 'GLNFD'; end if;
  return true;
end $$;

-- ---------------------------------------------------------------- settings and admin

create or replace function greenlight_api.greenlight_get_settings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from greenlight.settings
$$;

create or replace function greenlight_api.greenlight_set_setting(p_key text, p_value jsonb, p_by text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  insert into greenlight.settings (key, value, updated_by) values (p_key, p_value, p_by)
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  insert into greenlight.admin_events (actor, action, target, detail) values (p_by, 'setting.changed', p_key, jsonb_build_object('value', p_value));
  return jsonb_build_object('key', p_key, 'value', p_value);
end $$;

create or replace function greenlight_api.greenlight_admin_event(p_actor text, p_action text, p_target text, p_detail jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  insert into greenlight.admin_events (actor, action, target, detail) values (p_actor, p_action, p_target, coalesce(p_detail, '{}'::jsonb))
  returning jsonb_build_object('id', id, 'at', at, 'actor', actor, 'action', action, 'target', target, 'detail', detail)
$$;

create or replace function greenlight_api.greenlight_admin_overview() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'accounts', (select count(*) from greenlight.accounts),
    'users', (select count(*) from greenlight.web_identities),
    'projects', (select count(*) from greenlight.projects),
    'versions', (select count(*) from greenlight.test_versions),
    'approvals', (select count(*) from greenlight.approvals),
    'jobs', (select jsonb_object_agg(status, n) from (select status, count(*) n from greenlight.jobs group by status) s),
    'records', (select count(*) from greenlight.certification_records),
    'certified', (select count(*) from greenlight.certification_records where certified),
    'creditsSpent', (select coalesce(sum((doc -> 'credits' ->> 'actualSpend')::numeric), 0) from greenlight.certification_records where doc -> 'credits' ->> 'actualSpend' is not null),
    'creditsEstimated', (select coalesce(sum((doc -> 'credits' ->> 'estimate')::numeric), 0) from greenlight.certification_records where doc -> 'credits' ->> 'estimate' is not null),
    'activeTokens', (select count(*) from greenlight.api_tokens where revoked_at is null),
    'guestSessions', (select count(*) from greenlight.guest_sessions),
    'guestProjects', (select count(*) from greenlight.guest_projects),
    'guestRuns24h', (select count(*) from greenlight.guest_runs where created_at > now() - interval '24 hours'),
    'evidenceBytes', (select coalesce(sum(evidence_bytes), 0) from greenlight.runs)
  )
$$;

-- Cross-account lists for the admin console. p_kind: users | projects | jobs | records | tokens | events | guests
create or replace function greenlight_api.greenlight_admin_list(p_kind text, p_limit integer) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare lim integer := least(greatest(coalesce(p_limit, 100), 1), 500);
begin
  if p_kind = 'users' then
    return (select coalesce(jsonb_agg(x order by x ->> 'lastSignInAt' desc), '[]'::jsonb) from (
      select jsonb_build_object('provider', i.provider, 'account', a.slug, 'email', i.email, 'name', i.name, 'createdAt', i.created_at, 'lastSignInAt', i.last_sign_in_at,
        'projects', (select count(*) from greenlight.projects p where p.account_id = a.id)) x
      from greenlight.web_identities i join greenlight.accounts a on a.id = i.account_id order by i.last_sign_in_at desc limit lim) s);
  elsif p_kind = 'projects' then
    return (select coalesce(jsonb_agg(x order by x ->> 'createdAt' desc), '[]'::jsonb) from (
      select jsonb_build_object('id', p.id, 'name', p.name, 'url', p.url, 'account', a.slug, 'createdBy', p.created_by, 'createdAt', p.created_at,
        'versions', (select count(*) from greenlight.test_versions v where v.project_id = p.id),
        'approved', (select count(*) from greenlight.approvals ap where ap.project_id = p.id),
        'records', (select count(*) from greenlight.certification_records r where r.project_id = p.id),
        'certified', (select count(*) from greenlight.certification_records r where r.project_id = p.id and r.certified)) x
      from greenlight.projects p join greenlight.accounts a on a.id = p.account_id order by p.created_at desc limit lim) s);
  elsif p_kind = 'jobs' then
    return (select coalesce(jsonb_agg(x order by x ->> 'createdAt' desc), '[]'::jsonb) from (
      select j.doc || jsonb_build_object('account', a.slug, 'projectName', p.name) x
      from greenlight.jobs j join greenlight.projects p on p.id = j.project_id join greenlight.accounts a on a.id = p.account_id order by j.created_at desc limit lim) s);
  elsif p_kind = 'records' then
    return (select coalesce(jsonb_agg(x order by x ->> 'startedAt' desc), '[]'::jsonb) from (
      select jsonb_build_object('id', r.id, 'projectId', r.project_id, 'projectName', p.name, 'account', a.slug, 'status', r.status, 'certified', r.certified,
        'commit', r.deployed_commit, 'testVersion', r.doc ->> 'testVersion', 'startedAt', r.doc -> 'execution' ->> 'startedAt',
        'credits', r.doc -> 'credits', 'evidenceStatus', r.doc -> 'evidence' ->> 'status') x
      from greenlight.certification_records r join greenlight.projects p on p.id = r.project_id join greenlight.accounts a on a.id = p.account_id order by r.created_at desc limit lim) s);
  elsif p_kind = 'tokens' then
    return (select coalesce(jsonb_agg(x order by x ->> 'createdAt' desc), '[]'::jsonb) from (
      select jsonb_build_object('id', left(t.token_sha256, 16), 'account', a.slug, 'user', u.name, 'role', u.role, 'label', t.label, 'createdAt', t.created_at, 'revokedAt', t.revoked_at) x
      from greenlight.api_tokens t join greenlight.users u on u.id = t.user_id join greenlight.accounts a on a.id = u.account_id order by t.created_at desc limit lim) s);
  elsif p_kind = 'events' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'at', e.at, 'actor', e.actor, 'action', e.action, 'target', e.target, 'detail', e.detail) order by e.at desc), '[]'::jsonb)
      from (select * from greenlight.admin_events order by at desc limit lim) e);
  elsif p_kind = 'guests' then
    return (select coalesce(jsonb_agg(x order by x ->> 'createdAt' desc), '[]'::jsonb) from (
      select jsonb_build_object('id', r.id, 'projectName', gp.name, 'url', gp.url, 'status', r.status, 'createdAt', r.created_at, 'finishedAt', r.finished_at, 'kind', coalesce(r.doc ->> 'kind', 'kane')) x
      from greenlight.guest_runs r join greenlight.guest_projects gp on gp.id = r.project_id order by r.created_at desc limit lim) s);
  end if;
  raise exception 'greenlight: unknown list' using errcode = 'GLINV';
end $$;

-- Admin: revoke any token by its public id (the console records the action).
create or replace function greenlight_api.greenlight_admin_revoke_token(p_id text, p_actor text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if p_id !~ '^[0-9a-f]{16}$' then raise exception 'greenlight: bad token id' using errcode = 'GLNFD'; end if;
  update greenlight.api_tokens set revoked_at = now() where left(token_sha256, 16) = p_id and revoked_at is null;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'greenlight: no such token' using errcode = 'GLNFD'; end if;
  insert into greenlight.admin_events (actor, action, target) values (p_actor, 'token.revoked', p_id);
  return true;
end $$;

-- ---------------------------------------------------------------- privileges: service_role only

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig, n.nspname as schema from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'greenlight_api' and p.proname in ('greenlight_web_sign_in', 'greenlight_put_project_details', 'greenlight_get_project_details', 'greenlight_issue_token',
      'greenlight_list_account_tokens', 'greenlight_revoke_account_token', 'greenlight_get_settings', 'greenlight_set_setting', 'greenlight_admin_event',
      'greenlight_admin_overview', 'greenlight_admin_list', 'greenlight_admin_revoke_token')
  loop
    execute format('revoke all on function %s from public', f.sig);
    if exists (select 1 from pg_roles where rolname = 'anon') then execute format('revoke all on function %s from anon', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then execute format('revoke all on function %s from authenticated', f.sig); end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then execute format('grant execute on function %s to service_role', f.sig); end if;
  end loop;
end $$;
