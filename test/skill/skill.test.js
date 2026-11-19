// Checks the Greenlight Claude Code Skill against Claude Code's Skill conventions
// and against the actual implementation (CLI commands and options, exit codes,
// file paths, Stop hook messages, report format). No Kane, network or credits.

import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseYamlSubset } from "../../src/spec/yaml-subset.js";
import { parseSpec, renderAll } from "../../src/spec/index.js";
import { parseArgs, EXIT } from "../../src/cli/main.js";
import { HOOK_EXIT, MAX_FIX_ATTEMPTS, isRelevantPath, GITIGNORE_CONTENT } from "../../src/hook/index.js";
import { detectAgentEnvironment } from "../../src/spec/approval.js";
import { buildFailureReport, renderMarkdown, catalogFromSpec } from "../../src/report/index.js";
import { evaluateRun } from "../../src/verify/classify.js";
import { toApprovedTests } from "../../src/spec/generate.js";
import { fabricatedRun } from "../verify/helpers.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const SKILL_DIR = path.join(ROOT, "skills", "greenlight");
const read = (p) => readFileSync(path.join(ROOT, p), "utf8");
const SKILL = read("skills/greenlight/SKILL.md");
const YAML_REF = read("skills/greenlight/references/greenlight-yaml.md");
const EXAMPLES = read("skills/greenlight/references/examples.md");
const ALL = [SKILL, YAML_REF, EXAMPLES].join("\n");
const SRC = {
  cli: read("src/cli/main.js"),
  hook: read("src/hook/stop-hook.js"),
  report: read("src/report/failure-report.js"),
  approval: read("src/spec/approval.js"),
};

function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  assert.ok(m, "SKILL.md must start with --- frontmatter ---");
  return { meta: parseYamlSubset(m[1]), body: text.slice(m[0].length) };
}

// ---------------------------------------------------------------- Skill conventions

test("frontmatter follows Claude Code Skill conventions", () => {
  const { meta, body } = frontmatter(SKILL);
  assert.deepEqual(Object.keys(meta).sort(), ["description", "name"]);
  assert.match(meta.name, /^[a-z0-9-]{1,64}$/, "name: lowercase letters, digits and hyphens, max 64");
  assert.equal(/anthropic|claude/.test(meta.name), false, "name must not use reserved words");
  assert.equal(path.basename(SKILL_DIR), meta.name, "directory name matches the skill name");
  assert.equal(typeof meta.description, "string");
  assert.ok(meta.description.length > 50 && meta.description.length <= 1024, `description length ${meta.description.length}`);
  assert.equal(/[<>]/.test(meta.description), false, "no XML tags in the description");
  assert.match(meta.description, /Use when/, "description says when to use it");
  assert.match(meta.description, /greenlight\.yaml/);
  assert.ok(body.split("\n").length < 500, "SKILL.md body stays under 500 lines");
});

test("every relative link in the Skill points to a file that exists", () => {
  for (const [file, text] of [["SKILL.md", SKILL], ["references/examples.md", EXAMPLES], ["references/greenlight-yaml.md", YAML_REF]]) {
    for (const [, target] of text.matchAll(/\]\(([^)#]+)\)/g)) {
      if (/^https?:/.test(target)) continue;
      assert.ok(existsSync(path.join(SKILL_DIR, path.dirname(file), target)), `${file} links to missing ${target}`);
    }
  }
  assert.match(SKILL, /\[references\/greenlight-yaml\.md\]/);
  assert.match(SKILL, /\[references\/examples\.md\]/);
});

// ---------------------------------------------------------------- CLI accuracy

const PLACEHOLDER = { "<url>": "https://app.example.com/", "<n>": "1", "<name>": "preview", "<path>": "/opt/kane", "<hash>": "a".repeat(64) };

test("every `greenlight <command …>` in the Skill is a real command with real options", () => {
  const found = [...ALL.matchAll(/`greenlight ([a-z]+)((?: [^`]*)?)`/g)];
  assert.ok(found.length >= 8);
  for (const [, cmd, rest] of found) {
    const tokens = rest.trim() ? rest.trim().split(/\s+/).map((t) => PLACEHOLDER[t] ?? t) : [];
    assert.doesNotThrow(() => parseArgs([cmd, ...tokens]), `greenlight ${cmd}${rest}`);
  }
  for (const cmd of ["init", "generate", "approve", "status", "verify"]) assert.ok(SKILL.includes(`\`greenlight ${cmd}\``), cmd);
});

test("every --option named in the Skill is a real verify option, and every verify option is documented", () => {
  const named = new Set([...ALL.matchAll(/`(--[a-z-]+)(?: <[a-z]+>)?`/g)].map((m) => m[1]));
  named.delete("--no-adaptive-heal");
  for (const opt of named) assert.doesNotThrow(() => parseArgs(["verify", opt, "1"]), opt);
  assert.ok(SKILL.includes("`greenlight approve --relayed <hash>`"), "relayed approval documented");
  const real = [...SRC.cli.matchAll(/^\s+"(--[a-z-]+)": "(?:string|number)",$/gm)].map((m) => m[1]);
  assert.ok(real.length >= 8);
  for (const opt of real) assert.ok(SKILL.includes(`\`${opt} <`), `undocumented verify option ${opt}`);
});

