// Preload for child-process tests of bin/greenlight-server.js: routes fetch() for the fake
// project URL to the in-memory fake Supabase (real migrations on PGlite). Test-only.
import { createFakeSupabase } from "./fake-supabase.js";

const fake = await createFakeSupabase({ serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY });
if (process.env.FAKE_SUPABASE_PUBLIC_BUCKET === "1") await fake.sql("update storage.buckets set public = true where id = 'greenlight-evidence'");
const real = globalThis.fetch;
globalThis.fetch = (u, init) => (String(u).startsWith(fake.url) ? fake.fetch(u, init) : real(u, init));
