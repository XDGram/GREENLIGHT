# The Greenlight web app (`/app`)

A dashboard for the people who approve and certify: projects, the verification path of each
test version, claims and tests, the credit estimate, approvals waiting, and every
verification record.

## How it is built

- `web/`: React 18 + TypeScript (owner dashboard and guest demo), built with Vite. Fonts (Inter, JetBrains Mono) and icons
  (lucide) are bundled, so the page loads nothing from other origins.
- `npm run build` writes the app to `public/app/` (git-ignored). On Vercel the build runs on
  every deployment (`buildCommand` in `vercel.json`); `public/` otherwise holds only `.gitkeep`.
- `npm run dev:web` serves it at <http://localhost:5173/app/> and proxies `/app/api` and
  `/approve` to a running server (`GREENLIGHT_DEV_API`, default `http://127.0.0.1:8787`).
- `npm run typecheck:web` type-checks it.

## Data and sign-in

The app holds no API token. It reads `/app/api/*`, which the server answers only for a
person signed in with Vercel (the same session, approver list and account scoping as the
approval pages, [APPROVAL.md](APPROVAL.md)):

| Route | Returns |
|---|---|
| `GET /app/api/session` | who is signed in, the account, when the session ends |
| `GET /app/api/projects` | the account's projects with their current state |
| `GET /app/api/projects/:id` | versions with claims, tests, estimate and approval; jobs; records |
| `POST /app/api/logout` | ends the session (same-origin only) |

Everything is read-only. Approving still happens only on the server-rendered `/approve`
pages (two typed hashes, CSRF tokens, write-once records); the app links to them. Certifying
still needs `greenlight publish` and its spending confirmation. Sessions last 15 minutes;
when one ends, the app shows the sign-in screen again.

## Guest demo (no sign-up)

With `GREENLIGHT_GUEST_MODE=on`, people without an account (hackathon judges, for example) can try
Greenlight from the start page: **Explore as a guest**. The browser is remembered by a signed,
HttpOnly, 30-day cookie (`__Host-gl_guest`); there is no sign-up and no personal data.

A guest can:

1. **Read the sample project** (`GREENLIGHT_GUEST_SAMPLE_PROJECT`): a real, owner-approved project,
   shown read-only and without approval identities.
2. **Add an app**: its public address plus either a plain-English description, from which Claude
   (`claude-opus-5-5`, structured output, server-side refusal fallback) writes claims and tests after
   reading the app's start page, or tests written in the form. Either way the result is shown for
   editing and checked live against Greenlight's spec rules and the demo's credit cap.
3. **Approve the tests** by typing their fingerprint back (write-once).
4. **Start one real Kane run** against the live site and read the results claim by claim.

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
| `POST /app/api/guest/projects/:id/runs` | start a real run |

**Guarantees:**
- Guest data lives only in `guest_sessions`, `guest_projects` and `guest_runs`
  ([SUPABASE.md](SUPABASE.md)). Guest approvals, runs and results never enter the certification
  tables, so a guest can never produce a certification or a public record.
- Limits are enforced by the database in one locked transaction:
  - real runs: `GREENLIGHT_GUEST_RUNS_PER_GUEST` per guest (default 1) and
    `GREENLIGHT_GUEST_RUNS_PER_DAY` per rolling 24 hours across all guests (default 3);
  - credits: `GREENLIGHT_GUEST_MAX_CREDITS_PER_RUN` per run (default 150, never above the server cap);
  - 5 apps and 8 AI drafts per guest;
  - 20 new guests per network address per hour.
- A run that fails before Kane starts (unreachable or private address, credit check, sandbox
  setup) is refunded.
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
