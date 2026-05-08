# Personal Kalshi Trading Dashboard

Single-owner, **Kalshi-only**, **3-tier AI ensemble** autonomous trading
dashboard. All thresholds (drawdown, exposure caps, Kelly clamps, high-stakes
cutoffs) are **percentage-based and read live Kalshi capital** — they
auto-scale as your account grows.

> No guarantees — trading involves real risk of loss. The guardrails below
> improve odds by filtering low-edge / ambiguous trades.

---

## What this is

- **Platform**: Kalshi only.
- **AI ensemble**: 3 tiers, asymmetric activation:

  | Tier | Model | Fires on | Avg / month |
  | --- | --- | --- | --- |
  | 1 | **Claude Sonnet 4.6** (Anthropic) | every reviewed signal | ~165 reviews |
  | 2 | **Claude Opus 4.7** (Anthropic) | high-stakes signals (≥3% of capital, ≤24h to resolution, or self-consistency split) | ~22 reviews |
  | 3 | **Claude Opus 4.7 unanimous gate** (Anthropic) | catastrophic-bet (≥10% of capital) — both passes must agree | ~6 reviews |

  Grok 4.1 Fast (xAI) remains as a legacy fallback: when `ANTHROPIC_API_KEY`
  is unset or `REVIEWER_PREFER_GROK=true`, the system uses Grok instead.

- **Cost** (live, audited per trade): ~**$1/month** at the default cadence.
- **Mode**: live only. The single owner trades live; the only "paper"
  control is the `PAPER_TRADE_MODE=true` global emergency kill-switch.

## Profit guardrails (every gate must pass)

| Gate | Floor (auto-scales with live Kalshi capital) |
| --- | --- |
| Net EV (after exact Kalshi fees + amortized AI cost) | ≥ 6.5 % |
| Confidence after ensemble adjustment + self-consistency | ≥ 76 % |
| Position size: ½ Kelly (moderately aggressive default) | clamped 0.5 %–4 % of live capital |
| Total open exposure | ≤ 20 % of live capital |
| Per correlated category | ≤ 10 % of live capital |
| Daily drawdown circuit breaker | pause new entries on > 3 % loss |
| Weekly drawdown circuit breaker | pause new entries on > 8 % loss |
| Cold streak | pause after 5 consecutive losses, OR 7-day realized edge < 3 % |

**All dollar values are derived from `kalshiClient.getPortfolioBalance()` at runtime.** When your balance grows from $300 → $1,000 → $5,000, the high-stakes cutoff, Kelly caps, drawdown thresholds, and exposure limits all scale automatically. No redeploy.

## High-stakes ensemble triggers

A signal is escalated to Claude Sonnet (Tier 2) if **any** of:

1. notional ≥ 3 % of live Kalshi capital, OR
2. ≤ 24 hours to resolution, OR
3. Grok's two self-consistency passes disagreed on direction or EV by > 3 %.

A signal is a **catastrophic-bet** (Tier 3 unanimous gate) if its notional ≥
10 % of live capital. All three reviewers must approve, or it's vetoed.

## Daily cron activity (capital-aware)

Base **5 analyses / day** regardless of capital — the bottleneck on Kalshi
is signal supply, not reviewer quality. Conditional ramp on
high-opportunity days (FOMC, CPI, NFP, election, named-storm landfall, > 18
liquid+unambiguous markets, weekly edge > 8 %):

| Live Kalshi capital | Max ramp |
| --- | --- |
| ≤ $500 | 8 / day |
| $500 – $2,000 | 10 / day |
| > $2,000 | 12 / day |

## Niche priority order (Grok personas)

1. **Weather** — backed by GFS/NOAA ensemble skill vs implied probability.
2. **Economic events** — Fed transcripts, CPI/PPI/NFP, scheduled releases.
3. **Low-liquidity politics** — only when resolution rules are unambiguous.

All other categories require a clear quantitative edge AND an imminent catalyst, or are vetoed by default.

## Quick start

### 1. Generate a Kalshi RSA-PSS key pair

