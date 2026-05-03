# Deploying to Railway

This guide walks you through deploying the Laurenzo Dashboard (`tradingmanus`)
to [Railway](https://railway.com). Railway runs the Express server in
`server/_core/index.ts` as a long-lived Node process, so the in-process
schedulers handle autonomous trading (every 15 min) and order sync (every
30 sec). The Vercel-only `/api/scheduled/*` cron endpoints are not used on
Railway.

## What is in the repo

- `railway.json` — tells Railway to build with NIXPACKS, run
  `corepack enable && corepack pnpm install --frozen-lockfile && corepack pnpm build && corepack pnpm build:server`,
  start with `corepack pnpm start`, and health-check `/api/health`.
- `.nvmrc` — pins Node 20 (matches local + CI).

You do not need to commit any other Railway-specific files. The
`vercel.json`/`api/index.ts` files remain in the repo for backwards
compatibility but are ignored by Railway.

---

## 1. Prerequisites on your end

1. A Railway account: <https://railway.com>.
2. (Optional but recommended) the Railway CLI:
   `npm i -g @railway/cli && railway login`.
3. Your existing Postgres database. The app uses the `@neondatabase/serverless`
   HTTP driver, so any Postgres reachable over `https`/`postgres://...` works:
   - **Recommended:** keep your existing Neon database — it already has the
     schema and your data. Just copy its pooled connection string.
   - Or provision a new Neon database (Neon's HTTP driver is required for the
     distributed-locks table to behave correctly under serverless conditions).
   - Railway's built-in Postgres plugin works for a fresh install but you must
     run `pnpm db:push` once after the first deploy.

> ⚠️ Do **not** use a non-Neon Postgres without testing the distributed lock
> code path; the project's distributed lock implementation is designed around
> Neon's HTTP driver (see `server/_core/distributedLock.ts`).

## 2. Create the Railway project

### Option A — From the Railway dashboard (easiest)

1. Go to <https://railway.com/new> → **Deploy from GitHub repo**.
2. Authorize Railway to access `mikelaurenzo7-collab/tradingmanus` and
   pick the branch you want to deploy (typically `main`).
3. Railway detects `railway.json` and starts the first build immediately.
   It will fail until you add the env vars in the next step — that is
   expected.

### Option B — From the CLI

```bash
railway login
railway init                # create a new project, link it to this directory
railway up                  # triggers the first build
```

## 3. Configure environment variables

In **Project → Variables** (or `railway variables --set KEY=value`), set
**every** required variable below. The full reference is in
[`.env.example`](./.env.example).

### Required

| Variable | Notes |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Pooled Neon connection string, e.g. `postgresql://USER:PASSWORD@HOST/DB?sslmode=require` |
| `JWT_SECRET` | 32+ random chars. Generate with `openssl rand -hex 32`. |
| `CREDENTIAL_ENCRYPTION_SECRET` | 32+ random chars, **different** from `JWT_SECRET`. Used to encrypt Kalshi API credentials at rest. Rotating this value invalidates stored credentials. |
| `OWNER_EMAIL` | Single-owner login email. |
| `OWNER_PASSWORD` | 12+ chars in production. |
| `ANTHROPIC_API_KEY` | Required — Claude is the primary trading reviewer. |

### Recommended

| Variable | Notes |
|---|---|
| `OPENAI_API_KEY` | Required for high-stakes trades (≥$25, near-resolution, or confidence ≥0.9) where both providers must approve. |
| `LOG_LEVEL` | `info` (default in production). |
| `ALERT_WEBHOOK_URL` | Slack/PagerDuty/etc. webhook for critical alerts. |

### Optional

`KALSHI_API_KEY`, `GNEWS_API_KEY`, `ANTHROPIC_MODEL`, `ANTHROPIC_TRIAGE_MODEL`,
`ANTHROPIC_DEEP_MODEL`, `ANTHROPIC_TIMEOUT_MS`, `OPENAI_MODEL`,
`OPENAI_TIMEOUT_MS`, all `ENABLE_AI_*` flags, `AI_TRIAGE_THRESHOLD`,
`VITE_ANALYTICS_ENDPOINT`, `VITE_ANALYTICS_WEBSITE_ID`.

### Not needed on Railway

| Variable | Why |
|---|---|
| `CRON_SECRET` | Only used by the Vercel cron handler. The Railway deployment runs schedulers in-process (see `server/_core/index.ts`), so this can be left unset. (`server/_core/env.ts` will log a single benign warning at startup; ignore it.) |
| `PORT` | Railway sets this automatically. Do **not** override it. |

> 🔐 **Generating secrets** — on macOS/Linux run:
> ```bash
> openssl rand -hex 32   # JWT_SECRET
> openssl rand -hex 32   # CREDENTIAL_ENCRYPTION_SECRET
> ```

## 4. Trigger a deploy

Either push to the connected branch or run `railway up`. Railway will:

1. Install dependencies with `corepack pnpm install --frozen-lockfile`.
2. Build the client (`vite build` → `dist/public/`).
3. Bundle the server (`esbuild ... → dist/index.js`).
4. Start it with `node dist/index.js`.
5. Probe `GET /api/health` until it returns 200.

Watch the build with `railway logs` or in the dashboard.

## 5. First-run database setup (only if using a fresh database)

If you provisioned a brand-new Postgres (e.g. Railway's plugin, or a new
Neon project), you need to push the Drizzle schema once:

```bash
# From your local machine, with DATABASE_URL pointing at the Railway/Neon DB:
DATABASE_URL='postgres://...' corepack pnpm db:push
```

Or run it inside Railway:

```bash
railway run corepack pnpm db:push
```

> If you copied your existing Neon database into `DATABASE_URL`, skip this
> step — the schema (including `distributedLocks`, `users.betaAccessLevel`,
> etc.) is already in place.

## 6. Expose the service

In **Settings → Networking → Public Networking**, click **Generate Domain**
to get a `*.up.railway.app` URL, or attach your own domain. Railway terminates
TLS automatically and forwards to the port from `process.env.PORT`.

Confirm the deployment is healthy:

```bash
curl https://<your-domain>/api/health
# → {"status":"ok",...}
```

Then log in at `https://<your-domain>/` with `OWNER_EMAIL` / `OWNER_PASSWORD`.

## 7. Verify the in-process schedulers

Tail the logs and look for these lines on startup:

```
Server running on http://localhost:<PORT>/
[Scheduler] Autonomous trading scheduler started (15-min interval)
[OrderSync] Order sync started (30-sec interval)
```

Within ~30 seconds you should see periodic `[OrderSync]` activity (or no-op
log lines if no users are eligible for autonomous trading yet).

## 8. Day-2 operations

- **Re-deploys**: push to the connected branch, or `railway up`.
- **Schema changes**: after merging a PR that edits `drizzle/schema.ts`, run
  `railway run corepack pnpm db:push`.
- **Rotating secrets**: update the variable in Railway → it triggers a fresh
  deploy automatically. Rotating `CREDENTIAL_ENCRYPTION_SECRET` invalidates
  every stored Kalshi credential and they will need to be re-entered.
- **Scaling**: keep this service at **1 replica**. The autonomous trading and
  order-sync intervals run in-process and use a database-backed distributed
  lock, but running multiple replicas is untested and can cause duplicate
  scheduler ticks across the lock TTL boundaries.
- **Logs**: `railway logs` or the dashboard log viewer. Logs are structured
  JSON via `pino`; set `LOG_LEVEL=debug` temporarily for deeper diagnosis.

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Build fails on `corepack pnpm install` | Make sure your branch is up to date with `pnpm-lock.yaml`. Railway uses `--frozen-lockfile`. |
| Health check times out | Check logs for env-validation errors (missing `JWT_SECRET`, `DATABASE_URL`, etc.). The server exits before binding if a required var is missing. |
| `pathRegexp is not a function` at runtime | `pnpm.overrides.path-to-regexp` must be exactly `0.1.13`. Reinstall and redeploy. |
| Scheduler never runs | No user has been promoted into `betaAccessLevel` ≥ `internal` and/or no Kalshi credentials are stored yet. |
| `FATAL: distributed lock ...` errors | You are not on Neon's HTTP driver. Switch `DATABASE_URL` to a Neon pooled endpoint. |

---

That's it — once the health check is green and you can log in, the dashboard
is live on Railway and the autonomous trading + order-sync schedulers are
running on the same dyno.
