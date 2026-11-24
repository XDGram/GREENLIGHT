// Documentation must not drift from the code: every error code, API endpoint,
// CLI command and Kane limitation is documented.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ERRORS } from "../src/cli/errors.js";
import { KANE_CAPABILITIES } from "../src/kane/capabilities.js";

const API = readFileSync(new URL("../docs/API.md", import.meta.url), "utf8");
// The CLI reference moved from the README to docs/CLI.md; the README is the product overview.
const README = readFileSync(new URL("../docs/CLI.md", import.meta.url), "utf8");
const HTTP = readFileSync(new URL("../src/server/http.js", import.meta.url), "utf8");
const MAIN = readFileSync(new URL("../src/cli/main.js", import.meta.url), "utf8");

test("every error code is documented with its HTTP status and exit code", () => {
  for (const [code, spec] of Object.entries(ERRORS)) {
    const row = API.split("\n").find((l) => l.startsWith(`| \`${code}\` |`));
    assert.ok(row, `docs/API.md lacks error code ${code}`);
    assert.ok(row.includes(`| ${spec.http} | ${spec.exit} |`), `docs/API.md has wrong statuses for ${code}`);
  }
});

test("every API route in src/server/http.js is documented", () => {
  const routes = [...HTTP.matchAll(/^\s+\["(GET|POST)", \/\^(.+?)\$\//gm)].map(([, m, re]) => [m, re.replace(/\\\//g, "/").replace(/\(\[\^\/\]\+\)/g, ":x")]);
  assert.ok(routes.length >= 10);
  const documented = [...API.matchAll(/`(GET|POST) (\/v1\/[^`]+)`/g)].map(([, m, p]) => [m, p.replace(/:[A-Za-z]+/g, ":x")]);
  for (const [m, p] of routes) assert.ok(documented.some(([dm, dp]) => dm === m && dp === p), `undocumented route ${m} ${p}`);
});

test("every CLI command is in docs/CLI.md and the usage text", () => {
  const commands = /const COMMANDS = \{([^}]+)\}/.exec(MAIN)[1].split(",").map((s) => s.split(":")[0].trim().replace(/"/g, ""));
  for (const c of commands) {
    assert.ok(README.includes(`greenlight ${c}`), `docs/CLI.md lacks greenlight ${c}`);
    assert.match(MAIN, new RegExp(`\\n  ${c}\\s`), `usage text lacks ${c}`);
  }
});

test("the Kane recording limitation is stated where people will read it", () => {
  assert.equal(KANE_CAPABILITIES.retainsAuthoredRecordingsLocally, false);
  assert.match(README, /Kane 0\.10\.6 keeps no recordings in local mode/);
  assert.match(README, /cannot run unattended/);
});

test("docs/SUPABASE.md documents every table, the bucket and every migration file", async () => {
  const { readdirSync } = await import("node:fs");
  const doc = readFileSync(new URL("../docs/SUPABASE.md", import.meta.url), "utf8");
  const dir = new URL("../supabase/migrations/", import.meta.url);
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql"));
  const sql = files.map((f) => readFileSync(new URL(f, dir), "utf8")).join("\n");
  for (const f of files) assert.ok(doc.includes(f), `SUPABASE.md lacks migration ${f}`);
  const tables = [...sql.matchAll(/create table greenlight\.([a-z_]+)/g)].map((m) => m[1]);
  assert.ok(tables.length >= 11);
  for (const t of tables) assert.ok(doc.includes(`\`${t}\``), `SUPABASE.md lacks table ${t}`);
  assert.ok(doc.includes("greenlight-evidence") && sql.includes("'greenlight-evidence', 'greenlight-evidence', false"));
});
