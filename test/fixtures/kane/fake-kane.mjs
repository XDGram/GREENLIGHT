#!/usr/bin/env node
// Stand-in for kane-cli used by the runner tests. Never contacts any service.
// Behaviour is chosen with FAKE_KANE_MODE:
//   replay    write FAKE_KANE_STDOUT / FAKE_KANE_STDERR in small chunks, exit FAKE_KANE_EXIT
//             (FAKE_KANE_LINES=N stops after N stdout lines, to simulate a cut-off stream)
//   graceful  start a stream, then hang; exit 3 on SIGINT (like Kane's cancel)
//   stubborn  start a stream, then hang and ignore SIGINT (needs SIGKILL)
//   launcher  copy kane-cli's launcher: ignore SIGINT, run a child in "graceful"
//             mode with inherited stdio, exit with the child's code
//   version   report another cli_version in stream_start, then behave like graceful
//   stdin     report what stdin contained and whether it is a TTY, then exit 0
//   noise     non-JSON lines, arrays, CRLF, unknown events, a split multi-byte char

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const mode = process.env.FAKE_KANE_MODE ?? "replay";
const out = (s) => process.stdout.write(s);
const ev = (o) => out(JSON.stringify({ ...o, v: 1, ts: new Date().toISOString() }) + "\n");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hang = () => setInterval(() => {}, 1000);

const startEvents = (version = "0.10.6") => {
  ev({ type: "stream_start", cli_version: version, surface: "testrun", pid: process.pid });
  ev({ type: "testrun_plan", members: [{ path: "/w/cart_test.md", tags: ["clm-001"] }], valid: true, parallel: 1 });
};

async function writeChunked(stream, buf, size = 37) {
  for (let i = 0; i < buf.length; i += size) {
    stream.write(buf.subarray(i, i + size));
    await sleep(1);
  }
}

switch (mode) {
  case "replay": {
    let stdout = readFileSync(process.env.FAKE_KANE_STDOUT);
    if (process.env.FAKE_KANE_LINES) {
      const n = Number(process.env.FAKE_KANE_LINES);
      stdout = Buffer.from(stdout.toString("utf8").split("\n").slice(0, n).join("\n") + "\n");
    }
    const stderr = process.env.FAKE_KANE_STDERR ? readFileSync(process.env.FAKE_KANE_STDERR) : Buffer.alloc(0);
    await writeChunked(process.stderr, stderr.subarray(0, Math.floor(stderr.length / 2)));
    await writeChunked(process.stdout, stdout);
    await writeChunked(process.stderr, stderr.subarray(Math.floor(stderr.length / 2)));
    process.exitCode = Number(process.env.FAKE_KANE_EXIT ?? 0);
    break;
  }
  case "graceful":
  case "version": {
    process.on("SIGINT", () => {
      process.stderr.write("cancelled\n");
      process.exit(3);
    });
    startEvents(mode === "version" ? "0.9.9" : "0.10.6");
    hang();
    break;
  }
  case "stubborn": {
    process.on("SIGINT", () => process.stderr.write("ignoring SIGINT\n"));
    startEvents();
    hang();
    break;
  }
  case "launcher": {
    process.on("SIGINT", () => {});
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      stdio: "inherit",
      env: { ...process.env, FAKE_KANE_MODE: "graceful" },
    });
    process.exit(r.status ?? 1);
    break;
  }
  case "stdin": {
    let bytes = 0;
    process.stdin.on("data", (c) => (bytes += c.length));
    process.stdin.on("end", () => {
      ev({ type: "stream_start", cli_version: "0.10.6", surface: "testrun", pid: process.pid });
      ev({ type: "x_stdin", bytes, isTTY: Boolean(process.stdin.isTTY) });
      process.exitCode = 0;
    });
    break;
  }
  case "noise": {
    out("Skill update available\n");
    ev({ type: "stream_start", cli_version: "0.10.6", surface: "testrun", pid: process.pid });
    out("[1,2,3]\n");
    out("42\n");
    out("\n");
    out('{"type":"testrun_plan","members":[{"path":"/w/a_test.md","tags":["x"]}],"valid":true,"parallel":1}\r\n');
    ev({ type: "brand_new_event", foo: 1 });
    ev({ step: 1, status: "running", remark: "untyped progress line" });
    // A multi-byte character split across two writes.
    const tail = Buffer.from(JSON.stringify({ type: "warning", code: "x", message: "dash — here" }) + "\n");
    const cut = tail.indexOf(Buffer.from("—")) + 1;
    process.stdout.write(tail.subarray(0, cut));
    await sleep(5);
    process.stdout.write(tail.subarray(cut));
    out("{not json\n");
    out('{"type":"testrun_done","execution_id":"e1","overall_status":"passed"}'); // no trailing newline
    process.exitCode = 0;
    break;
  }
  default:
    process.stderr.write(`unknown FAKE_KANE_MODE ${mode}\n`);
    process.exitCode = 99;
}
