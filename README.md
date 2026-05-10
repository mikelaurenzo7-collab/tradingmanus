# Personal Kalshi Trading Dashboard

Single-owner autonomous trading dashboard for **Kalshi** (primary) with
optional **Polymarket** modules.  Heuristic signal generation gated by a
multi-tier Claude AI reviewer, percentage-based risk that auto-scales with
live account equity, and full audit-log coverage of every decision.

> No guarantees — trading involves real risk of loss.  The guardrails below
> exist to filter low-edge / ambiguous trades, not to eliminate risk.

---

## Architecture

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite 8 + Wouter + TanStack Query v5 + Tailwind v4 + shadcn/ui |
| Backend | Node 20 + Express 4 + tRPC v11 |
| Database | Neon Postgres (serverless HTTP driver) + Drizzle ORM |
| Auth | JWT (24h access / 7d refresh) in httpOnly cookies, optional TOTP 2FA |
| AI | Anthropic SDK direct — Haiku 4.5 → Sonnet 4.6 → Opus 4.7 escalation |
| Build | Vite (frontend → `dist/public`), esbuild (backend → `dist/index.js`) |
| Deploy | Railway (Docker), schedulers run in-process |

---

## Trading pipeline

```
heuristic signal generation (server/_core/kalshiSignals.ts)
        │
        ▼
confidence + market-condition + training-rule filters
        │
        ▼
(optional) free OpenRouter pre-triage  ←  drops obvious junk, never approves
        │
        ▼
Tier 1: Claude Haiku 4.5  (every reviewed signal, prompt-cached)
        │
        ├── (optional) parallel Grok review when ENABLE_GROK_TEAM=true
        ▼
Tier 2: Claude Sonnet 4.6 (high-stakes / contested signals)
        │
        ▼
Tier 3: Claude Opus 4.7  (catastrophic-bet unanimous gate, ≥10% capital)
        │
        ▼
profit-guardrail entry gate  →  Kelly sizing  →  per-user mutex
        │
        ▼
Kalshi REST order placement (RSA-PSS signed)
        │
        ▼
order-sync + exit-monitor (30s tick, runs 24/7)
```

Every stage emits a typed audit-log event (`kalshi_signal_pipeline`,
`kalshi_reviewer_telemetry`, `kalshi_order_placed`,
`kalshi_position_exit_signal`, …).

---

## Profit guardrails

All thresholds are **percentages of live Kalshi capital** (read from
`server/_core/liveCapital.ts`, 30s cache).  When your balance changes,
caps scale automatically — no redeploy.

| Gate | Default | ENV override |
|---|---|---|
| Net EV (after exact Kalshi fees + amortized AI cost) | ≥ 2.5 % | `MIN_NET_EV` |
| Confidence after AI adjustment | ≥ 60 % | `MIN_CONFIDENCE_AFTER_ADJUST` |
| Kelly sizing fraction | ½ Kelly | `KELLY_FRACTION` |
| Kelly max position | 25 % capital | `KELLY_MAX_PCT_OF_CAPITAL` |
| Kelly min position | 1 % capital | `KELLY_MIN_PCT_OF_CAPITAL` |
| Per-trade outer cap | 6 % capital | `MAX_RISK_PER_TRADE_PERCENT` |
| Total open exposure | 35 % capital | `MAX_PORTFOLIO_EXPOSURE_PCT` |
| Per correlated category | 15 % capital | `MAX_CORRELATED_GROUP_PCT` |
| Min market liquidity | $40k | `MIN_LIQUIDITY_USD` |
| Daily drawdown breaker | 5 % | `DAILY_DRAWDOWN_PAUSE_FRAC` |
| Weekly drawdown breaker | 12 % | `WEEKLY_DRAWDOWN_PAUSE_FRAC` |
| Daily loss USD stop | $20 | `DAILY_LOSS_LIMIT_USD` |
| Cold streak | 6 losses or 7-day edge < 3 % | `COLD_STREAK_LOSS_COUNT` |

The `MAX_RISK_PER_TRADE_PERCENT` outer cap binds *before* `KELLY_MAX_PCT_OF_CAPITAL`,
so it's the hardest single-order constraint.

`DAILY_LOSS_LIMIT_USD` is a hard daily stop — when the day's realized net
P&L drops below `-DAILY_LOSS_LIMIT_USD`, every autonomy tick is skipped
until UTC midnight (emits `kalshi_daily_loss_limit_triggered`).

