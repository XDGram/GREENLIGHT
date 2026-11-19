# GREENLIGHT
## Backend Implementation Brief
### Kane CLI Hackathon

## 1. PROJECT OVERVIEW

Greenlight is an AI-powered application verification platform that helps developers prove their applications actually fulfil their stated requirements.

Developers provide their application URL and project requirements. Greenlight analyses those requirements, generates verification tests, and uses Kane CLI to test the actual application.

When Kane identifies a failure, Greenlight communicates the structured failure report to the developer's AI coding agent through a Claude Code Skill and Stop Hook.

Claude investigates the failure, modifies the source code, commits and pushes the changes. Greenlight waits for the new deployment and runs verification again.

Once verification succeeds, Greenlight can publish an independently executed, permanent public verification report.

**Core workflow:**

BUILD → VERIFY → DETECT → FIX → RE-VERIFY → CERTIFY

The central product principle:

Don't just tell judges what you built. Prove that it works.

---

## 2. CORE ARCHITECTURE

Greenlight consists of five technical components.

### A. Greenlight Backend

Responsible for:
- Project management.
- Requirements storage.
- AI requirement analysis.
- Test generation.
- Test approval and version management.
- Verification orchestration.
- Kane execution management.
- Agent integration.
- Deployment monitoring.
- Evidence storage.
- Public certification.
- Verification history.

### B. Greenlight CLI

The developer-facing interface and primary entry point.

It must support:
- Project initialization.
- Requirements processing.
- Test generation.
- Test approval workflows.
- Verification execution.
- Kane CLI integration.
- Result collection.
- Failure report generation.
- Verification state management.
- Publishing.

The CLI should communicate with the Greenlight backend through a defined API.

It should also maintain the project's local verification state.

### C. Claude Code Skill

The skill teaches Claude how to interact with Greenlight.

It should explain:
- When verification is required.
- How to initialize Greenlight.
- How to generate tests.
- How human approval works.
- How to execute verification.
- How to interpret Kane results.
- How to investigate failures.
- How to propose test modifications.
- How to publish final certification.

Claude can propose tests and modifications but cannot approve them.

### D. Claude Code Stop Hook

The Stop Hook enforces the verification workflow.

When Claude attempts to finish its work:

1. Check whether relevant code has changed.
2. Check the last verified Git commit.
3. Skip verification if nothing has changed and the working tree is clean.
4. Otherwise, initiate verification against the deployed application.
5. Wait for the corresponding deployment.
6. Execute Kane.
7. Interpret the exit code.
8. Return failures directly to Claude.

Exit code 2 from the Stop Hook should return the failure report to Claude and prevent it from finishing.

The full report must also be saved to a file that Claude can read.

The hook must avoid unnecessary repeated executions.

### E. Kane CLI

Kane is the actual browser testing engine.

Greenlight must invoke Kane as a subprocess and capture its structured output.

Kane is responsible for:
- Browser interactions.
- Executing test scenarios.
- Checking expected behaviour.
- Capturing screenshots.
- Recording execution evidence.
- Returning execution results.

Greenlight must not fabricate test results or replace Kane's execution verdicts with AI-generated judgments.

---

## 3. REQUIREMENT ANALYSIS

A developer provides:
- Project name.
- Project description.
- Live application URL.
- Project requirements.
- Specific features to verify.
- Optional test credentials.

The Greenlight AI agent analyses the requirements and identifies individual functional claims.

Each claim should receive a unique identifier.

Example:

**Claim:**

Users can connect their wallets, deposit funds and withdraw their balances.

Generated verification scenarios:

1. Wallet connection.
2. Deposit functionality.
3. Balance updates.
4. Withdrawal functionality.

The AI should convert these into structured tests that Kane can execute.

The generated tests must be reviewed and approved by the human developer before execution.

---

## 4. TEST APPROVAL AND INTEGRITY

Tests must be stored in:

`greenlight.yaml`

The file contains:
- Project configuration.
- Application URL.
- Requirements.
- Claim identifiers.
- Approved test scenarios.
- Expected behaviour.
- Test configuration version.

After human approval:

1. Generate a cryptographic hash of the approved configuration.
2. Store the approved hash on the Greenlight server.
3. Associate the hash with the project and test version.

Claude must never silently modify approved tests.

If Claude identifies a problem with a test, it may propose a modification.

The developer must approve the modification.

Approval creates a new test version and hash.

**Important:**

Local file protection is not sufficient.

The Greenlight server is the ultimate authority. It must reject certification if the submitted test configuration does not match the approved version and hash.

---

## 5. LIVE URL VERIFICATION

All iteration and certification runs must target a deployed application URL.

**No localhost verification.**

The developer's coding agent must commit and push changes before Greenlight starts a new verification cycle.

Greenlight must:

1. Identify the expected Git commit.
2. Confirm that the commit was pushed.
3. Wait for deployment completion.
4. Check the application's deployment metadata.
5. Confirm that the deployed commit matches the expected commit.
6. Only then initiate Kane.

The application should expose a deployment metadata endpoint:

`/greenlight.json`

Example:

```json
{
  "commit": "EXPECTED_GIT_COMMIT",
  "environment": "preview"
}
```

---

## 6. KANE EXECUTION AND RESULT HANDLING

Invoke Kane CLI as a subprocess.

Capture:
- Standard output.
- Standard error.
- Exit code.
- Execution duration.
- Structured test results.
- Evidence file references.

Kane exit codes:

| Exit code | Meaning | Greenlight classification |
|---|---|---|
| 0 | Passed | passed |
| 1 | Executed but failed | app_failure |
| 2 | Execution or infrastructure error | couldnt_verify |
| 3 | Timeout or cancellation | couldnt_verify |

These mappings must remain authoritative.

Do not use an LLM to decide whether Kane passed or failed.

For infrastructure failures:
- Retry once.
- If the retry also fails, classify as `couldnt_verify`.
- Do not send infrastructure failures into the automatic code-fixing loop.

---

## 7. FAILURE REPORTING

When Kane identifies an application failure, Greenlight generates a compact structured report.

Each failure should contain:
- Claim ID.
- Original claim.
- Failed test step.
- Expected behaviour.
- Actual observed behaviour.
- Kane's execution notes.
- Screenshot path.
- Failure category.

Example:

```json
{
  "claim_id": "CLM-002",
  "claim": "Users can withdraw their balance",
  "status": "failed",
  "category": "app_failure",
  "failed_step": "Submit withdrawal",
  "expected": "Withdrawal completes successfully",
  "actual": "Transaction rejected",
  "evidence": {
    "screenshot": "evidence/CLM-002.png"
  }
}
```
