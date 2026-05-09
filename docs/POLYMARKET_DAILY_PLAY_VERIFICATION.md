# Polymarket Daily Sports Play — Operator Pre-Arm Checklist & Verification

This doc is the canonical go-live checklist for the Polymarket daily sports
play and the new `dailyPlayPicks` scoreboard.  It also covers the parallel
Kalshi side and the `pay-for-yourself` enforcement.  Replay these steps after
any redeploy that touches schedulers, credentials, or env vars.

---

## Pre-arm checklist

### 1. Polymarket connection (Railway env vars)

| Variable | Value | Notes |
|---|---|---|
| `POLYMARKET_OWNER_ADDRESS` | `0x…` (your EOA proxy from Polymarket account / deposit page) | **REQUIRED.** Without this, `placePolymarketOrder` hard-blocks. |
| `POLYMARKET_LIVE_TRADING_ENABLED` | `true` | Default. Flip to `false` to kill switch all live Polymarket placement. |
| `ENABLE_POLYMARKET_DAILY_SPORTS_PLAY` | `true` | Default ON. Set to `false` to disable just the daily Polymarket play. |
| `POLYMARKET_DAILY_SPORTS_PLAY_HOUR_UTC` | `14` (default) | Hour of day to fire. Stagger (e.g. `15`) to offset from Kalshi's daily play if you want sequential AI bursts. |
| `POLYMARKET_DAILY_SPORTS_PLAY_PCT_OF_CAPITAL` | `0.025` (default) | 2.5% of bankroll per pick. Clamped 0.5%–10%. |

### 2. Polymarket credentials (in dashboard `/connect`)

1. Click **Derive API keys from wallet** if you haven't already (uses the
   wallet private key; no API/secret/passphrase needed up front).
2. Confirm fields populate: API Key, API Secret, API Passphrase.
3. Paste your wallet private key (64-hex, with or without `0x`).
4. Paste your funder address (the same `0x…` as `POLYMARKET_OWNER_ADDRESS`
   for Polymarket UI accounts using the proxy).
5. Signature type: `1` (POLY_PROXY) for standard Polymarket UI accounts.
6. Hit Connect. Status should flip to `connected` within 1–2s.

### 3. Polymarket funding (Polygon)

1. Deposit ≥ **$50 USDC.e** to your proxy wallet (the address shown on
   your Polymarket account page).
2. Bridge ~**0.5 MATIC** to your EOA (the signing wallet) for gas.
3. Confirm balances visible in the Polymarket UI.

### 4. Per-user trading preferences (in dashboard Trading Preferences)

| Field | Value | Notes |
|---|---|---|
| `liveTradingEnabled` | **true** | Single kill-switch — covers BOTH Kalshi and Polymarket daily plays. |
| `autonomyMode` | `semi` or `fully` | NOT `manual`. |
| `executionCadence` | `continuous` (or any non-`manual_only`) | NOT `manual_only`. |
| `paperTradeMode` | **false** | After smoke test (Step 5 of verification). |
| `maxOrderNotional` | `15` | 5% of $300 bankroll. Adjust to your bankroll. |
| `maxDailyOrders` | `20` | Sane cap; daily plays each count as 1. |

### 5. Pay-for-yourself

| Variable | Value | Notes |
|---|---|---|
| `AI_DAILY_BUDGET_USD` | `5` | Default. Cold-start exemption + profitable-day bypass. At ≥100% overrun the autonomy tick skips entirely. |
| `ANTHROPIC_API_KEY` | required | Claude reviewer. |
| `XAI_API_KEY` | optional | Enables dual-bot consensus when `ENABLE_GROK_TEAM=true`. |

### 6. Kalshi side (parallel daily play)

Same connect/funding pattern. Existing env vars:
- `ENABLE_DAILY_SPORTS_PLAY=true` to arm Kalshi daily sports
- `DAILY_SPORTS_PLAY_HOUR_UTC=14` (default)
- Kalshi credentials in `/connect`
- ≥ $200 deposited in Kalshi

### 7. Self-test verification

After redeploy, watch Railway logs for `[SelfTest]` lines:
- All `PASS` → schedulers arm in 30s
- Any `FAIL` in production → schedulers do NOT arm; HTTP server stays up
  so you can fix the env var and redeploy. Most common failures:
  - `ANTHROPIC_API_KEY` missing
  - `CREDENTIAL_ENCRYPTION_SECRET` unset
  - `kalshiPositions.exitState` column missing → `pnpm migrate:apply` runs
    automatically on next deploy; you can also run `pnpm db:push` manually.

---

## Smoke-test sequence (verification — do this in order)

