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

---

## 8. CLOSED-LOOP AGENT INTEGRATION

This is a critical part of Greenlight.

The integration must work without developers manually copying failure reports between applications.

Expected sequence:

1. Claude develops the application.
2. Claude attempts to finish.
3. Stop Hook checks Git state.
4. If verification is required, Greenlight initiates the process.
5. Changes are pushed and deployed.
6. Greenlight verifies the deployed commit.
7. Kane executes the approved tests.
8. Kane identifies an application failure.
9. Greenlight returns the structured report through the Stop Hook.
10. Claude investigates the source code.
11. Claude implements a correction.
12. Claude commits and pushes the correction.
13. Greenlight waits for deployment.
14. Kane verifies the failed claims again.

The process repeats until:
- All relevant tests pass.
- Three fix attempts have been exhausted.
- A human intervention is required.

**Maximum automatic fix attempts: THREE.**

The hook must track attempts and avoid repeatedly triggering the same verification without relevant code changes.

---

## 9. VERIFICATION STATES

Support the following claim-level statuses:

- `passed`
- `failed`
- `partial`
- `couldnt_verify`

Definitions:

**PASSED:** All tests associated with a claim passed.

**FAILED:** The claim's verification tests failed.

**PARTIAL:** Some tests associated with a claim passed while others failed.

**COULDNT_VERIFY:** The claim could not be reliably tested because of authentication, infrastructure, timeout or another external limitation.

Overall project status should be calculated from the individual claim results.

Do not describe an unverified claim as passed.

---

## 10. EVIDENCE STORAGE

Each Kane execution should produce an evidence package.

Where available, capture:
- Screenshots for individual steps.
- Annotated screenshots.
- Browser console logs.
- Network logs.
- Execution notes.
- Failed-step records.
- Test results.

Greenlight must store its own evidence.

Do not assume Kane's internal run links are publicly accessible.

Generate cryptographic hashes for:
- Approved test configuration.
- Evidence package.
- Final verification record.

These hashes should be associated with the published certification.

---

## 11. FINAL CERTIFICATION

The developer initiates publishing through:

`greenlight publish`

This triggers a fresh server-side verification.

The certification process must:

1. Retrieve the approved test configuration.
2. Validate its hash.
3. Confirm the target application's deployed commit.
4. Execute the full approved test suite through Kane.
5. Collect the raw execution output.
6. Store the evidence package.
7. Generate evidence hashes.
8. Calculate the final verification status.
9. Create a permanent verification record.
10. Return the public verification URL.

Only a successful server-side execution can produce a Greenlight certification.

Developer-side iteration reports must never be treated as public certification.

For final certification, run the tests fresh without relying on cached execution results.

---

## 12. PUBLIC VERIFICATION API

The backend must support permanent public verification records.

Every published run receives a unique identifier.

A verification record should contain:
- Project information.
- Application URL.
- Git commit.
- Approved requirements.
- Test configuration hash.
- Individual claim results.
- Overall verification status.
- Execution timestamps.
- Kane execution metadata.
- Evidence references.
- Evidence package hash.
- Certification timestamp.

Each subsequent certification creates a separate record.

Previous verification records must remain accessible.

Each run should have its own permanent public URL.

A failed run must remain a historical record of what happened at that particular time. It must not imply that the application is permanently broken.

---

## 13. BACKEND INFRASTRUCTURE REQUIREMENTS

Kane requires a browser execution environment.

The execution service must run in a container or dedicated server with Chrome available.

Do not rely on standard serverless functions such as Vercel Functions for long-running browser execution.

The architecture should support:
- Background execution jobs.
- Execution timeouts.
- Job status tracking.
- Concurrent job limits.
- Secure credential handling.
- Evidence uploads.
- Persistent storage.
- API authentication.
- Rate limiting.
- Retry management.
- Execution logs.

Kane execution credits must be tracked.

Public users must not be able to trigger unlimited executions.

---

## 14. BUILD PRIORITIES

Implement in this order.

### PHASE 1: CORE LOOP

1. Greenlight CLI.
2. Kane subprocess integration.
3. Structured execution results.
4. Failure report generation.
5. Claude Code Skill.
6. Claude Code Stop Hook.
7. Git-based change detection.
8. Deployment verification.
9. Automatic failure feedback.
10. Re-verification after code changes.

### PHASE 2: CERTIFICATION

1. Server-side Kane runner.
2. Approved test hash validation.
3. Evidence storage.
4. Cryptographic integrity checks.
5. Certification workflow.
6. Permanent public verification records.

### PHASE 3: PLATFORM

1. Project submission API.
2. AI requirement analysis.
3. Test generation.
4. Human approval workflow.
5. Project and verification management APIs.

**Frontend implementation is outside the scope of this brief.**

---

## 15. IMPLEMENTATION REQUIREMENTS

Before implementing each major component:

- Inspect Kane CLI's actual commands and output formats.
- Verify the Claude Code Skill and Stop Hook interfaces.
- Confirm the available evidence formats.
- Test subprocess behaviour.
- Validate exit-code handling.
- Identify deployment-provider requirements.

Do not invent Kane capabilities or assume undocumented behaviour.

Use actual tool documentation and working integration tests.

Keep the components modular so the CLI, agent integration, backend and certification service can be tested independently.

Do not introduce MCP in this implementation.

Do not implement automatic repository cloning or direct repository modification by Greenlight.

Claude operates on the developer's existing project and repository.

---

## 16. DEFINITION OF DONE

The backend is not complete until this entire scenario works:

1. A developer initializes Greenlight.
2. Greenlight generates tests from project requirements.
3. The developer approves the tests.
4. Claude builds an application.
5. Claude commits and pushes its changes.
6. Greenlight waits for deployment.
7. Kane tests the deployed application.
8. Kane identifies a deliberately broken feature.
9. The Stop Hook returns the failure report to Claude.
10. Claude fixes the source code.
11. Claude pushes the correction.
12. Greenlight waits for the updated deployment.
13. Kane verifies the correction.
14. All approved claims pass.
15. `greenlight publish` triggers fresh server-side certification.
16. Greenlight creates a permanent verification record with supporting evidence.

The central acceptance criterion is a genuinely working, automated agent-verification-fix-reverification loop.

A collection of disconnected components is not sufficient.

The complete workflow must work end to end.

---

# END OF PROJECT BRIEF
