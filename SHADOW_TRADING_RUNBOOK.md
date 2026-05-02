# Shadow Trading Runbook

This runbook walks the operator from "code lives in main" to "shadow-mode bot
is logging would-have trades against live markets" to "we're confident enough
to graduate to real money".

The whole point: **never let untested strategy logic touch real capital**.
Shadow mode runs the full pipeline (signal generation, AI review, risk gates,
sizing, would-have order placement) without sending orders to the exchange.
After ≥4 weeks of shadow data, you compare hypothetical PnL against AI cost +
realistic fees + slippage to decide whether to enable live trading.

## 0. Pre-flight — DB schema must be applied

Earlier work added the `deskMemory` table.  If you haven't run the migration:

```bash
export DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
corepack pnpm db:push
```

Confirm:

```sql
\d "deskMemory"
\d "tradingPreferences"
```

The `tradingPreferences` table is unchanged by recent commits — no new
columns are required for shadow mode itself.  All shadow-mode behavior is
gated by env vars.

## 1. Set the environment for shadow mode

Edit your deployment env vars (Vercel: Project → Settings → Environment Variables):

| Variable | Value | Why |
|---|---|---|
| `SHADOW_TRADING_MODE` | `true` | The master switch. Order placement intercepted; audit-log entries written instead. |
| `ENABLE_AI_ARBITRAGE_REVIEW` | `true` (default) | Cross-arb stays gated even in shadow. |
| `ENABLE_KELLY_SIZING` | `true` | Force the Kelly path so we measure shadow PnL with the sizing we'd actually run. |
| `KELLY_FRACTION` | `0.25` (quarter Kelly) | Conservative starting point. |
| `KELLY_MAX_EQUITY_FRACTION` | `0.05` | No single bet > 5% of equity. |
| `ENABLE_COLD_START_SIZING` | `true` | New accounts ramp from 10% → 100% over 30 days / 30 trades. |
| `ENABLE_CONCENTRATION_LIMITS` | `true` | Block correlated-event over-exposure. |
| `CONCENTRATION_CATEGORY_CAP_FRACTION` | `0.2` | Max 20% equity in one category. |
| `ENABLE_STOP_LOSS_SCANNER` | `true` | Cron will close positions hitting -30% or 72h. |
| `STOP_LOSS_LOSS_FRACTION` | `0.3` | -30% of entry exposure → close. |
| `STOP_LOSS_MAX_HOLD_HOURS` | `72` | 3-day max hold. |
| `ALERTS_WEBHOOK_URL` | Slack/Discord webhook | Get pinged on circuit breakers, kill switches, stop losses. |

`liveTradingEnabled` must remain `true` in `tradingPreferences` for the
autonomy loops to *run* — shadow mode short-circuits at the order-placement
boundary, not earlier in the pipeline, on purpose: we want to exercise the
real signal + AI + risk path.

## 2. Verify the new cron is registered

`vercel.json` now lists three crons:

- `/api/scheduled/autonomous-trading` — every 15 min
- `/api/scheduled/order-sync` — every 5 min
- `/api/scheduled/stop-loss-scan` — every 10 min  ← NEW

After a Vercel deploy, the Vercel dashboard's "Cron Jobs" tab should show all
three with green status.

## 3. Confirm shadow mode is actually intercepting

Trigger one autonomous run manually:

```bash
curl -X POST "https://YOUR_DEPLOYMENT/api/scheduled/autonomous-trading" \
  -H "Authorization: Bearer ${CRON_SECRET}"
```

Then query the audit log for the last hour, looking for:

- `kalshi_shadow_order_intent` / `polymarket_shadow_order_intent`
  → confirms a would-have order was logged.
- `kalshi_reviewer_telemetry` / `polymarket_reviewer_telemetry`
  → confirms AI reviewer ran and produced a cost estimate.
- `kalshi_kelly_sized` / `polymarket_kelly_sized` (if Kelly fired)
- `kalshi_cold_start_sized` (if account is still in cold-start ramp)

You should NOT see `kalshi_order_placed` / `polymarket_autonomy_order_placed`
events while shadow mode is on.  If you do, shadow mode isn't on.

## 4. Let it run for 4 weeks minimum

During this window, watch for:

- **Hypothetical PnL drift.** Each shadow trade has known entry price and a
  later resolution.  After resolution, the hypothetical PnL = (resolution
  payout - entry price) × quantity, less the fees + slippage you'd have paid.
- **AI cost vs hypothetical PnL.** Sum `estimatedUsdCost` from the
  `kalshi_reviewer_telemetry` and `polymarket_reviewer_telemetry` events.
  If shadow PnL doesn't comfortably exceed AI cost, the strategy isn't viable
  at this AI spend rate.
- **Drawdown shape.** Compute equity curve from the shadow trades.  Look
  for a max drawdown < 15% of bankroll.  Anything deeper and the strategy
  needs more position-sizing constraints before live capital.
- **Win rate calibration.** Strategy emits `confidence` per signal.  Track:
  for signals with confidence ≥ 0.7, what fraction actually won?  If 50%,
  the strategy is overconfident and Kelly will over-size.

## 5. Graduation gate

Move from shadow to live trading **only if all of these are true**:

1. ≥ 4 weeks of shadow data with ≥ 50 hypothetical trades.
2. Hypothetical net PnL > 2× AI cost over the window.
3. Max hypothetical drawdown < 15% of starting bankroll.
4. Calibration: P(win | confidence ≥ 0.7) ≥ 0.6 — strategy isn't overconfident.
5. Walk-forward / parameter-sweep run on the synthetic harness still shows
   the strategy is robust (positive PnL in ≥ 60% of cells).

When ready: flip `SHADOW_TRADING_MODE=false`.  Leave Kelly + cold-start +
concentration + stop-loss scanner on.  Watch the alerts webhook obsessively
for the first 72 hours.

## 6. Roll-back plan

If something looks wrong post-graduation:

```bash
# Disarm immediately
vercel env add SHADOW_TRADING_MODE production # set to true
# Or hit the kill-switch tRPC endpoint from your authenticated client
```

The `kill_switch_activated` alert fires through `ALERTS_WEBHOOK_URL` — if you
set that up in step 1, you'll see it within seconds.

## 7. Things this does not do (yet)

- **Real historical backtest.** The synthetic harness is a sanity test, not
  proof of edge against real prices.  Real historical data ingestion is the
  next big lift.
- **Polymarket positions table.** Stop-loss scanner is Kalshi-only.
  Polymarket open positions live on the CLOB; we'd need a positions cache
  before time-stops can work there.
- **Per-user shadow mode.** `SHADOW_TRADING_MODE` is a global flag.  Per-user
  shadow / live mix needs a column on `tradingPreferences`.
