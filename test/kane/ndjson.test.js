import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { NdjsonDecoder } from "../../src/kane/ndjson.js";

const fixture = (name) => new URL(`../fixtures/kane/${name}`, import.meta.url);

function collect(feed) {
  const events = [];
  const bad = [];
  const d = new NdjsonDecoder({
    onEvent: (e, n) => events.push({ e, n }),
    onNonJson: (line, n, reason) => bad.push({ line, n, reason }),
  });
  feed(d);
  d.end();
  return { events, bad };
}

test("parses every line of the real Run 1 stream, fed one byte at a time", () => {
  const buf = readFileSync(fixture("run1-authored/stdout.ndjson"));
  const { events, bad } = collect((d) => {
    for (let i = 0; i < buf.length; i++) d.push(buf.subarray(i, i + 1));
  });
  assert.equal(bad.length, 0);
  assert.equal(events.length, 12);
  assert.equal(events[0].e.type, "stream_start");
  assert.equal(events.at(-1).e.type, "testrun_done");
});

test("byte-at-a-time and whole-buffer feeding give identical events (Run 2)", () => {
  const buf = readFileSync(fixture("run2-replay/stdout.ndjson"));
  const whole = collect((d) => d.push(buf)).events.map((x) => x.e);
  const bytes = collect((d) => {
    for (let i = 0; i < buf.length; i++) d.push(buf.subarray(i, i + 1));
  }).events.map((x) => x.e);
  assert.deepEqual(bytes, whole);
  assert.equal(whole.length, 18);
});

test("skips non-JSON lines, non-object JSON and blank lines without throwing", () => {
  const { events, bad } = collect((d) => {
    d.push('Skill update available\n{"type":"a"}\n[1,2]\n"str"\nnull\n\n   \n{broken\n{"type":"b"}\n');
  });
  assert.deepEqual(events.map((x) => x.e.type), ["a", "b"]);
  assert.deepEqual(
    bad.map((b) => b.reason),
    ["invalid_json", "not_an_object", "not_an_object", "not_an_object", "invalid_json"],
  );
  assert.deepEqual(bad.map((b) => b.n), [1, 3, 4, 5, 8]);
});

test("handles CRLF line endings and a final line without a newline", () => {
  const { events } = collect((d) => d.push('{"type":"a"}\r\n{"type":"b"}'));
  assert.deepEqual(events.map((x) => x.e.type), ["a", "b"]);
});

test("reassembles a multi-byte UTF-8 character split across chunks", () => {
  const buf = Buffer.from('{"type":"w","m":"a — b"}\n');
  const cut = buf.indexOf(Buffer.from("—")) + 1; // inside the 3-byte sequence
  const { events } = collect((d) => {
    d.push(buf.subarray(0, cut));
    d.push(buf.subarray(cut));
  });
  assert.equal(events[0].e.m, "a — b");
});

test("push after end throws; end is idempotent", () => {
  const d = new NdjsonDecoder();
  d.end();
  d.end();
  assert.throws(() => d.push("x"), /after end/);
});
