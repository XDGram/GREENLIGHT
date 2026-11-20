// Production runtime: the execution-host check (Kane CLI + Chrome), the real server binary's
// startup, readiness, configuration refusals and graceful shutdown, and the container files.
// Kane and Chrome are stand-in executables; Supabase is the in-memory fake. No network, no Kane.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { checkRuntime, findChrome } from "../../src/server/index.js";
import { KANE_CLI_VERSION } from "../../src/kane/runner.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const PRELOAD = fileURLToPath(new URL("./fake-supabase-preload.mjs", import.meta.url));
const KEY = `sb_secret_${"r".repeat(22)}_runtime1`;
const temps = [];
after(() => Promise.all(temps.map((d) => rm(d, { recursive: true, force: true }))));

async function bins({ version = KANE_CLI_VERSION } = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "gl-runtime-"));
  temps.push(dir);
  const kane = path.join(dir, "kane-cli");
  // Answers --version only; anything else would be a real run and fails loudly.
  await writeFile(kane, `#!/bin/sh\nif [ "$1" = "--version" ]; then echo ${version}; exit 0; fi\necho "kane run attempted" >&2; exit 99\n`);
  await chmod(kane, 0o755);
  const chrome = path.join(dir, "chromium");
  await writeFile(chrome, "#!/bin/sh\nexit 0\n");
  await chmod(chrome, 0o755);
  return { dir, kane, chrome };
}

test("checkRuntime: pinned Kane and a launchable Chrome are required", async () => {
  const b = await bins();
  assert.deepEqual(await checkRuntime({ kaneBin: b.kane, env: { KANE_CLI_CHROME_PATH: b.chrome } }), { ok: true, kane: "ok", kaneVersion: KANE_CLI_VERSION, chrome: "ok", chromePath: b.chrome });
  const old = await bins({ version: "0.9.9" });
  const r = await checkRuntime({ kaneBin: old.kane, env: { KANE_CLI_CHROME_PATH: b.chrome } });
  assert.deepEqual([r.ok, r.kane, r.kaneVersion], [false, "kane_version_mismatch", "0.9.9"]);
  assert.equal((await checkRuntime({ kaneBin: path.join(b.dir, "missing"), env: { KANE_CLI_CHROME_PATH: b.chrome } })).kane, "kane_not_installed");
  const noChrome = await checkRuntime({ kaneBin: b.kane, env: { KANE_CLI_CHROME_PATH: path.join(b.dir, "nope") } });
  assert.deepEqual([noChrome.ok, noChrome.chrome], [false, "chrome_not_found"]);
  assert.equal(findChrome({ KANE_CLI_CHROME_PATH: b.chrome }), b.chrome);
});

/** Run bin/greenlight-server.js with the fake Supabase. */
function server(env, { port = 0 } = {}) {
  const child = spawn(process.execPath, ["--import", PRELOAD, "bin/greenlight-server.js"], {
    cwd: ROOT,
    env: { PATH: process.env.PATH, HOME: os.tmpdir(), SUPABASE_URL: "https://fake-project.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY, GREENLIGHT_PORT: String(port), ...env },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let log = "";
  child.stderr.on("data", (c) => (log += c));
  const exited = new Promise((resolve) => child.on("exit", (code, signal) => resolve({ code, signal })));
  const events = () => log.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { raw: l }; } });
  const waitFor = async (event, ms = 30_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const e = events().find((x) => x.event === event);
      if (e) return e;
      if (child.exitCode !== null) return null;
      await new Promise((r) => setTimeout(r, 50));
    }
    return null;
  };
  return { child, exited, events, waitFor, log: () => log };
}

test("server binary: starts on Supabase with Kane and Chrome, reports ready, stops cleanly on SIGTERM", async () => {
  const b = await bins();
  const work = await mkdtemp(path.join(os.tmpdir(), "gl-runtime-work-"));
  temps.push(work);
  const s = server({ GREENLIGHT_KANE_BIN: b.kane, KANE_CLI_CHROME_PATH: b.chrome, GREENLIGHT_WORK_DIR: work });
  const up = await s.waitFor("listening");
  assert.ok(up, s.log());
  assert.deepEqual([up.store, up.kane, up.chrome, up.bucket], ["supabase", KANE_CLI_VERSION, b.chrome, "greenlight-evidence"]);
  const base = `http://127.0.0.1:${up.port}`;
  const health = await fetch(`${base}/v1/health`);
  assert.equal(health.status, 200);
  const ready = await fetch(`${base}/v1/ready`);
  assert.deepEqual([ready.status, await ready.json()], [200, { schema: "greenlight.ready/v1", ok: true, store: "supabase", database: "ok", storage: "ok", kane: "ok", chrome: "ok" }]);
  assert.equal((await fetch(`${base}/v1/projects`)).status, 401);
  s.child.kill("SIGTERM");
  assert.deepEqual(await s.exited, { code: 0, signal: null });
  assert.ok(s.events().some((e) => e.event === "stopping" && e.signal === "SIGTERM"));
  assert.ok(!s.log().includes(KEY), "the key never appears in logs");
  assert.ok(!s.log().includes("kane run attempted"), "startup never runs Kane beyond --version");
});

