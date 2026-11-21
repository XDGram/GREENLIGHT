// The live-app reader with a real headless Chromium (@sparticuz/chromium, the one production
// uses) against a local page. Private-address requests from the page are blocked; only the
// local test origin is allowed through the injected check. No external network.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readLiveApp } from "../../src/server/browse.js";

const hits = [];
const server = http.createServer((req, res) => {
  hits.push(req.url);
  res.setHeader("content-type", "text/html");
  if (req.url === "/about") return res.end("<h1>About</h1><p>Made by a small team.</p>");
  res.end(`<html><head><title>Shop</title></head><body>
    <h1>Shop</h1><nav><a href="/about">About</a></nav>
    <form><label>Email <input name="email" type="email"></label><button>Subscribe</button></form>
    <div id="later"></div>
    <img src="http://10.0.0.1/track.png">
    <script>document.getElementById("later").textContent = "Rendered by JavaScript";</script>
  </body></html>`);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
after(() => new Promise((r) => server.close(r)));
const origin = `http://127.0.0.1:${server.address().port}`;

test("reads what a visitor sees after JavaScript runs, follows a same-origin link, and blocks private addresses", { timeout: 120_000 }, async () => {
  const blocked = [];
  const r = await readLiveApp({
    url: `${origin}/`,
    checkHost: async () => {},
    isBlocked: (h) => {
      const b = h !== "127.0.0.1";
      if (b) blocked.push(h);
      return b || false;
    },
    maxPages: 2,
  });
  assert.equal(r.status, "ok", r.reason);
  const [home, about] = r.pages;
  assert.equal(home.title, "Shop");
  assert.match(home.text, /Rendered by JavaScript/, "text rendered by scripts is seen");
  assert.deepEqual(home.buttons, ["Subscribe"]);
  assert.deepEqual(home.inputs, [{ type: "email", label: "Email" }]);
  assert.equal(about.headings[0], "About");
  assert.ok(blocked.includes("10.0.0.1"), "the request to a private address was aborted");
  assert.match(r.screenshot, /^data:image\/jpeg;base64,/);
});

test("refuses non-public start addresses before opening a browser", async () => {
  let launched = false;
  const r = await readLiveApp({ url: "http://127.0.0.1:1/", launch: async () => { launched = true; } });
  assert.deepEqual([r.status, launched], ["unavailable", false]);
});

test("a public-looking name that resolves to a private address is refused (regression: callers used to ignore the result)", async () => {
  const { requirePublicHost } = await import("../../src/deploy/host.js");
  const lookup = async () => [{ address: "10.0.0.5" }];
  await assert.rejects(requirePublicHost("internal.example.com", { lookup }), /host_resolves_to_private_address/);
  assert.equal((await requirePublicHost("shop.example.com", { lookup: async () => [{ address: "93.184.216.34" }] })).ok, true);
  const { readStartPage } = await import("../../src/server/guest-ai.js");
  let fetched = false;
  const text = await readStartPage("https://internal.example.com/", { checkHost: (h) => requirePublicHost(h, { lookup }), fetchImpl: async () => { fetched = true; return new Response("<p>secret</p>", { headers: { "content-type": "text/html" } }); } });
  assert.deepEqual([text, fetched], [null, false], "nothing is fetched from a private address");
});
