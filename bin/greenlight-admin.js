#!/usr/bin/env node
// Greenlight operator commands against the Supabase project (server-side key).
//
//   greenlight-admin create-account <slug>
//   greenlight-admin create-user <account> <name> <owner|agent>
//   greenlight-admin issue-token <account> <user> [label]   prints a NEW token once; only its SHA-256 is stored
//   greenlight-admin revoke-token                           reads the token on stdin; revokes it
//
// Needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The service key is never printed.
// Give owner tokens only to the person; agent tokens may go to Claude Code.

import { randomBytes } from "node:crypto";
import { loadConfig, sha256Hex } from "../src/server/config.js";
import { createSupabaseClient } from "../src/server/supabase/client.js";

const [cmd, ...a] = process.argv.slice(2);
const die = (m, code = 2) => {
  process.stderr.write(`greenlight-admin: ${m}\n`);
  process.exit(code);
};
let config;
try {
  config = loadConfig(process.env);
} catch (err) {
  die(err.message);
}
if (config.store !== "supabase") die("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
const db = createSupabaseClient({ url: config.supabase.url, serviceRoleKey: config.supabase.serviceRoleKey });

try {
  if (cmd === "create-account" && a.length === 1) {
    process.stdout.write(`${JSON.stringify(await db.rpc("greenlight_ensure_account", { p_slug: a[0] }))}\n`);
  } else if (cmd === "create-user" && a.length === 3) {
    process.stdout.write(`${JSON.stringify(await db.rpc("greenlight_create_user", { p_account: a[0], p_name: a[1], p_role: a[2] }))}\n`);
  } else if (cmd === "issue-token" && (a.length === 2 || a.length === 3)) {
    const token = `glt_${randomBytes(32).toString("base64url")}`;
    await db.rpc("greenlight_add_token", { p_account: a[0], p_user: a[1], p_token_sha256: sha256Hex(token), p_label: a[2] ?? null });
    process.stderr.write("New API token (shown once; store it in a secret manager, never in a repository):\n");
    process.stdout.write(`${token}\n`);
  } else if (cmd === "revoke-token" && a.length === 0) {
    let input = "";
    for await (const c of process.stdin) input += c;
    const ok = await db.rpc("greenlight_revoke_token", { p_token_sha256: sha256Hex(input.trim()) });
    process.stdout.write(`${ok ? "revoked" : "no active token matched"}\n`);
  } else {
    die("usage: create-account <slug> | create-user <account> <name> <owner|agent> | issue-token <account> <user> [label] | revoke-token (token on stdin)");
  }
} catch (err) {
  die(`${err.code ?? "error"}: ${err.message}`, 1);
}
