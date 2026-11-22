import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSpec, SpecError, nextClaimId } from "../../src/spec/schema.js";

const SAMPLE = readFileSync(new URL("../fixtures/spec/smoke/greenlight.yaml", import.meta.url), "utf8");

/** Minimal valid spec, with overridable parts. */
function spec({ project, claims, tests, extra = "" } = {}) {
  return `version: 1
project:
${project ?? "  name: App\n  url: https://app.example.com/"}
claims:
${claims ?? "  - id: CLM-001\n    text: Users can log in."}
tests:
${tests ?? `  - id: login
    title: Log in
    claims: [CLM-001]
    steps:
      - name: Log in
        do: Click the "Log in" button.
      - name: Check
        expect_text: Welcome back`}
${extra}`;
}

function errorsOf(text) {
  try {
    parseSpec(text);
  } catch (e) {
    if (e instanceof SpecError) return e.errors;
    throw e;
  }
  assert.fail("expected SpecError");
}
const has = (errors, re) => assert.ok(errors.some((e) => re.test(e)), `no error matching ${re}:\n${errors.join("\n")}`);

test("the sample spec is valid and normalised", () => {
  const s = parseSpec(SAMPLE);
  assert.equal(s.project.name, "Greenlight Test App");
  assert.equal(s.project.url, "https://gl-test-93mjujacr-timeb7208-5361s-projects.vercel.app/");
  assert.match(s.project.description, /^Throwaway app with one working feature \(cart\) and one deliberately broken/);
  assert.deepEqual(s.claims.map((c) => c.id), ["CLM-001", "CLM-002", "CLM-003"]);
  assert.equal(s.claims[0].requirement, "The cart shows how many items have been added.");
  const t = Object.fromEntries(s.tests.map((x) => [x.id, x]));
  assert.deepEqual(t["cart-then-about"].claims, ["CLM-001", "CLM-003"], "a test can verify several claims");
  assert.equal(t["cart-then-about"].maxSteps, 20);
  assert.equal(t["cart-add-two"].maxSteps, 15, "default");
  assert.equal(t["cart-add-two"].mode, "testing", "default");
  assert.equal(t["cart-add-two"].startPath, "/", "default");
  assert.deepEqual(t["newsletter-subscribe"].steps.map((x) => x.kind), ["do", "do", "expect_text"]);
});

test("a minimal spec is valid", () => {
  assert.equal(parseSpec(spec()).tests[0].id, "login");
});

test("invalid YAML is reported as a spec error with its line", () => {
  has(errorsOf("version: 1\nproject: {name: x}"), /YAML: line 2: flow mappings/);
  has(errorsOf("version: 1\nversion: 1"), /YAML: line 2: duplicate key/);
});

test("missing required fields are all reported together", () => {
  const e = errorsOf("version: 2\nproject:\n  description: x\n");
  has(e, /^version: must be 1/);
  has(e, /^project\.name: required/);
  has(e, /^project\.url: required/);
  has(e, /^claims: required/);
  has(e, /^tests: required/);
  has(errorsOf("version: 1\n"), /^project: required mapping/);
  has(errorsOf("- a\n"), /top level must be a mapping/);
});

test("unknown fields are rejected at every level", () => {
  has(errorsOf(spec({ extra: "owner: me" })), /top level: unknown field "owner"/);
  has(errorsOf(spec({ project: "  name: A\n  url: https://a.example.com/\n  token: x" })), /project: unknown field "token"/);
  has(errorsOf(spec({ claims: "  - id: CLM-001\n    text: T\n    weight: 2" })), /claims\[0\]: unknown field "weight"/);
});

test("claim ids: required, CLM-NNN format, unique; a missing id suggests the next free one", () => {
  has(errorsOf(spec({ claims: "  - id: CLM-001\n    text: A\n  - text: B" })), /claims\[1\]: missing id \(next free id: CLM-002\)/);
  has(errorsOf(spec({ claims: "  - id: CLM-001\n    text: A\n  - id: CLM-001\n    text: B" })), /duplicate claim id CLM-001/);
  has(errorsOf(spec({ claims: "  - id: claim-1\n    text: A" })), /must look like CLM-001/);
  assert.equal(nextClaimId(["CLM-001", "CLM-007", null, "x"]), "CLM-008");
  assert.equal(nextClaimId([]), "CLM-001");
  assert.equal(nextClaimId(["CLM-1234"]), "CLM-1235");
});

test("test ids: required, lowercase-hyphenated, unique", () => {
  const t = (id) => `  - id: ${id}\n    title: T\n    claims: [CLM-001]\n    steps:\n      - name: S\n        expect_text: X`;
  has(errorsOf(spec({ tests: `${t("login")}\n${t("login")}` })), /duplicate test id login/);
  has(errorsOf(spec({ tests: t("Login_Test") })), /tests\[0\]\.id: required, lowercase/);
  has(errorsOf(spec({ tests: t("a".repeat(61)) })), /max 60/);
});

test("test claims must exist, be unique, and every claim must be tested", () => {
  const steps = "    steps:\n      - name: S\n        expect_text: X";
  has(errorsOf(spec({ tests: `  - id: a\n    title: T\n    claims: [CLM-009]\n${steps}` })), /unknown claim "CLM-009"/);
  has(errorsOf(spec({ tests: `  - id: a\n    title: T\n    claims: [CLM-001, CLM-001]\n${steps}` })), /CLM-001 listed twice/);
  has(errorsOf(spec({ tests: `  - id: a\n    title: T\n    claims: []\n${steps}` })), /claims: required, at least one claim id/);
  has(errorsOf(spec({ claims: "  - id: CLM-001\n    text: A\n  - id: CLM-002\n    text: B" })), /claim CLM-002: no test verifies it/);
});

