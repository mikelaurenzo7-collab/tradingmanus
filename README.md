# Personal Kalshi Trading Dashboard

Single-owner, **Kalshi-only**, **Grok-only** autonomous trading dashboard
optimized for a $200 starting capital. Capital preservation > trade volume.

> No guarantees — trading involves real risk of loss. The guardrails below
> improve odds by filtering low-edge / ambiguous trades.

---

## What this is

- **Platform**: Kalshi only. The Polymarket integration was removed in the
  pivot (see `docs/CODEMAPS/` and the git log for history).
- **AI reviewer**: Grok 4.1 Fast (xAI) only. Claude / Anthropic was removed.
  Every reviewed signal runs through:
  1. A category-specialized Grok persona (Weather → Economics → Politics → …).
  2. The market's verbatim resolution criteria + void/settlement rules.
  3. A self-consistency check (two passes at different temperatures must agree).
  4. The hard "**if any ambiguity exists, SKIP**" rule.
- **Mode**: live only. The single owner trades live; the only "paper"
  control is the `PAPER_TRADE_MODE=true` global emergency kill-switch.

## Profit guardrails (every gate must pass)

| Gate | Floor |
| --- | --- |
| Net EV (after exact Kalshi fees + amortized Grok cost) | ≥ 6.5 % |
| Confidence after Grok adjustment + self-consistency | ≥ 76 % |
| Position size: ¼ Kelly, clamped to 0.5 %–2 % of capital | enforced |
| Total open exposure | ≤ 20 % of capital |
| Per correlated category | ≤ 10 % of capital |
| Daily drawdown circuit breaker | pause new entries on > 3 % loss |
| Weekly drawdown circuit breaker | pause new entries on > 8 % loss |
| Cold-streak: 5 consecutive losses, OR 7-day realized edge < 3 % | pause |

## Daily activity (dynamic scanner)

Base **5 analyses / day**. Conditional auto-raise to **7** (one trigger) or
**8** (two+ triggers) only when:

- More than 18 liquid markets with unambiguous resolution rules are open today, **or**
- A major scheduled event lands today (FOMC, CPI/PPI/NFP, election day, named-storm landfall, scheduled SCOTUS decision day), **or**
- Trailing-week realized edge > 8 %.

Otherwise the scanner stays at 5/day to preserve capital + cap AI spend.

## Niche priority order

The Grok prompt explicitly orders desks (highest edge first):

1. **Weather** — backed by GFS/NOAA forecast skill vs implied probability.
2. **Economic events** — Fed transcripts, CPI/PPI/NFP, scheduled releases.
3. **Low-liquidity politics** — only when resolution rules are unambiguous.

## Quick start

### 1. Generate a Kalshi RSA-PSS key pair

Kalshi's Trade API signs every private request with RSA-PSS over
`${timestamp}${METHOD}${path}`. Generate the key on Kalshi:

1. Sign in at <https://kalshi.com> (production) or <https://demo-api.kalshi.co>
   (paper / DEMO_MODE).
2. Account → API → "Create new key".
3. Kalshi shows the **Key ID** once — copy it. Download the **private key
   PEM** when prompted (it is never shown again).

Set the env vars:

```env
KALSHI_KEY_ID=<paste the key id>
# Either:
KALSHI_PRIVATE_KEY_PATH=/secrets/kalshi-private-key.pem
# OR (preferred for Railway, paste as a single line, real newlines as \n):
KALSHI_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...IDAQAB\n-----END PRIVATE KEY-----\n"
```

Test connectivity (signs `/portfolio/balance`):

```bash
DEMO_MODE=true corepack pnpm tsx -e "import('./server/_core/kalshiClient.ts').then(m=>m.getPortfolioBalance().then(console.log))"
```

### 2. Get a Grok API key

Sign up at <https://console.x.ai/>. Copy the key into `XAI_API_KEY=`.
Default model is `grok-4-1-fast`.

### 3. Local dev

```bash
corepack pnpm install
cp .env.example .env       # fill in values
corepack pnpm db:push      # apply Drizzle schema
corepack pnpm dev          # vite + tsx watch
```

### 4. Schedule the weekly calibration job

The calibration job replays the past 90 days of reviewed signals, computes
the Brier score per persona/category, and proposes weight adjustments.
Run it once per week:

```bash
# Local (or any cron / Railway cron):
corepack pnpm tsx scripts/runCalibrationJob.ts
```

The result is logged via the `kalshi_calibration_job_completed` audit event
and surfaces on the dashboard's **Calibration Scores** tab. EV thresholds
auto-adjust if the overall Brier exceeds 0.18.