Kalshi's Trade API signs every private request with RSA-PSS over
`${timestamp}${METHOD}${path}`. Generate the key on Kalshi:

1. Sign in at <https://kalshi.com> (production) or <https://demo-api.kalshi.co>
   (demo / `DEMO_MODE=true`).
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

### 2. Get your AI keys

- **Grok (xAI)** — required. Sign up at <https://console.x.ai/>. Set `XAI_API_KEY`.
- **Claude (Anthropic)** — strongly recommended. Sign up at <https://console.anthropic.com/>. Set `ANTHROPIC_API_KEY`. Without this, the system silently degrades to Grok-only with a boot warning.

### 3. Local dev

```bash
corepack pnpm install
cp .env.example .env       # fill in values
corepack pnpm db:push      # apply Drizzle schema
corepack pnpm dev          # vite + tsx watch
```

### 4. Schedule the weekly calibration job

Replays the past 90 days of `kalshi_trade_outcome_log` rows, computes the
Brier score per reviewer per category, and proposes weight adjustments.

```bash
corepack pnpm tsx scripts/runCalibrationJob.ts
```

Result is logged via the `kalshi_calibration_job_completed` audit event and
surfaces on the dashboard's **Calibration Scores** tab.

### 5. Railway deploy

Railway deploys from `main` via Docker. Required env vars:

```env
DATABASE_URL
JWT_SECRET                    # 32+ random chars
CREDENTIAL_ENCRYPTION_SECRET  # 32+ random chars, MUST differ from JWT_SECRET
OWNER_EMAIL
OWNER_PASSWORD                # 12+ chars in production
NODE_ENV=production

# AI reviewer — Claude is the primary trader (default)
ANTHROPIC_API_KEY             # https://console.anthropic.com/  (required for Claude-as-trader)

# Optional: Grok legacy fallback. Used only when ANTHROPIC_API_KEY is unset
# OR when REVIEWER_PREFER_GROK=true.
XAI_API_KEY                   # https://console.x.ai/

# Kalshi — required for trading
KALSHI_KEY_ID
KALSHI_PRIVATE_KEY            # OR KALSHI_PRIVATE_KEY_PATH
DEMO_MODE                     # true=demo, false=production (default false)
```

## Optional env vars (all auto-tuned)

```env
# Kalshi connection
ALLOWED_ORIGIN                          # CORS allow-list
ALERT_WEBHOOK_URL                       # Slack/Discord/PagerDuty

# AI cost / cadence
GROK_MODEL                              # grok-4-1-fast (default)
GROK_TIMEOUT_MS                         # 15000 (default)
GROK_COST_PER_REVIEW_USD                # 0.0035 (default — amortized)
CLAUDE_SONNET_MODEL                     # claude-sonnet-4-6 (default)
CLAUDE_OPUS_MODEL                       # claude-opus-4-7 (default)
CLAUDE_SONNET_TIMEOUT_MS                # 20000 (default)
CLAUDE_OPUS_TIMEOUT_MS                  # 45000 (default)
AI_DAILY_BUDGET_USD                     # 0=unlimited (default)

# Schedulers
AUTONOMY_INTERVAL_MS                    # 60000 (default 60s)
ORDER_SYNC_INTERVAL_MS                  # 30000 (default 30s)
PAPER_TRADE_MODE                        # global emergency kill-switch
AUDIT_LOG_RETENTION_DAYS                # 90 (default)

# Profit guardrails — all percentages, auto-scale with live capital
MIN_NET_EV                              # 0.065
MIN_CONFIDENCE_AFTER_ADJUST             # 0.76
MAX_PORTFOLIO_EXPOSURE_PCT              # 0.20
MAX_CORRELATED_GROUP_PCT                # 0.10
KELLY_FRACTION                          # 0.5  (¼=0.25 conservative, ½=0.5 moderate, ¾=0.75 aggressive)
KELLY_MAX_PCT_OF_CAPITAL                # 0.04
KELLY_MIN_PCT_OF_CAPITAL                # 0.005
DAILY_DRAWDOWN_PAUSE_FRAC               # 0.03
WEEKLY_DRAWDOWN_PAUSE_FRAC              # 0.08
COLD_STREAK_LOSS_COUNT                  # 5
COLD_STREAK_MIN_REALIZED_EDGE_PCT       # 0.03

# High-stakes ensemble triggers
HIGH_STAKES_PCT_OF_CAPITAL              # 0.03 (3% of live balance)
HIGH_STAKES_RESOLUTION_MINUTES          # 1440 (24h)
CATASTROPHIC_PCT_OF_CAPITAL             # 0.10 (Tier 3 unanimous gate)

# Capital-tier scanner ramp
SCANNER_BASE_ANALYSES_PER_DAY           # 5 (signal-supply-bound, doesn't scale)
SCANNER_CAP_MID_TIER_USD                # 500
SCANNER_CAP_HIGH_TIER_USD               # 2000
SCANNER_MAX_ANALYSES_PER_DAY            # 8 (low tier)
SCANNER_MAX_ANALYSES_PER_DAY_MID_TIER   # 10
SCANNER_MAX_ANALYSES_PER_DAY_HIGH_TIER  # 12
SCANNER_HIGH_OPP_LIQUID_MARKETS         # 18
SCANNER_HIGH_OPP_WEEKLY_EDGE_PCT        # 0.08

# Kalshi fee multipliers (override only if Kalshi changes the schedule)
KALSHI_MAKER_FEE_MULTIPLIER             # 0.0175
KALSHI_TAKER_FEE_MULTIPLIER             # 0.07
PREFER_MAKER_ORDERS                     # true (default)

# Owner-override domains — categories where your domain knowledge is high
# enough to relax the AI gate (hard guardrails still apply).
OWNER_OVERRIDE_DOMAINS                  # CSV, e.g. "weather,economics"
```

