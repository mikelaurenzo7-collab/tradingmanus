# CLAUDE.md — Codebase guide for AI assistants

This file is the authoritative reference for GitHub Copilot, Claude Code, and
other AI coding assistants working in this repo.  Read it before making any
changes.

---

## Project summary

Single-owner prediction-market trading dashboard for **Kalshi** and **Polymarket**.
The AI component is a category-specialized Claude reviewer that screens every
heuristic-generated signal before any live order is placed.  The app runs as a
long-lived Express server on **Railway** (primary) or as a Vercel serverless
function (secondary).

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 8, Wouter, TanStack Query v5, Tailwind CSS v4, shadcn/ui, lucide-react, sonner toasts |
| Backend | Node 20, Express 4, tRPC v11 |
| Database | Neon Postgres (serverless HTTP driver), Drizzle ORM |
| Auth | JWT (24 h access / 7 d refresh) in `httpOnly` cookies, optional 2FA/TOTP |
| AI | Anthropic SDK direct (`@anthropic-ai/sdk`) — Claude review tier defaults to Haiku 4.5, deep tier escalates to Opus 4.7. Optional dual-bot consensus with Grok (xAI) when `XAI_API_KEY` is set. |
| Testing | Vitest 3, no jsdom (pure unit tests) |
| Build | `pnpm build` → Vite (frontend to `dist/public`), `pnpm build:server` → esbuild (backend to `dist/index.js`) |

---

## Commands

```bash
# Install (pnpm v10 — onlyBuiltDependencies enables native Tailwind/esbuild binaries)
corepack pnpm install

# Dev server (Vite HMR + tsx watch)
corepack pnpm dev

# Type check (no emit)
corepack pnpm check           # or: corepack pnpm typecheck

# Tests (all, no watch)
corepack pnpm test -- --run

# Run a single test file
corepack pnpm test -- --run server/kalshi.market-data.test.ts

# Build frontend (Vite)
corepack pnpm build

# Build backend (esbuild → dist/index.js)
corepack pnpm build:server

# DB schema push (Drizzle)
corepack pnpm db:push
```

All commands use **corepack pnpm** to ensure pnpm v10 from `packageManager` is
used.  Never use `npm` or `yarn` in this repo — the lockfile is
`pnpm-lock.yaml`.

---

