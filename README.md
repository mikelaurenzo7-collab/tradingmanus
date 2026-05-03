# Laurenzo Kalshi Trading Dashboard

Single-owner Kalshi + Polymarket trading console with a **Claude-primary, category-specialized AI reviewer** (and OpenAI as an optional fallback / high-stakes second opinion). Designed to run on **Vercel** with a **Neon Postgres** database.

## 🔒 Security Features

This application includes comprehensive security features:
- **2FA/MFA**: Time-based one-time passwords (TOTP) with backup codes
- **Rate Limiting**: Protection against brute force and DDoS attacks
- **CSRF Protection**: Double-submit cookie pattern for all mutations
- **JWT Tokens**: 24-hour access tokens with 7-day refresh tokens
- **PBKDF2 Encryption**: 100k iterations for credential encryption
- **Distributed Locking**: PostgreSQL advisory locks for autonomous trading
- **Structured Logging**: Pino-based logging with sensitive data redaction
- **Request Tracing**: Correlation IDs for distributed request tracking
- **Security Headers**: Helmet.js for XSS, clickjacking, and other protections

📖 **See [SECURITY.md](./SECURITY.md) for detailed documentation**
📖 **See [SECURITY_MIGRATION.md](./SECURITY_MIGRATION.md) for migration guide**

## Architecture

- **Frontend**: React 19 + Vite + Wouter + tRPC + TanStack Query + Tailwind v4 + shadcn UI
- **Backend**: Express + tRPC, deployed as a single Vercel function at `api/index.ts`
- **Database**: Neon Postgres via `@neondatabase/serverless` HTTP driver + `drizzle-orm/neon-http`
- **Auth**: Owner-only password login with optional 2FA/MFA. JWT access tokens (24h) + refresh tokens (7d) in httpOnly cookies.
- **Security**: Rate limiting, CSRF protection, PBKDF2 encryption, distributed locking, structured logging
- **AI**: Claude is the primary reviewer for every candidate signal on both Kalshi and Polymarket. Each candidate is routed by category (sports / crypto / politics / economics / tech / culture / weather) to a domain-expert desk persona. Claude calls use prompt caching, the `web_search_20250305` tool for fresh news context, and extended thinking on high-stakes trades. OpenAI is an optional **fallback** (used when Claude fails to return a review for a market) and an optional **second-opinion escalation** (consulted on high-stakes trades, where both providers must approve). Bounded confidence adjustments `[-0.25, +0.15]` and EV adjustments `[-0.1, +0.1]` are blended. Existing risk guardrails still hard-block.
- **Scheduling**: Vercel Cron triggers `/api/scheduled/autonomous-trading` (every 15 min) and `/api/scheduled/order-sync` (every 5 min). Local dev uses interval timers.

## One-time setup

1. **Create a Neon Postgres project** and copy the pooled `DATABASE_URL`.
2. **Generate strong secrets** for `JWT_SECRET`, `CREDENTIAL_ENCRYPTION_SECRET`, and `CRON_SECRET` (32+ random chars each):
   ```bash
   openssl rand -base64 32  # Run this 3 times for each secret
   ```
3. **Get an Anthropic API key** (required — Claude is the primary reviewer). An **OpenAI API key** is optional but recommended for fallback + high-stakes second opinion.
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

## Deploying to Railway

See [`RAILWAY.md`](./RAILWAY.md) for full step-by-step instructions. In short:
import the repo in Railway, set every variable from `.env.example` (Railway
sets `PORT` itself; `CRON_SECRET` is unused because the long-running Express
server runs the autonomous-trading and order-sync schedulers in-process), and
let the platform run the build + start commands defined in `railway.json`.

## Deploying to Vercel

1. Import the repo in Vercel. Framework preset: **Vite**. Build command and output directory are pre-configured in `vercel.json`.
2. Set every variable from `.env.example` in **Project Settings → Environment Variables** (Production + Preview).
3. After the first deploy, run `corepack pnpm db:push` locally with the production `DATABASE_URL` exported to provision the schema. `runMigrations()` is a no-op at runtime — DDL is never run inside the serverless cold path.
4. Vercel Cron is configured in `vercel.json`:
   - `*/15 * * * *` → autonomous trading scan
   - `*/5 * * * *` → order/position sync
   Cron jobs authenticate via `Authorization: Bearer ${CRON_SECRET}`.

## How the AI bots trade

