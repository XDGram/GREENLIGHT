-- Read-only checks for Greenlight's isolation inside the Ceaser project.
-- Every aggregate has an explicit, deterministic order. Run as the postgres role.
-- Nothing here writes; the role checks use SET LOCAL ROLE and fail with 42501 when access is denied.

-- 1. Ceaser fingerprint (must be identical before and after any Greenlight change).
select
  (select json_agg(json_build_object('t', relname, 'rls', relrowsecurity) order by relname)
     from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') as tables,
  (select json_agg(json_build_object('v', viewname, 'md5', md5(definition)) order by viewname)
     from pg_views where schemaname = 'public') as views,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) as public_functions,
  (select md5(string_agg(format('%s|%s|%s|%s|%s|%s|%s', tablename, policyname, permissive, roles::text, cmd, coalesce(qual, ''), coalesce(with_check, '')), E'\n' order by tablename, policyname))
     from pg_policies where schemaname = 'public') as policies_md5,
  (select md5(string_agg(format('%s|%s|%s', relname, relkind, coalesce(relacl::text, '')), E'\n' order by relname))
     from pg_class where relnamespace = 'public'::regnamespace) as relacl_md5,
  (select md5(string_agg(format('%s|%s|%s', conrelid::regclass::text, conname, pg_get_constraintdef(oid)), E'\n' order by conrelid::regclass::text, conname))
     from pg_constraint where connamespace = 'public'::regnamespace) as constraints_md5,
  (select md5(string_agg(indexdef, E'\n' order by indexdef)) from pg_indexes where schemaname = 'public') as indexes_md5,
  (select md5(string_agg(format('%s|%s|%s', pg_get_userbyid(defaclrole), n.nspname, defaclobjtype::text || defaclacl::text), E'\n'
                         order by pg_get_userbyid(defaclrole), n.nspname, defaclobjtype::text || defaclacl::text))
     from pg_default_acl d join pg_namespace n on n.oid = d.defaclnamespace where n.nspname not like 'greenlight%') as default_acl_md5,
  (select nspacl::text from pg_namespace where nspname = 'public') as public_acl,
  (select json_agg(extname || ' ' || extversion order by extname) from pg_extension) as extensions,
  (select json_agg(id order by id) from storage.buckets where id <> 'greenlight-evidence') as other_buckets,
  (select json_agg(version || ' ' || name order by version) from supabase_migrations.schema_migrations where name not like 'greenlight%') as ceaser_migrations;

-- 2. Greenlight objects and privileges.
select
  (select count(*) from pg_class where relnamespace = 'greenlight'::regnamespace and relkind = 'r' and relrowsecurity) as tables_with_rls,
  (select count(*) from pg_policies where schemaname in ('greenlight', 'greenlight_api')) as policies,
  (select count(*) from pg_proc where pronamespace = 'greenlight_api'::regnamespace and prosecdef and proconfig @> array['search_path=""']) as secdef_rpcs,
  (select json_agg(distinct proacl::text) from pg_proc where pronamespace = 'greenlight_api'::regnamespace) as rpc_acls,
  (select nspacl::text from pg_namespace where nspname = 'greenlight') as greenlight_acl,
  (select nspacl::text from pg_namespace where nspname = 'greenlight_api') as greenlight_api_acl,
  (select json_agg(json_build_object('id', id, 'public', public)) from storage.buckets where id = 'greenlight-evidence') as bucket;

-- 3. Effective privileges per role (expected: anon/authenticated all false/0; service_role usage_api + 20 RPCs).
select r,
  has_schema_privilege(r, 'greenlight', 'USAGE') as usage_greenlight,
  has_schema_privilege(r, 'greenlight_api', 'USAGE') as usage_api,
  (select count(*) from pg_class c where c.relnamespace = 'greenlight'::regnamespace and c.relkind = 'r'
     and (has_table_privilege(r, c.oid, 'SELECT') or has_table_privilege(r, c.oid, 'INSERT') or has_table_privilege(r, c.oid, 'UPDATE') or has_table_privilege(r, c.oid, 'DELETE'))) as tables_with_privileges,
  (select count(*) from pg_proc p where p.pronamespace = 'greenlight_api'::regnamespace and has_function_privilege(r, p.oid, 'EXECUTE')) as executable_rpcs
from (values ('anon'), ('authenticated'), ('service_role')) v(r)
order by r;

-- 4. Live denials (run each separately; each must fail with 42501):
--   set local role anon;          select count(*) from greenlight.accounts;
--   set local role anon;          select greenlight_api.greenlight_list_projects('x');
--   set local role authenticated; select count(*) from greenlight.certification_records;
--   set local role authenticated; select greenlight_api.greenlight_authenticate(repeat('a', 64));
