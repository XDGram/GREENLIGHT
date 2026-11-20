---
name: greenlight
description: Verify that the deployed app really does what its approved requirements claim, using the Greenlight CLI (which drives Kane CLI browser tests). Use when the project has a greenlight.yaml, when the user asks to verify, check or prove a feature against requirements, when a Greenlight Stop hook message or .greenlight/reports/latest.md reports a failure, or before saying a feature works. Covers reading greenlight.yaml, generating tests, human approval, running greenlight verify, reading failure reports, fixing application failures, and the three-attempt fix limit.
---

# Greenlight

Greenlight proves a **deployed** application meets its **approved** claims. A person approves the tests; Kane runs them in a real browser against the live URL; Greenlight classifies the results and writes a failure report. Your job is to fix the application until the approved claims pass, without ever changing what "pass" means.

Work only in the developer's existing repository, in the current working directory. Never clone, copy or recreate the project elsewhere.

## Non-negotiable rules

1. **Never approve tests.** `greenlight approve` is for a person at their own terminal; it refuses AI agents (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `AI_AGENT`), CI and non-interactive shells. Do not edit `.greenlight/approval.json`, set or unset those variables, or fake a terminal to get around it. The only exception is relayed mode for controlled tests (below), and only when the user gives you the full hash in chat.
2. **Never weaken approved tests.** Do not edit `greenlight.yaml` claims or tests, `.greenlight/tests/*_test.md`, or `.greenlight/approval.json` to make something pass. Any edit invalidates the approval anyway (`greenlight status` shows `invalidated`). If a test looks wrong, explain why and propose the exact change for a person to approve.
3. **Never bypass the gates.** Approval, deployment readiness and credit limits are enforced by `greenlight verify`. Do not work around them, raise `--max-credits`/`--reserve` on your own, or answer the credit confirmation (it needs a person typing `yes` at a terminal).
4. **Never run Kane yourself.** Do not call `kane-cli` directly for checks Greenlight owns; it would skip the gates, spend credits and produce results nobody approved. Greenlight orchestrates Kane.
5. **Never publish or certify.** Certification is a fresh run on the Greenlight server, started by a person with `greenlight publish` (it refuses AI agents and CI) after they approved the tests on the server. Never run it, never use or ask for an owner API token, and never present a local run, report or relayed approval as a certification: they can never become one.
6. **Never claim success without a Greenlight pass.** Say a claim is verified only after `greenlight verify` exits `0` ("Verified: all N claim(s) passed.") or the Stop hook reports "Greenlight verified commit …". Local runs, unit tests or your own reading of the code are not verification.

## When to use Greenlight

- The repository has a `greenlight.yaml`, and you changed application behaviour covered by its claims.
- The user asks you to verify, check or prove that the app meets its requirements.
- A Greenlight Stop hook message or `.greenlight/reports/latest.md` reports a failure.

Do **not** run verification after every small edit. Each run waits for a deployment and can spend Kane credits. Finish a coherent change, commit, push, then verify once. The Stop hook already verifies new commits when you finish; usually you do not need to run `greenlight verify` yourself at all.

## The files

| Path | What it is | You may |
|---|---|---|
| `greenlight.yaml` | Project, live URL, claims (`CLM-001`…) and tests | read; propose changes only |
| `.greenlight/tests/<test-id>_test.md` | Kane tests generated from the spec | read only |
| `.greenlight/approval.json` | The person's approval of those exact tests | read only |
| `.greenlight/reports/latest.md` | Concise failure report from the last failing run | read |
| `.greenlight/reports/latest.json` | Same report as structured JSON | read |
| `.greenlight/runs/<run-id>/` | Private evidence: Kane output, evidence pack, manifest | read; never share or publish |
| `.greenlight/state.json` | Stop hook state: commits, results, fix attempts | read only |

`.greenlight/.gitignore` keeps local files (state, reports, runs, Kane recordings) out of git. `greenlight.yaml`, `.greenlight/approval.json` and `.greenlight/tests/*_test.md` are committed.

Details of the spec format: [references/greenlight-yaml.md](references/greenlight-yaml.md).

## Commands

