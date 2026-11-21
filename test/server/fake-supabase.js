// A mocked Supabase for tests: the REAL migrations in supabase/migrations/ run
// in PGlite (PostgreSQL compiled to WASM, in-process), behind a small fake of
// PostgREST's RPC endpoint and of Supabase Storage. Nothing leaves this process.
//
// Like Supabase:
//   - the service-role key runs as service_role, the anon key as anon: access is
//     decided by real database grants, not by this fake;
//   - only "exposed schemas" are reachable (PGRST106 otherwise);
//   - public has Supabase's default privileges (new tables/functions are granted
//     to anon and authenticated), and an optional Ceaser-like application lives
//     there, so tests can prove Greenlight neither touches it nor is reachable by it.

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

// What Supabase provides before our migrations run.
const SUPABASE_BASELINE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint);
`;

// A stand-in for an existing application (Ceaser) sharing the project.
export const CEASER_APP = `
  create table public.communities (id bigint generated always as identity primary key, name text not null);
  create table public.posts (id bigint generated always as identity primary key, community_id bigint references public.communities (id), body text not null);
  alter table public.communities enable row level security;
  alter table public.posts enable row level security;
  create policy communities_read on public.communities for select using (true);
  create policy posts_read on public.posts for select using (true);
  create policy posts_insert on public.posts for insert with check (char_length(body) > 0);
  create view public.post_stats as select community_id, count(*) as n from public.posts group by 1;
  create function public.post_count() returns bigint language sql stable as 'select count(*) from public.posts';
  insert into public.communities (name) values ('near'), ('zk');
  insert into public.posts (community_id, body) values (1, 'gm'), (1, 'hello'), (2, 'proof');
  insert into storage.buckets (id, name, public) values ('avatars', 'avatars', true);