## Key environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | ✅ | Neon pooled connection string |
| `JWT_SECRET` | ✅ | 32+ random chars |
| `CREDENTIAL_ENCRYPTION_SECRET` | ✅ | 32+ random chars, different from `JWT_SECRET` |
| `OWNER_EMAIL` | ✅ | Login email |
| `OWNER_PASSWORD` | ✅ | 12+ chars in production |
| `ANTHROPIC_API_KEY` | ✅ | Direct Anthropic API key — required for AI-reviewer-gated live trading. |
| `NODE_ENV` | ✅ | `development` / `production` |
| `LOG_LEVEL` | optional | `debug`/`info`/`warn`/`error` (default `info`) |
| `CLAUDE_MODEL` | optional | Bulk-review tier model (default `claude-haiku-4-5-20251001`) |
| `CLAUDE_TRIAGE_MODEL` | optional | Triage pre-filter model (default `claude-haiku-4-5-20251001`) |
| `CLAUDE_DEEP_MODEL` | optional | Deep-tier model for high-stakes / contested trades (default `claude-opus-4-7`) |
| `XAI_API_KEY` | optional | Grok (xAI) key for true dual-bot consensus. Without it, the reviewer gracefully degrades to Claude-only. |
| `GROK_MODEL` | optional | Default `grok-3-latest` |
| `ENABLE_GROK_TEAM` | optional | Default `true` — when `XAI_API_KEY` is set, both bots review every signal in parallel and both must approve. |
| `AI_DAILY_BUDGET_USD` | optional | Daily soft cap on the *pay-for-yourself* overrun = `(ai_cost + fees − realized_pnl)`.  Profitable days never throttle regardless of AI spend.  Net-negative days self-throttle as the deficit widens (×1.5 at 60% overrun, ×2 at 80%, ×4 at 95%, hard skip at 100%).  Cold-start exemption: under $5 AI spend, no throttle.  Resets at UTC midnight.  `0` or unset = unlimited.  See `server/_core/aiCostBudget.ts` + `server/_core/dailyScoreboard.ts`. |
| `AUTONOMY_INTERVAL_MS` | optional | Kalshi autonomy tick rate in ms (default `600000` = 10 min). At 10 min the heartbeat TTL aligns with cadence so near 0 % of reviews are wasted. Tighten to `60000` (1 min) only when you want sub-minute price-move responsiveness — adaptive cadence keeps the extra cost to ~15-20 % above the 10-min baseline. |
| `ORDER_SYNC_INTERVAL_MS` | optional | Kalshi order/position reconciliation + exit monitor cadence (default `30000` = 30 s) |
| `CROSS_ARB_INTERVAL_MS` | optional | Cross-platform arb scanner cadence (default `10000` = 10 s) |
| `SIGNAL_REVIEW_PRICE_DELTA_BPS` | optional | Adaptive cadence: skip AI review when a market hasn't moved this many basis points since last review (default `50` = 0.5 %) |
| `SIGNAL_REVIEW_STALE_TTL_MS` | optional | Adaptive cadence heartbeat: re-review every market at least this often regardless of price (default `600000` = 10 min) |
| `AUTO_CLOSE_ON_EXIT_SIGNAL` | optional | `true` to auto-close positions when stop-loss / profit-target hits (default `false` — emits audit signal only, lets operator validate first) |
| `POLYMARKET_OWNER_ADDRESS` | optional but recommended | Polymarket EOA proxy wallet (the `0x…` address from your Polymarket account page).  Used by the position-sync reconciliation to detect manual UI closes and refresh mark prices.  When unset the sync silently no-ops; you'll see a `[SelfTest] WARN polymarket_owner_address` line at boot. |
| `ALLOWED_ORIGIN` | optional | Extra CORS origin for production (e.g. Railway public URL) |
| `ALERT_WEBHOOK_URL` | optional | Webhook URL for ops alerts (consecutive failures, equity drops) |
| `PAPER_TRADE_MODE` | optional | `true` is a **global emergency override** — forces every user (including owner) into paper mode regardless of their per-user setting.  When unset/false, paper-vs-live is **per-user**: each user toggles `Trade Mode` in Trading Preferences (default = live).  See "Paper-mode policy" below. |

See `.env.example` for the full set.

---

## Repository layout

