import { test } from "node:test";
import assert from "node:assert/strict";
import { claimsFromText, cleanClaim, checkCost, maxClaims, checkSpecYaml } from "../../src/server/simple-check.js";
import { USER_LIMITS } from "../../src/server/guest-spec.js";
import { projectFromText } from "../../src/spec/generate.js";

test("README bullets become claims; headings, code, badges, links and commands are left out", () => {
  const readme = [
    "# Todo",
    "[![build](https://x/badge.svg)](https://x)",
    "A tiny todo app.",
    "## Features",
    "- Users can **sign up** with email",
    "* Add, edit and delete tasks",
    "1. [Dark mode](https://example.com/docs) toggle in settings",
    "- [x] Tasks sync across devices",
    "- npm run dev",
    "```",
    "- not a claim inside code",
    "```",
    "## License",
    "- MIT",
  ].join("\n");
  assert.deepEqual(claimsFromText(readme), ["Users can sign up with email", "Add, edit and delete tasks", "Dark mode toggle in settings", "Tasks sync across devices"]);
});

test("without bullets, each line or sentence is a claim; duplicates are dropped", () => {
  assert.deepEqual(claimsFromText("Users can sign up. Tasks can be added and removed.\nThe dashboard shows a chart\nusers can sign up"), ["Users can sign up.", "Tasks can be added and removed.", "The dashboard shows a chart"]);
  assert.deepEqual(claimsFromText(""), []);
});

test("typed claims are one line, without web addresses or template syntax", () => {
  assert.equal(cleanClaim("  Users   can\nsign up ", 0), "Users can sign up");
  assert.throws(() => cleanClaim("Open https://x.example", 0), /web address/);
  assert.throws(() => cleanClaim("{{token}} works", 1), /Claim 2/);
  assert.throws(() => cleanClaim("", 2), /empty/);
});

test("cost and claim limit follow the credit estimate", () => {
  assert.deepEqual([1, 2, 3].map((n) => checkCost(n, {})), [57, 94, 131]);
  assert.deepEqual([maxClaims(100, {}), maxClaims(150, {}), maxClaims(50, {})], [2, 3, 0]);
});

test("one Kane test per claim, each a single check step", () => {
  const { spec, rendered } = projectFromText(checkSpecYaml({ name: "acme/shop", url: "https://shop.example.com", claims: ["Users can sign up", "The cart should show a total"], limits: USER_LIMITS }));
  assert.deepEqual(spec.tests.map((t) => [t.id, t.claims, t.steps.map((s) => s.kind)]), [["claim-1", ["CLM-001"], ["check"]], ["claim-2", ["CLM-002"], ["check"]]]);
  assert.match(rendered[1].content, /## Claim\nUse the app as a normal visitor would .*verify it: The cart should show a total/);
});
