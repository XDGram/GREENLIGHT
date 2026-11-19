// Minimal server-side Supabase client: RPC (PostgREST) and Storage, over fetch.
// No dependency on @supabase/supabase-js.
//
// The service-role key is sent only in request headers to the configured
// Supabase URL. It is never logged, never put in an error message, never
// returned to API clients. This module must only ever run on the server.

import { GreenlightError } from "../../cli/errors.js";

// SQLSTATEs raised by supabase/migrations/*_greenlight_rpc.sql -> API error codes.
const DB_ERRORS = Object.freeze({
  GLNFD: "not_found",
  GLCON: "conflict",
  GLIMM: "conflict",
  GLLIM: "job_limit_reached",
  GLHSH: "approval_hash_mismatch",
  GLINV: "internal_error",
  GLCRT: "internal_error",
});

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The dedicated schema holding Greenlight's RPC functions (never "public"). */
export const RPC_SCHEMA = "greenlight_api";

/** Validate a storage object path made of safe segments (no traversal, no empty parts). */
export function assertObjectPath(p) {
  const parts = String(p).split("/");
  if (!parts.length || parts.some((s) => !SEGMENT.test(s) || s === "." || s === "..")) throw new TypeError(`unsafe storage path: ${p}`);
  return parts.map(encodeURIComponent).join("/");
}

/**
 * @param {object} p
 * @param {string} p.url                Supabase project URL, https://<ref>.supabase.co
 * @param {string} p.serviceRoleKey     server-side secret; never sent anywhere else
 * @param {typeof fetch} [p.fetchImpl]
 * @param {number} [p.timeoutMs]
 */
export function createSupabaseClient({ url, serviceRoleKey, fetchImpl = (...a) => globalThis.fetch(...a), timeoutMs = 30_000, schema = RPC_SCHEMA }) {
  if (schema === "public" || !/^[a-z_][a-z0-9_]{0,62}$/.test(schema)) throw new Error("the Greenlight RPC schema must be a dedicated schema, never public");
  let base;
  try {
    base = new URL(url);
  } catch {
    throw new Error("SUPABASE_URL is not a valid URL");
  }
  if (base.protocol !== "https:" && !(base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname))) {
    throw new Error("SUPABASE_URL must use https");
  }
  if (typeof serviceRoleKey !== "string" || serviceRoleKey.length < 20) throw new Error("SUPABASE_SERVICE_ROLE_KEY is missing");
  const root = base.href.replace(/\/+$/, "");
  const auth = { apikey: serviceRoleKey, authorization: `Bearer ${serviceRoleKey}` };
  const scrub = (s) => String(s ?? "").split(serviceRoleKey).join("REDACTED");

  async function request(path, init, what) {
    let res;
    try {
      res = await fetchImpl(`${root}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    } catch (err) {
      throw new GreenlightError("internal_error", `Supabase ${what} failed: ${scrub(err?.message ?? err)}`);
    }
    return res;
  }

  return {
    /** Call greenlight_api.greenlight_* (PostgREST profile headers select the schema). Returns JSON (null for SQL NULL). */
    async rpc(fn, args = {}) {
      if (!/^greenlight_[a-z_]+$/.test(fn)) throw new TypeError(`not a Greenlight RPC: ${fn}`);
      const res = await request(`/rest/v1/rpc/${fn}`, {
        method: "POST",
        headers: { ...auth, "content-type": "application/json", accept: "application/json", "content-profile": schema, "accept-profile": schema },
        body: JSON.stringify(args),
      }, `rpc ${fn}`);
      const text = await res.text();
      let body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON */
      }
      if (!res.ok) {
        if (body?.code === "PGRST106") {
          throw new GreenlightError("server_not_configured", `Supabase does not expose the ${schema} schema: add it under Project Settings -> API -> Exposed schemas (see docs/SUPABASE.md).`);
        }
        const code = DB_ERRORS[body?.code] ?? "internal_error";
        const message = scrub(String(body?.message ?? `HTTP ${res.status}`).replace(/^greenlight:\s*/, ""));
        throw new GreenlightError(code, code === "internal_error" ? `Database error in ${fn}: ${message}` : `${message.charAt(0).toUpperCase()}${message.slice(1)}.`);
      }
      return body;
    },

    storage: {
      /** Upload once; an existing object is never overwritten (x-upsert: false). */
      async upload(bucket, objectPath, bytes, contentType = "application/octet-stream") {
        const p = assertObjectPath(objectPath);
        const res = await request(`/storage/v1/object/${encodeURIComponent(bucket)}/${p}`, {
          method: "POST",
          headers: { ...auth, "content-type": contentType, "x-upsert": "false", "cache-control": "no-store" },
          body: bytes,
        }, "storage upload");
        if (res.status === 409 || res.status === 400) {
          const t = await res.text();
          if (res.status === 409 || /duplicate|already exists/i.test(t)) throw new GreenlightError("conflict", "Evidence object already exists; it is never overwritten.");
          throw new GreenlightError("internal_error", `Supabase storage upload refused (HTTP ${res.status}).`);
        }
        if (!res.ok) throw new GreenlightError("internal_error", `Supabase storage upload failed (HTTP ${res.status}).`);
        return true;
      },
      /** Download a private object (service role only). */
      async download(bucket, objectPath) {
        const p = assertObjectPath(objectPath);
        const res = await request(`/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${p}`, { method: "GET", headers: { ...auth } }, "storage download");
        if (res.status === 404 || res.status === 400) throw new GreenlightError("not_found", "Evidence object not found.");
        if (!res.ok) throw new GreenlightError("internal_error", `Supabase storage download failed (HTTP ${res.status}).`);
        return Buffer.from(await res.arrayBuffer());
      },
    },
  };
}