test("the exit-code table matches the CLI exactly", () => {
  const table = SKILL.slice(SKILL.indexOf("### Exit codes of `greenlight verify`"), SKILL.indexOf("## Workflow"));
  const codes = [...table.matchAll(/^\| (\d+) \|/gm)].map((m) => Number(m[1])).sort((a, b) => a - b);
  assert.deepEqual(codes, Object.values(EXIT).sort((a, b) => a - b));
  assert.match(table, /\| 1 \| App failures/);
  assert.match(table, /\| 3 \| Could not verify/);
  assert.match(table, /\| 4 \| Blocked by a gate/);
});

test("every .greenlight path in the Skill is one the implementation uses", () => {
  const known = [
    ".greenlight/tests/", ".greenlight/approval.json", ".greenlight/reports/latest.md", ".greenlight/reports/latest.json",
    ".greenlight/runs/", ".greenlight/state.json", ".greenlight/.gitignore", ".greenlight/recordings.json",
  ];
  const paths = new Set([...ALL.matchAll(/\.greenlight\/[A-Za-z0-9_.*<>/-]*/g)].map((m) => m[0].replace(/[.,]$/, "")));
  for (const p of paths) assert.ok(known.some((k) => p === k || p.startsWith(k) || k.startsWith(p)), `unknown path ${p}`);
  // Committed vs local files agree with the .gitignore Greenlight writes.
  for (const local of ["state.json", "runs/", "reports/", "tests/output-*/"]) assert.ok(GITIGNORE_CONTENT.includes(local), local);
  for (const committed of ["approval.json", "greenlight.yaml"]) assert.equal(GITIGNORE_CONTENT.includes(committed), false);
});