test("every test needs an exact visible-text check", () => {
  has(
    errorsOf(spec({ tests: "  - id: a\n    title: T\n    claims: [CLM-001]\n    steps:\n      - name: S\n        do: Click the button." })),
    /needs at least one expect_text step/,
  );
});

test("visual-only checks are rejected", () => {
  for (const key of ["expect", "expect_visual", "screenshot", "looks_like"]) {
    has(
      errorsOf(spec({ tests: `  - id: a\n    title: T\n    claims: [CLM-001]\n    steps:\n      - name: S\n        ${key}: the page looks right\n      - name: C\n        expect_text: X` })),
      new RegExp(`visual-only check "${key}" is not allowed`),
    );
  }
});

test("a do step may not verify anything, use absolute URLs, variables or imports", () => {
  const withDo = (d) => spec({ tests: `  - id: a\n    title: T\n    claims: [CLM-001]\n    steps:\n      - name: S\n        do: ${d}\n      - name: C\n        expect_text: X` });
  for (const d of ["Verify the cart shows 2.", "Make sure the banner is visible.", "The page should show a welcome.", "Confirm the order went through."]) {
    has(errorsOf(withDo(d)), /describes a verification/);
  }
  has(errorsOf(withDo("Go to https://example.com/login.")), /absolute URL/);
  has(errorsOf(withDo("Type {{password}} into the box.")), /\{\{variables\}\}/);
  has(errorsOf(withDo('"@import ./helpers/login.md"')), /@import/);
  assert.doesNotThrow(() => parseSpec(withDo('Check the "Remember me" checkbox.')), "checking a checkbox is an action");
});

test("expect_text must be exact, single-line, unquoted and variable-free", () => {
  const withExpect = (e) => spec({ tests: `  - id: a\n    title: T\n    claims: [CLM-001]\n    steps:\n      - name: C\n        expect_text: ${e}` });
  has(errorsOf(withExpect('" padded "')), /must not start or end with spaces/);
  has(errorsOf(withExpect("'say \"hi\"'")), /double quotes/);
  has(errorsOf(withExpect('"{{name}}"')), /\{\{variables\}\}/);
  has(errorsOf(withExpect('""')), /required, the exact visible text/);
  has(errorsOf(withExpect('"line one\\nline two"')), /single line/);
  has(errorsOf(withExpect(`"${"x".repeat(201)}"`)), /longer than 200/);
});

test("a step needs exactly one of do / expect_text / check, and a name", () => {
  const step = (s) => spec({ tests: `  - id: a\n    title: T\n    claims: [CLM-001]\n    steps:\n${s}\n      - name: C\n        expect_text: X` });
  has(errorsOf(step("      - name: S\n        do: Click it.\n        expect_text: Y")), /exactly one of "do", "expect_text" or "check"/);
  has(errorsOf(step("      - name: S\n        do: Click it.\n        check: It works.")), /exactly one of/);
  has(errorsOf(step("      - name: S")), /exactly one of/);
  has(errorsOf(step("      - do: Click it.")), /name: required/);
  has(errorsOf(step('      - name: "# heading"\n        do: Click it.')), /must not start with #/);
});

test("project URL must be a deployed http(s) URL without secrets", () => {
  const withUrl = (u) => spec({ project: `  name: A\n  url: ${u}` });
  has(errorsOf(withUrl("http://localhost:3000/")), /not localhost/);
  has(errorsOf(withUrl("https://app.example.com/?x-vercel-protection-bypass=abc")), /query string or fragment/);
  has(errorsOf(withUrl('"https://user:pw@app.example.com/"')), /credentials/);
  has(errorsOf(withUrl("ftp://app.example.com/")), /http or https/);
  has(errorsOf(withUrl("not-a-url")), /not a valid URL/);
});

test("start_path, mode and max_steps are validated", () => {
  const t = (extra) => spec({ tests: `  - id: a\n    title: T\n    claims: [CLM-001]\n${extra}\n    steps:\n      - name: C\n        expect_text: X` });
  has(errorsOf(t("    start_path: https://evil.example.com/")), /start_path/);
  has(errorsOf(t('    start_path: "//evil.example.com"')), /start_path/);
  has(errorsOf(t("    start_path: /a?b=1")), /start_path/);
  has(errorsOf(t("    mode: strict")), /mode: must be/);
  has(errorsOf(t("    max_steps: 99")), /max_steps/);
  assert.equal(parseSpec(t("    start_path: /shop/cart\n    mode: action\n    max_steps: 3")).tests[0].startPath, "/shop/cart");
});

test("a check step is a claim Kane judges and counts as the verifying step", () => {
  const one = (c) => spec({ tests: `  - id: a\n    title: T\n    claims: [CLM-001]\n    steps:\n      - name: Claim\n        check: ${c}` });
  const ok = parseSpec(one("Users can sign up and see their dashboard."));
  assert.deepEqual(ok.tests[0].steps, [{ name: "Claim", kind: "check", text: "Users can sign up and see their dashboard." }]);
  has(errorsOf(one("Open https://evil.example and sign up.")), /check: must not contain an absolute URL/);
  has(errorsOf(one('"{{secret}} works"')), /must not contain \{\{variables\}\}/);
});
