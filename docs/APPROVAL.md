# Approving tests in the browser (Sign in with Vercel)

A person approves a server test version at `/approve/<projectId>/<version>` on the Greenlight
API, without a terminal. `greenlight publish` then accepts that approval for exactly the local tests.

## Security model

- **Identity is verified by the server, never assumed.** The page uses Sign in with Vercel (OAuth 2.0
  authorization code + PKCE S256, OpenID Connect). The server exchanges the code itself and verifies
  the ID token against `https://vercel.com/.well-known/jwks`: RS256/ES256 signature, issuer
  `https://vercel.com`, audience = the app's client id, expiry, and a per-sign-in nonce. Request
  headers (`x-vercel-*`, `x-forwarded-*`), the URL used, Vercel deployment protection and API tokens
  are never treated as identity.
- **Only listed people may approve.** `GREENLIGHT_APPROVERS` maps a verified Vercel subject (`sub`)
  to one Greenlight account and owner user. Other Vercel users get 403; other accounts' projects 404.
- **Client authentication without a secret:** the code exchange uses this deployment's Vercel OIDC
  token as a client assertion (a trusted issuer configured on the Vercel app). A client secret
  (`GREENLIGHT_VERCEL_APP_CLIENT_SECRET`, sensitive) is optional.
- **Sessions:** HMAC-signed `__Host-` cookies (Secure, HttpOnly, SameSite=Lax), keyed from the
  server's Supabase key; sign-in state 10 minutes, session 15 minutes.
- **Two separate, exact confirmations:** first the test-specification hash (re-derived from the
  stored greenlight.yaml), then the server version's recorded hash, each typed back in full. Each form
  carries a CSRF token bound to the session, action, project, version and hash; POSTs also need a
  same-origin `Origin` (and `Sec-Fetch-Site`). The second confirmation needs the first, from the same
  session, for the same project, version and hash.
- **One genuine human record:** both confirmations, the verified identity (`provider: vercel`,
  issuer, subject, username, email) and their timestamps are written into the version's single
  `server-owner` approval with `channel: web-sign-in-with-vercel`, covered by its `recordSha256`.
  The database stores it write-once and only for the version's own hash, so replays and duplicate
  submissions are refused (409), and a changed specification is a new, unapproved version.
- **Signed records (server-only key):** each browser approval is signed with HMAC-SHA256 using
  `GREENLIGHT_APPROVAL_SIGNING_KEY`, which only the deployment holds. API tokens, the Supabase key or
  direct database writes cannot produce a valid signature; unsigned, re-signed or modified records
  are rejected. The record carries the key's public id (`signature.keyId`), never the key.
- **Server-side enforcement:** accounts in `GREENLIGHT_BROWSER_APPROVAL_ACCOUNTS` (default `xdgram`)
  and every account in `GREENLIGHT_APPROVERS` can only be certified with a signed browser approval
  by that account's configured approver. For them the owner-token approval route is refused (403)
  and certification refuses any other approval (`approval_not_certifiable`, with the reason). This
  is checked when a certification is requested and again by the job. Other accounts keep the
  existing rules. Agent tokens can propose but never approve or certify.
- **Publish:** with no local `approval.json`, `greenlight publish` accepts the server version's
  approval only if it is an intact browser approval of exactly the local tests (same hash for both
  confirmations) and the server reports it verified (`approvalVerification.browserApproval`; only the
  server can check the signature). Relayed approvals are still refused; token approvals do not count.
- The page sends a strict CSP, `no-store`, `X-Frame-Options: DENY` and no referrer.

## Setup (once)

1. In Vercel, create a **Sign in with Vercel** app for the team:
   - Redirect URI: `https://greenlight-api-xi.vercel.app/approve/callback`
   - Scopes: `openid email profile`
   - Trusted issuer (client authentication with the deployment's OIDC token):
     issuer `https://oidc.vercel.com/timeb7208-5361s-projects`,
     `sub` `owner:timeb7208-5361s-projects:project:greenlight-api:environment:production`,
     `aud` `https://vercel.com/timeb7208-5361s-projects`.
2. Production environment variables of `greenlight-api`:
   - `GREENLIGHT_APPROVAL_SIGNING_KEY` (**Sensitive**, required): a random secret of at least 32
     characters, e.g. the output of `openssl rand -hex 32`, entered directly in Vercel. Never commit
     or share it. Rotating it invalidates existing browser approvals (they must be given again).
   - `GREENLIGHT_BROWSER_APPROVAL_ACCOUNTS` (plain, optional): default `xdgram`.

   Plain, not secret:
   - `GREENLIGHT_VERCEL_APP_CLIENT_ID` = the app's client id
   - `GREENLIGHT_APPROVERS` = `[{"vercelSub":"<your Vercel subject>","account":"xdgram","user":"sadiqyusuf1775"}]`
   If the subject is unknown, sign in once: the page shows "Not an authorised approver" with your
   verified subject; put that value in `GREENLIGHT_APPROVERS`.
3. Redeploy.

## Approving

1. Open `https://greenlight-api-xi.vercel.app/approve/<projectId>/<version>` and sign in with Vercel.
2. Review the project, claims, every test and the complete greenlight.yaml.
3. Type the full test-specification hash and approve it.
4. Type the full server-version hash and approve it.