test("approval rules in the Skill match the gate", () => {
  for (const marker of ["CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "AI_AGENT"]) {
    assert.ok(SKILL.includes(`\`${marker}\``), marker);
    assert.deepEqual(detectAgentEnvironment({ [marker]: "1" }), [marker]);
  }
});

// ---------------------------------------------------------------- Stop hook consistency

test("every Stop hook message the Skill quotes is one the hook actually prints", () => {
  const quoted = [
    "Greenlight needs your changes committed and pushed",
    "must be pushed first",
    "Greenlight verification FAILED for commit",
    "automatic fix attempt",
    "Greenlight verified commit",
    "Greenlight could not",
    "Greenlight cannot verify",
    "Greenlight already verified commit",
    "still fails after",
    "greenlight-stop-hook reset",
  ];
  for (const q of quoted) {
    assert.ok(SKILL.includes(q) || EXAMPLES.includes(q), `Skill does not mention: ${q}`);
    assert.ok(SRC.hook.includes(q.replace("Greenlight verified commit", "Greenlight verified commit ${short(head)}").split("${")[0]), `hook does not print: ${q}`);
  }
});

test("the three-attempt limit, skipped paths and hook exit semantics agree", () => {
  assert.equal(MAX_FIX_ATTEMPTS, 3);
  assert.match(SKILL, /\*\*three automatic fix attempts\*\* per failure streak/);
  assert.match(SKILL, /automatic fix attempt n of 3/);
  assert.match(EXAMPLES, /still fails after 3 automatic fix attempts/);
  for (const p of [".greenlight/", ".claude/", ".testmuai/"]) {
    assert.ok(SKILL.includes(`\`${p}\``), p);
    assert.equal(isRelevantPath(`${p}x`), false, p);
  }
  assert.deepEqual(HOOK_EXIT, { ALLOW: 0, BLOCKER: 1, BLOCK: 2 });
  assert.match(SKILL, /you are blocked from finishing/, "exit 2 blocks Claude");
  assert.match(SKILL, /shown to the user and do not block you/, "exit 1 does not");
  assert.match(SKILL, /non-interactively, so it can never approve tests or confirm credit spending/);
});

// ---------------------------------------------------------------- examples are real output

test("the sample spec in the reference parses and generates", () => {
  const yaml = /```yaml\n([\s\S]*?)```/.exec(YAML_REF)[1];
  const spec = parseSpec(yaml);
  assert.equal(spec.tests[0].id, "cart-add-two");
  const [file] = renderAll(spec);
  assert.ok(file.content.includes('Verify the page shows the exact text "Items in cart: 2".'));
  assert.ok(YAML_REF.includes('`Verify the page shows the exact text "Items in cart: 2".`'));
  assert.ok(file.content.includes("tags: [clm-001]"));
});

test("the application-failure example matches what the report renderer prints", async () => {
  const spec = parseSpec(read("test/fixtures/spec/smoke/greenlight.yaml"));
  const rendered = renderAll(spec);
  const run = fabricatedRun({
    members: [{ file: "newsletter-subscribe_test.md", tags: ["clm-002"], status: "failed", message: 'Final verification failed: "the page shows the message "Thanks for subscribing, smoke@example.com!""' }],
    exitCode: 1,
  });
  run.stream.members[0].final.failure.step_index = 3;
  const approved = { tests: toApprovedTests(rendered).tests.filter((t) => t.file === "newsletter-subscribe_test.md") };
  const md = renderMarkdown(await buildFailureReport({ evaluation: evaluateRun(run, approved), catalog: catalogFromSpec(spec), now: () => new Date("2026-11-19T12:00:00Z") }));
  for (const line of [
    "# Greenlight: verification failed",
    "Project: **failed**. 1 app failure(s), 0 could not be verified.",
    "## App failures: fix the application code",
    "### CLM-002 Users can subscribe to the newsletter.",
    "- Test: `newsletter-subscribe_test.md` (Subscribe to the newsletter)",
    '- Failed step 3 "Check the confirmation": page must show the exact text "Thanks for subscribing, smoke@example.com!"',
    '- Kane: Final verification failed: "the page shows the message "Thanks for subscribing, smoke@example.com!""',
  ]) {
    assert.ok(md.includes(line), `renderer does not print: ${line}`);
    assert.ok(EXAMPLES.includes(line), `example does not show: ${line}`);
  }
  assert.ok(SRC.report.includes("Kane's AI diagnosis (context only, not authoritative)"));
  assert.ok(SKILL.includes("Kane's AI diagnosis (context only, not authoritative)"));
  assert.ok(SKILL.includes("## Could not verify: not a code failure; do not change application code for these"));
  assert.ok(SRC.report.includes("## Could not verify: not a code failure; do not change application code for these"));
});

test("the passing and could-not-verify examples use the CLI's real messages", () => {
  for (const s of ["Approved tests:", "Checking deployment ", "Deployment ready: commit ", "Credits: estimate ", "fresh recording(s)", "known failing step(s)); balance ", "Running Kane (run ", "Evidence: ", "Credits: ", "Verified: all ", " claim(s) passed."]) {
    assert.ok(EXAMPLES.includes(s), `passing example lacks: ${s}`);
    assert.ok(SRC.cli.includes(s), `CLI does not print: ${s}`);
  }
  for (const s of ["Credits: actual ", " (balance ", "Kane-reported ", "(lower bound)", "unaccounted by Kane ", "estimate "]) {
    assert.ok(EXAMPLES.includes(s), `passing example lacks credit text: ${s}`);
    assert.ok(SRC.report.includes(s.replace("Credits: ", "")), `report renderer does not print: ${s}`);
  }
  for (const s of ["Deployment not ready: ", "Kane was not run.", "live commit ", "Credit check refused the run: ", "Confirmation needed for fresh recording", "Tests are not approved ("]) {
    assert.ok(EXAMPLES.includes(s), `blocker example lacks: ${s}`);
    assert.ok(SRC.cli.includes(s), `CLI does not print: ${s}`);
  }
  assert.ok(SRC.hook.includes("This is not an application failure; do not change code for it."));
  assert.ok(EXAMPLES.includes("This is not an application failure; do not change code for it."));
  assert.match(EXAMPLES, /## 1\. Passing/);
  assert.match(EXAMPLES, /## 2\. Application failure/);
  assert.match(EXAMPLES, /## 3\. Could not verify/);
});

// ---------------------------------------------------------------- required behaviour

test("the Skill states every required rule", () => {
  const rules = [
    /existing repository/,
    /Never clone, copy or recreate the project elsewhere/,
    /\*\*Never approve tests\.\*\*/,
    /\*\*Never weaken approved tests\.\*\*/,
    /\*\*Never bypass the gates\.\*\*/,
    /\*\*Never run Kane yourself\.\*\*/,
    /\*\*Never publish certification\.\*\*/,
    /\*\*Never claim success without a Greenlight pass\.\*\*/,
    /propose the exact change for a person to approve/,
    /Do \*\*not\*\* run verification after every small edit/,
    /commit, and \*\*push\*\*/,
    /not authoritative/,
  ];
  for (const re of rules) assert.match(SKILL, re);
});

test("Kane, approval bypasses and publishing appear only as prohibitions", () => {
  for (const line of ALL.split("\n")) {
    if (/kane-cli/.test(line)) assert.match(line, /\b(never|not|don't|do not)\b/i, `kane-cli outside a prohibition: ${line}`);
    if (/publish/i.test(line)) assert.match(line, /\b(never|not|no|nothing)\b/i, `publish outside a prohibition: ${line}`);
    assert.equal(/unset CLAUDECODE|CLAUDECODE=0|script -q|--yes\b/.test(line), false, `bypass suggested: ${line}`);
  }
  assert.equal(/`greenlight publish`/.test(ALL), false);
  assert.equal(/approval\.json`?\s*(?:edit|write)/i.test(ALL), false);
});