1. The autonomy job pulls open Kalshi (and/or Polymarket) markets and runs the heuristic signal generator (price/volume/sentiment/liquidity, plus Polymarket cluster-monitor signals).
2. Heuristic signals are filtered by confidence, market conditions, and any active training instructions.
3. **Per-category dispatch.** Each candidate signal is classified into `sports | crypto | politics | economics | tech | culture | weather | other` (`server/_core/marketCategoryRouter.ts`) and routed to a domain-expert desk persona (`server/_core/categoryPersonas.ts`). There are 16 personas total — one per `(platform, category)` — so a Kalshi crypto signal and a Polymarket politics signal are reviewed under different specialist mandates.
4. **Claude reviews everything.** The Anthropic call uses prompt caching on the static system mandate (cuts input cost ~90% at high cadence), enables the hosted `web_search_20250305` tool so the reviewer can pull fresh news for fast-moving markets, and turns on extended thinking for high-stakes trades. Model tier is automatic: Sonnet for normal review, Opus when the trade is high-stakes.
5. **OpenAI is optional fallback + second opinion.**
   - Normal-stakes trade, Claude approves → trade proceeds on Claude's verdict alone.
   - Normal-stakes trade, Claude omits a market → OpenAI's review acts as the fallback gate (if configured).
   - High-stakes trade (notional ≥ $25, near-resolution, or `confidence ≥ 0.9`) → both Claude and OpenAI must approve.
6. Each reviewer returns JSON shaped like `{ reviews: [{ marketId, approved, confidenceAdjustment, expectedValueAdjustment, reasoning }] }`. Vetoes drop the signal. Approvals get bounded adjustments blended together.
7. The execution layer ranks remaining signals, computes risk-budgeted contract sizes, and only places an order if every guardrail passes (`kalshiRisk.ts`, `polymarketRisk.ts`).
8. In `NODE_ENV=test`, AI review is bypassed for deterministic tests unless a test explicitly forces provider calls (`skipInTest: false`).

### Per-desk memory tape

Each desk keeps its own persistent learning tape in the `deskMemory` Postgres table — one row per `(userId, platform, deskId)`. After a trade resolves, callers append a short lesson via `recordDeskTradeOutcome({ userId, platform, marketCategory, outcome, note })`. Before each review run, the tape (capped to the last 12 lessons + win-rate header) is loaded and injected into the Claude system prompt as a *separate* cached block so the persona block stays cache-warm even when memory updates between runs. Disable with `ENABLE_AI_DESK_MEMORY=false`.

### Haiku triage pre-filter

When a category bucket has more than `AI_TRIAGE_THRESHOLD` (default 12) candidates, the bot first runs a single cheap Haiku call (`ANTHROPIC_TRIAGE_MODEL`, default `claude-haiku-4-5`) that returns the marketIds worth keeping. Sonnet/Opus then only review the survivors. If triage fails for any reason, the bot falls through to reviewing everything (capital preservation > cost). Disable with `ENABLE_AI_TRIAGE=false`.

### Citations on reasoning

When Claude uses `web_search_20250305` to gather context, the reviewer parses the response's citation blocks and appends a short `[cites: espn.com, nyt.com]` tag to the saved signal reasoning so the audit trail shows which sources supported the call. Disable with `ENABLE_AI_CITATIONS=false`.

### Cross-platform arbitrage AI desk

`server/_core/arbitrageReviewer.ts` adds a Claude-only review layer on top of the deterministic `crossPlatformArbitrage.ts` scanner. The scanner finds Kalshi ↔ Polymarket pairs whose YES prices diverge enough that arbitrage is theoretically profitable; the reviewer rejects the ones that look like edge but actually aren't (different resolution criteria, stale data on one side, evaporating liquidity, settlement asymmetry). Approved opportunities come back annotated with a `sizeFraction ∈ [0, 1]` so the caller's risk-budget layer can scale leg sizing accordingly. Always uses extended thinking + web_search since multi-leg trades are by definition high-stakes.

### Reviewer telemetry

Each autonomy run captures per-run telemetry — Anthropic prompt-cache read/creation tokens, cache-hit ratio, web_search invocations, extended-thinking invocations, triage drop counts, per-provider call/failure counts — and writes it to the audit log under `kalshi_reviewer_telemetry` / `polymarket_reviewer_telemetry`. Tail those events to see how well caching is paying off in production and how often the bots are reaching for fresh news.

### Specialized desks

| Platform | Desk | Focus |
|---|---|---|
| Kalshi / Polymarket | Sports | Win-probability vs sportsbook consensus, lineup/injury news |
| Kalshi / Polymarket | Crypto | Price-threshold vs event contracts, vol calibration, oracle risk |
| Kalshi / Polymarket | Politics | Polls + base rates, indictment/court-date risk, candidate viability |
| Kalshi / Polymarket | Economics | Consensus vs surprise, FOMC blackout windows, release timing |
| Kalshi / Polymarket | Tech | Launch-slip discounting, firm-dated vs rumored catalysts |
| Kalshi / Polymarket | Culture | Awards forecasts, opening-weekend tracking, recency bias |
| Kalshi / Polymarket | Weather | Ensemble spread, climate base rates |
| Kalshi / Polymarket | Generalist | Fallback for unmapped markets — defaults to skepticism |

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