```
api/
  index.ts                    Vercel serverless entrypoint (wraps Express app)

server/
  routers.ts                  All tRPC routers (auth, kalshi, polymarket, training, advanced)
  db.ts                       Core DB helpers (audit log, positions, orders, capital…)
  db.training.ts              Training instructions + applyInstructionsToSignals
  db.kalshi-credentials.ts    Encrypted Kalshi API key storage / retrieval
  db.polymarket-credentials.ts Encrypted Polymarket credential storage
  db.trading-preferences.ts   Per-user trading config (risk posture, cadence…)
  db.desk-memory.ts           Desk learning tape (win/loss history per category)
  db.chat.ts                  Chat bot message persistence
  _core/
    index.ts                  Railway / local server entrypoint (starts Express + schedulers)
    app.ts                    Express factory — CORS, Helmet, CSRF, rate limiting, tRPC, static serving
    auth.ts                   Owner credential validation, JWT creation/verification
    context.ts                tRPC context (user from cookie/bearer)
    trpc.ts                   tRPC init + publicProcedure / protectedProcedure
    env.ts                    Validated env vars (throws on missing required)
    logger.ts                 Pino structured logger with redaction
    correlationId.ts          Request correlation-ID middleware
    cookies.ts                Cookie options factory
    csrf.ts                   CSRF double-submit protection
    rateLimiter.ts            express-rate-limit configs (api, auth, scheduled)
    twoFactor.ts              TOTP + backup-code logic (speakeasy)
    distributedLock.ts        Postgres-backed distributed lock for autonomy runs
    userMutex.ts              Per-user in-process async mutex for placeOrder
    fetchWithRetry.ts         HTTP retry helper (exponential backoff + jitter)
    circuitBreaker.ts         Circuit breaker (CLOSED/OPEN/HALF_OPEN, clock-injectable)
    alerting.ts               Ops alerting (Slack / webhook)

    kalshiAutonomy.ts         Scheduled Kalshi trading run (signal → review → execute)
    kalshiMarketData.ts       Kalshi market fetch + response validation + normalisation
    kalshiMarketFeed.ts       Real-time market feed (WebSocket / polling)
    kalshiMarketSnapshots.ts  Immutable timestamped market history persistence
    kalshiSignals.ts          Heuristic signal generators (value/momentum/contrarian/sentiment)
    kalshiRisk.ts             Position sizing, exposure calculations, risk guardrails
    kalshiExecution.ts        Order placement / cancellation / position close (REST)
    kalshiOrderSync.ts        Pending order reconciliation + position sync
    kalshiAuth.ts             Kalshi credential validation + equity fetch
    kalshiSentiment.ts        Multi-source sentiment scoring
    kalshiLearning.ts         Performance tracking + learning feedback loop
    kalshiAdvancedRisk.ts     Portfolio-level advanced risk calculations
    kalshiArbitrage.ts        Cross-expiry / cross-option arbitrage scanner
    kalshiCombinatorial.ts    Combinatorial arbitrage (multi-leg)
    kalshiBacktest.ts         Historical backtest runner
    kalshiPortfolioOptimization.ts  Kelly / mean-variance optimization helpers
    kalshiFunding.ts          Account funding helpers
    kalshiTrading.ts          Trading utility functions

    polymarketAutonomy.ts     Scheduled Polymarket trading run
    polymarketAuth.ts         Polymarket credential validation + order placement
    polymarketSignals.ts      Polymarket signal generators
    polymarketSignalReviewer.ts  Claude reviewer for Polymarket signals
    polymarketClusterMonitor.ts  Wash-trading cluster detection
    polymarketMarketMaking.ts    MM quote-pair / mispricing detection
    polymarketLearning.ts     Polymarket performance tracking
    polymarketRisk.ts         Polymarket risk guardrails

    tradingReviewer.ts        Claude reviewer entry point (Kalshi + cross-platform)
    arbitrageReviewer.ts      Claude reviewer for cross-platform arbitrage legs
    categoryPersonas.ts       16 desk persona system prompts (platform × category)
    marketCategoryRouter.ts   Market title → category classifier
    crossPlatformArbitrage.ts Kalshi ↔ Polymarket arbitrage scanner
    crossBotStrategies.ts     Multi-platform signal merging + cross-arb execution
    aiToolbelt.ts             Shared Anthropic call wrapper (caching, tools, telemetry)
    vite.ts                   Vite dev-server middleware + production static serving
    userScope.ts              User-scope helpers

drizzle/
  schema.ts                   Drizzle schema (30+ tables, all enums, type exports)

client/src/
  App.tsx                     Route definitions (Wouter)
  pages/                      Full-page React components
  components/                 Shared UI components (shadcn + custom)
  hooks/                      Custom React hooks (tRPC, auth, trading state)
  contexts/                   React contexts (auth, trading preferences)
  lib/                        Frontend utilities
  _core/                      Client-level constants + tRPC client setup
  const.ts                    Client-side constants
```

---

## Database schema (key tables)

| Table | Purpose |
|---|---|
| `users` | Single-owner account, 2FA secrets, role |
| `auditLog` | Immutable event log (every trade decision, risk block, reviewer call) |
| `kalshiCredentials` | AES-256-GCM encrypted Kalshi API key + private key |
| `kalshiMarkets` | Latest-known market view (upserted on each fetch) |
| `kalshiMarketSnapshots` | Immutable timestamped market history (append-only) |
| `kalshiSignals` | Saved signals with confidence, EV, reviewer reasoning |
| `kalshiOrders` | Order ledger (pending/filled/cancelled/rejected) |
| `kalshiPositions` | Open positions with entry price, quantity, PnL |
| `kalshiCapital` | Running account balance + drawdown tracking |
| `tradingPreferences` | Autonomy mode, risk posture, cadence, thresholds |
| `autonomyRuns` | One row per scheduled run — outcome, execution decision, reconciliation status |
| `trainingInstructions` + `instructionRules` + `instructionSchedules` | User-defined signal/market filters |
| `deskMemory` | Per-desk win/loss tape (12 lessons, injected into Claude prompts) |
| `distributedLocks` | Postgres-backed advisory lock for concurrent autonomy run prevention |
| `polymarketCredentials` | Encrypted Polymarket API credentials |
| `botConfigs` + `chatMessages` | Chat bot sessions |

