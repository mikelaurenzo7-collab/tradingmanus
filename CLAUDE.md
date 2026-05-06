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
| AI | OpenRouter (default model: `tencent/hy3-preview:free`) with Anthropic-compatible interface |
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
| `OPENROUTER_API_KEY` | ✅ | AI reviewer via OpenRouter — required for any live trading. `ANTHROPIC_API_KEY` accepted as fallback. |
| `NODE_ENV` | ✅ | `development` / `production` |
| `CRON_SECRET` | Vercel only | Bearer token for Vercel Cron jobs (32+ chars) |
| `LOG_LEVEL` | optional | `debug`/`info`/`warn`/`error` (default `info`) |
| `OPENROUTER_MODEL` | optional | Default `tencent/hy3-preview:free` |
| `ALLOWED_ORIGIN` | optional | Extra CORS origin for production (e.g. Railway public URL) |
| `ALERT_WEBHOOK_URL` | optional | Webhook URL for ops alerts (consecutive failures, equity drops) |
| `PAPER_TRADE_MODE` | optional | `true` to simulate orders without placing real trades |

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
reviewSignalsWithTrader()           ← AI review via OpenRouter (tradingReviewer.ts)
┌─────────────────────────────────────────────────────────────────┐
│  1. Triage pre-filter (if >threshold candidates) via same model │
│  2. Per-desk review with 16 category personas                   │
│  3. Intra-model second pass for high-stakes or contested signals│
│  4. Confidence/EV adjustments applied (bounded)                 │
│  5. Desk memory tape injected into each desk's system prompt    │
│  Note: web_search + extended thinking disabled (OpenRouter)     │
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

---

## Git workflow

- Feature branches: `feature/<slug>` off `main`
- Merge with `--no-ff` to preserve branch structure
- Conventional commits: `feat(scope):`, `fix(scope):`, `chore(scope):`
- All tests + typecheck must pass before merging
- Never force-push `main`

---

## Deployment

### Railway (primary)
- `railway.json` sets `builder: DOCKERFILE`
- `Dockerfile` pins Node 20 + pnpm 10.4.1, runs `pnpm install --frozen-lockfile && pnpm build && pnpm build:server`, starts `pnpm start`
- `pnpm.onlyBuiltDependencies` in `package.json` allows `@tailwindcss/oxide` and `esbuild` postinstall scripts (Tailwind v4 native binary — **required** for the Vite build)
- **Schema migrations are manual.** Before deploying any commit that changes `drizzle/schema.ts`, run `corepack pnpm db:push` against the production `DATABASE_URL` from a workstation. We do **not** run `db:push` automatically in `preDeployCommand` because `drizzle-kit push` is interactive: in a non-TTY release environment it would either hang on destructive prompts or auto-skip them, leaving the running server with a schema mismatch. If you want auto-applied migrations, switch to a versioned `drizzle/migrations` folder + `drizzle-kit migrate`.
- Liveness probe: `GET /api/health/live` (Railway restart policy is wired here — never touches the DB so a Neon outage cannot cause a restart loop)
- Schedulers run **in-process**: autonomy every 15 min, order sync every 30 sec
- `CRON_SECRET` is not needed on Railway

### Vercel (secondary)
- One serverless function: `api/index.ts`
- `vercel.json` handles rewrites, cron config, build command
- Cron jobs authenticate with `Authorization: Bearer ${CRON_SECRET}`

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
