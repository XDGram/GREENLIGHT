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

## Alternative: Vercel Functions + Vercel Sandbox (no persistent server)

`GREENLIGHT_EXECUTION=sandbox` keeps everything on Vercel and Supabase:

- `api/index.js` (Vercel Function, `vercel.json` rewrites `/v1/*` to it) serves the unchanged API.
  A certification is persisted as before, then handed to a **new Vercel Sandbox per job**
  (`src/server/sandbox.js`, `@vercel/sandbox`); the function answers once the sandbox's command
  is started and never runs Kane itself.
- In the sandbox (`node22`, 2 vCPUs, named `greenlight-<job id>`, not persistent), `run-job.sh` installs `@testmuai/kane-cli@0.10.6`,
  installs Kane's `remote-execution` plugin, logs Kane in with basic auth, drops the credentials,
  and runs `bin/greenlight-worker.js <jobId>`: the same `JobRunner.execute` -> `runCertification`
  pipeline, storing the record and evidence in Supabase.
- Kane runs with `--remote hyper` (TestMu HyperExecute runs the browser; no Chrome in the
  sandbox), still with `--local` (no Test Manager uploads) and `--no-adaptive-heal`. The sealed
  evidence pack Kane copies back (`execution-<id>.evidence`) goes through the normal checks; if
  it is missing or not a sealed pack, the run is not certified.
- If setup fails (install, plugin, login), the job is marked `failed` with `sandbox_setup_failed`
  and Kane does not run. If the sandbox cannot start, `sandbox_dispatch_failed`. A job whose
  sandbox disappeared is settled as `interrupted` once it is older than a sandbox's lifetime.
- Stopping: Vercel documents only `stop()` (SDK/API/CLI) and the timeout as ways a sandbox ends,
  so Greenlight does not rely on the VM shutting itself down. When the job is settled, the worker
  POSTs `/v1/sandbox/finished` with an HMAC of the job id (keyed with the Supabase server key the
  sandbox already has; no Vercel credential is ever in the sandbox); the API checks the job is
  finished in the database and calls `Sandbox.get({ name }).stop()` with its own OIDC token.
  Backups: the API also stops a finished job's sandbox when it returns the job (publish polls every
  10 s), stale-job recovery stops the sandboxes of jobs it settles, and the timeout is the hard
  limit. `GREENLIGHT_PUBLIC_BASE_URL` (https, reachable from the sandbox) is required.
- Vercel Hobby (defaults in sandbox mode): sandbox 45 min (Hobby's maximum), Kane 25 min,
  deployment wait 300 s, plus 10 min reserved for setup and evidence upload = 40 min worst case.
  The configuration refuses settings that do not fit (`GREENLIGHT_SANDBOX_MAX_MINUTES`, default
  45; Pro allows up to 1440). Hobby allows 10 concurrent sandboxes; Greenlight runs one job per
  project at a time.

Vercel project environment variables (Production; mark the secrets as sensitive):

| Variable | Value |
|---|---|
| `GREENLIGHT_EXECUTION` | `sandbox` |
| `GREENLIGHT_KANE_REMOTE` | `hyper` |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret) | as for the container |
| `GREENLIGHT_KANE_USERNAME`, `GREENLIGHT_KANE_ACCESS_KEY` (secret) | TestMu basic-auth credentials for Kane |
| `GREENLIGHT_KANE_PROJECT_ID`, `GREENLIGHT_KANE_FOLDER_ID` | optional: skip Kane's project/folder picker at login |
| `GREENLIGHT_PUBLIC_BASE_URL` | the deployment's public URL |

The function authenticates to Vercel Sandbox with the deployment's OIDC token automatically.
The secrets reach the sandbox only as the detached command's environment, never in files,
sandbox settings, logs or job documents.

Not verifiable without a real run (credits): that `kane-cli login --username/--access-key` and
`plugin install remote-execution` complete non-interactively in the sandbox, that `--remote hyper`
works together with `--local`, the exact file Kane copies back, and HyperExecute's credit cost.