---

## Critical patterns and conventions

### Never bypass risk guardrails
`kalshiRisk.ts` and `polymarketRisk.ts` contain the hard-block rules
(max position size, max loss per day, max open positions, capital check).
Claude's confidence/EV adjustments are additive only — they never override
a hard block.  Do not remove or weaken these checks.

### Order placement is per-user serialised
`placeOrder` (Kalshi) wraps the entire check-and-execute block in
`withUserLock(userId, …)` from `server/_core/userMutex.ts`.  This prevents
TOCTOU races where two concurrent requests both pass risk checks against
stale state.  **Do not remove this mutex without adding equivalent
transaction isolation.**

### Audit every significant event
Use `db.logAuditEvent(eventType, jsonPayload, openId)` for:
- Every order placement and cancellation
- Every risk block
- Every autonomy run (start, skipped, executed, error)
- Every AI reviewer call failure
- Every signal pipeline run (emits `kalshi_signal_pipeline` with
  per-stage counts)

### Kalshi market responses are validated at the boundary
`normalizeKalshiMarket` in `kalshiMarketData.ts` drops any raw market
object that is null/non-object, has no valid ID, has prices outside `[0,1]`,
non-finite prices, or negative volumes.  Raw Kalshi cent-scale prices
(`yes_price` 0..100) are converted explicitly via `centsToDollars`.  
**Do not loosen these guards.**

### Resilience wrappers
All Kalshi market-data fetches go through:
1. `fetchWithRetry` — retries on transient HTTP errors (5xx, 408, 425, 429)
   with exponential back-off + jitter
2. `kalshiBreaker` (a `CircuitBreaker`) — trips after 5 failures in 30 s,
   fails fast for 30 s, half-open probe on recovery

Both are in `server/_core/`.  Use the same pattern for any new external HTTP call.

### Tests
- Location: `server/*.test.ts` (not inside `_core/`)
- **All external dependencies are mocked** — `vi.mock(…)` at the top of
  every test file; actual HTTP calls and DB calls never fire in the test suite
- Test for the `kalshi_signal_pipeline` audit event: `server/kalshi.autonomy.test.ts`
- Test for `withUserLock`: `server/user-mutex.test.ts`
- Baseline: **368 tests passing** (`corepack pnpm test -- --run`)
- After any change, run `corepack pnpm check && corepack pnpm test -- --run`
  before committing

### TypeScript
- `tsconfig.json` targets `ESNext`, `moduleResolution: bundler`
- `strict: true` enforced — no `@ts-ignore` without a comment explaining why
- Server code uses ESM (`"type": "module"` in `package.json`)

---

## AI reviewer architecture

```
generateSignalsForMarkets()         ← heuristic signals (kalshiSignals.ts)
  │
  ▼
filterSignalsByConfidence()         ← drop below minConfidence threshold
  │
  ▼
filterSignalsByMarketConditions()   ← drop illiquid / poor-condition markets
  │
  ▼
applyInstructionsToSignals()        ← apply user training rules
  │
  ▼
reviewSignalsWithTrader()           ← AI review via direct Anthropic SDK (tradingReviewer.ts)
┌─────────────────────────────────────────────────────────────────┐
│  1. Haiku 4.5 triage pre-filter (if >threshold candidates)      │
│  2. Per-desk review with 16 category personas (Haiku 4.5 bulk)  │
│  3. Optional parallel Grok review (when ENABLE_GROK_TEAM + key) │
│     → both bots must approve (true dual-bot consensus)          │
│  4. Opus 4.7 deep-tier escalation for contested mid-stakes      │
│     trades and high-stakes signals (notional, near-resolution,  │
│     extreme-tail implied probability)                           │
│  5. Confidence/EV adjustments applied (bounded)                 │
│  6. Desk memory tape injected into each desk's system prompt    │
│  Anthropic-native features ON: prompt caching (cache_control),  │
│  web_search tool, extended thinking on the deep tier.           │
└─────────────────────────────────────────────────────────────────┘
  │
  ▼
getTopSignalsForExecution()         ← rank by execution score
  │
  ▼
evaluateExecutionCandidate()        ← risk checks + sizing
  │
  ▼
placeKalshiOrder()                  ← Kalshi REST (wrapped in withUserLock)
```

