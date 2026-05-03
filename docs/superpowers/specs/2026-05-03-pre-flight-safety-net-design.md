# SP-1 · Pre-Flight Safety Net — Design Spec

**Date:** 2026-05-03  
**Status:** Approved  
**Scope:** Kalshi + Polymarket  
**Depends on:** nothing (first sub-project)  
**Followed by:** SP-2 Order Lifecycle Correctness, SP-3 Observability & Alerting

---

## Problem

The platform has never placed a real order. Going directly from zero to live trading exposes real capital to:
- Untested executor paths (bugs only reproducible at execution time)
- No ability to observe what the bot *would* do before it *does* it
- No automatic brakes if something goes badly wrong on day one
- No ramp-up period with reduced position sizing

This spec defines shadow mode, paper-trading mode, a kill-switch, and progressive drawdown auto-pause so the operator can gain confidence safely before committing capital.

---

## Goals

1. **Shadow mode** — signals, reviewer, and risk all run end-to-end; executor logs intended order and stops. Zero exchange calls.
2. **Paper mode** — same as shadow but with simulated fills, a synthetic ledger, and full PnL tracking. No real exchange calls.
3. **Live mode** — existing behaviour, gated behind an explicit per-platform opt-in.
4. **Kill-switch** — multiple surfaces to pause all trading instantly.
5. **Drawdown auto-pause** — three-tier circuit breaker (warn / pause / panic) that auto-trips on excessive intra-day loss.
6. **Ramp-window cap** — first-N-hours position-size reduction when transitioning to live.

---

## Non-Goals

- Log shipping (SP-3)
- Full alert-webhook wiring (SP-3)
- Paper-position automatic settlement (deferred; operator settles manually via tRPC)
- Manual-UI trade detection (SP-2)
- Order-lifecycle correctness fixes (SP-2)
- Polymarket retry / circuit-breaker hardening (SP-5)

---

## Architecture

### Two orthogonal axes

```
Run state:       running | paused          (kill-switch dimension)
Execution mode:  shadow  | paper | live    (behaviour-when-running dimension)
```

Both are **per-platform** (Kalshi, Polymarket) with a global ENV override. The most restrictive active constraint wins. Signals, AI reviewer, and risk checks always run regardless of mode — only the final exchange call is gated.

### Effective-mode resolution

```
getEffectiveMode(userId, platform) → { mode, paused, reason, source }
```

Precedence (top wins):

| Priority | Source | Effect |
|---|---|---|
| 1 | `TRADING_MODE_OVERRIDE=pause` ENV | all platforms paused |
| 2 | `TRADING_MODE_OVERRIDE=shadow` ENV | forces shadow regardless of user setting |
| 3 | `*_paused = true` (manual, auto-tripped by drawdown, or auto-tripped by future rules) | platform paused |
| 4 | User `*_mode` setting | shadow / paper / live |

Note: drawdown auto-pause always works by writing `*_paused = true` (row 3). The `source` field in the audit event distinguishes manual vs auto vs env.

This is a pure function with no side effects — every executor calls it at entry, every test can exercise the full matrix.

---

## Data Model

### `trading_preferences` — new columns

```sql
-- Mode per platform
kalshi_mode                 trading_mode  NOT NULL DEFAULT 'shadow'
polymarket_mode             trading_mode  NOT NULL DEFAULT 'shadow'

-- Kill-switch per platform
kalshi_paused               boolean       NOT NULL DEFAULT false
polymarket_paused           boolean       NOT NULL DEFAULT false

-- Ramp-window anchors (set when transitioning *to* live; cleared on revert)
kalshi_live_started_at      timestamptz   NULL
polymarket_live_started_at  timestamptz   NULL

-- Ramp-window config
ramp_window_hours           integer       NOT NULL DEFAULT 72
ramp_size_multiplier        numeric(4,2)  NOT NULL DEFAULT 0.25

-- Drawdown thresholds (% of start-of-day equity)
drawdown_warn_pct           numeric(4,2)  NOT NULL DEFAULT 5.0
drawdown_pause_pct          numeric(4,2)  NOT NULL DEFAULT 10.0
drawdown_panic_pct          numeric(4,2)  NOT NULL DEFAULT 20.0
```

New Drizzle enum: `trading_mode = pgEnum('trading_mode', ['shadow', 'paper', 'live'])`.

### `execution_mode` column on order/position/capital tables

Add `execution_mode trading_mode NOT NULL DEFAULT 'live'` to:
- `kalshi_orders`
- `kalshi_positions`
- `kalshi_capital`
- `polymarket_orders`
- `polymarket_positions`

Add composite index `(user_id, execution_mode)` on each. All existing rows are treated as `live` via the default. UI and risk queries filter by the platform's current effective mode.

---

## Executor Short-Circuit Logic