`;

export async function createFakeSupabase({
  serviceRoleKey = `service-role-${"s".repeat(40)}`,
  anonKey = `anon-key-${"a".repeat(40)}`,
  url = "https://fake-project.supabase.co",
  exposedSchemas = ["public", "graphql_public", "greenlight_api"],
  withCeaser = false,
  migrate = true,
} = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_BASELINE);
  if (withCeaser) await db.exec(CEASER_APP);
  const migrationFiles = readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort();
  const applied = [];
  async function applyMigrations() {
    for (const f of migrationFiles) {
      await db.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
      applied.push(f);
    }
  }
  if (migrate) await applyMigrations();

  const objects = new Map(); // "<bucket>/<path>" -> Buffer
  const calls = [];
  const hooks = { onUpload: null }; // tests may corrupt uploads
  const argCache = new Map();
  let queue = Promise.resolve(); // one statement at a time, like a single connection

  async function argsOf(schema, fn) {
    const key = `${schema}.${fn}`;
    if (!argCache.has(key)) {
      const exists = await db.query("select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = $1 and p.proname = $2", [schema, fn]);
      if (!exists.rows.length) return null;
      const r = await db.query(
        `select p.parameter_name as name, p.udt_name as udt from information_schema.parameters p
         join information_schema.routines r on r.specific_name = p.specific_name
         where r.routine_schema = $1 and r.routine_name = $2 and p.parameter_mode = 'IN' order by p.ordinal_position`,
        [schema, fn],
      );
      argCache.set(key, r.rows);
    }
    return argCache.get(key);
  }

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  async function rpc(role, schema, fn, body) {
    if (!exposedSchemas.includes(schema)) {
      return json(406, { code: "PGRST106", message: `The schema must be one of the following: ${exposedSchemas.join(", ")}` });
    }
    const params = await argsOf(schema, fn);
    if (!params) return json(404, { code: "PGRST202", message: `Could not find the function ${schema}.${fn}` });
    const args = JSON.parse(body || "{}");
    const used = params.filter((p) => p.name in args);
    const call = `"${schema}"."${fn}"(${used.map((p, i) => `${p.name} => $${i + 1}::${p.udt === "_text" ? "text[]" : p.udt}`).join(", ")})`;
    const values = used.map((p) => (p.udt === "jsonb" && args[p.name] !== null ? JSON.stringify(args[p.name]) : args[p.name]));
    const run = async () => {
      await db.exec(`set role ${role}`);
      try {
        return (await db.query(`select ${call} as r`, values)).rows[0].r;
      } finally {
        await db.exec("reset role");
      }
    };
    const p = queue.then(run, run);
    queue = p.catch(() => {});
    try {
      const r = await p;
      return json(200, r === undefined ? null : r);
    } catch (e) {
      // PostgREST answers 401/403 for privilege errors, 400 for raised exceptions.
      return json(e.code === "42501" ? 401 : 400, { code: e.code ?? "XX000", message: e.message, details: null, hint: null });
    }
  }

  async function fetchImpl(input, init = {}) {
    const u = new URL(String(input));
    const h = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    if (`${u.protocol}//${u.host}` !== url) throw new Error(`fake supabase: unexpected host ${u.host}`);
    // Which database role the request runs as, exactly as Supabase decides it from the key.
    // A legacy JWT key is sent in apikey and Authorization; an sb_ secret key only in apikey
    // (Supabase refuses an sb_ key that is not identical in both headers).
    const keyOk = serviceRoleKey.startsWith("sb_") ? h.apikey === serviceRoleKey && (h.authorization === undefined || h.authorization === `Bearer ${serviceRoleKey}`) : h.apikey === serviceRoleKey && h.authorization === `Bearer ${serviceRoleKey}`;
    const role = keyOk ? "service_role" : h.apikey === anonKey ? "anon" : null;
    calls.push({ method: init.method ?? "GET", path: u.pathname, role, profile: h["content-profile"] ?? null });
    if (!role) return json(401, { code: "PGRST301", message: "invalid api key" });
    if (u.pathname.startsWith("/rest/v1/rpc/")) {
      const schema = h["content-profile"] ?? h["accept-profile"] ?? "public";
      return rpc(role, schema, decodeURIComponent(u.pathname.slice("/rest/v1/rpc/".length)), init.body);
    }
    if (role !== "service_role") return json(403, { statusCode: "403", error: "Unauthorized", message: "no storage policy allows this" });

    const bk = /^\/storage\/v1\/bucket\/([^/]+)$/.exec(u.pathname);
    if (bk && (init.method ?? "GET") === "GET") {
      const b = await db.query("select id, name, public from storage.buckets where id = $1", [decodeURIComponent(bk[1])]);
      return b.rows.length ? json(200, b.rows[0]) : json(400, { statusCode: "404", error: "Bucket not found", message: "Bucket not found" });
    }
    const up = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(u.pathname);
    const down = /^\/storage\/v1\/object\/authenticated\/([^/]+)\/(.+)$/.exec(u.pathname);
    if (down && (init.method ?? "GET") === "GET") {
      const k = `${decodeURIComponent(down[1])}/${down[2].split("/").map(decodeURIComponent).join("/")}`;
      return objects.has(k) ? new Response(objects.get(k), { status: 200 }) : json(400, { statusCode: "404", error: "not_found", message: "Object not found" });
    }
    if (up && init.method === "POST") {
      const bucket = decodeURIComponent(up[1]);
      const b = await db.query("select public from storage.buckets where id = $1", [bucket]);
      if (!b.rows.length) return json(400, { statusCode: "404", error: "Bucket not found" });
      const k = `${bucket}/${up[2].split("/").map(decodeURIComponent).join("/")}`;
      if (objects.has(k) && h["x-upsert"] !== "true") return json(400, { statusCode: "409", error: "Duplicate", message: "The resource already exists" });
      let bytes = Buffer.from(init.body instanceof Uint8Array ? init.body : String(init.body ?? ""));
      if (hooks.onUpload) bytes = hooks.onUpload(k, bytes) ?? bytes;
      objects.set(k, bytes);
      return json(200, { Key: k });
    }
    return json(404, { message: "fake supabase: no such endpoint" });
  }

  return {
    url,
    serviceRoleKey,
    anonKey,
    db,
    objects,
    calls,
    hooks,
    applied,
    applyMigrations,
    fetch: fetchImpl,
    /** Run SQL as a given role (default: the owner), for direct assertions. */
    async sql(text, params = [], { role } = {}) {
      if (role) await db.exec(`set role ${role}`);
      try {
        return (await db.query(text, params)).rows;
      } finally {
        if (role) await db.exec("reset role");
      }
    },
    close: () => db.close(),
  };
}
