---
description: Check this app with Greenlight (Kane CLI tests it in a real browser), fix the claims that fail, push, and re-check until Kane passes them.
argument-hint: "[check id, optional]"
allowed-tools: Bash(curl:*), Bash(git:*), Bash(sleep:*), Read, Edit, Grep, Glob
---

# /greenlight: fix what Kane says is broken, then let Kane confirm it

Greenlight checks a deployed app against its claims (for example the bullet points of its README).
Kane CLI tests each claim on the live app in a real browser and says **passed** or **failed**, with
a note on what it saw. Your job: read Kane's verdict, fix the code for every failed claim, push,
wait for the new deploy, and ask Greenlight to re-check. Repeat until Kane passes every claim.

## Setup (from the environment)

- `GREENLIGHT_TOKEN`: required. The token from "Connect Claude Code" on the Greenlight result page.
  Never print it, echo it, write it to a file or commit it.
- `GREENLIGHT_URL`: the Greenlight server, default `https://greenlight-api-xi.vercel.app`.
- `GREENLIGHT_CHECK`: the check id (`prj_…`). If `$ARGUMENTS` has one, use that instead. If neither
  is set, list the checks and use the newest one whose `repository` matches `git remote get-url origin`.

If `GREENLIGHT_TOKEN` is missing, stop and tell the user to click "Connect Claude Code" on their
Greenlight result page and run the commands it shows.

## The API (always send `Authorization: Bearer $GREENLIGHT_TOKEN`)

```bash
G="${GREENLIGHT_URL:-https://greenlight-api-xi.vercel.app}"
curl -fsS -H "Authorization: Bearer $GREENLIGHT_TOKEN" "$G/v1/checks"                      # list checks
curl -fsS -H "Authorization: Bearer $GREENLIGHT_TOKEN" "$G/v1/checks/$CHECK"               # one check + latest verdict
curl -fsS -X POST -H "Authorization: Bearer $GREENLIGHT_TOKEN" -H "content-type: application/json" -d '{}' "$G/v1/checks/$CHECK/recheck"  # run Kane again
```

A check has `url` (the live app), `repository`, `claims`, `status` (`queued`, `running`, `passed`,
`failed`, `couldnt_verify`, `error`) and `verdict.claims[]` with each claim's `status`, `kaneSaw`
(Kane's own note) and `failedStep`. `resultUrl` is the page the user can open.

## The loop (at most 3 rounds)

1. **Read the verdict.** GET the check. While `status` is `queued` or `running`, wait 20 seconds and
   GET again (a Kane run takes 1-3 minutes). Show the user a short table: each claim, passed or
   failed, and Kane's note.
2. **Stop if done.** `passed`: tell the user every claim passed and give `resultUrl`. Stop.
   `couldnt_verify` or `error`: Kane could not finish (for example the site did not load). Report
   Kane's notes and `job.error`, and stop; don't guess at code changes.
3. **Fix each failed claim** in this repository. Use Kane's note as the symptom: find the code
   behind that feature, find the real cause, and make the smallest correct fix. Rules:
   - Fix the app, never the claim. You can't change or remove claims (a person approved them).
   - Don't fake success (no hard-coded success messages, no special cases for test browsers).
   - Run the project's own tests or build if it has them.
4. **Commit and push** to the branch the live app deploys from, with a clear message
   (for example `Fix newsletter sign-up: read the API's ok field`). Note the commit sha.
5. **Wait for the deploy.** If `<url>/greenlight.json` exists, poll it every 15 seconds until its
   `commit` equals your sha (up to 10 minutes). Otherwise wait about 2 minutes and check the live
   page shows your change.
6. **Re-check.** POST `/recheck`, then go back to step 1 with the new job.

After 3 rounds without a pass, stop and summarise what Kane still reports.

## Finish with

- The claims and their final verdicts (Kane passed / failed).
- What you changed and why, with commit sha(s).
- `resultUrl`, so the user can see Kane's verdict and evidence on Greenlight.