**Audit event emitted at every stage:**
- `kalshi_signal_pipeline` — per-filter-stage counts
- `kalshi_reviewer_telemetry` — token usage, cache hit ratio, escalation counts
- `scheduled_autonomy_run_executed` / `generated_only` / `skipped` / `error`
- `kalshi_order_placed` / `kalshi_order_blocked_or_failed`
- `kalshi_position_exit_signal` — stop-loss or profit-target trigger (auto-close gated by `AUTO_CLOSE_ON_EXIT_SIGNAL`)
- `kalshi_position_closed` / `kalshi_position_close_failed`

---

## Exit monitor (stop-loss + profit targets)

Independent of the autonomy pipeline above, `server/_core/exitMonitor.ts`
runs every `ORDER_SYNC_INTERVAL_MS` (default 30 s) for every open Kalshi
position:

```
syncLivePositions()                   ← reflect Kalshi positions into DB
  │
  ▼
evaluateExitsForOpenPositions()       ← exitMonitor.ts
  │  for each open position:
  │    1. read current market price from kalshiMarkets table
  │    2. initializeExitStrategy(entry, side, vol=0.15)  ← stateless recompute
  │    3. checkExitConditions(state, currentPrice)
  │
  ├── if shouldExit:
  │     emit `kalshi_position_exit_signal` audit event always
  │     if AUTO_CLOSE_ON_EXIT_SIGNAL=true: closeKalshiPosition() (real reverse order)
  │
  └── else: continue
```

Per-position state (high-water mark, trailing stop level, hit profit
targets) is persisted in the `kalshiPositions.exitState` JSONB column so
the trailing stop ratchets across ticks without regression.  Schema
push (`pnpm db:push`) is required after pulling this — drizzle-kit will
add the column non-destructively as a nullable JSONB; rows that pre-date
it are treated as fresh state.

---

## Git workflow

- Feature branches: `feature/<slug>` off `main`
- Merge with `--no-ff` to preserve branch structure
- Conventional commits: `feat(scope):`, `fix(scope):`, `chore(scope):`
- All tests + typecheck must pass before merging
- Never force-push `main`

---

## Deployment

