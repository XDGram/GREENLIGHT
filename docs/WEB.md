# The Greenlight web app (`/app`)

The product for three kinds of people:

- **Users** sign in with Google, add their apps, write and approve claims and tests, start
  verification runs with an explicit credit confirmation, and read results, evidence and history.
- **Visitors and judges** use the demo without an account: a read-only sample project, their own
  apps and tests, and free demo checks that never spend credits or certify anything.
- **The administrator** signs in with Vercel (only the subjects in `GREENLIGHT_APPROVERS`) and gets
  the admin console as well.

## How it is built

- `web/`: React 18 + TypeScript (owner dashboard and guest demo), built with Vite. Fonts (Inter, JetBrains Mono) and icons
  (lucide) are bundled, so the page loads nothing from other origins.
- `npm run build` writes the app to `public/app/` (git-ignored). On Vercel the build runs on
  every deployment (`buildCommand` in `vercel.json`); `public/` otherwise holds only `.gitkeep`.
- `npm run dev:web` serves it at <http://localhost:5173/app/> and proxies `/app/api` and
  `/approve` to a running server (`GREENLIGHT_DEV_API`, default `http://127.0.0.1:8787`).
- `npm run typecheck:web` type-checks it.

## The one-page check (the main screen)

`/app` is one page, for visitors (no sign-up), Google users and administrators alike:

1. Paste the GitHub repository, the live URL and, optionally, the README or notes.
2. **Check my app** (`POST /app/api/checks/claims`, free, no Kane): each bullet point of the
   notes (or of the repository's README when nothing was pasted) becomes a claim. The page shows
   the claims, how many one run can hold under the per-run credit ceiling, and the cost.
3. **Run** (`POST /app/api/checks` with `confirm: true` and `confirmSpend` >= the cost shown):
   creates the project, writes one Kane test per claim (a single `check` step: Kane uses the live
   app and judges the claim), records the person's signed approval of exactly those tests and
   queues the Kane run. That one click is the approval and the spend confirmation.
4. `/app/check/:projectId` shows progress, then the verdict (Passed / Failed / Could not verify),
   each claim marked, and for each failure Kane's own note and a suggested fix.

No AI is involved; claims come from the text. Visitor runs keep every guest limit (one run per
visitor, daily runs and credits, per-run ceiling, admin pause, atomic reservation). Runs made of
Kane-judged claims are verdicts, never certifications (`notCertifiedBecause: kane_judged_claims`);
only exact visible-text tests can certify.

## The journey (guests first)

Visitors use Greenlight without an account: **Test your app, no account needed** gives the browser a
signed guest cookie, which maps to an anonymous account (`v-<hash>`) with the full project flow:

1. **Submit an app**: GitHub repository URL and live URL (both required, with why each is needed),
   what the app does, an optional throwaway test account.
2. **Learn the app** (`POST .../understand`): the public GitHub API (metadata, languages, files and
   routes, `package.json`, README; optional read-only `GREENLIGHT_GITHUB_TOKEN` for higher limits)
   and a headless Chromium read of the live app (`src/server/browse.js`, `@sparticuz/chromium`;
   every request is checked against private addresses). Claude compares this with the description:
   testable features with their source, mismatches, questions. Private repositories are reported
   as unreadable, never guessed at.
3. **Test plan**: plain-language tests (feature, what Greenlight does, what should happen, what
   counts as working). Edit, remove, add, or ask Claude to revise; the spec stays under Technical
   details. Guests approve the exact plan in the app (a signed, write-once approval); accounts that
   can certify approve on the `/approve` pages.
4. **Verification**: a real Kane run. For guests the server picks the commit (the live site's
   `/greenlight.json`, else the public branch head, recorded as unconfirmed), runs are capped in the
   database (`GREENLIGHT_GUEST_REAL_RUNS_PER_GUEST`, default 1; `GREENLIGHT_GUEST_REAL_RUNS_PER_DAY`,
   default 3; the administrator can pause them), and results are never certificates or public
   records. Outcomes are shown as Working / Not working / Could not verify, in plain English.
5. **Fix Centre** (`src/server/fix-centre.js`): per failed test, an explanation (facts only without
   AI; the likely cause is labelled as supported, a guess, or unknown), a conversation that keeps the
   failure's context, a generated fix and a task for a coding agent. **Send to coding agent** makes
   it available over MCP (`greenlight_list_fix_tasks`, `greenlight_get_fix_task`,
   `greenlight_report_fix`); Greenlight never changes code. Status becomes "fixed" only when a later
   run passes the test; re-runs can target just the failed tests.

Navigation: Overview, My projects, Submit an app, Test plan, Verification, Fix Centre, Evidence &
history, Integrations, Administration (administrators only).

## Sign-in and roles

| | Normal users | Administrator |
|---|---|---|
| Sign-in | Google (OpenID Connect, PKCE, nonce; ID token verified against Google's keys) | Vercel, only subjects in `GREENLIGHT_APPROVERS` |
| Account | one per Google identity: `g-<sha256(subject) prefix>`, owner user `owner` | the configured approver's account |
| Session | signed HttpOnly `__Host-gl_session`, 12 hours | same cookie, 15 minutes |
| Role | `user` | `admin` (admin console) |

Nothing a Google user can do produces the `admin` role. Every Google account requires signed
browser approvals for certification (`approval-policy.js`): the approval must be signed with the
server's key and given by the Google identity that owns the account. Owner-token approvals are
refused for those accounts. Setup: create an OAuth client (type "Web application") in the Google
Cloud console with the redirect URI `<GREENLIGHT_PUBLIC_BASE_URL>/api/auth/google/callback`, then
set `GREENLIGHT_GOOGLE_CLIENT_ID` and `GREENLIGHT_GOOGLE_CLIENT_SECRET` (secret) on the server.

## Setup checklist (operator)

1. **Google sign-in.** In the Google Cloud console (console.cloud.google.com), with a project selected:
   - *Google Auth Platform → Branding / OAuth consent screen*: user type **External**; app name,
     support email and developer contact. Scopes: only `openid`, `.../auth/userinfo.email`,
     `.../auth/userinfo.profile` (non-sensitive, no Google verification needed). While the
     publishing status is **Testing**, only listed test users can sign in; choose **Publish app**
     (In production) to let anyone sign in.
   - *Clients → Create client*: type **Web application**. Authorised redirect URI, exactly:
     `https://greenlight-api-xi.vercel.app/api/auth/google/callback`. No JavaScript origins are
     needed (the server does the exchange).
   - In Vercel → project `greenlight-api` → Settings → Environment Variables, environment
     **Production**: `GREENLIGHT_GOOGLE_CLIENT_ID` (the client ID) and
     `GREENLIGHT_GOOGLE_CLIENT_SECRET` (mark **Sensitive**). `GREENLIGHT_APPROVAL_SIGNING_KEY`
     is already set. Surrounding whitespace is ignored.
2. **Claude API.** In the Claude Console (platform.claude.com) → API keys → Create key (a
   workspace with billing). Add it in Vercel as `ANTHROPIC_API_KEY` (Production, **Sensitive**).
   Optional: `GREENLIGHT_AI_MODEL` (default `claude-opus-5-5`); the key must have access to it.
3. **Redeploy.** Vercel applies environment variables only to new deployments.
4. **Verify.** Admin → System health shows "Sign in with Google: Configured" and "Claude API key:
   Configured"; the landing page shows **Sign in with Google**; after signing in, Integrations
   shows Claude API **Connected**, and "Draft with Claude" on a project's Claims and tests page
   returns a draft. Problems show in Vercel's runtime logs as `google_signin_failed` or
   `ai_error` (type and status only, never keys).

## User API (`/app/api/*`, session cookie, same-origin JSON writes)

| Route | Does |
|---|---|
| `GET /app/api/session` | who is signed in, role, features (AI, certification) |
| `GET`/`POST /app/api/projects` | list / add a project (name, live URL, GitHub URL, branch, description, what it should do, optional test credentials) |
| `GET /app/api/projects/:id` | versions with claims, tests, estimate and approval; jobs; records; details |
| `POST .../details` | edit repository, branch, description, credentials |
| `POST .../repository-check` | GitHub public API: repository and branch head (private repositories read as "not found or private") |
| `POST .../deployment-check` | one read of `<live URL>/greenlight.json`: the deployed commit, and whether GitHub confirms it is a commit of the project's repository (`found`, `not_found`, or `unknown` for private repositories, rate limits and errors; Greenlight never claims more than GitHub confirms) |
| `POST .../draft` | Claude drafts claims and tests from the description and the start page (not saved) |
| `POST .../preview` | rules check, fingerprint, credit estimate |
| `POST .../versions` | save a new immutable version (pending approval) |
| `POST .../certifications` | start a run: `{version, commit, confirmSpend, approvedTestHash}` |
| `GET /app/api/jobs/:id` | job progress |
| `GET .../records/:rid` | claims, per-test results with failure step and Kane's message, evidence files |
| `GET .../records/:rid/files/<name>` | one evidence file, re-checked against its SHA-256 |
| `GET .../records/:rid/integrity` | re-download and re-hash all evidence |
| `GET`/`POST /app/api/tokens`, `POST /app/api/tokens/:id/revoke` | API tokens for Claude Code and MCP (shown once, stored hashed) |
| `GET /app/api/integrations` | Claude API, Claude Code and MCP status |

The API cannot approve: approval happens only on the server-rendered `/approve` pages (two typed
fingerprints, CSRF tokens, signed write-once record). Certification still needs the signed
approval, a fresh server-side run of exactly the approved tests on the commit the live site
reports, and the person's credit confirmation (`confirmSpend` at least the estimate, capped by
`GREENLIGHT_MAX_CREDITS_PER_RUN`). Only certified runs get a public record. Test credentials
are stored AES-256-GCM-encrypted and never returned; the current test format runs signed out.

## Admin console (`/app/admin`, role `admin`)

Overview (users, projects, runs by status, records, credits spent and estimated, tokens, demo
activity, evidence size), system health (database, evidence bucket, configuration flags, runs
stuck over 45 minutes), failed runs, and lists of users, projects, runs, records, tokens, admin
activity and demo checks. The activity log records sign-ups, projects created and edited, test
versions (web and MCP), browser approvals, verification requests, token changes and
administrator changes. Controls: pause demo checks, revoke any API token. Every change is
written to the append-only `admin_events` table. The console cannot approve, start runs, change
records or reveal secrets.

## MCP (`POST /mcp`)

Streamable HTTP, JSON-RPC, bearer API tokens (Integrations page). Tools: list projects, get
project, get spec, propose tests (returns the approval link), get job, get record, check
deployment. No tool approves, starts a paid run or publishes.

## Guest demo (no sign-up)

With `GREENLIGHT_GUEST_MODE=on`, people without an account (hackathon judges, for example) can try
Greenlight from the start page: **Try the demo, no account**. The browser is remembered by a signed,
HttpOnly, 30-day cookie (`__Host-gl_guest`); there is no sign-up and no personal data.

A guest can:

1. **Read the sample project** (`GREENLIGHT_GUEST_SAMPLE_PROJECT`): a real, owner-approved project,
   shown read-only and without approval identities.
2. **Add an app**: its public address plus either a plain-English description, from which Claude
   (`claude-opus-5-5`, structured output, server-side refusal fallback) writes claims and tests after
   reading the app's start page, or tests written in the form. Either way the result is shown for
   editing and checked live against Greenlight's spec rules and the demo's credit cap.
3. **Approve the tests** by typing their fingerprint back (write-once).
4. **Run a demo check**: the server reads the live start page and checks the expected texts that
   come before any interaction. Kane never runs, no credits are spent, and steps that need a browser
   are reported as not checked. Results are labelled as a demo check and never certify.

| Route | Does |
|---|---|
| `GET /app/api/guest/me` | the guest (or none), limits left, whether AI and the sample are available |
| `POST /app/api/guest/start` | create the guest and set the cookie |
| `GET /app/api/guest/sample` | the sample project, read-only |
| `POST /app/api/guest/draft` | AI: requirements -> claims and tests (not saved; counts toward the AI limit) |
| `POST /app/api/guest/preview` | structured tests -> spec check, fingerprint, credit estimate |
| `GET`/`POST /app/api/guest/projects` | list / save the guest's apps |
| `GET /app/api/guest/projects/:id` | one app with its runs |
| `POST /app/api/guest/projects/:id/approve` | the guest's own approval (typed fingerprint) |
| `POST /app/api/guest/projects/:id/runs` | run a demo check (no browser, no credits) |

**Guarantees:**
- Guest data lives only in `guest_sessions`, `guest_projects` and `guest_runs`
  ([SUPABASE.md](SUPABASE.md)). Guest approvals, runs and results never enter the certification
  tables, so a guest can never produce a certification or a public record.
- Limits are enforced by the database in one locked transaction:
  - demo checks: `GREENLIGHT_GUEST_RUNS_PER_GUEST` per guest (default 10) and
    `GREENLIGHT_GUEST_RUNS_PER_DAY` per rolling 24 hours across all guests (default 500);
    the administrator can pause them (`guest.checks_paused`);
  - specs must stay within `GREENLIGHT_GUEST_MAX_CREDITS_PER_RUN` (default 150), so they would also fit a real run;
  - 5 apps and 8 AI drafts per guest;
  - 20 new guests per network address per hour.
- A demo check that fails before it reads the page is refunded.
- Every write must come from this site (Origin and Sec-Fetch-Site) as JSON. App addresses must
  be public: private and local addresses are refused before any request or run.
- Requirements and page text are passed to Claude as data, never in the system prompt. The
  generated tests still go through the normal rules and need the guest's approval before anything runs.
- `ANTHROPIC_API_KEY` is a server secret (never serialised or logged). Without it, the form still works.

## Hosting

- Vercel: `vercel.json` rewrites `/app/api/*` to the function, client-side routes under `/app`
  to `/app/index.html`, and `/` redirects to `/app`. `/app` pages are sent with a strict CSP
  (`default-src 'self'`, `frame-ancestors 'none'`).
- Docker/self-hosted: the container serves the API only. Serve `public/app/` from your reverse
  proxy (same origin as the API) with the same headers, after `npm ci && npm run build`.

## Design

Monochrome: a soft grey ground, white rounded panels, black accents and fully rounded pills.
State is shown by form and words (filled = done, outlined = needs attention, dashed = not yet)
rather than colour. Tokens are in `web/src/styles/tokens.css`.