test("server binary refuses to start without a usable configuration or runtime (exit 2, reason logged)", async () => {
  const b = await bins();
  const cases = [
    [{ SUPABASE_SERVICE_ROLE_KEY: "" , SUPABASE_URL: "" }, /set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY/],
    [{ SUPABASE_SERVICE_ROLE_KEY: "sb_publishable_O3ev7dyTwadU-uAlsB-2Mw_3Y6SFuV7" }, /publishable key/],
    [{ SUPABASE_URL: "http://fake-project.supabase.co" }, /https/],
    [{ SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "", GREENLIGHT_DATA_DIR: os.tmpdir() }, /file store is for tests only/],
    [{ GREENLIGHT_KANE_BIN: path.join(b.dir, "missing"), KANE_CLI_CHROME_PATH: b.chrome }, /"kane":"kane_not_installed"/],
    [{ GREENLIGHT_KANE_BIN: (await bins({ version: "0.11.0" })).kane, KANE_CLI_CHROME_PATH: b.chrome }, /"kane":"kane_version_mismatch"/],
    [{ GREENLIGHT_KANE_BIN: b.kane, KANE_CLI_CHROME_PATH: path.join(b.dir, "no-chrome") }, /"chrome":"chrome_not_found"/],
    [{ GREENLIGHT_KANE_BIN: b.kane, KANE_CLI_CHROME_PATH: b.chrome, FAKE_SUPABASE_PUBLIC_BUCKET: "1" }, /"storage":"bucket_public"/],
  ];
  for (const [env, why] of cases) {
    const s = server(env);
    const { code } = await s.exited;
    assert.equal(code, 2, `${JSON.stringify(env)}: ${s.log()}`);
    assert.match(s.log(), why);
    assert.ok(!s.log().includes(KEY));
  }
});

test("container files: pinned Kane, Chromium, no secrets in the image, readiness health check, persistent volumes", () => {
  const docker = readFileSync(path.join(ROOT, "Dockerfile"), "utf8");
  assert.match(docker, new RegExp(`@testmuai/kane-cli@${KANE_CLI_VERSION.replace(/\./g, "\\.")}\\b`));
  assert.match(docker, /grep -qx '0\.10\.6'/);
  assert.match(docker, /apt-get install[^\n]*\bchromium\b/);
  assert.match(docker, /KANE_CLI_CHROME_PATH=\/usr\/bin\/chromium/);
  assert.match(docker, /HEALTHCHECK[\s\S]*\/v1\/ready/);
  assert.match(docker, /CMD \["node", "bin\/greenlight-server\.js"\]/);
  assert.match(docker, /^USER greenlight$/m);
  assert.doesNotMatch(docker, /SUPABASE_SERVICE_ROLE_KEY|sb_secret_|LT_ACCESS_KEY/, "no secret names or values in the image");
  const ignore = readFileSync(path.join(ROOT, ".dockerignore"), "utf8").split("\n");
  for (const p of [".env", ".env.*", ".git", ".testmuai", ".greenlight"]) assert.ok(ignore.includes(p), p);
  const compose = readFileSync(path.join(ROOT, "compose.yaml"), "utf8");
  assert.match(compose, /env_file: \.env/);
  assert.match(compose, /init: true/);
  assert.match(compose, /kane-home:\/home\/greenlight\/\.testmuai/);
  assert.match(compose, /"127\.0\.0\.1:8787:8787"/);
  const gitignore = readFileSync(path.join(ROOT, ".gitignore"), "utf8").split("\n");
  assert.ok(gitignore.includes(".env") && gitignore.includes("!.env.example"));
  const example = readFileSync(path.join(ROOT, ".env.example"), "utf8");
  assert.match(example, /^SUPABASE_SERVICE_ROLE_KEY=$/m, "the example never carries a secret value");
});
