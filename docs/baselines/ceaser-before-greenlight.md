# Ceaser baseline before Greenlight migrations

Captured read-only on 2026-11-19 from project `ceaser` (`ncbrsrklofofdqdftwjw`), before any Greenlight migration was applied. After the migrations, the same query must return exactly these values; only `greenlight`, `greenlight_api` and the `greenlight-evidence` bucket may be new.

| Item | Value |
|---|---|
| Public tables (RLS) | `communities` (on), `posts` (on), `profiles` (on), `reactions` (on) |
| Public view | `post_stats` (definition md5 `6636f08353595ca11af8716a0a3015f0`) |
| Public functions / triggers | none |
| Policies | 11 on `public` (communities ×3, posts ×2, profiles ×3, reactions ×3), qual/check md5s recorded |
| Row counts | communities=3, posts=124, reactions=140, profiles=6 |
| Data md5 (all four tables) | `50da6dad050eb274001333a6aeb0e898` |
| Storage buckets | none |
| Migrations | `20261113202455_community_feed`, `20261114064347_communities`, `20261114085953_community_posts_and_demo_flag`, `20261114105047_near_post_fees` |
| Extensions | pg_stat_statements 1.11, pgcrypto 1.3, plpgsql 1.0, supabase_vault 0.3.2, uuid-ossp 1.1 |
| `public` schema ACL | `pg_database_owner=UC, PUBLIC=U, postgres=U, anon=U, authenticated=U, service_role=U` |
| Pre-existing advisor finding | ERROR `security_definer_view` on `public.post_stats` (Ceaser's, untouched) |