| Command | Use |
|---|---|
| `greenlight init` | Create a starter `greenlight.yaml` (never overwrites) |
| `greenlight generate` | Validate the spec, write the tests, print the specification hash. Never approves. |
| `greenlight approve` | **A person only.** Do not run it; tell the user to run it in their own terminal. |
| `greenlight status` | Spec validity, approval, hash integrity, generated tests, recording cache |
| `greenlight verify` | Gates, then Kane against the live URL, then classification and the report |
| `greenlight runs` | Run history from `.greenlight/runs/`, with each record's integrity re-checked |
| `greenlight check-run <run-id>` | Re-check one run record and its files against their hashes |
| `greenlight submit` | Proposes `greenlight.yaml` as a server test version (needs `GREENLIGHT_API_URL` and an agent token in `GREENLIGHT_API_TOKEN`); records the project and version in `.greenlight/server.json`. Run it after the tests are final, then tell the user to approve on the server. |
| `greenlight server-approve` | **A person only.** Approves the submitted version on the server (owner token, full hash typed back). Tell the user to run it. |
| `greenlight publish` | **A person only.** Asks the Greenlight server for a fresh certification run. Tell the user to run it. |

Every command accepts `--json`: stdout is then one `greenlight.cli-result/v1` document (`ok`, `exitCode`, `error.code`, `error.action`, `data`) and the human-readable lines go to stderr. Branch on `error.code`, not on message text.

`greenlight verify` options: `--url <url>` (live URL; default `project.url`), `--environment <name>`, `--max-credits <n>`, `--reserve <n>`, `--kane <path>`, `--kane-timeout-minutes <n>`, `--deploy-timeout-seconds <n>`, `--deploy-interval-seconds <n>`, `--confirm-spend <n>` (relayed mode only), `--estimate-margin <n>` (multiplies the credit estimate; 1 or more, so it can only make it more conservative). Do not change the credit options unless the user asks.

### Exit codes of `greenlight verify`

| Code | Meaning | What you do |
|---|---|---|
| 0 | Every approved claim passed | Report success |
| 1 | App failures | Read the report and fix the application |
| 2 | Usage error | Fix the command |
| 3 | Could not verify (deployment, Kane or infrastructure) | Do not change code; report the blocker |
| 4 | Blocked by a gate (spec invalid, not approved, credit limits, confirmation needed, recording cache changed, another verification already running) | Tell the user what a person must do |
| 130 | Interrupted | Re-run later if needed |

## Workflow

1. **Read** `greenlight.yaml` and run `greenlight status`. Know which claims your change touches.
2. **If the spec or tests need to change**, propose the edit to the user. After they edit it, `greenlight generate` regenerates the tests; the user reviews `.greenlight/tests/` and runs `greenlight approve` themselves.
3. **Change the application**, commit, and **push**. Greenlight tests the deployed app at the pushed commit: it refuses dirty working trees and unpushed commits, and waits until `<live URL>/greenlight.json` reports exactly `git rev-parse HEAD`.
4. **Finish your turn.** The Stop hook verifies the new commit. Or run `greenlight verify` when the user asks.
5. **Act on the result** (below).

## Reading a failure report

`.greenlight/reports/latest.md` has two kinds of entry, and they need opposite responses:

- **`## App failures: fix the application code`**: a test ran and the app did not meet the claim. Each entry gives the claim, the test, the failed step with the **expected** result from the approved spec (for example `page must show the exact text "…"`), Kane's message, the page URL and a screenshot reference inside the evidence pack.
- **`## Could not verify: not a code failure; do not change application code for these`**: the result cannot be trusted (deployment not ready, Kane error, timeout, broken run). Do not touch the code for these. Report the reason to the user. `greenlight verify` already retried an infrastructure failure once (within the same credit limits), so do not re-run it yourself.

Classification comes only from Kane's test results and the approved tests. A line starting "Kane's AI diagnosis (context only, not authoritative)" is a hint, not a verdict: it has called real app bugs "agent mistakes" before. Never dismiss an app failure because of it.

## Fixing an application failure

1. Read the failed step's expected result: it is the requirement, exactly as approved.
2. Reproduce the path in the code: find what renders that page and that text.
3. Fix the application so the page shows the expected result for the described actions. Do not special-case the test (no checks for test emails, user agents or test hostnames).
4. Commit with a message naming the claim (e.g. `Fix newsletter subscribe confirmation (CLM-002)`) and push.
5. Finish; the Stop hook verifies the new commit.

If you believe the test, not the app, is wrong, stop and tell the user: quote the claim, the step, and why. Propose the exact `greenlight.yaml` change. Do not apply it.