1. **Migration applied.** `pnpm migrate:apply` runs at start. Verify with
   `\d "dailyPlayPicks"` in psql; you should see the table with columns
   `userId`, `platform`, `playType`, `playDate`, `status`, … plus indexes
   `dailyPlayPicks_user_platform_type_date_uq` (unique) and
   `dailyPlayPicks_userId_status_idx`.

2. **Boot in paper mode.** Set `tradingPreferences.paperTradeMode = 1` for
   the owner row. Set `POLYMARKET_DAILY_SPORTS_PLAY_HOUR_UTC` to next
   upcoming UTC hour. Boot. Logs should show
   `[SelfTest] OK polymarket_owner_address` and the scheduler armed log.

3. **Connect step.** From `/connect`, derive + paste credentials. tRPC
   `connectPolymarketAccount` returns `{ success: true }`. DB:
   `polymarketCredentials.accountStatus = 'connected'`.

4. **Read-only fetch.** Dashboard's Polymarket connection panel shows
   `connected`. Confirms Gamma API + creds work without firing trades.

5. **Force a paper tick.** Wait for the configured hour OR manually invoke
   `runPolymarketDailySportsPlay(ownerUserId)` from a one-shot tsx script.
   Expected:
   - Audit `polymarket_daily_sports_play_executed` event written
   - `simulatePolymarketOrderFill` writes `polymarketPositions` +
     `polymarketOrders` rows
   - `dailyPlayPicks` row inserted with `status='pending'`
   - Dashboard's "Daily Pick Scoreboard" card renders today's pick

6. **Force a paper close.** Trigger the exit-monitor (tighten take-profit
   env, OR simulate by manually setting `polymarketPositions.currentPrice`
   to trigger profit-target). `dailyPlayPicks.status` flips to `won`/`lost`,
   `realizedPnl` populated, scoreboard updates immediately on next tRPC
   query.

7. **Flip live.** `tradingPreferences.paperTradeMode = 0`. Restart (or
   wait for env reload).

8. **First live fill.** At the configured hour, the scheduler ticks. With
   ≥$50 USDC.e funded:
   - `placePolymarketOrder` returns `{ success: true, orderId: "..." }`
   - `polymarketPositionSync` (next 30s tick) confirms the position
     on-chain
   - `dailyPlayPicks.linkedPositionId` populated by the +60s deferred
     linkage (or via the close-hook fallback if the position closes
     before linkage)
   - Position visible in the Polymarket UI (proves
     `POLYMARKET_OWNER_ADDRESS` is correct)

9. **Cross-check.** Run `SELECT * FROM "dailyPlayPicks" WHERE "playDate" =
   CURRENT_DATE;` — expect one Kalshi row + one Polymarket row.

10. **First daily pick close.** When the pick resolves, status flips,
    scoreboard reflects within seconds.

11. **Pay-for-yourself sanity.** After one full day, check the
    `dailyScoreboard` audit emission: `netUsd = realizedPnlUsd −
    aiSpendUsd − estimatedFeesUsd`. If consistently net-negative for 3+
    days, tighten `AUTONOMY_INTERVAL_MS` longer or `AI_DAILY_BUDGET_USD`
    lower.

---

## What pays for itself, and what doesn't

The bot is configured to throttle aggressively when net-negative.
Specifically:
- Cold-start: first $5 of AI spend exempt — this means a brand-new boot
  on a quiet day will burn $5 of AI budget regardless of P&L.
- Net-positive days: never throttle.
- Net-negative days: throttle ramps multiplicatively. At 60% overrun,
  cadence ×1.5; at 80%, ×2; at 95%, ×4; at 100%, full skip.

For a $300-500 bankroll, expect first-week variance of ±15–20% bankroll
swings purely from market noise — this is normal and not a bug. The
calibration loop runs weekly (Brier score) and tightens the EV/confidence
floors after 30+ closed trades.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| "POLYMARKET_OWNER_ADDRESS is not set — live placement blocked" | Env var missing | Set on Railway, redeploy |
| "Polymarket wallet credentials missing" | `walletPrivateKey` or `walletAddress` empty in `polymarketCredentials` | Re-run /connect, paste wallet key + address |
| Daily play `status: 'disabled'` with `liveTradingEnabled=0` | Per-user gate | Toggle in Trading Preferences |
| Daily play fires but `dailyPlayPicks` row absent | DB write failed; check Railway logs for `[DailyPlayPicks] insert failed` | DB connectivity issue; check Neon dashboard |
| Pick status stuck on `pending` after close | Linkage failure; +60s deferred linkage didn't run (container restart?) | Close-hook fallback should resolve on next position-sync tick. If not, manually update the row. |