Entry point: top of `placeKalshiOrder` and `placePolymarketOrder`.

```
effectiveState = getEffectiveMode(userId, platform)

if effectiveState.paused:
    logAuditEvent('order_blocked_kill_switch', { reason, source })
    return { status: 'blocked', reason: effectiveState.reason }

switch effectiveState.mode:

  case 'shadow':
    write order row { execution_mode: 'shadow', status: 'shadowed' }
    logAuditEvent('shadow_order_logged', { marketId, side, size, price, signal })
    return { status: 'shadowed' }

  case 'paper':
    write order row { execution_mode: 'paper', status: 'pending' }
    fill = simulateFill(order)    // buy at ask, sell at bid
    update order { status: 'filled', fill_price: fill.price }
    write position { execution_mode: 'paper', ... }
    adjust paper capital ledger
    logAuditEvent('paper_order_filled', { ... })
    return { status: 'paper_filled', fill }

  case 'live':
    applyRampWindowCap(userId, platform, order)   // may clamp size
    // existing execution path ...
```

**Paper fill simulation (MVP):**
- Buy: fill at current `ask_price`; Sell: fill at current `bid_price`.
- Full fill assumed (no partial fills in MVP).
- No slippage, no settlement automation (operator calls `settlePaperPosition` tRPC action when market resolves).
- Paper positions are mark-to-market using current mid-price for unrealized PnL display.

---

## Drawdown Auto-Pause

Evaluated **once per autonomy run**, before the signal pipeline, against `execution_mode = 'live'` rows only. Paper/shadow losses do not trip the circuit breaker.

```
lossToday = realizedTodayLive + unrealizedOpenLive
startEquity = startOfDayEquity(userId, platform)
lossPct = (lossToday / startEquity) * 100
```

| Threshold | Action |
|---|---|
| `>= drawdown_warn_pct` (5%) | `alertDrawdown('warn')`, continue run |
| `>= drawdown_pause_pct` (10%) | set `*_paused = true`, `alertDrawdown('pause')`, `logAuditEvent('drawdown_auto_pause')`, abort run |
| `>= drawdown_panic_pct` (20%) | same as pause + `alertDrawdown('panic')` with "review open positions" context |

**No auto-resume.** Operator must call `resumeTrading({ platform, reason })` explicitly. Resuming after an auto-trip logs `drawdown_resume_manual`.

**Existing positions are never auto-closed.** The operator decides whether to use the existing `activateKalshiKillSwitch` / close-all flow manually. Panic-closing illiquid prediction-market positions at worst-case prices can lock in larger losses than holding.

---

## Ramp-Window Cap

Activated when: `*_live_started_at IS NOT NULL` AND `now() - *_live_started_at < ramp_window_hours`.

Applied inside `applyRampWindowCap` before the live execution path:
```
cappedSize     = floor(intendedSize     * ramp_size_multiplier)  // default 25%
cappedDayLoss  = floor(maxLossPerDay    * ramp_size_multiplier)
```

Every ramp-clamped order carries `logAuditEvent('ramp_window_clamp', { originalSize, cappedSize, hoursRemaining })`.

When the operator reverts a platform back to `paper` or `shadow`, `*_live_started_at` is cleared. The next transition to `live` re-arms the ramp from zero.

---

## Kill-Switch Surfaces

| Surface | Latency | Notes |
|---|---|---|
| **ENV** `TRADING_MODE_OVERRIDE=pause` | Redeploy (~60 s on Railway) | Most durable; survives DB loss |
| **tRPC** `pauseTrading({ platform })` | Instant | Requires auth + 2FA if enabled |
| **tRPC** `pauseAll()` | Instant | Pauses both platforms |
| **tRPC** `resumeTrading({ platform, reason })` | Instant | Requires `reason` string for audit |
| **UI** "PAUSE ALL" button | ~1 s round-trip | Two-step confirm dialog |
| **Auto-trip** from drawdown engine | Within current run | Sets `*_paused = true` |

Pausing **never** closes open positions. The separate `panicClosePlatformPositions` mutation remains available but is never called automatically.

---

## New tRPC Procedures

All on `tradingRouter`, all `protectedProcedure`:

```
setTradingMode({ platform, mode })          // 'shadow'|'paper'|'live'
pauseTrading({ platform })
resumeTrading({ platform, reason })
pauseAll()
settlePaperPosition({ positionId, settlePrice })   // manual paper settlement
getTradingStatus()                           // returns effective mode + paused + ramp state per platform
```

`setTradingMode` to `live` sets `*_live_started_at = now()`. Revert to shadow/paper clears it.

---

## Audit Events