---

## AI reviewer tiers

| Tier | Model | Triggers |
|---|---|---|
| 1 | Claude Haiku 4.5 | every reviewed signal (batch, prompt-cached) |
| 2 | Claude Sonnet 4.6 | high-stakes signals: ≥3% capital, ≤24h to resolution, or self-consistency split |
| 3 | Claude Opus 4.7 | gross EV ≥5% AND Tier-2 disagreement, OR catastrophic-bet (≥10% capital) — Tier 3 is a *unanimous gate* (all reviewers must approve) |

`ANTHROPIC_API_KEY` is required.  Autonomy fails closed if the key is
missing — high-stakes signals are explicitly refused rather than approved
without escalation review.

### Optional reviewers
- **Grok (xAI)** — set `XAI_API_KEY` and `ENABLE_GROK_TEAM=true` for parallel dual-bot consensus on Tier 2 (alternate reviewer for breaking-news categories with ≤72h resolution).  Without it, the system gracefully degrades to Claude-only.
- **OpenRouter free pre-triage** — set `OPENROUTER_API_KEY` to run a free model (default Qwen3 235B) before paid Claude review.  It drops obvious junk; it never approves trades; on errors it fails open to the full paid stack.

---

## Schedulers (in-process, Railway)

| Scheduler | Default | Notes |
|---|---|---|
| Kalshi autonomy | 10 min (prime) / 40 min (overnight) | Time-of-day adaptive — see below |
| Order sync + exit monitor | 30 s | Runs 24/7 — open positions need overnight stop-loss |
| Combinatorial arb scanner | 60 s | Risk-free math, no AI cost, detection-only |
| Wikipedia edit watcher | 5 min | Free real-time signal on watched politicians/companies |
| Daily plays (sports / moonshot) | 5 min poll | Idempotent within a UTC day |
| Weekly Brier calibration | 7 days | Reviewer score recalibration |
| Audit-log cleanup | 24 h | Purges entries older than `AUDIT_LOG_RETENTION_DAYS` (default 90) |

### Time-of-day adaptive cadence

Kalshi liquidity is heavily US-skewed.  The autonomy scheduler runs at
the `AUTONOMY_INTERVAL_MS` base interval during US prime hours, then
slows by `AUTONOMY_OVERNIGHT_MULTIPLIER` (default 4×) during quiet hours.

| Tier | UTC window | ET window | Cadence |
|---|---|---|---|
| prime | 13:00–05:00 | 9am–1am ET | base interval |
| overnight | 05:00–13:00 | 1am–9am ET | 4× slower |

Tunable via `AUTONOMY_PRIME_START_UTC_HOUR`, `AUTONOMY_PRIME_END_UTC_HOUR`,
`AUTONOMY_OVERNIGHT_MULTIPLIER`.  Order sync + exit monitor are NOT
slowed — open positions still need overnight monitoring.

---

## Database (Drizzle / Neon Postgres)

Selected tables — full schema in [drizzle/schema.ts](drizzle/schema.ts):

| Table | Purpose |
|---|---|
| `users` | Owner account, 2FA secrets, role |
| `auditLog` | Immutable event log (every trade decision, risk block, reviewer call) |
| `kalshiCredentials` | AES-256-GCM encrypted Kalshi API key + private key |
| `kalshiMarkets` | Latest market view (upserted on each fetch) |
| `kalshiMarketSnapshots` | Immutable timestamped market history |
| `kalshiSignals` | Saved signals with confidence, EV, reviewer reasoning |
| `kalshiOrders` | Order ledger (pending/filled/cancelled/rejected) |
| `kalshiPositions` | Open positions with `exitState` JSONB for trailing stops |
| `kalshiCapital` | Running balance + drawdown tracking |
| `tradingPreferences` | Per-user autonomy mode, risk posture, paper toggle |
| `autonomyRuns` | One row per scheduled run with outcome + reconciliation |
| `trainingInstructions` + `instructionRules` | User-defined signal/market filters |
| `deskMemory` | Per-desk win/loss tape (12 lessons, injected into Claude prompts) |
| `distributedLocks` | Postgres advisory lock preventing concurrent autonomy runs |
| `polymarketCredentials` + `polymarketPositions` | Polymarket integration |