### Railway (only deploy target)
- `railway.json` sets `builder: DOCKERFILE`
- `Dockerfile` pins Node 20 + pnpm 10.4.1, runs `pnpm install --frozen-lockfile && pnpm build && pnpm build:server`, starts `pnpm start`
- `pnpm.onlyBuiltDependencies` in `package.json` allows `@tailwindcss/oxide` and `esbuild` postinstall scripts (Tailwind v4 native binary — **required** for the Vite build)
- **Schema migrations are auto-applied on deploy** via `pnpm migrate:apply` in the start script (`pnpm start` = `pnpm migrate:apply && node dist/index.js`).  The runner is a small custom script (`scripts/applyMigrations.ts`) that:
    1. Creates a `migrations_log` tracking table on first run.
    2. Reads `drizzle/migrations/*.sql` files in lexicographic (0001_, 0002_, …) order.
    3. Runs each unapplied file inside a single Neon HTTP request (multi-statement supported).
    4. Records the filename in `migrations_log` so reruns are idempotent at the runner level.
  Migrations are also expected to be **idempotent at the SQL level** (use `ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, etc.) so that hand-applied changes via Neon's SQL editor don't break the runner on the next deploy.
- **Adding a new migration**: drop a new SQL file in `drizzle/migrations/` using the next sequential number.  No code change needed; the next deploy applies it.
- **`pnpm db:push` is still available** for fast iteration during development, but production should use the migration files committed to the repo.
- Liveness probe: `GET /api/health/live` (Railway restart policy is wired here — never touches the DB so a Neon outage cannot cause a restart loop)
- Schedulers run **in-process** (`server/_core/index.ts`):
  - Kalshi autonomy: every `AUTONOMY_INTERVAL_MS` (default 10 min)
  - Kalshi order sync: every `ORDER_SYNC_INTERVAL_MS` (default 30 s)
  - Cross-platform arb scanner: every `CROSS_ARB_INTERVAL_MS` (default 10 s, in-flight guarded)
- The Vercel serverless entry (`api/index.ts`) and `vercel.json` were removed in the Railway-only consolidation pass; if a Vercel deploy is ever needed again, see git history for the prior shape.

### External monitoring (recommended)
- Point an uptime monitor (Better Uptime, Cronitor, Pingdom, or Railway's external check)
  at `GET /api/health/ready` — it returns 503 if the DB is unreachable, so it pages
  before failed trades start accumulating in the audit log.
- Set `ALERT_WEBHOOK_URL` to a Slack/Discord/PagerDuty inbound webhook to receive
  proactive alerts on consecutive autonomy failures, equity drops, and exchange
  rejections (emitted via `server/_core/alerting.ts`).
- The `/api/health` endpoint also surfaces DB latency, scheduler runtime, and
  uptime in its body — useful for dashboard scrapers.

---

## Boot behaviour (Railway)

`server/_core/index.ts` runs `runStartupSelfTest()` immediately after the
HTTP server starts listening:

- **All checks pass** → Schedulers arm, autonomy starts firing in 30 s.
- **Any FAIL in production** → Schedulers do **NOT** arm, but the HTTP
  server stays up.  This is deliberate: a crash-loop hides the diagnostic
  in restart noise, while a running-but-degraded server keeps `/api/health/*`
  reachable so the operator can inspect the [SelfTest] log lines in
  Railway, fix the env var (`ANTHROPIC_API_KEY`, `DATABASE_URL`,
  `CREDENTIAL_ENCRYPTION_SECRET`), and redeploy without watching the
  container restart loop.
- **Schema migrations missing** (e.g. `kalshiPositions.exitState` after a
  fresh deploy) → emits a WARN, not a FAIL.  Exit monitor falls back to
  re-initialising state every tick (trailing stops won't ratchet across
  ticks, but everything else works).

The startup-fatal failures (DB unreachable, app construction throws) still
crash hard so Railway's restart policy kicks in — those are non-recoverable.

---

## Polymarket position sync

`server/_core/polymarketPositionSync.ts:syncPolymarketPositions(userId)` runs
inside every order-sync tick (default 30 s) and reconciles the local
`polymarketPositions` rows against the Polymarket data-api response:

```
GET https://data-api.polymarket.com/positions?user=<POLYMARKET_OWNER_ADDRESS>
```

For each remote position the sync UPSERTs the local row (refreshing
`sizeUsdc`, `currentPrice`, `unrealizedPnl`).  For each local row marked
`open` whose tokenId is **absent** from the remote response, the sync
marks the row `closed` and emits a `polymarket_position_drift_closed`
audit event — this is the manual-UI-close detection.

Without it, manually closing a Polymarket position via the Polymarket
website would leave the local DB thinking it's still open; the exit
monitor would then re-attempt to close a vanished position every cycle
and log "insufficient balance" indefinitely.

The sync requires `POLYMARKET_OWNER_ADDRESS` to be set to your EOA
proxy wallet (the address shown on your Polymarket account / deposit
page).  When unset it silently no-ops; the startup self-test surfaces
a WARN line so you notice before going live.

The data API is unauthenticated for public position reads, so no API
key is required for the sync itself — only for placing orders (which
goes through the existing CLOB credentials).

---

## Adaptive cadence (AI cost gate)

`server/_core/adaptiveCadence.ts` skips the AI reviewer for markets whose
price hasn't moved materially since their last review.  Tunable via env:

- `SIGNAL_REVIEW_PRICE_DELTA_BPS` (default `50` = 0.5 %) — minimum price
  change required to re-review.
- `SIGNAL_REVIEW_STALE_TTL_MS` (default `600000` = 10 min) — heartbeat:
  even quiet markets get re-reviewed at least this often.

Empirically this skips ~70-85 % of cycle candidates, so AI cost drops 3-5×
for the same cadence.  Or equivalently, you can tighten `AUTONOMY_INTERVAL_MS`
to 60 s — adaptive cadence absorbs the extra ticks so actual Anthropic spend
increases only ~15-20 % vs the 10-min default.

Each autonomy run emits a `kalshi_adaptive_cadence_skipped` /
`polymarket_adaptive_cadence_skipped` audit event with the skipped count
+ first 50 market IDs + cache telemetry, so the operator can verify the
gate is working.

---

## Paper-mode policy (per-user)

`server/_core/effectivePaperMode.ts:getEffectivePaperTradeMode(userId)` resolves
each order/cancel/close call to either paper or live, in this order:

1. `ENV.paperTradeMode === true` → **everyone** is paper.  Global
   emergency kill-switch — flip the env var, redeploy, all real trading
   stops immediately regardless of per-user settings.
2. `tradingPreferences.paperTradeMode === 1` for this user → **paper**.
   Per-user opt-in toggle exposed in the dashboard's Trading Preferences
   page ("Trade Mode" section).  Default is `0` (live).
3. Otherwise → **live**.

This shape lets every authenticated user choose live or paper without
operator intervention.  The closed-beta gate that previously blocked
non-owners has been removed.  Owner identity is no longer special —
just another user with their own preferences.

Safety unchanged: live trading still requires the user to:
- Connect Kalshi credentials (`accountStatus = 'connected'`)
- Set `tradingPreferences.liveTradingEnabled = 1`
- Set `autonomyMode != 'manual'` and `executionCadence != 'manual_only'`
- Pass profitGuardrails (env-tunable EV/confidence floors, exposure caps)
- Stay within their per-user `maxOrderNotional` + `maxDailyOrders` caps

The result is cached per-userId for 5 minutes, so an autonomy run that
opens one Kalshi order + one Polymarket order pays a single
`tradingPreferences` read regardless of how many positions are evaluated
by exit monitors during the same tick.

If the lookup fails (DB outage etc.), the resolver returns `true`
(paper) — defaulting to live on failure would silently let real orders
through during a transient outage.

---

## Security invariants

1. **CSRF**: all state-changing tRPC calls go through `csrfProtection` middleware (double-submit cookie)
2. **Rate limiting**: `/api/trpc/auth.*` uses `authLimiter`; `/api/scheduled/*` uses `scheduledLimiter`
3. **Credential encryption**: Kalshi + Polymarket API keys are stored AES-256-GCM encrypted under `CREDENTIAL_ENCRYPTION_SECRET`. **Never log or return raw credentials.**
4. **JWT validation**: `protectedProcedure` validates the access token on every call. Refresh tokens are JWT-verified but **not** denylisted on use; a leaked refresh token is replayable for its full 7-day TTL. Single-use rotation is on the roadmap and requires a `refreshTokenJti` denylist table.
5. **Distributed lock**: `distributedLock.ts` uses Postgres to ensure only one autonomy run per user is in-flight at a time.
6. **Input validation**: all tRPC inputs are Zod-validated; Kalshi API responses are validated in `normalizeKalshiMarket` before any downstream code sees them.

---

## Common pitfalls

- **`pnpm install` silently skips native build scripts** unless `onlyBuiltDependencies` lists them. If Tailwind or esbuild suddenly produces "Cannot find native binding", run `pnpm rebuild @tailwindcss/oxide esbuild`.
- **Fake-timer tests with unhandled rejections**: when using `vi.useFakeTimers()`, attach `expect(promise).rejects.toThrow()` *before* calling `vi.runAllTimersAsync()`, otherwise the rejection fires without a handler and pollutes the test run.
- **Circuit breaker clock injection**: `CircuitBreaker` accepts a `now: () => number` option. Always inject a deterministic clock in tests instead of relying on `Date.now()`.
- **`applyInstructionsToSignals` vs `applyInstructionsToMarkets`**: the former filters signals after generation; the latter filters markets before generation. Both exist and are called in `generateScheduledSignals`.
- **Kalshi prices are cent-scale in raw API responses** (`yes_price` = 42 means $0.42). `normalizeKalshiMarket` handles conversion via `centsToDollars`. Do not divide by 100 elsewhere in the pipeline.
