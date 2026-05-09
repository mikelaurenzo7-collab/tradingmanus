# Phase 2 — Fee + spread aware EV gate

## Goal

`MIN_NET_EV` (default 5 %) evaluates **after** realistic transaction costs:
exact Kalshi / Polymarket fees + half-spread on entry × 2 (round-trip).
This is the most likely cause of underperformance at the current bankroll —
on illiquid markets a 2-3 ¢ spread can eat the entire model edge before
fees even kick in.

## Current state (after Phase 1.5)

- `server/_core/feeCalculator.ts` already does the exact Kalshi fee math
  (maker 0.0175 / taker 0.07, round-up-to-cent). It does NOT account for
  spread cost.
- `signal.metadata.spreadProxy` is `|yesPrice + noPrice − 1|` — usable
  proxy that we already compute on every market snapshot.
- `KalshiMarket` interface has `yesPrice` / `noPrice` (last-trade or fallback
  prices) but no bid/ask. Live orderbook can be fetched but is not exposed
  to the autonomy hot path.
- `// PHASE-2-FEEAWARE` marker is in `profitGuardrails.ts:89` — the call
  site for the upgrade.
- No Polymarket fee module yet; Polymarket signals carry `limitPrice` but
  no fee math.

## Plan

### New files

- **`server/_core/kalshiFees.ts`** — exact per the plan:

  ```ts
  export interface RoundTripCost {
    feeUsd: number;
    spreadCostUsd: number;
    totalCostUsd: number;
    costAsFraction: number;  // totalCostUsd / notionalUsd
    notionalUsd: number;
    priceCents: number;
    contracts: number;
    bestBidCents: number;
    bestAskCents: number;
    feeScheduleVersion: string;
  }

  export function computeKalshiRoundTripCost(args: {
    priceCents: number;
    contracts: number;
    bestBidCents: number;
    bestAskCents: number;
  }): RoundTripCost;
  ```

  Plus a sibling `computeKalshiRoundTripCostFromMarket(market, count, side)`
  that derives bid/ask from `yesPrice + spreadProxy` so callers without
  live orderbook data still get spread-aware costs.

  `feeScheduleVersion = '2026-Q1'`. Fee math reuses
  `calculateFillFeeUsd` from `feeCalculator.ts` — kalshiFees is purely the
  spread layer + the richer return shape.

- **`server/_core/polymarketFees.ts`** — same shape:

  ```ts
  export function computePolymarketRoundTripCost(args: {
    priceCents: number;
    contracts: number;
    bestBidCents: number;
    bestAskCents: number;
  }): RoundTripCost;
  ```

  Polymarket CLOB: 0 % taker fee on binaries (per Polymarket docs), gas
  subsidized via the proxy wallet (~$0.02 round-trip on small notionals).
  Spread is the dominant cost. `feeScheduleVersion = '2026-Q1'`.

### Files modified

- **`server/_core/profitGuardrails.ts`** at the `// PHASE-2-FEEAWARE` marker:
  - Compute `cost = computeKalshiRoundTripCostFromMarket(...)` from the
    signal's `entryPrice` + `spreadProxy`.
  - `netEv = grossEv − cost.costAsFraction`.
  - Apply the threshold to `netEv`.
  - Attach `cost`, `grossEv`, `netEv` to the verdict's audit-log payload.

- **Signals (Kalshi + Polymarket)**: every emitted signal carries
  `feeBreakdown: RoundTripCost` on `metadata`. The fee breakdown is what
  the gate actually uses, so persisting it lets the operator audit
  "why was this rejected" cleanly.

### Schema

- **`drizzle/migrations/0016_signal_fee_breakdown.sql`**:

  ```sql
  ALTER TABLE "kalshiSignals"
    ADD COLUMN IF NOT EXISTS "feeBreakdownJson" jsonb;
  ALTER TABLE "polymarketSignals"
    ADD COLUMN IF NOT EXISTS "feeBreakdownJson" jsonb;
  ```

  Existing rows: `NULL`. No backfill — historical signals didn't compute
  this.

### Tests

`server/feeAwareEv.test.ts` — table-driven, ≥6 cases:

1. Low-price contract (3¢): high fee fraction → reject at 3.5 % gross EV.
2. High-price contract (60¢): low fee fraction → pass at 3.5 % gross EV.
3. Wide-spread (bid 40, ask 50): reject even at high gross EV.
4. Narrow-spread (bid 49, ask 50): pass.
5. Polymarket 50¢ market with 1¢ spread: pass at 3.5 % EV.
6. Polymarket 50¢ market with 5¢ spread: reject at 3.5 % EV.
7. Edge: 0-spread market (bid == ask): spreadCost = 0, only fees count.
8. Edge: priceCents at the boundary (1¢, 99¢): fee math handles correctly.

### Sanity script

`scripts/dryRunFeeBreakdown.ts` — pulls 10 real markets each from Kalshi
and Polymarket, prints `priceCents | spread | grossEv | netEv | passes`.
Operator runs against production env to verify the new gate is reasonable
before relying on it for trading. Output captured in PR body.

## Acceptance

- [ ] All new tests pass; full suite still green.
- [ ] Audit-log `kalshi_signal_pipeline` / `polymarket_signal_pipeline`
      events include `grossEv`, `netEv`, `costAsFraction` per signal.
- [ ] Migration applies cleanly (`pnpm db:push` against local dev DB
      adds `feeBreakdownJson` column; existing rows show `NULL`).
- [ ] `pnpm build`, `pnpm typecheck`, `pnpm test -- --run` green.
- [ ] Dry-run script output captured in PR body.

## Rollback

Reverse migration drops `feeBreakdownJson` columns:

```sql
ALTER TABLE "kalshiSignals"   DROP COLUMN IF EXISTS "feeBreakdownJson";
ALTER TABLE "polymarketSignals" DROP COLUMN IF EXISTS "feeBreakdownJson";
```

Code revert restores the pre-spread net-EV math in `profitGuardrails.ts`
(no behavioral diff except `costAsFraction` is no longer computed).

## Out of scope (deferred to later phases)

- Live orderbook fetch in the autonomy hot path (Phase 5 if needed for
  cost telemetry; Phase 7 if it becomes a calibration concern).
- Per-market fee schedule overrides (Kalshi published a single-tier
  schedule for now; revisit when they publish tiered rates).
- Cross-platform arb fee math — `crossPlatformArbitrage.ts` already does
  approximate fee subtraction; will migrate to `kalshiFees` /
  `polymarketFees` in a Phase 7 cleanup.
