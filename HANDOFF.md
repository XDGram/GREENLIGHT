# Greenlight: handoff

Read this whole file before doing anything. It is the state of the project as of 2026-11-23.

## What Greenlight is (the product, as the owner wants it)

One page. The visitor pastes:

1. a GitHub repository URL,
2. the live app URL,
3. the README or notes (optional; if empty, the README is read from the repo).

Greenlight turns the README's bullet points into claims, shows them with the cost, and a single
**Run** click starts a real browser test with **Kane** (TestMu AI's Kane CLI). The result page shows
a verdict (**Passed / Failed / Could not verify**), each claim ✓/✗, Kane's note on each failure and a
suggested fix.

**The owner strongly dislikes complexity.** Earlier versions had test-plan editors, a separate
approval step, a Fix Centre, agent hand-offs and AI planning; the owner rejected all that ("stop
complicating things"). Keep the product to that one flow. Don't add steps, screens or concepts
without being asked. Explain things in plain words.

## Where things are

- Repository: `XDGram/GREENLIGHT`. Work branch: `claude/elegant-dirac-tqdzmd` (also mirrored to
  `claude/zealous-sagan-1jgcjc`; push to whichever branch your session is told to use).
- Production: https://greenlight-api-xi.vercel.app/app, running commit `0714a2b` (deployed and
  verified 2026-11-23).
- Vercel project `prj_S9KIQCg2LN4xQfGw7reIGMH3fvtu`, team `team_aehGbVQxuk4rXpTFzXyLre8R`.
  **Pushing does not deploy.** Deploy with the Vercel MCP `create_deployment`: `gitSource`
  `{type: "github", org: "XDGram", repo: "GREENLIGHT", ref: <branch>, sha: <full sha>}`,
  `forceNew: "1"`, `target: "production"`, `project` = the id above. Then check `get_deployment`
  is READY and aliased to `greenlight-api-xi.vercel.app`.
- Supabase project `ncbrsrklofofdqdftwjw`. Schema `greenlight` (tables, RLS deny-all) and
  `greenlight_api` (SECURITY DEFINER RPCs, service_role only). **Migrations 1-6 are applied**
  (migration 6, `supabase/migrations/20261122090000_greenlight_journey.sql`, on 25 Nov at the owner's
  request: atomic visitor-run reservations, Fix Centre and agent-request tables). The code still
  works without it (see below).

## How the one-page check works (code map)

- `src/server/simple-check.js`: `claimsFromText` (README bullets → claims), `cleanClaim`,
  `checkCost`, `maxClaims`, `checkSpecYaml` (one Kane test per claim).
- `src/spec/schema.js` + `src/spec/generate.js`: a step kind **`check`**: a plain-English claim Kane
  judges by using the app ("Use the app as a normal visitor would to find out whether this claim
  is true, then verify it: …"). Each test needs an `expect_text` or a `check` step.
- `src/server/app-api.js`:
  - `POST /app/api/checks/claims`: free, no Kane. Returns claims, `maxClaims`, `costs`, guest
    limits and `budget {cap, left}`.
  - `POST /app/api/checks` `{repository, url, notes, claims[], confirm: true, confirmSpend}`:
    creates the project, writes the spec, records a signed in-app approval (`approveInApp`, the
    Run click is the approval), queues the Kane job (`submitVerification`, `autoCommit`).
  - `committedCredits` / `checkTotalCap`: **total Kane credit cap**, `GREENLIGHT_TOTAL_CREDIT_CAP`
    (default 400, 0 = off). Counts max(recorded actual spend, recorded estimates) over all records +
    `confirmSpend` of queued/running jobs. Fails closed. Currently 188 are already counted (two old
    runs), so **212 are left**.
  - Without migration 6: `store.guestAccount` falls back to `greenlight_ensure_account` +
    `greenlight_create_user`; `reserveGuestRun` returns `{reservation: null}`; one run per visitor is
    counted from the visitor's own jobs (`guestJobsUsed`). Missing functions surface as
    `err.missingFunction` (PostgREST `PGRST202`, `src/server/supabase/client.js`).
- `src/server/certify.js`: runs made of `check` steps are never certified
  (`notCertifiedBecause: kane_judged_claims`); guests never certify (`guest_verification`).
- Web (`web/src`, React + Vite, built to `public/app`):
  - `pages/CheckPage.tsx`: `CheckForm`, `CheckPage`, `CheckResultPage` (polls the job, shows the
    verdict), `ChecksListPage`.
  - `App.tsx`: `Landing` (signed-out page: hero + form; first call starts a visitor session).
  - `components/Hero.tsx`: pixel hero, ticker, typed `[ README█ ]`, flow strip, value cells.
  - `styles/theme.css`: the current design ("terminal grid": white sheets, hairlines, square
    corners, mono caps labels, near-black ink, one green accent). Loaded after `app.css`.
  - Older pages (TestsPage, VerifyPage, FixCentrePage, IntegrationsPage …) still exist and are
    reachable by URL but are no longer in the navigation. Leave them unless asked.
- Limits today: visitors 1 run each, ≤100 credits per run (= 2 claims, 94 credits); signed-in ≤150
  (= 3 claims, 131). Cost: ~37 per one-step test + 20 per run.

## Rules the owner set (follow them)

- **Commits:** author `0xDGraM-Dev <timeb7208@gmail.com>`
  (`git -c user.name="0xDGraM-Dev" -c user.email="timeb7208@gmail.com" commit …`). **No Claude
  attribution, no Co-Authored-By lines** ("do not include yourself as contributor").
- Never modify `GREENLIGHT_PROJECT_BRIEF.md`.
- Never ask for, print or commit secrets. The owner adds secrets in Vercel themselves.
- Don't change Vercel environment variables or apply Supabase migrations unless the owner asks.
- Don't run Kane or spend credits yourself; don't approve, certify or publish anything on the
  owner's behalf. Deploy when the owner asks ("deploy").
- Keep it simple. Short, plain answers.

## Testing

- `npm test`: 455 pass, 9 skipped (live). `npx tsc -p web/tsconfig.json`; `npm run build`.
- Key tests: `test/server/journey.test.js` (one-page check end to end with a fake Kane, and the
  "without migration 6 + total cap" case), `test/server/simple-check.test.js`,
  `test/spec/schema.test.js`.
- Browser preview: start a local server with the PGlite fake Supabase and a fake Kane (pattern in
  `test/server/journey.test.js` `setup()`), serve `public/app`, drive it with Playwright
  (`require("playwright")`, Chromium is preinstalled). Check desktop 1280px and phone 390px.

## Open items

1. **No real Kane run has happened yet** through the one-page flow. The first one is the real test
   of how Kane handles `check` steps. If it misbehaves, look at the rendered step text in
   `src/spec/generate.js` `checkStep` and Kane's output (`kane-stdout.ndjson` in the run files).
2. Cap: 212 of 400 left because old runs count. Owner may want the cap to count only from a date,
   or a higher `GREENLIGHT_TOTAL_CREDIT_CAP`. Ask before changing.
3. Concurrency: two simultaneous Run clicks across server instances could pass the cap check
   together (overshoot ≤ one run). Fixing it needs a database lock (migration); only if asked.
4. Suggested fixes are generic (Kane's note + a standard next step). The owner plans to add an AI
   key later for code-level fixes and smarter claim extraction; nothing should depend on it.
5. Google sign-in is not configured in production (visitors use the no-account flow).