| Event | When |
|---|---|
| `mode_changed` | `setTradingMode` called |
| `kill_switch_activated` | any pause (manual or auto) |
| `kill_switch_deactivated` | `resumeTrading` called |
| `drawdown_auto_pause` | drawdown threshold breached |
| `drawdown_resume_manual` | operator resumes after auto-pause |
| `shadow_order_logged` | shadow-mode order intent recorded |
| `paper_order_filled` | paper-mode simulated fill |
| `order_blocked_kill_switch` | order rejected while paused |
| `ramp_window_clamp` | live order size reduced by ramp cap |

---

## Alert Call Sites

Using existing `sendAlert` shape. All fire-and-forget (`void`). Full webhook wiring is SP-3.

```
alertDrawdown(userId, platform, { level: 'warn'|'pause'|'panic', lossPct, threshold })
alertKillSwitch(userId, platform, { reason, source: 'manual'|'auto'|'env' })
alertModeChange(userId, platform, { oldMode, newMode, actor })
```

---

## UI Changes

**Settings → Trading Modes panel (new section):**
- Per-platform mode selector (shadow / paper / live) with confirmation on live
- Per-platform pause toggle
- Ramp-window config (hours, size multiplier)
- Drawdown threshold config (warn / pause / panic %)
- "Live since" timestamp + ramp-window countdown

**Dashboard:**
- Sticky mode banner: `"Kalshi: LIVE — ramp window 47h remaining"` / `"Polymarket: PAUSED — auto-tripped at 11.4% drawdown"`. Banner colour: grey (shadow), blue (paper), green (live), red (paused).
- Orders and positions tables: mode filter chip + row colour coding (grey = shadow, blue = paper, green = live).
- Floating **PAUSE ALL** button (bottom-right), red, two-step confirm.

---

## Error Handling

- `getEffectiveMode` never throws; returns `{ paused: true, reason: 'error_reading_prefs' }` on DB failure (fail-safe).
- `simulateFill` falls back to mid-price if bid/ask unavailable; logs warning.
- `applyRampWindowCap` on DB read error: apply cap conservatively (treat as ramp active).
- All new tRPC mutations validate inputs with Zod; return structured errors.

---

## Testing Plan

~40 new tests across the following suites:

**`server/trading-mode.test.ts`** — pure unit tests for `getEffectiveMode`:
- All combinations of ENV override × `*_paused` × auto-pause × user mode (≥12 cases)
- Verify precedence order is respected

**`server/kalshi.execution.mode.test.ts`** — executor short-circuit:
- Shadow: asserts zero Kalshi HTTP calls + correct audit event + order row written with `execution_mode='shadow'`
- Paper: asserts zero Kalshi HTTP calls + simulated fill written + capital adjusted
- Live (paused): asserts `order_blocked_kill_switch` + nothing written to positions
- Live: existing tests still pass

**`server/drawdown.autoPause.test.ts`** — drawdown engine:
- Synthetic equity series crossing each tier boundary
- Assert correct tier transition + audit event + `*_paused` flag set
- No auto-resume test: paused stays paused after next run
- Paper/shadow losses do not trip breaker (only live rows counted)

**`server/ramp-window.test.ts`** — ramp cap, clock-injected:
- Size clamped during window
- Size unclamped after window expires
- `live_started_at` cleared on revert, re-armed on next live transition

**`server/kalshi.autonomy.shadowMode.test.ts`** — full autonomy run in shadow:
- Mocked Kalshi market + signal pipeline + reviewer + risk all run
- Asserts zero `POST /order` calls to Kalshi API
- Asserts `shadow_order_logged` audit event emitted

Baseline: 368 tests. Target after SP-1: ≥ 408 tests passing.

---

## Migration

One Drizzle migration (`drizzle push` safe):
- Add `trading_mode` enum
- Add new columns to `trading_preferences`
- Add `execution_mode trading_mode NOT NULL DEFAULT 'live'` column to five tables (existing rows get `'live'` by default; no backfill needed)
- Add composite indexes

No backfill required. Existing live-ish data reads as `execution_mode = 'live'` by default.

---

## Definition of Done

- [ ] All new tRPC procedures implemented and Zod-validated
- [ ] `getEffectiveMode` pure function with full precedence logic
- [ ] Executor short-circuits for shadow, paper, paused on both Kalshi and Polymarket
- [ ] Paper fill simulation with mode-tagged ledger
- [ ] Drawdown engine evaluates each run; auto-pause wired
- [ ] Ramp-window cap active on first live transition
- [ ] All new audit events emitted at correct call sites
- [ ] Alert call sites stubbed (webhook wiring deferred to SP-3)
- [ ] UI: mode banner, settings panel, PAUSE ALL button, table mode filter
- [ ] Drizzle migration written and tested with `db:push`
- [ ] ≥ 408 tests passing, typecheck clean
- [ ] Committed and pushed to `claude/setup-claude-plugin-hub-guzlD`