**Migrations**: drop a new SQL file in [drizzle/migrations/](drizzle/migrations/)
using the next sequential number.  [scripts/applyMigrations.ts](scripts/applyMigrations.ts)
runs them on every Railway deploy via `pnpm migrate:apply`, tracked in
the `migrations_log` table.  Migrations should be SQL-idempotent
(`ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

---

## Commands

```bash
corepack pnpm install            # install (pnpm v10, native binaries via onlyBuiltDependencies)
corepack pnpm dev                # vite + tsx watch
corepack pnpm check              # tsc --noEmit
corepack pnpm test -- --run      # full vitest suite (~938 tests)
corepack pnpm build              # frontend → dist/public
corepack pnpm build:server       # backend → dist/index.js
corepack pnpm db:push            # fast schema sync (dev)
corepack pnpm migrate:apply      # apply drizzle/migrations/*.sql (production)
corepack pnpm tsx scripts/runCalibrationJob.ts   # weekly Brier calibration
```

All commands use **corepack pnpm** to pin the version from `packageManager`.
Never use `npm` or `yarn` — the lockfile is `pnpm-lock.yaml`.

---

## Quick start

### 1. Generate Kalshi RSA-PSS key

Kalshi signs every private request with RSA-PSS over `${timestamp}${METHOD}${path}`.

1. Sign in at <https://kalshi.com> (production) or the demo environment.
2. Account → API → "Create new key".
3. Copy the **Key ID** (shown once) and download the **private key PEM**.

```env
KALSHI_KEY_ID=<paste the key id>
KALSHI_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...IDAQAB\n-----END PRIVATE KEY-----\n"
# OR
KALSHI_PRIVATE_KEY_PATH=/secrets/kalshi-private-key.pem
DEMO_MODE=false                 # true for sandbox
```

### 2. Local dev

```bash
corepack pnpm install
cp .env.example .env             # fill in values
corepack pnpm db:push
corepack pnpm dev
```

### 3. Railway deploy

Deploys from `main` via the [Dockerfile](Dockerfile).  Required env:

```env
DATABASE_URL                     # Neon pooled connection string
JWT_SECRET                       # 32+ random chars
CREDENTIAL_ENCRYPTION_SECRET     # 32+ random chars, MUST differ from JWT_SECRET
OWNER_EMAIL
OWNER_PASSWORD                   # 12+ chars in production
NODE_ENV=production
ANTHROPIC_API_KEY                # required — autonomy fails closed without it
KALSHI_KEY_ID
KALSHI_PRIVATE_KEY
```

Migrations apply automatically on deploy via `pnpm migrate:apply`.

---

## Optional environment variables

```env
# CORS + alerts
ALLOWED_ORIGIN                          # extra origin in production
ALERT_WEBHOOK_URL                       # Slack/Discord/PagerDuty inbound

# AI models (defaults shown)
CLAUDE_MODEL                            # claude-haiku-4-5-20251001 (Tier 1)
CLAUDE_TRIAGE_MODEL                     # claude-haiku-4-5-20251001
CLAUDE_DEEP_MODEL                       # claude-opus-4-7 (Tier 3)
CLAUDE_SONNET_TIMEOUT_MS                # 20000
CLAUDE_OPUS_TIMEOUT_MS                  # 45000

# Optional secondary reviewers
XAI_API_KEY                             # enables Grok dual-bot
GROK_MODEL                              # grok-3-latest
ENABLE_GROK_TEAM                        # true (when XAI_API_KEY set)
OPENROUTER_API_KEY                      # enables free pre-triage
OPENROUTER_TRIAGE_MODEL                 # qwen/qwen3-235b-a22b:free
OPENROUTER_TRIAGE_THRESHOLD             # 0 (run on every non-empty batch)
OPENROUTER_TRIAGE_ENABLED               # true (default when key set)
OPENROUTER_TIMEOUT_MS                   # 8000

# Schedulers + cadence
AUTONOMY_INTERVAL_MS                    # 600000 (10 min default)
AUTONOMY_OVERNIGHT_MULTIPLIER           # 4 (overnight slowdown)
AUTONOMY_PRIME_START_UTC_HOUR           # 13 (prime window starts 9am ET)
AUTONOMY_PRIME_END_UTC_HOUR             # 5  (prime window ends 1am ET)
ORDER_SYNC_INTERVAL_MS                  # 30000
COMBINATORIAL_ARB_INTERVAL_MS           # 60000
WIKIPEDIA_WATCH_INTERVAL_MS             # 300000
SIGNAL_REVIEW_PRICE_DELTA_BPS           # 50  (skip review if price moved <0.5%)
SIGNAL_REVIEW_STALE_TTL_MS              # 600000 (force re-review every 10 min)

# Risk + sizing (all percentages of live capital)
MIN_NET_EV                              # 0.025
MIN_CONFIDENCE_AFTER_ADJUST             # 0.60
MAX_PORTFOLIO_EXPOSURE_PCT              # 0.35
MAX_CORRELATED_GROUP_PCT                # 0.15
KELLY_FRACTION                          # 0.5
KELLY_MAX_PCT_OF_CAPITAL                # 0.25
KELLY_MIN_PCT_OF_CAPITAL                # 0.01
MAX_RISK_PER_TRADE_PERCENT              # 6
MIN_LIQUIDITY_USD                       # 40000
MIN_ORDER_EXPOSURE_USD                  # 5 (dust-trade block)
DAILY_DRAWDOWN_PAUSE_FRAC               # 0.05
WEEKLY_DRAWDOWN_PAUSE_FRAC              # 0.12
DAILY_LOSS_LIMIT_USD                    # 20 (hard daily stop)
COLD_STREAK_LOSS_COUNT                  # 6
COLD_STREAK_MIN_REALIZED_EDGE_PCT       # 0.03

# High-stakes triggers
HIGH_STAKES_PCT_OF_CAPITAL              # 0.03
HIGH_STAKES_RESOLUTION_MINUTES          # 1440
CATASTROPHIC_PCT_OF_CAPITAL             # 0.10

# Operational
PAPER_TRADE_MODE                        # global emergency kill-switch (per-user toggle in dashboard otherwise)
AUTO_CLOSE_ON_EXIT_SIGNAL               # false (emit audit signal only) / true (auto-close on stop-loss)
AUDIT_LOG_RETENTION_DAYS                # 90
LOG_LEVEL                               # info
POLYMARKET_OWNER_ADDRESS                # EOA proxy wallet for Polymarket position sync

# Kalshi fee schedule (override only if Kalshi changes it)
KALSHI_MAKER_FEE_MULTIPLIER             # 0.0175
KALSHI_TAKER_FEE_MULTIPLIER             # 0.07
PREFER_MAKER_ORDERS                     # true
```

See [.env.example](.env.example) for the full set with comments.

---

## Key modules

| File | Purpose |
|---|---|
| [server/_core/index.ts](server/_core/index.ts) | Boot sequence, scheduler runners, self-test, time-of-day cadence |
| [server/_core/env.ts](server/_core/env.ts) | Single source of truth for env validation + defaults |
| [server/_core/liveCapital.ts](server/_core/liveCapital.ts) | Live Kalshi balance reader (30s cache) |
| [server/_core/autonomyCadence.ts](server/_core/autonomyCadence.ts) | Time-of-day prime/overnight tier helper |
| [server/_core/kalshiClient.ts](server/_core/kalshiClient.ts) | RSA-PSS signed Kalshi REST client |
| [server/_core/kalshiSignals.ts](server/_core/kalshiSignals.ts) | Heuristic signal generators (value / momentum / contrarian / sentiment) |
| [server/_core/kalshiAutonomy.ts](server/_core/kalshiAutonomy.ts) | Autonomy run orchestration + risk gates + execution |
| [server/_core/kalshiRisk.ts](server/_core/kalshiRisk.ts) | Hard risk blocks (size, exposure, daily loss, capital reserve) |
| [server/_core/profitGuardrails.ts](server/_core/profitGuardrails.ts) | Canonical entry-gate (`checkFullEntry`) |
| [server/_core/feeCalculator.ts](server/_core/feeCalculator.ts) | Exact Kalshi fee math (rounded up to cent) + net EV |
| [server/_core/kellySizer.ts](server/_core/kellySizer.ts) | ½ Kelly with outer-cap clamps |
| [server/_core/drawdownBreaker.ts](server/_core/drawdownBreaker.ts) | Daily / weekly drawdown + cold-streak pause |
| [server/_core/dailyScoreboard.ts](server/_core/dailyScoreboard.ts) | Live P&L tracking + daily loss limit + tier (green/yellow/red) |
| [server/_core/exitMonitor.ts](server/_core/exitMonitor.ts) | Stop-loss + profit-target evaluation per tick |
| [server/_core/exitStrategy.ts](server/_core/exitStrategy.ts) | Trailing-stop state machine (persisted in `kalshiPositions.exitState`) |
| [server/_core/highStakesDetector.ts](server/_core/highStakesDetector.ts) | Tier escalation classifier |
| [server/_core/ensembleConsensus.ts](server/_core/ensembleConsensus.ts) | 3-tier reviewer orchestrator |
| [server/_core/claudeReviewer.ts](server/_core/claudeReviewer.ts) | Sonnet + Opus reviewers (Anthropic SDK direct, prompt caching, extended thinking) |
| [server/_core/tradingReviewer.ts](server/_core/tradingReviewer.ts) | Tier-1 Haiku batch reviewer |
| [server/_core/grokReviewer.ts](server/_core/grokReviewer.ts) | Optional Grok parallel reviewer |
| [server/_core/openRouterTriage.ts](server/_core/openRouterTriage.ts) | Optional free pre-triage |
| [server/_core/categoryPersonas.ts](server/_core/categoryPersonas.ts) | 16 desk persona system prompts |
| [server/_core/marketCategoryRouter.ts](server/_core/marketCategoryRouter.ts) | Market title → category classifier |
| [server/_core/userMutex.ts](server/_core/userMutex.ts) | Per-user in-process async mutex for placeOrder |
| [server/_core/distributedLock.ts](server/_core/distributedLock.ts) | Postgres advisory lock for concurrent autonomy runs |
| [server/_core/circuitBreaker.ts](server/_core/circuitBreaker.ts) | Clock-injectable breaker (CLOSED / OPEN / HALF_OPEN) |
| [server/_core/fetchWithRetry.ts](server/_core/fetchWithRetry.ts) | Exponential backoff + jitter HTTP retry |
| [server/_core/alerting.ts](server/_core/alerting.ts) | Webhook alerts (Slack / PagerDuty) |
| [server/_core/startupSelfTest.ts](server/_core/startupSelfTest.ts) | Boot diagnostic — blocks scheduler arming on prod failure |
| [server/_core/calibrationJob.ts](server/_core/calibrationJob.ts) | Weekly Brier-score recalibration |

---

## Operational invariants

1. **Hard risk blocks never bypassed**: `kalshiRisk.ts` hard blocks (max position, max daily loss, max open positions, capital reserve) cannot be overridden by AI confidence/EV adjustments.
2. **Order placement is per-user serialized**: every `placeOrder` and `closeOrder` call is wrapped in `withUserLock` to prevent TOCTOU races.
3. **Audit-log coverage is total**: every order placement, cancellation, risk block, autonomy run, AI reviewer call, exit signal, kill-switch trigger, and daily-loss-limit hit emits a typed audit event.
4. **Market responses validated at boundary**: `normalizeKalshiMarket` rejects malformed Kalshi responses before any downstream code sees them.  Cent-scale prices are converted explicitly via `centsToDollars`.
5. **Resilient external calls**: every Kalshi market-data fetch uses `fetchWithRetry` + `kalshiBreaker`.  Use the same pattern for any new external HTTP call.
6. **Self-test gates scheduler arming**: in production, any FAIL in `runStartupSelfTest()` keeps the HTTP server up but prevents schedulers from arming.  HTTP stays reachable so the operator can read the [SelfTest] log lines and fix env vars without crash-loop noise.
7. **Kill switch is layered**: disarms `tradingPreferences.liveTradingEnabled` *first*, then closes positions sequentially under `withUserLock`, then alerts on any partial failure.

---

## Health endpoints

- `GET /api/health/live` — liveness, no DB touch (Railway restart probe)
- `GET /api/health/ready` — readiness, returns 503 on DB outage (point uptime monitoring here)
- `GET /api/health` — full body with DB latency, scheduler runtimes, uptime

---

## Testing

```bash
corepack pnpm test -- --run                                  # all (~938 tests)
corepack pnpm test -- --run server/kalshi.autonomy.test.ts   # single file
```

All external dependencies are `vi.mock()`-ed — actual HTTP and DB calls
never fire in the suite.  Tests live in `server/*.test.ts` (not inside
`_core/`).  Run `corepack pnpm check && corepack pnpm test -- --run`
before every commit.

---

## License

MIT.  Use at your own risk.
