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

## User API (`/app/api/*`, session cookie, same-origin JSON writes)

| Route | Does |
|---|---|
| `GET /app/api/session` | who is signed in, role, features (AI, certification) |
| `GET`/`POST /app/api/projects` | list / add a project (name, live URL, GitHub URL, branch, description, what it should do, optional test credentials) |
| `GET /app/api/projects/:id` | versions with claims, tests, estimate and approval; jobs; records; details |
| `POST .../details` | edit repository, branch, description, credentials |
| `POST .../repository-check` | GitHub public API: repository and branch head (private repositories read as "not found or private") |
| `POST .../deployment-check` | one read of `<live URL>/greenlight.json`: the deployed commit |
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
activity and demo checks. Controls: pause demo checks, revoke any API token. Every change is
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