### 5. Railway deploy

Railway uses the existing `Dockerfile` + `railway.json`. The service auto-
applies SQL migrations from `drizzle/migrations/*.sql` on each deploy
(see `scripts/applyMigrations.ts`).

Required Railway env vars (full list also in `.env.example`):

```
DATABASE_URL
JWT_SECRET
CREDENTIAL_ENCRYPTION_SECRET
OWNER_EMAIL
OWNER_PASSWORD
XAI_API_KEY
KALSHI_KEY_ID
KALSHI_PRIVATE_KEY            # OR KALSHI_PRIVATE_KEY_PATH
DEMO_MODE                     # true=demo, false=production (default)
NODE_ENV=production
```

Optional but recommended:

```
ALLOWED_ORIGIN                 # Railway public URL for CORS
ALERT_WEBHOOK_URL              # Slack/Discord/PagerDuty inbound webhook
GROK_MODEL                     # Defaults to grok-4-1-fast
GROK_TIMEOUT_MS                # Defaults to 15000
GROK_COST_PER_REVIEW_USD       # Defaults to 0.0035
AI_DAILY_BUDGET_USD            # 0 = unlimited
PAPER_TRADE_MODE               # true=global emergency kill-switch
AUDIT_LOG_RETENTION_DAYS       # Defaults to 90
AUTO_CLOSE_ON_EXIT_SIGNAL      # Defaults to false (signal only)
AUTONOMY_INTERVAL_MS           # Defaults to 60000 (60 s)
ORDER_SYNC_INTERVAL_MS         # Defaults to 30000 (30 s)
OWNER_OVERRIDE_DOMAINS         # CSV, e.g. "weather,economics"
```

Profit/Kelly/scanner overrides (all optional — defaults match the table above):

```
MIN_NET_EV
MIN_CONFIDENCE_AFTER_ADJUST
MAX_PORTFOLIO_EXPOSURE_PCT
MAX_CORRELATED_GROUP_PCT
KELLY_FRACTION
KELLY_MAX_PCT_OF_CAPITAL
KELLY_MIN_PCT_OF_CAPITAL
DAILY_DRAWDOWN_PAUSE_FRAC
WEEKLY_DRAWDOWN_PAUSE_FRAC
COLD_STREAK_LOSS_COUNT
COLD_STREAK_MIN_REALIZED_EDGE_PCT
SCANNER_BASE_ANALYSES_PER_DAY
SCANNER_MAX_ANALYSES_PER_DAY
SCANNER_HIGH_OPP_LIQUID_MARKETS
SCANNER_HIGH_OPP_WEEKLY_EDGE_PCT
KALSHI_MAKER_FEE_MULTIPLIER
KALSHI_TAKER_FEE_MULTIPLIER
PREFER_MAKER_ORDERS
```

## Key modules

| File | Purpose |
| --- | --- |
| `server/_core/env.ts` | Validated env (single source of truth). |
| `server/_core/kalshiClient.ts` | RSA-PSS signed Kalshi Trade API client (markets, series, orderbook, candlesticks, historical trades, orders, fills, positions, balance) with demo toggle. |
| `server/_core/feeCalculator.ts` | Exact Kalshi fee math (0.0175 maker / 0.07 taker, round-up to cent) + net EV. |
| `server/_core/kellySizer.ts` | ¼ Kelly with 0.5 %–2 % capital clamp. |
| `server/_core/drawdownBreaker.ts` | Daily/weekly drawdown + cold-streak pause. |
| `server/_core/dynamicScanner.ts` | 5-base / 7-8-conditional analysis budget. |
| `server/_core/profitGuardrails.ts` | Single canonical entry-gate (`checkFullEntry`). |
| `server/_core/performanceTracker.ts` | Per-trade outcome ledger + summary rollups. |
| `server/_core/calibrationJob.ts` | Weekly Brier-score calibration. |
| `server/_core/tradingReviewer.ts` | Grok-only reviewer pipeline. |
| `server/_core/grokPersonas.ts` | Kalshi category personas (8 desks). |

## Dashboard tabs (post-pivot)

In addition to the existing pages:

- **Calibration Scores** — current overall + per-persona Brier scores, last
  weekly run, EV-threshold auto-adjustment.
- **Cost vs Profit** — Grok spend vs realized P&L, cost-to-profit ratio.
- **Guardrails Status** — drawdown breakers, cold-streak counter, scanner
  budget today, current Kelly clamp.
- **Weekly Performance Report** — auto-generated summary (per-category
  ROI, edge captured vs predicted, top wins/losses, AI cost roll-up).

## License

MIT. Use at your own risk.