## The Stop hook

`greenlight-stop-hook` runs when you try to finish:

- **"Greenlight needs your changes committed and pushed …"** or **"… must be pushed first"**: commit and push, then finish again. It asks only once per commit.
- **"Greenlight verification FAILED for commit … (automatic fix attempt n of 3)"**: you are blocked from finishing; the report follows. Fix the application as above, commit, push, finish.
- **"Greenlight verified commit …"**: done; the claims passed for that commit.
- Messages starting **"Greenlight could not …"**, **"Greenlight cannot verify …"** or **"Greenlight already verified commit …"** are shown to the user and do not block you. They are not application failures: do not change code for them.
- **"Greenlight: .greenlight/state.json is unreadable …"**: automatic verification is stopped until a person resets it. Never delete or edit `state.json` or `.greenlight/runs/`: the attempt count is also rebuilt from the run records, so it would not help, and it destroys history.

The hook never re-runs a commit that already has a result, skips commits that change only `.greenlight/`, `.claude/` or `.testmuai/` files, runs one verification at a time, and calls `greenlight verify` non-interactively, so it can never approve tests or confirm credit spending.

## Three attempts, then a person

You get **three automatic fix attempts** per failure streak. After the third failed fix, the hook stops blocking and says "Greenlight: commit … still fails after 3 automatic fix attempts". From then on it does not verify until a person reviews `.greenlight/reports/latest.md` and runs `greenlight-stop-hook reset`. When that happens, stop trying fixes. Summarise for the user what you tried, what the report shows, and your best explanation.

The counter resets after a fully passing verification or when a person approves changed tests.

## Relayed mode (controlled tests only)

For a controlled test in an environment with no terminal, a person can approve in chat and you record it:

- Only when the user explicitly asks for relayed approval and gives you the **full 64-character** approved-test hash that `greenlight generate` printed. Never use a hash you computed or chose yourself.
- Only with `GREENLIGHT_RELAYED_APPROVAL=1`: `greenlight approve --relayed <hash>`. The record is `method: relayed-by-agent`, `certifiable: false`.
- Every `greenlight verify` on relayed tests needs `--confirm-spend <n>`, where `n` is the credit limit the user approved **for that run**. Never reuse an earlier figure or raise it yourself. Through the Stop hook, set `GREENLIGHT_CONFIRM_SPEND` for that one invocation only.
- A relayed approval can never be used for certification or publishing.

## First runs and credits

**With Kane 0.10.6, every run authors every test afresh.** Greenlight always runs Kane in local-only mode (no Test Manager uploads), and in that mode Kane keeps no replayable recording, so there is nothing to replay next time. Each `greenlight verify` therefore needs a person's spend confirmation (or, in relayed mode, `--confirm-spend`); in a normal session the Stop hook cannot run the fix loop unattended and reports exit `4` ("Confirmation needed for fresh recording …"). Tell the user to run `greenlight verify` in their own terminal.

Tests that have never been recorded cost far more than replays: Greenlight budgets 37 credits per authored test of up to 3 steps, 12.5 per extra step, and 20 once per authoring run (real authoring runs cost 76.64 for two tests and 109.12 for three). A test counts as recorded only when Kane left a replayable `.internal/execution.json`. `greenlight verify` asks a person to type `yes` before recording tests afresh, so in your shell it stops with exit `4` ("Confirmation needed for fresh recording …"). Tell the user to run `greenlight verify` in their own terminal for that first run. Never try to answer the prompt.

If the report or the Stop hook shows `recording_not_retained`, Kane authored those tests but kept no replayable recording (Kane 0.10.6 does this in its local-only mode, which Greenlight always uses). The next run will author them afresh and cost fresh-authoring credits again. Tell the user before anything else runs. Do not turn off local-only mode, enable Test Manager uploads or run Kane yourself to "fix" it.

Every run's `latest.json` and run manifest record `credits`: `balanceBefore`, `balanceAfter`, `actualSpend` (the balance difference, or `null` if a balance could not be read, never an estimate), `kaneReportedSpend` (Kane's logs, a lower bound), `discrepancy` (spend Kane's logs do not account for) and `estimate`. Report `actualSpend` to the user, not the estimate.

Worked examples (pass, app failure, could not verify): [references/examples.md](references/examples.md).