## Key modules

| File | Purpose |
| --- | --- |
| `server/_core/env.ts` | Validated env (single source of truth). |
| `server/_core/liveCapital.ts` | Live Kalshi balance reader (30s cache). All percentage thresholds derive from this. |
| `server/_core/kalshiClient.ts` | RSA-PSS signed Kalshi Trade API client + demo toggle. |
| `server/_core/feeCalculator.ts` | Exact Kalshi fee math (0.0175 maker / 0.07 taker, round-up to cent) + net EV. |
| `server/_core/kellySizer.ts` | ½ Kelly with 0.5 %–4 % live-capital clamp (env-overridable). |
| `server/_core/drawdownBreaker.ts` | 3 %/8 % drawdown + cold-streak pause. |
| `server/_core/dynamicScanner.ts` | 5-base / 8-10-12-conditional analysis budget (capital-tier-scaled). |
| `server/_core/profitGuardrails.ts` | Single canonical entry-gate (`checkFullEntry`). |
| `server/_core/grokPersonas.ts` | Tier-1 Grok personas (8 desks, niche-priority ordered). |
| `server/_core/claudeReviewer.ts` | Tier 2 (Sonnet 4.6) + Tier 3 (Opus 4.7) reviewers via Anthropic SDK. Adaptive thinking, prompt caching, structured JSON output. |
| `server/_core/highStakesDetector.ts` | Classifies signals as low-stakes / high-stakes / catastrophic-bet. |
| `server/_core/ensembleConsensus.ts` | 3-tier orchestrator. |
| `server/_core/performanceTracker.ts` | Per-trade outcome ledger + per-category ROI rollups. |
| `server/_core/calibrationJob.ts` | Weekly Brier-score calibration per reviewer per category. |
| `server/_core/tradingReviewer.ts` | Grok-only Tier-1 reviewer pipeline. |

## Dashboard tabs (post-pivot)

- **Calibration Scores** — Brier scores per reviewer per category. Weekly refresh.
- **Cost vs Profit** — AI spend per tier vs realized P&L; cost-to-profit ratio.
- **Guardrails Status** — drawdown breakers, cold-streak counter, scanner budget today, current Kelly clamp, current capital tier.
- **Weekly Performance Report** — auto-generated summary (per-category ROI, edge captured vs predicted, top wins/losses, AI cost roll-up).

## License

MIT. Use at your own risk.
