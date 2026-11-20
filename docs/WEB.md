# The Greenlight web app (`/app`)

A dashboard for the people who approve and certify: projects, the verification path of each
test version, claims and tests, the credit estimate, approvals waiting, and every
verification record.

## How it is built

- `web/`: React 18 + TypeScript, built with Vite. Fonts (Inter, JetBrains Mono) and icons
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
