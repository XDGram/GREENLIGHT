// A mocked Supabase for tests: the REAL migrations in supabase/migrations/ run
// in PGlite (PostgreSQL compiled to WASM, in-process), behind a small fake of
// PostgREST's RPC endpoint and of Supabase Storage. Every RPC executes as the
// service_role database role, so function grants are exercised as in Supabase.
// Nothing leaves this process.

import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);

// What Supabase provides before our migrations run.
const SUPABASE_BASELINE = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  create schema storage;
  create table storage.buckets (id text primary key, name text not null, public boolean not null default false, file_size_limit bigint);
`;

export async function createFakeSupabase({ serviceRoleKey = `service-role-${"s".repeat(40)}`, anonKey = `anon-key-${"a".repeat(40)}`, url = "https://fake-project.supabase.co" } = {}) {
  const db = new PGlite();
  await db.exec(SUPABASE_BASELINE);
  const applied = [];
  for (const f of readdirSync(MIGRATIONS).filter((x) => x.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(new URL(f, MIGRATIONS), "utf8"));
    applied.push(f);
  }
  const objects = new Map(); // "<bucket>/<path>" -> Buffer
  const calls = [];
  const hooks = { onUpload: null }; // tests may corrupt uploads
  const argCache = new Map();
  let queue = Promise.resolve(); // one statement at a time, like a single connection

  async function argsOf(fn) {
    if (!argCache.has(fn)) {
      const r = await db.query(
        `select p.parameter_name as name, p.data_type as type, p.udt_name as udt from information_schema.parameters p
         join information_schema.routines r on r.specific_name = p.specific_name
         where r.routine_schema = 'public' and r.routine_name = $1 and p.parameter_mode = 'IN' order by p.ordinal_position`,
        [fn],
      );
      argCache.set(fn, r.rows);
    }
    return argCache.get(fn);
  }

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  async function rpc(fn, body) {
    const params = await argsOf(fn);
    if (!params.length && !(await db.query("select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1", [fn])).rows.length) {
      return json(404, { code: "PGRST202", message: `Could not find the function public.${fn}` });
    }
    const args = JSON.parse(body || "{}");
    const used = params.filter((p) => p.name in args);
    const sql = `select public.${fn}(${used.map((p, i) => `${p.name} => $${i + 1}::${p.udt === "_text" ? "text[]" : p.udt}`).join(", ")}) as r`;
    const values = used.map((p) => (p.udt === "jsonb" && args[p.name] !== null ? JSON.stringify(args[p.name]) : args[p.name]));
    const run = async () => {
      await db.exec("set role service_role");
      try {
        return (await db.query(sql, values)).rows[0].r;
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
      return json(400, { code: e.code ?? "XX000", message: e.message, details: null, hint: null });
    }
  }

  async function fetchImpl(input, init = {}) {
    const u = new URL(String(input));
    const h = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method: init.method ?? "GET", path: u.pathname, apikey: h.apikey === serviceRoleKey ? "service_role" : h.apikey === anonKey ? "anon" : "other" });
    if (`${u.protocol}//${u.host}` !== url) throw new Error(`fake supabase: unexpected host ${u.host}`);
    if (h.apikey !== serviceRoleKey || h.authorization !== `Bearer ${serviceRoleKey}`) {
      // The anon key (what a browser would hold) gets nothing from Greenlight.
      return json(401, { code: "PGRST301", message: "permission denied" });
    }
    if (u.pathname.startsWith("/rest/v1/rpc/")) return rpc(decodeURIComponent(u.pathname.slice("/rest/v1/rpc/".length)), init.body);

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
