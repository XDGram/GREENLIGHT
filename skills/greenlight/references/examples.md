# Worked examples

## 1. Passing

You fixed the cart count, committed and pushed. You finish your turn; the Stop hook verifies:

```
Greenlight verified commit 3f2a9c1d0b7e: every approved claim passed.
```

Or, when the user asked you to run it:

```
$ greenlight verify
Approved tests: 3 (hash 07bc6327dd53…)
Checking deployment https://my-app.vercel.app/ …
Deployment ready: commit 3f2a9c1d0b7e (preview)
Credits: estimate 0.6 (0 fresh recording(s), 0 known failing step(s)); balance 11076.5779; cap 60; reserve 500
Running Kane (run gl-20261119T120000-3f2a9c1d) …
Evidence: stored (sha256 2c2f2beace4dd01d…)
Credits: actual 0.4 (balance 11076.5779 -> 11076.1779) · Kane-reported 0.39 (lower bound) · unaccounted by Kane 0.01 · estimate 0.6 — consistent
  passed         CLM-001
  passed         CLM-002
  passed         CLM-003
Verified: all 3 claim(s) passed.
```

Exit code `0`. Only now may you tell the user the claims are verified, for that commit.

## 2. Application failure

The Stop hook blocks you from finishing:

```
Greenlight verification FAILED for commit 3f2a9c1d0b7e (automatic fix attempt 1 of 3).

# Greenlight: verification failed
run gl-20261119T120000-3f2a9c1d · commit 3f2a9c1d0b7e · https://my-app.vercel.app/ · 2026-11-19T12:00:00.000Z

Project: **failed**. 1 app failure(s), 0 could not be verified.

## App failures: fix the application code

### CLM-002 Users can subscribe to the newsletter.
- Test: `newsletter-subscribe_test.md` (Subscribe to the newsletter)
- Failed step 3 "Check the confirmation": page must show the exact text "Thanks for subscribing, smoke@example.com!"
- Kane: Final verification failed: "the page shows the message "Thanks for subscribing, smoke@example.com!""
- Page: https://my-app.vercel.app/
- Kane's AI diagnosis (context only, not authoritative): Agent misread newsletter failure as subscription confirmation
```

What to do:
- The requirement is the expected text, "Thanks for subscribing, smoke@example.com!". The AI diagnosis blaming the agent is not authoritative; this is an app failure.
- Find the subscribe handler. In the sample app it always shows "Subscription failed. Please try again later." because of a hard-coded `SUBSCRIBE_BROKEN = true`.
- Fix the application, commit `Fix newsletter subscribe confirmation (CLM-002)`, push, finish.

What not to do: change `expect_text`, edit `.greenlight/tests/newsletter-subscribe_test.md`, or make the page print the text only for `smoke@example.com`.

## 3. Could not verify

```
Greenlight could not verify the deployment for commit 3f2a9c1d0b7e. This is not an application failure; do not change code for it.
Deployment not ready: stale_deployment (commit_mismatch, timed_out). Kane was not run.
  live commit 8f315c8a4da5, expected 3f2a9c1d0b7e
```

The deployed site still serves an older commit, so nothing was tested. Do not change code. Tell the user the deployment for the pushed commit did not go live in time (check the hosting dashboard). Do not re-run in a loop; the hook will not re-run this commit, and a person can run `greenlight verify` again once it is deployed.

Other blockers that are never code failures:
- `Deployment not ready: couldnt_verify (redirected_possibly_protected)`: the preview is behind a login wall.
- `Credit check refused the run: exceeds_per_run_cap`: a person decides whether to raise `--max-credits`.
- `Confirmation needed for fresh recording … (agent_or_ci_environment)`: the user runs `greenlight verify` in their own terminal.
- `Tests are not approved (invalidated: …)`: a person reviews the tests and runs `greenlight approve`.

## 4. Three attempts used

```
Greenlight: commit 9a8b7c6d5e4f still fails after 3 automatic fix attempts. Stopping the loop; a person needs to review .greenlight/reports/latest.md.
```

Stop fixing. Summarise what you changed in each attempt, what the latest report says, and what you think the cause is. Ask the user to review and, if they want the loop back, run `greenlight-stop-hook reset`.

## 5. A test looks wrong

The page correctly says "Items in your cart: 2" after a deliberate copy change, but the approved test expects `Items in cart: 2`.

Do not edit the spec or the generated test. Tell the user:

> CLM-001's test `cart-add-two` expects the exact text "Items in cart: 2", but the product copy now reads "Items in your cart: 2" (changed in commit 1a2b3c4). If the new copy is intended, change that `expect_text` in greenlight.yaml to "Items in your cart: 2", run `greenlight generate`, review the test and run `greenlight approve` yourself.
