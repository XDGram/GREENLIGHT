// LIVE denial test against the real Supabase project, with the PUBLIC key only.
// Skipped unless GREENLIGHT_LIVE_SUPABASE=1, SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY are set.
//
// The publishable key (sb_publishable_...) is what any browser or app may hold. It must reach
// nothing of Greenlight's over the real Data API and Storage API, and the server must refuse
// to use it as its own key. Read-only: every request here is refused by Supabase.

import { test, before } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../src/server/config.js";
import { SupabaseStore } from "../../src/server/supabase/store.js";

const URL_ = process.env.SUPABASE_URL;
const PUB = process.env.SUPABASE_PUBLISHABLE_KEY;
const LIVE = process.env.GREENLIGHT_LIVE_SUPABASE === "1" && URL_ && PUB;
const skip = LIVE ? false : "set GREENLIGHT_LIVE_SUPABASE=1, SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY";
const BUCKET = "greenlight-evidence";

const call = async (path, { method = "GET", headers = {}, body } = {}) => {
  const res = await fetch(`${URL_}${path}`, { method, headers: { apikey: PUB, ...headers }, body });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON */
  }
  return { status: res.status, json, text };
};
const rpc = (fn, args, schema = "greenlight_api") =>
  call(`/rest/v1/rpc/${fn}`, { method: "POST", headers: { "content-type": "application/json", "content-profile": schema, "accept-profile": schema }, body: JSON.stringify(args) });

// Guard: an egress proxy that injects the SERVER key into every request to this host would turn
// these probes into service-role calls (and the write probes below into real writes). Prove the
// requests really run as anon before anything else; otherwise fail every test without writing.
let injected = null;
before(async () => {
  if (!LIVE) return;
  const r = await rpc("greenlight_authenticate", { p_token_sha256: "0".repeat(64) });
  injected = r.status === 200 ? "requests reach Supabase with the server key (an egress proxy injects it); run this suite without the proxy, e.g. without NODE_USE_ENV_PROXY" : null;
});
const guard = () => assert.equal(injected, null, injected ?? "");

test("live: the publishable key is refused as the server key (config) and fails readiness", { skip }, async () => {
  guard();
  assert.throws(() => loadConfig({ SUPABASE_URL: URL_, SUPABASE_SERVICE_ROLE_KEY: PUB }), /publishable key/);
  // Even if code bypassed the config check, Supabase gives it nothing.
  const h = await new SupabaseStore({ url: URL_, serviceRoleKey: PUB }).health();
  assert.deepEqual([h.ok, h.database], [false, "unauthorized"]);
  assert.notEqual(h.storage, "ok");
});

test("live: every Greenlight RPC is denied to the publishable key (42501)", { skip }, async () => {
  guard();
  const calls = [
    ["greenlight_authenticate", { p_token_sha256: "0".repeat(64) }],
    ["greenlight_list_projects", { p_account: "greenlight-e2e-a" }],
    ["greenlight_get_project", { p_id: "prj_834501c8031744a3a449f357343a158c", p_account: "greenlight-e2e-a" }],
    ["greenlight_list_versions", { p_project_id: "prj_834501c8031744a3a449f357343a158c" }],
    ["greenlight_list_jobs", { p_statuses: null }],
    ["greenlight_ensure_account", { p_slug: "anon-should-not-create" }],
    ["greenlight_add_token", { p_account: "greenlight-e2e-a", p_user: "e2e-owner", p_token_sha256: "f".repeat(64), p_label: "x" }],
  ];
  for (const [fn, args] of calls) {
    const r = await rpc(fn, args);
    assert.equal(r.json?.code, "42501", `${fn}: ${r.status} ${r.text.slice(0, 120)}`);
    assert.ok([401, 403].includes(r.status), `${fn}: ${r.status}`);
  }
});

test("live: the private greenlight schema is not exposed; public schema has no Greenlight functions", { skip }, async () => {
  guard();
  const r = await call("/rest/v1/accounts", { headers: { "accept-profile": "greenlight" } });
  assert.equal(r.status, 406);
  assert.equal(r.json?.code, "PGRST106");
  assert.match(`${r.json?.message} ${r.json?.hint}`, /greenlight_api/, "the exposed list includes greenlight_api (the server's schema)");
  const pub = await rpc("greenlight_list_projects", { p_account: "x" }, "public");
  assert.ok(pub.status >= 400 && pub.status < 500, `public RPC lookup: ${pub.status}`);
  assert.equal(pub.json?.code, "PGRST202", "no Greenlight function in public");
});

test("live: the evidence bucket is invisible to the publishable key", { skip }, async () => {
  guard();
  const info = await call(`/storage/v1/bucket/${BUCKET}`, { headers: { authorization: `Bearer ${PUB}` } });
  assert.ok(info.status >= 400, `bucket info: ${info.status}`);
  assert.match(info.text, /not found/i);
  const list = await call(`/storage/v1/object/list/${BUCKET}`, { method: "POST", headers: { authorization: `Bearer ${PUB}`, "content-type": "application/json" }, body: JSON.stringify({ prefix: "", limit: 10 }) });
  assert.ok(list.status >= 400 || (Array.isArray(list.json) && list.json.length === 0), `list: ${list.status} ${list.text.slice(0, 120)}`);
  const pubUrl = await call(`/storage/v1/object/public/${BUCKET}/projects/x/runs/y/manifest.json`);
  assert.ok(pubUrl.status >= 400, `public URL: ${pubUrl.status}`);
  const up = await call(`/storage/v1/object/${BUCKET}/anon-probe.txt`, { method: "POST", headers: { authorization: `Bearer ${PUB}`, "content-type": "text/plain", "x-upsert": "false" }, body: "probe" });
  assert.ok(up.status >= 400, `upload must be refused: ${up.status} ${up.text.slice(0, 120)}`);
});
