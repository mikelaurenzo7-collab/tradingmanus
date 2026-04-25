# Laurenzo Kalshi Trading Dashboard

Single-owner Kalshi trading console with an **OpenAI + Claude autonomous trading duo**. Designed to run on **Vercel** with a **Neon Postgres** database.

## Architecture

- **Frontend**: React 19 + Vite + Wouter + tRPC + TanStack Query + Tailwind v4 + shadcn UI
- **Backend**: Express + tRPC, deployed as a single Vercel function at `api/index.ts`
- **Database**: Neon Postgres via `@neondatabase/serverless` HTTP driver + `drizzle-orm/neon-http`
- **Auth**: Owner-only password login. JWT (HS256, 1-year) in an httpOnly `app_session_id` cookie.
- **AI**: OpenAI and Claude review every candidate signal before persistence and before any autonomous order. Both providers must approve. Their bounded confidence adjustments `[-0.25, +0.15]` and EV adjustments `[-0.1, +0.1]` are blended. Existing risk guardrails still hard-block.
- **Scheduling**: Vercel Cron triggers `/api/scheduled/autonomous-trading` (every 15 min) and `/api/scheduled/order-sync` (every 5 min). Local dev uses interval timers.

## One-time setup

1. **Create a Neon Postgres project** and copy the pooled `DATABASE_URL`.
2. **Generate strong secrets** for `JWT_SECRET`, `CREDENTIAL_ENCRYPTION_SECRET`, and `CRON_SECRET` (32+ random chars each).
3. **Get both an OpenAI API key and an Anthropic API key** for the duo reviewer.
4. Copy `.env.example` → `.env` and fill in values.
5. Install deps:
   ```bash
   corepack pnpm install
   ```
6. Push the schema to Neon:
   ```bash
   corepack pnpm db:push
   ```

## Local development

```bash
corepack pnpm dev
```

Visit http://localhost:5008 and log in with `OWNER_EMAIL` / `OWNER_PASSWORD`.

## Tests / typecheck / build

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## Deploying to Vercel

1. Import the repo in Vercel. Framework preset: **Vite**. Build command and output directory are pre-configured in `vercel.json`.
2. Set every variable from `.env.example` in **Project Settings → Environment Variables** (Production + Preview).
3. After the first deploy, run `corepack pnpm db:push` locally with the production `DATABASE_URL` exported to provision the schema. `runMigrations()` is a no-op at runtime — DDL is never run inside the serverless cold path.
4. Vercel Cron is configured in `vercel.json`:
   - `*/15 * * * *` → autonomous trading scan
   - `*/5 * * * *` → order/position sync
   Cron jobs authenticate via `Authorization: Bearer ${CRON_SECRET}`.

## How the AI duo trades

1. The autonomy job pulls open Kalshi markets and runs the heuristic signal generator (price/volume/sentiment/liquidity).
2. Heuristic signals are filtered by confidence, market conditions, and any active training instructions.
3. **OpenAI + Claude are the final reviewers** (`server/_core/tradingReviewer.ts`). Each returns JSON shaped like `{ reviews: [{ marketId, approved, confidenceAdjustment, expectedValueAdjustment, reasoning }] }`. Any veto, omission, malformed response, or timeout drops the signal. Dual approvals get bounded adjustments blended together.
4. The execution layer ranks remaining signals, computes risk-budgeted contract sizes, and only places an order if every guardrail passes (`kalshiRisk.ts`).
5. In `NODE_ENV=test`, duo review is bypassed for deterministic tests unless a test explicitly forces provider calls.

## Disarming live trading

- Toggle `liveTradingEnabled` off via the Trading Preferences page, or
- Activate the kill switch via the dashboard, or
- Unset `OWNER_PASSWORD` in production env (login becomes impossible until rotated).

## Repo layout

```
api/index.ts                    # Vercel serverless entrypoint
server/_core/app.ts             # Express factory; mounts /api/trpc + /api/scheduled/*
server/_core/auth.ts            # Owner credential check + JWT session
server/_core/tradingReviewer.ts # OpenAI + Claude reviewer (final go/no-go on signals)
server/_core/kalshiAutonomy.ts  # Scheduled autonomous trading run
server/routers.ts               # tRPC routers (auth, kalshi, training, advanced)
drizzle/schema.ts               # Postgres schema (16 tables)
client/src                      # React SPA
vercel.json                     # Vercel build + cron config
```

## Future platform expansion (post-Kalshi)

- Polymarket has a materially different wallet/signing and CLOB integration model.
- Manifold has public APIs, but its market mechanics and play-money/social use case do not map directly to Kalshi live-cash risk controls.
- PredictIt and similar legacy venues require fresh legal/API verification before any integration plan.

Before adding another exchange, introduce a platform adapter boundary with typed operations for credentials, account equity, market discovery, order placement, order sync, positions, and risk normalization. Then either add platform-aware generic ledgers or explicit platform columns/indexes so every order, fill, position, signal, audit event, and capital record remains user-scoped and exchange-scoped. The frontend should move from direct `kalshi` assumptions to a platform selector and capability-aware copy.

## Manus Forge endpoint

`https://forge.manus.ai` is a Manus-hosted Forge proxy endpoint. In this codebase, Forge settings are optional auxiliary infrastructure for app services such as LLM calls, data proxies, storage/map/notification helpers, or browser map proxying. They are separate from Kalshi and are not the API endpoint used to place trades.

For Kalshi launch testing, the important live-trading credentials are the user-connected Kalshi API key ID and private key entered through Connect Kalshi. Leave Forge variables blank unless a specific auxiliary feature you use requires them.

## Notes

- Optional analytics only load when both analytics environment variables are set.
- User Kalshi trading actions use the user's encrypted API key/private key pair and stay scoped to that user's ledger.
- Encrypted credential storage uses per-user AES-256-GCM envelopes derived from `CREDENTIAL_ENCRYPTION_SECRET`.
- The dashboard kill switch both disarms live trading and submits exchange close orders for the user's open positions.
- Autonomy policy editing is intentionally locked while live trading is armed; disarm, edit/save, then arm again.
