# Hosting the Greenlight server

The server runs Kane CLI as a subprocess with a real browser for up to
`GREENLIGHT_KANE_TIMEOUT_MINUTES` (default 30). It needs a **persistent** host: a VM or a
container service that keeps the process and its volumes. Serverless functions (Vercel
Functions, Lambda, Cloud Functions) cannot run it (brief §13).

## What is in the image

`Dockerfile`: Node 22, Debian's Chromium (`KANE_CLI_CHROME_PATH=/usr/bin/chromium`),
`@testmuai/kane-cli@0.10.6` (the build fails if the installed version differs), Greenlight's
`bin/` and `src/` (no runtime dependencies), an unprivileged `greenlight` user, and a health
check on `/v1/ready`. No secret is in the image.

## Run it

```sh
cp .env.example .env            # fill in SUPABASE_SERVICE_ROLE_KEY etc.; .env is git-ignored
docker compose build
# One-time Kane login, stored in the kane-home volume (basic auth with your TestMu username
# and access key, or --oauth on a machine with a browser):
docker compose run --rm greenlight kane-cli login --username <user> --access-key <key>
docker compose up -d
curl -s http://127.0.0.1:8787/v1/ready
```

`compose.yaml` publishes the API on `127.0.0.1:8787` only: put a TLS reverse proxy in front
and set `GREENLIGHT_PUBLIC_BASE_URL`. It also sets `init: true` (signals, Chrome reaping),
`shm_size: 1gb` (Chrome), and `stop_grace_period: 35m` so a running Kane run finishes
instead of being lost on restart.

## Secrets

| Secret | Where |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` (`sb_secret_…`) | Host environment: `.env` (git-ignored) or the platform's secret store. Never in the image, Git or a frontend. A publishable/anon key is refused |
| Kane login (TestMu credentials) | The `kane-home` volume (`/home/greenlight/.testmuai`), written by `kane-cli login` |
| Greenlight API tokens | Issued with `greenlight-admin issue-token`; only SHA-256 hashes are stored |

## Startup, readiness, shutdown

On start the server checks, in order, and exits with code 2 and a `not_ready` log line if any
fails (it never starts half-working):

1. configuration (Supabase URL and a server key; the file store is refused),
2. Supabase: the key works, `greenlight_api` is exposed, the evidence bucket exists and is
   private (retries only while unreachable),
3. runtime: `kane-cli --version` is exactly 0.10.6 and a Chrome binary Kane can launch exists
   (this runs no test and spends no credits).

`GET /v1/health` is liveness; `GET /v1/ready` returns `database`, `storage`, `kane` and
`chrome` codes (503 when any is not `ok`). On SIGTERM/SIGINT the server stops accepting
requests, lets running jobs finish and exits 0; jobs still queued are settled at the next
start (`recover()`), and nothing is re-run.

Not verifiable without a deployment (check on the first one): Kane's authenticated session in
the volume (`kane-cli balance` inside the container), and that Chromium launches under the
host's container sandbox settings.
