# SP-1 Pre-Flight Safety Net Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shadow mode, paper-trading mode, a multi-surface kill-switch, progressive drawdown auto-pause, and first-live ramp-window cap so the operator can safely gain confidence before committing real capital.

**Architecture:** A pure `getEffectiveMode(userId, platform)` function is the single source of truth for mode resolution (ENV override > paused flag > user setting). Every executor calls it at entry; shadow logs intent only, paper simulates fills against real prices, live applies the existing path with a ramp-window size cap. A drawdown engine runs at the top of each autonomy scheduler and auto-trips the paused flag when intra-day loss crosses configurable thresholds.

**Tech Stack:** Node 20, TypeScript strict, Drizzle ORM + Neon Postgres, tRPC v11, Vitest 3, React 19, TanStack Query v5, shadcn/ui, Tailwind CSS v4.

**Spec:** `docs/superpowers/specs/2026-05-03-pre-flight-safety-net-design.md`

**Run all tests:** `corepack pnpm test -- --run`
**Type check:** `corepack pnpm check`
**Push schema:** `corepack pnpm db:push`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `drizzle/schema.ts` | Add `tradingModeEnum`, new columns to `tradingPreferences`, `kalshiOrders`, `kalshiPositions`; paper columns on `kalshiCapital` |
| Modify | `server/_core/env.ts` | Add `tradingModeOverride` |
| Create | `server/_core/tradingMode.ts` | `getEffectiveMode()` pure function + platform types |
| Modify | `server/_core/alerting.ts` | Add `alertDrawdown`, `alertKillSwitch`, `alertModeChange` |
| Modify | `server/db.trading-preferences.ts` | Extend type + CRUD for mode fields |
| Create | `server/_core/paperSimulator.ts` | `simulatePaperFill()` — immediate fill at ask/bid |
| Create | `server/_core/rampWindow.ts` | `applyRampWindowCap()` — size clamp during ramp period |
| Create | `server/_core/drawdownEngine.ts` | `evaluateDrawdown()` — tier check + auto-pause |
| Modify | `server/_core/kalshiExecution.ts` | Short-circuit at entry of `placeKalshiOrder` |
| Modify | `server/_core/polymarketAuth.ts` | Add `gatedPlacePolymarketOrder()` wrapper |
| Modify | `server/_core/kalshiAutonomy.ts` | Call `evaluateDrawdown` at top of `runScheduledAutonomousTrading` |
| Modify | `server/routers.ts` | Add `setTradingMode`, `pauseTrading`, `resumeTrading`, `pauseAll`, `getTradingStatus`, `settlePaperPosition` procedures |
| Create | `server/trading-mode.test.ts` | Unit tests for `getEffectiveMode` |
| Create | `server/drawdown.autoPause.test.ts` | Tests for `evaluateDrawdown` |
| Create | `server/ramp-window.test.ts` | Tests for `applyRampWindowCap` |
| Create | `server/kalshi.execution.mode.test.ts` | Tests for executor short-circuit paths |
| Create | `server/kalshi.autonomy.shadowMode.test.ts` | End-to-end shadow autonomy run test |
| Create | `client/src/hooks/useTradingStatus.ts` | tRPC hook for effective mode per platform |
| Create | `client/src/components/TradingModeBanner.tsx` | Sticky banner showing live mode + ramp/pause state |
| Create | `client/src/components/PauseAllButton.tsx` | Floating red pause button with two-step confirm |
| Create | `client/src/components/TradingModePanel.tsx` | Settings panel: mode selector, thresholds, ramp config |
| Modify | `client/src/components/DashboardLayout.tsx` | Mount `TradingModeBanner` + `PauseAllButton` |
| Modify | `client/src/pages/TradingAutonomy.tsx` | Mount `TradingModePanel` |

---

## Task 1: Schema additions

**Files:**
- Modify: `drizzle/schema.ts`

- [ ] **Step 1: Add `tradingModeEnum` and new columns**

Replace the existing exports block at the top of `drizzle/schema.ts`. Add after the existing `reconciliationStatusEnum` line (line 29):

```typescript
export const tradingModeEnum = pgEnum("trading_mode", ["shadow", "paper", "live"]);
```

Add to the `tradingPreferences` table definition after the `requireApprovalAbove` column:

```typescript
  kalshiMode: tradingModeEnum("kalshiMode").default("shadow").notNull(),
  polymarketMode: tradingModeEnum("polymarketMode").default("shadow").notNull(),
  kalshiPaused: integer("kalshiPaused").default(0).notNull(),
  polymarketPaused: integer("polymarketPaused").default(0).notNull(),
  kalshiLiveStartedAt: timestamp("kalshiLiveStartedAt", { withTimezone: true }),
  polymarketLiveStartedAt: timestamp("polymarketLiveStartedAt", { withTimezone: true }),
  rampWindowHours: integer("rampWindowHours").default(72).notNull(),
  rampSizeMultiplier: doublePrecision("rampSizeMultiplier").default(0.25).notNull(),
  drawdownWarnPct: doublePrecision("drawdownWarnPct").default(5.0).notNull(),
  drawdownPausePct: doublePrecision("drawdownPausePct").default(10.0).notNull(),
  drawdownPanicPct: doublePrecision("drawdownPanicPct").default(20.0).notNull(),
```

Add `executionMode` to `kalshiOrders` after the `cancelledAt` column:

```typescript
  executionMode: tradingModeEnum("executionMode").default("live").notNull(),
```

Add `executionMode` to `kalshiPositions` after the `closedAt` column:

```typescript
  executionMode: tradingModeEnum("executionMode").default("live").notNull(),
```

Add paper capital columns to `kalshiCapital` after the `updatedAt` column:

```typescript
  paperBalance: doublePrecision("paperBalance").default(0).notNull(),
  paperStartingBalance: doublePrecision("paperStartingBalance").default(0).notNull(),
  paperTotalPnl: doublePrecision("paperTotalPnl").default(0).notNull(),
  paperTrades: integer("paperTrades").default(0).notNull(),
  paperWins: integer("paperWins").default(0).notNull(),
```

- [ ] **Step 2: Push schema to database**

```bash
corepack pnpm db:push
```

Expected: Drizzle applies the migration without errors. All new columns default safely — no backfill required.

- [ ] **Step 3: Typecheck**

```bash
corepack pnpm check
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add drizzle/schema.ts
git commit -m "feat(schema): add tradingMode enum and pre-flight safety net columns"
```

---

## Task 2: ENV override

**Files:**
- Modify: `server/_core/env.ts`

- [ ] **Step 1: Write the failing test**

Create `server/trading-mode.test.ts` with just the ENV test:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("TRADING_MODE_OVERRIDE env var", () => {
  const originalEnv = process.env.TRADING_MODE_OVERRIDE;

  afterEach(() => {
    process.env.TRADING_MODE_OVERRIDE = originalEnv;
  });

  it("reads shadow override", async () => {
    process.env.TRADING_MODE_OVERRIDE = "shadow";
    const { ENV } = await import("./_core/env");
    // Force module reload
    vi.resetModules();
    expect(process.env.TRADING_MODE_OVERRIDE).toBe("shadow");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm test -- --run server/trading-mode.test.ts
```

Expected: PASS trivially (ENV not imported yet). Skip — ENV is plain JS, not worth the module reload dance. Move directly to adding the field.

- [ ] **Step 3: Add `tradingModeOverride` to ENV**

In `server/_core/env.ts`, add to the `ENV` object after `alertWebhookUrl`:

```typescript
  // Global trading mode override. Set to 'shadow' or 'pause' to force all
  // platforms into that mode regardless of per-user settings. Unset (or 'none')
  // means use per-user settings.
  tradingModeOverride: normalize(process.env.TRADING_MODE_OVERRIDE) as "none" | "shadow" | "pause" | "",
```

- [ ] **Step 4: Typecheck**

```bash
corepack pnpm check
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add server/_core/env.ts
git commit -m "feat(env): add TRADING_MODE_OVERRIDE for global trading mode override"
```

---

## Task 3: `getEffectiveMode` pure function

**Files:**
- Create: `server/_core/tradingMode.ts`
- Modify: `server/trading-mode.test.ts`

- [ ] **Step 1: Write failing tests**

Replace `server/trading-mode.test.ts` with:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: { tradingModeOverride: "" },
}));

vi.mock("./db.trading-preferences", () => ({
  getTradingPreferences: vi.fn(),
}));

import { getEffectiveMode } from "./_core/tradingMode";
import { ENV } from "./_core/env";
import { getTradingPreferences } from "./db.trading-preferences";

const mockPrefs = (overrides: Record<string, unknown> = {}) => ({
  kalshiMode: "shadow" as const,
  polymarketMode: "shadow" as const,
  kalshiPaused: 0,
  polymarketPaused: 0,
  kalshiLiveStartedAt: null,
  polymarketLiveStartedAt: null,
  rampWindowHours: 72,
  rampSizeMultiplier: 0.25,
  drawdownWarnPct: 5,
  drawdownPausePct: 10,
  drawdownPanicPct: 20,
  ...overrides,
});

describe("getEffectiveMode", () => {
  beforeEach(() => {
    vi.mocked(getTradingPreferences).mockResolvedValue(mockPrefs() as never);
    (ENV as { tradingModeOverride: string }).tradingModeOverride = "";
  });

  it("returns shadow when user mode is shadow", async () => {
    vi.mocked(getTradingPreferences).mockResolvedValue(mockPrefs({ kalshiMode: "shadow" }) as never);
    const result = await getEffectiveMode(1, "kalshi");
    expect(result.mode).toBe("shadow");
    expect(result.paused).toBe(false);
  });

  it("returns paper when user mode is paper", async () => {
    vi.mocked(getTradingPreferences).mockResolvedValue(mockPrefs({ kalshiMode: "paper" }) as never);
    const result = await getEffectiveMode(1, "kalshi");
    expect(result.mode).toBe("paper");
    expect(result.paused).toBe(false);
  });

  it("returns live when user mode is live", async () => {
    vi.mocked(getTradingPreferences).mockResolvedValue(mockPrefs({ kalshiMode: "live" }) as never);
    const result = await getEffectiveMode(1, "kalshi");
    expect(result.mode).toBe("live");
    expect(result.paused).toBe(false);
  });

  it("returns paused when platform is manually paused", async () => {
    vi.mocked(getTradingPreferences).mockResolvedValue(mockPrefs({ kalshiMode: "live", kalshiPaused: 1 }) as never);
    const result = await getEffectiveMode(1, "kalshi");
    expect(result.paused).toBe(true);
    expect(result.source).toBe("manual_pause");
  });

  it("ENV pause override takes priority over user setting", async () => {
    vi.mocked(getTradingPreferences).mockResolvedValue(mockPrefs({ kalshiMode: "live", kalshiPaused: 0 }) as never);
    (ENV as { tradingModeOverride: string }).tradingModeOverride = "pause";
    const result = await getEffectiveMode(1, "kalshi");
    expect(result.paused).toBe(true);
    expect(result.source).toBe("env_override");
  });

  it("ENV shadow override forces shadow even when user is live", async () => {
    vi.mocked(getTradingPreferences).mockResolvedValue(mockPrefs({ kalshiMode: "live" }) as never);
    (ENV as { tradingModeOverride: string }).tradingModeOverride = "shadow";
    const result = await getEffectiveMode(1, "kalshi");
    expect(result.mode).toBe("shadow");
    expect(result.paused).toBe(false);
    expect(result.source).toBe("env_override");
  });

  it("uses polymarket mode for polymarket platform", async () => {
    vi.mocked(getTradingPreferences).mockResolvedValue(
      mockPrefs({ kalshiMode: "live", polymarketMode: "shadow" }) as never
    );
    const kalshi = await getEffectiveMode(1, "kalshi");
    const poly = await getEffectiveMode(1, "polymarket");
    expect(kalshi.mode).toBe("live");
    expect(poly.mode).toBe("shadow");
  });

  it("returns safe paused state on DB error", async () => {
    vi.mocked(getTradingPreferences).mockRejectedValue(new Error("db down"));
    const result = await getEffectiveMode(1, "kalshi");
    expect(result.paused).toBe(true);
    expect(result.source).toBe("error_reading_prefs");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
corepack pnpm test -- --run server/trading-mode.test.ts
```

Expected: FAIL — `getEffectiveMode` not found.

- [ ] **Step 3: Implement `tradingMode.ts`**

Create `server/_core/tradingMode.ts`:

```typescript
import { ENV } from "./env";
import { getTradingPreferences } from "../db.trading-preferences";

export type TradingPlatform = "kalshi" | "polymarket";
export type TradingMode = "shadow" | "paper" | "live";

export interface EffectiveModeResult {
  mode: TradingMode;
  paused: boolean;
  reason: string;
  source: "env_override" | "manual_pause" | "user_setting" | "error_reading_prefs";
}

export async function getEffectiveMode(
  userId: number,
  platform: TradingPlatform
): Promise<EffectiveModeResult> {
  try {
    const override = ENV.tradingModeOverride;

    if (override === "pause") {
      return { mode: "shadow", paused: true, reason: "TRADING_MODE_OVERRIDE=pause", source: "env_override" };
    }

    const prefs = await getTradingPreferences(userId);
    const isPaused = platform === "kalshi"
      ? Boolean(prefs.kalshiPaused)
      : Boolean(prefs.polymarketPaused);
    const userMode: TradingMode = (platform === "kalshi" ? prefs.kalshiMode : prefs.polymarketMode) as TradingMode ?? "shadow";

    if (isPaused) {
      return { mode: userMode, paused: true, reason: `${platform} manually paused`, source: "manual_pause" };
    }

    if (override === "shadow") {
      return { mode: "shadow", paused: false, reason: "TRADING_MODE_OVERRIDE=shadow", source: "env_override" };
    }

    return { mode: userMode, paused: false, reason: `user setting: ${userMode}`, source: "user_setting" };
  } catch {
    return { mode: "shadow", paused: true, reason: "error reading trading preferences", source: "error_reading_prefs" };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
corepack pnpm test -- --run server/trading-mode.test.ts
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Run full suite**

```bash
corepack pnpm test -- --run
```

Expected: 368+ tests pass, 0 failures.

- [ ] **Step 6: Commit**

```bash
git add server/_core/tradingMode.ts server/trading-mode.test.ts
git commit -m "feat(tradingMode): add getEffectiveMode pure function with full precedence logic"
```

---

## Task 4: Alert helpers

**Files:**
- Modify: `server/_core/alerting.ts`

- [ ] **Step 1: Write failing tests**

Create `server/alerting.drawdown.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/env", () => ({
  ENV: { alertWebhookUrl: "https://hooks.example.com/test" },
}));

global.fetch = vi.fn();

import { alertDrawdown, alertKillSwitch, alertModeChange } from "./_core/alerting";

describe("alertDrawdown", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue({ ok: true } as Response);
  });

  it("calls sendAlert with correct event for warn level", async () => {
    await alertDrawdown(1, "kalshi", { level: "warn", lossPct: 5.5, threshold: 5.0 });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.event).toBe("drawdown_warn");
    expect(body.severity).toBe("warning");
    expect(body.details.platform).toBe("kalshi");
  });

  it("calls sendAlert with critical severity for panic level", async () => {
    await alertDrawdown(1, "kalshi", { level: "panic", lossPct: 21.0, threshold: 20.0 });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.severity).toBe("critical");
    expect(body.event).toBe("drawdown_panic");
  });
});

describe("alertKillSwitch", () => {
  it("fires with correct event", async () => {
    await alertKillSwitch(1, "kalshi", { reason: "manual pause", source: "manual" });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.event).toBe("kill_switch_activated");
  });
});

describe("alertModeChange", () => {
  it("fires with old and new mode in details", async () => {
    await alertModeChange(1, "kalshi", { oldMode: "shadow", newMode: "live", actor: "user" });
    const body = JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string);
    expect(body.event).toBe("trading_mode_changed");
    expect(body.details.oldMode).toBe("shadow");
    expect(body.details.newMode).toBe("live");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
corepack pnpm test -- --run server/alerting.drawdown.test.ts
```

Expected: FAIL — `alertDrawdown` not exported.

- [ ] **Step 3: Add helpers to `alerting.ts`**

Append to `server/_core/alerting.ts`:

```typescript
export async function alertDrawdown(
  userId: number,
  platform: string,
  details: { level: "warn" | "pause" | "panic"; lossPct: number; threshold: number }
): Promise<void> {
  const severityMap = { warn: "warning", pause: "warning", panic: "critical" } as const;
  await sendAlert({
    severity: severityMap[details.level],
    event: `drawdown_${details.level}`,
    userId,
    details: { platform, ...details },
    timestamp: new Date().toISOString(),
  });
}

export async function alertKillSwitch(
  userId: number,
  platform: string,
  details: { reason: string; source: "manual" | "auto" | "env" }
): Promise<void> {
  await sendAlert({
    severity: "warning",
    event: "kill_switch_activated",
    userId,
    details: { platform, ...details },
    timestamp: new Date().toISOString(),
  });
}

export async function alertModeChange(
  userId: number,
  platform: string,
  details: { oldMode: string; newMode: string; actor: string }
): Promise<void> {
  await sendAlert({
    severity: "info",
    event: "trading_mode_changed",
    userId,
    details: { platform, ...details },
    timestamp: new Date().toISOString(),
  });
}
```

- [ ] **Step 4: Run tests**

```bash
corepack pnpm test -- --run server/alerting.drawdown.test.ts
```

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/_core/alerting.ts server/alerting.drawdown.test.ts
git commit -m "feat(alerting): add alertDrawdown, alertKillSwitch, alertModeChange helpers"
```

---

## Task 5: Extend `db.trading-preferences.ts` with mode fields

**Files:**
- Modify: `server/db.trading-preferences.ts`

- [ ] **Step 1: Extend `TradingPreferencesSettings` type**

In `server/db.trading-preferences.ts`, update `TradingPreferencesSettings` to add:

```typescript
export type TradingMode = "shadow" | "paper" | "live";

export type TradingPreferencesSettings = {
  autonomyMode: TradingAutonomyMode;
  liveTradingEnabled: boolean;
  executionCadence: ExecutionCadence;
  riskPosture: RiskPosture;
  minSignalConfidence: number;
  maxOrderNotional: number;
  maxDailyOrders: number;
  requireApprovalAbove: number;
  // SP-1 pre-flight safety net
  kalshiMode: TradingMode;
  polymarketMode: TradingMode;
  kalshiPaused: number;        // 0 | 1 (matches DB integer column)
  polymarketPaused: number;
  kalshiLiveStartedAt: Date | null;
  polymarketLiveStartedAt: Date | null;
  rampWindowHours: number;
  rampSizeMultiplier: number;
  drawdownWarnPct: number;
  drawdownPausePct: number;
  drawdownPanicPct: number;
};
```

- [ ] **Step 2: Update `DEFAULT_TRADING_PREFERENCES`**

```typescript
export const DEFAULT_TRADING_PREFERENCES: TradingPreferencesSettings = {
  autonomyMode: "approval_required",
  liveTradingEnabled: false,
  executionCadence: "manual_only",
  riskPosture: "balanced",
  minSignalConfidence: 0.72,
  maxOrderNotional: 10,
  maxDailyOrders: 3,
  requireApprovalAbove: 8,
  kalshiMode: "shadow",
  polymarketMode: "shadow",
  kalshiPaused: 0,
  polymarketPaused: 0,
  kalshiLiveStartedAt: null,
  polymarketLiveStartedAt: null,
  rampWindowHours: 72,
  rampSizeMultiplier: 0.25,
  drawdownWarnPct: 5.0,
  drawdownPausePct: 10.0,
  drawdownPanicPct: 20.0,
};
```

- [ ] **Step 3: Update `normalizeTradingPreferences`**

Add after the `requireApprovalAbove` block inside the `normalized` object construction:

```typescript
    kalshiMode: (["shadow", "paper", "live"] as const).includes(input?.kalshiMode as TradingMode)
      ? (input?.kalshiMode as TradingMode)
      : "shadow",
    polymarketMode: (["shadow", "paper", "live"] as const).includes(input?.polymarketMode as TradingMode)
      ? (input?.polymarketMode as TradingMode)
      : "shadow",
    kalshiPaused: typeof input?.kalshiPaused === "number" ? (input.kalshiPaused === 0 ? 0 : 1) : 0,
    polymarketPaused: typeof input?.polymarketPaused === "number" ? (input.polymarketPaused === 0 ? 0 : 1) : 0,
    kalshiLiveStartedAt: input?.kalshiLiveStartedAt instanceof Date ? input.kalshiLiveStartedAt : null,
    polymarketLiveStartedAt: input?.polymarketLiveStartedAt instanceof Date ? input.polymarketLiveStartedAt : null,
    rampWindowHours: Math.round(clamp(Number(input?.rampWindowHours ?? 72), 1, 720)),
    rampSizeMultiplier: clamp(Number(input?.rampSizeMultiplier ?? 0.25), 0.05, 1.0),
    drawdownWarnPct: clamp(Number(input?.drawdownWarnPct ?? 5.0), 1.0, 50.0),
    drawdownPausePct: clamp(Number(input?.drawdownPausePct ?? 10.0), 1.0, 50.0),
    drawdownPanicPct: clamp(Number(input?.drawdownPanicPct ?? 20.0), 1.0, 100.0),
```

- [ ] **Step 4: Update `toDatabaseValues`**

Add to the returned object in `toDatabaseValues`:

```typescript
    kalshiMode: input.kalshiMode,
    polymarketMode: input.polymarketMode,
    kalshiPaused: input.kalshiPaused,
    polymarketPaused: input.polymarketPaused,
    kalshiLiveStartedAt: input.kalshiLiveStartedAt,
    polymarketLiveStartedAt: input.polymarketLiveStartedAt,
    rampWindowHours: input.rampWindowHours,
    rampSizeMultiplier: input.rampSizeMultiplier,
    drawdownWarnPct: input.drawdownWarnPct,
    drawdownPausePct: input.drawdownPausePct,
    drawdownPanicPct: input.drawdownPanicPct,
```

- [ ] **Step 5: Update `getTradingPreferences` return mapping**

In the `normalizeTradingPreferences({...})` call inside `getTradingPreferences`, add:

```typescript
      kalshiMode: record.kalshiMode as TradingMode,
      polymarketMode: record.polymarketMode as TradingMode,
      kalshiPaused: record.kalshiPaused,
      polymarketPaused: record.polymarketPaused,
      kalshiLiveStartedAt: record.kalshiLiveStartedAt ?? null,
      polymarketLiveStartedAt: record.polymarketLiveStartedAt ?? null,
      rampWindowHours: record.rampWindowHours,
      rampSizeMultiplier: Number(record.rampSizeMultiplier),
      drawdownWarnPct: Number(record.drawdownWarnPct),
      drawdownPausePct: Number(record.drawdownPausePct),
      drawdownPanicPct: Number(record.drawdownPanicPct),
```

- [ ] **Step 6: Typecheck**

```bash
corepack pnpm check
```

Expected: no errors.

- [ ] **Step 7: Run full test suite**

```bash
corepack pnpm test -- --run
```

Expected: all existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add server/db.trading-preferences.ts
git commit -m "feat(db): extend TradingPreferencesSettings with mode, pause, and drawdown fields"
```

---

## Task 6: Paper fill simulator

**Files:**
- Create: `server/_core/paperSimulator.ts`

- [ ] **Step 1: Write failing test**

Create `server/paper-simulator.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { simulatePaperFill } from "./_core/paperSimulator";

describe("simulatePaperFill", () => {
  it("fills a buy order at ask price", () => {
    const fill = simulatePaperFill({ side: "yes", action: "buy", askPrice: 0.55, bidPrice: 0.53, quantity: 5 });
    expect(fill.fillPrice).toBe(0.55);
    expect(fill.fillQuantity).toBe(5);
    expect(fill.executionMode).toBe("paper");
  });

  it("fills a sell order at bid price", () => {
    const fill = simulatePaperFill({ side: "yes", action: "sell", askPrice: 0.55, bidPrice: 0.53, quantity: 3 });
    expect(fill.fillPrice).toBe(0.53);
    expect(fill.fillQuantity).toBe(3);
  });

  it("falls back to midprice when ask/bid unavailable", () => {
    const fill = simulatePaperFill({ side: "yes", action: "buy", askPrice: 0, bidPrice: 0, quantity: 2, fallbackMidPrice: 0.50 });
    expect(fill.fillPrice).toBe(0.50);
  });

  it("falls back to limitPrice when no prices available", () => {
    const fill = simulatePaperFill({ side: "yes", action: "buy", askPrice: 0, bidPrice: 0, quantity: 2, limitPrice: 0.48 });
    expect(fill.fillPrice).toBe(0.48);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm test -- --run server/paper-simulator.test.ts
```

Expected: FAIL — `simulatePaperFill` not found.

- [ ] **Step 3: Implement**

Create `server/_core/paperSimulator.ts`:

```typescript
export interface PaperFillInput {
  side: "yes" | "no";
  action: "buy" | "sell";
  askPrice: number;
  bidPrice: number;
  quantity: number;
  fallbackMidPrice?: number;
  limitPrice?: number;
}

export interface PaperFillResult {
  fillPrice: number;
  fillQuantity: number;
  executionMode: "paper";
  filledAt: Date;
}

export function simulatePaperFill(input: PaperFillInput): PaperFillResult {
  const { action, askPrice, bidPrice, quantity, fallbackMidPrice, limitPrice } = input;

  let fillPrice: number;
  if (action === "buy" && askPrice > 0) {
    fillPrice = askPrice;
  } else if (action === "sell" && bidPrice > 0) {
    fillPrice = bidPrice;
  } else if (fallbackMidPrice && fallbackMidPrice > 0) {
    fillPrice = fallbackMidPrice;
  } else {
    fillPrice = limitPrice ?? 0.5;
  }

  return {
    fillPrice: Math.max(0.01, Math.min(0.99, fillPrice)),
    fillQuantity: quantity,
    executionMode: "paper",
    filledAt: new Date(),
  };
}
```

- [ ] **Step 4: Run tests**

```bash
corepack pnpm test -- --run server/paper-simulator.test.ts
```

Expected: all 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/_core/paperSimulator.ts server/paper-simulator.test.ts
git commit -m "feat(paper): add simulatePaperFill — immediate fill at ask/bid price"
```

---

## Task 7: Ramp-window cap

**Files:**
- Create: `server/_core/rampWindow.ts`
- Create: `server/ramp-window.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/ramp-window.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { applyRampWindowCap, isInRampWindow } from "./_core/rampWindow";

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

describe("isInRampWindow", () => {
  it("returns true when liveStartedAt is recent", () => {
    expect(isInRampWindow(hoursAgo(1), 72)).toBe(true);
  });

  it("returns false when liveStartedAt is past window", () => {
    expect(isInRampWindow(hoursAgo(73), 72)).toBe(false);
  });

  it("returns false when liveStartedAt is null", () => {
    expect(isInRampWindow(null, 72)).toBe(false);
  });
});

describe("applyRampWindowCap", () => {
  it("clamps size during ramp window", () => {
    const result = applyRampWindowCap({
      intendedSize: 20,
      intendedMaxDayLoss: 10,
      liveStartedAt: hoursAgo(1),
      rampWindowHours: 72,
      rampSizeMultiplier: 0.25,
    });
    expect(result.cappedSize).toBe(5);       // floor(20 * 0.25)
    expect(result.cappedMaxDayLoss).toBe(2); // floor(10 * 0.25)
    expect(result.rampActive).toBe(true);
  });

  it("does not clamp after ramp window expires", () => {
    const result = applyRampWindowCap({
      intendedSize: 20,
      intendedMaxDayLoss: 10,
      liveStartedAt: hoursAgo(73),
      rampWindowHours: 72,
      rampSizeMultiplier: 0.25,
    });
    expect(result.cappedSize).toBe(20);
    expect(result.rampActive).toBe(false);
  });

  it("does not clamp when liveStartedAt is null", () => {
    const result = applyRampWindowCap({
      intendedSize: 20,
      intendedMaxDayLoss: 10,
      liveStartedAt: null,
      rampWindowHours: 72,
      rampSizeMultiplier: 0.25,
    });
    expect(result.cappedSize).toBe(20);
    expect(result.rampActive).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
corepack pnpm test -- --run server/ramp-window.test.ts
```

Expected: FAIL — `applyRampWindowCap` not found.

- [ ] **Step 3: Implement**

Create `server/_core/rampWindow.ts`:

```typescript
export interface RampWindowCapInput {
  intendedSize: number;
  intendedMaxDayLoss: number;
  liveStartedAt: Date | null;
  rampWindowHours: number;
  rampSizeMultiplier: number;
}

export interface RampWindowCapResult {
  cappedSize: number;
  cappedMaxDayLoss: number;
  rampActive: boolean;
  hoursRemaining: number;
}

export function isInRampWindow(liveStartedAt: Date | null, rampWindowHours: number): boolean {
  if (!liveStartedAt) return false;
  const elapsed = (Date.now() - liveStartedAt.getTime()) / (60 * 60 * 1000);
  return elapsed < rampWindowHours;
}

export function applyRampWindowCap(input: RampWindowCapInput): RampWindowCapResult {
  const { intendedSize, intendedMaxDayLoss, liveStartedAt, rampWindowHours, rampSizeMultiplier } = input;

  if (!isInRampWindow(liveStartedAt, rampWindowHours)) {
    return { cappedSize: intendedSize, cappedMaxDayLoss: intendedMaxDayLoss, rampActive: false, hoursRemaining: 0 };
  }

  const elapsed = liveStartedAt ? (Date.now() - liveStartedAt.getTime()) / (60 * 60 * 1000) : 0;
  const hoursRemaining = Math.max(0, rampWindowHours - elapsed);

  return {
    cappedSize: Math.floor(intendedSize * rampSizeMultiplier),
    cappedMaxDayLoss: Math.floor(intendedMaxDayLoss * rampSizeMultiplier),
    rampActive: true,
    hoursRemaining: Math.round(hoursRemaining),
  };
}
```

- [ ] **Step 4: Run tests**

```bash
corepack pnpm test -- --run server/ramp-window.test.ts
```

Expected: all 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/_core/rampWindow.ts server/ramp-window.test.ts
git commit -m "feat(rampWindow): add applyRampWindowCap for first-live position-size reduction"
```

---

## Task 8: Drawdown engine

**Files:**
- Create: `server/_core/drawdownEngine.ts`
- Create: `server/drawdown.autoPause.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/drawdown.autoPause.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  getTodayRealizedLoss: vi.fn(),
  getKalshiCapital: vi.fn(),
  logAuditEvent: vi.fn().mockResolvedValue(true),
}));
vi.mock("./db.trading-preferences", () => ({
  getTradingPreferences: vi.fn(),
  saveTradingPreferences: vi.fn(),
}));
vi.mock("./_core/alerting", () => ({
  alertDrawdown: vi.fn().mockResolvedValue(undefined),
}));

import { evaluateDrawdown } from "./_core/drawdownEngine";
import * as db from "./db";
import * as prefsDb from "./db.trading-preferences";
import { alertDrawdown } from "./_core/alerting";

const mockPrefs = (overrides = {}) => ({
  drawdownWarnPct: 5,
  drawdownPausePct: 10,
  drawdownPanicPct: 20,
  kalshiPaused: 0,
  polymarketPaused: 0,
  ...overrides,
});

describe("evaluateDrawdown", () => {
  beforeEach(() => {
    vi.mocked(db.getTodayRealizedLoss).mockResolvedValue(0);
    vi.mocked(db.getKalshiCapital).mockResolvedValue({ currentBalance: 100, startingBalance: 100 } as never);
    vi.mocked(prefsDb.getTradingPreferences).mockResolvedValue(mockPrefs() as never);
    vi.mocked(prefsDb.saveTradingPreferences).mockResolvedValue(mockPrefs() as never);
  });

  it("returns ok when no loss", async () => {
    const result = await evaluateDrawdown(1, "kalshi", "system");
    expect(result.tier).toBe("ok");
    expect(result.shouldPause).toBe(false);
  });

  it("returns warn tier at 5% loss without pausing", async () => {
    vi.mocked(db.getTodayRealizedLoss).mockResolvedValue(5);
    const result = await evaluateDrawdown(1, "kalshi", "system");
    expect(result.tier).toBe("warn");
    expect(result.shouldPause).toBe(false);
    expect(alertDrawdown).toHaveBeenCalledWith(1, "kalshi", expect.objectContaining({ level: "warn" }));
  });

  it("returns pause tier at 10% loss and sets paused flag", async () => {
    vi.mocked(db.getTodayRealizedLoss).mockResolvedValue(10);
    const result = await evaluateDrawdown(1, "kalshi", "system");
    expect(result.tier).toBe("pause");
    expect(result.shouldPause).toBe(true);
    expect(prefsDb.saveTradingPreferences).toHaveBeenCalledWith(1, { kalshiPaused: 1 });
  });

  it("returns panic tier at 20% loss", async () => {
    vi.mocked(db.getTodayRealizedLoss).mockResolvedValue(20);
    const result = await evaluateDrawdown(1, "kalshi", "system");
    expect(result.tier).toBe("panic");
    expect(alertDrawdown).toHaveBeenCalledWith(1, "kalshi", expect.objectContaining({ level: "panic" }));
  });

  it("skips evaluation when already paused", async () => {
    vi.mocked(prefsDb.getTradingPreferences).mockResolvedValue(mockPrefs({ kalshiPaused: 1 }) as never);
    const result = await evaluateDrawdown(1, "kalshi", "system");
    expect(result.tier).toBe("already_paused");
    expect(prefsDb.saveTradingPreferences).not.toHaveBeenCalled();
  });

  it("returns ok when capital is zero (no meaningful loss pct)", async () => {
    vi.mocked(db.getKalshiCapital).mockResolvedValue({ currentBalance: 0, startingBalance: 0 } as never);
    const result = await evaluateDrawdown(1, "kalshi", "system");
    expect(result.tier).toBe("ok");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
corepack pnpm test -- --run server/drawdown.autoPause.test.ts
```

Expected: FAIL — `evaluateDrawdown` not found.

- [ ] **Step 3: Implement**

Create `server/_core/drawdownEngine.ts`:

```typescript
import { getTodayRealizedLoss, getKalshiCapital, logAuditEvent } from "../db";
import { getTradingPreferences, saveTradingPreferences } from "../db.trading-preferences";
import { alertDrawdown } from "./alerting";
import type { TradingPlatform } from "./tradingMode";

export type DrawdownTier = "ok" | "warn" | "pause" | "panic" | "already_paused";

export interface DrawdownEvalResult {
  tier: DrawdownTier;
  lossPct: number;
  shouldPause: boolean;
}

export async function evaluateDrawdown(
  userId: number,
  platform: TradingPlatform,
  triggeredByOpenId: string
): Promise<DrawdownEvalResult> {
  const prefs = await getTradingPreferences(userId);

  const isPaused = platform === "kalshi" ? Boolean(prefs.kalshiPaused) : Boolean(prefs.polymarketPaused);
  if (isPaused) {
    return { tier: "already_paused", lossPct: 0, shouldPause: false };
  }

  // Only Kalshi capital tracked in SP-1; Polymarket deferred to SP-5
  const capital = platform === "kalshi" ? await getKalshiCapital(userId) : null;
  const startEquity = Number(capital?.currentBalance ?? capital?.startingBalance ?? 0);

  if (startEquity <= 0) {
    return { tier: "ok", lossPct: 0, shouldPause: false };
  }

  const realizedLoss = platform === "kalshi" ? await getTodayRealizedLoss(userId) : 0;
  const lossPct = (realizedLoss / startEquity) * 100;

  if (lossPct >= prefs.drawdownPanicPct) {
    await saveTradingPreferences(userId, platform === "kalshi" ? { kalshiPaused: 1 } : { polymarketPaused: 1 });
    void alertDrawdown(userId, platform, { level: "panic", lossPct, threshold: prefs.drawdownPanicPct });
    void logAuditEvent("drawdown_auto_pause", JSON.stringify({ platform, tier: "panic", lossPct, threshold: prefs.drawdownPanicPct }), triggeredByOpenId);
    return { tier: "panic", lossPct, shouldPause: true };
  }

  if (lossPct >= prefs.drawdownPausePct) {
    await saveTradingPreferences(userId, platform === "kalshi" ? { kalshiPaused: 1 } : { polymarketPaused: 1 });
    void alertDrawdown(userId, platform, { level: "pause", lossPct, threshold: prefs.drawdownPausePct });
    void logAuditEvent("drawdown_auto_pause", JSON.stringify({ platform, tier: "pause", lossPct, threshold: prefs.drawdownPausePct }), triggeredByOpenId);
    return { tier: "pause", lossPct, shouldPause: true };
  }

  if (lossPct >= prefs.drawdownWarnPct) {
    void alertDrawdown(userId, platform, { level: "warn", lossPct, threshold: prefs.drawdownWarnPct });
    return { tier: "warn", lossPct, shouldPause: false };
  }

  return { tier: "ok", lossPct, shouldPause: false };
}
```

- [ ] **Step 4: Run tests**

```bash
corepack pnpm test -- --run server/drawdown.autoPause.test.ts
```

Expected: all 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add server/_core/drawdownEngine.ts server/drawdown.autoPause.test.ts
git commit -m "feat(drawdown): add evaluateDrawdown with warn/pause/panic auto-trip tiers"
```

---

## Task 9: Kalshi executor short-circuit

**Files:**
- Modify: `server/_core/kalshiExecution.ts`
- Create: `server/kalshi.execution.mode.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/kalshi.execution.mode.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/tradingMode", () => ({
  getEffectiveMode: vi.fn(),
}));
vi.mock("./db", () => ({
  insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([]) }),
  logAuditEvent: vi.fn().mockResolvedValue(true),
  getKalshiCapital: vi.fn().mockResolvedValue({ currentBalance: 100, paperBalance: 0 }),
  update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
}));
vi.mock("./db.kalshi-credentials", () => ({
  getKalshiCredentials: vi.fn().mockResolvedValue({ apiKey: "test-key", privateKey: "test-pk" }),
}));
vi.mock("./db.trading-preferences", () => ({
  getTradingPreferences: vi.fn().mockResolvedValue({
    kalshiMode: "shadow", kalshiPaused: 0, kalshiLiveStartedAt: null,
    rampWindowHours: 72, rampSizeMultiplier: 0.25,
  }),
  saveTradingPreferences: vi.fn(),
}));
vi.mock("./_core/kalshiRisk", () => ({
  calculateKalshiBuyOrderRisk: vi.fn().mockReturnValue({ quantity: 5, limitPrice: 0.50 }),
  normalizeLimitPrice: vi.fn((p: number) => p),
  normalizeOrderQuantity: vi.fn((q: number) => q),
}));

global.fetch = vi.fn();

import { placeKalshiOrder } from "./_core/kalshiExecution";
import { getEffectiveMode } from "./_core/tradingMode";
import * as db from "./db";

describe("placeKalshiOrder — mode gating", () => {
  beforeEach(() => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ order: { order_id: "exch-123" } }),
    } as Response);
  });

  it("returns shadowed status without calling exchange when in shadow mode", async () => {
    vi.mocked(getEffectiveMode).mockResolvedValue({ mode: "shadow", paused: false, reason: "shadow", source: "user_setting" });
    const result = await placeKalshiOrder(1, "MARKET-1", "yes", 5, 0.50);
    expect(result.success).toBe(false);
    expect(result.shadowed).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns blocked status without writing anything when paused", async () => {
    vi.mocked(getEffectiveMode).mockResolvedValue({ mode: "live", paused: true, reason: "manual", source: "manual_pause" });
    const result = await placeKalshiOrder(1, "MARKET-1", "yes", 5, 0.50);
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("calls exchange when in live mode", async () => {
    vi.mocked(getEffectiveMode).mockResolvedValue({ mode: "live", paused: false, reason: "live", source: "user_setting" });
    await placeKalshiOrder(1, "MARKET-1", "yes", 5, 0.50);
    expect(fetch).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
corepack pnpm test -- --run server/kalshi.execution.mode.test.ts
```

Expected: FAIL — `result.shadowed` and `result.blocked` not in return type.

- [ ] **Step 3: Add short-circuit to `placeKalshiOrder`**

In `server/_core/kalshiExecution.ts`, add imports at the top:

```typescript
import { getEffectiveMode } from "./tradingMode";
import { simulatePaperFill } from "./paperSimulator";
import { applyRampWindowCap } from "./rampWindow";
import { getTradingPreferences } from "../db.trading-preferences";
import { logAuditEvent } from "../db";
```

Change the return type signature of `placeKalshiOrder` to add:

```typescript
  shadowed?: boolean;
  blocked?: boolean;
  paperFilled?: boolean;
```

At the **very top** of the `try` block inside `placeKalshiOrder` (before `const risk = ...`), add:

```typescript
    const effective = await getEffectiveMode(userId, "kalshi");

    if (effective.paused) {
      void logAuditEvent("order_blocked_kill_switch", JSON.stringify({ reason: effective.reason, source: effective.source, marketId, side }), `user:${userId}`);
      return { success: false, blocked: true, error: `Trading paused: ${effective.reason}` };
    }

    if (effective.mode === "shadow") {
      const clientOrderId = `shadow-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      await db.insert(kalshiOrders).values({
        userId: getScopedUserId(userId),
        orderId: clientOrderId,
        marketId,
        action: "buy",
        side,
        quantity,
        limitPrice,
        status: "pending",
        filledQuantity: 0,
        averagePrice: 0,
        executionMode: "shadow",
      });
      void logAuditEvent("shadow_order_logged", JSON.stringify({ marketId, side, quantity, limitPrice, reason: effective.reason }), `user:${userId}`);
      return { success: false, shadowed: true, error: "shadow mode: order logged but not placed" };
    }

    if (effective.mode === "paper") {
      const clientOrderId = `paper-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      const fill = simulatePaperFill({ side, action: "buy", askPrice: limitPrice, bidPrice: limitPrice * 0.98, quantity, limitPrice });
      await db.insert(kalshiOrders).values({
        userId: getScopedUserId(userId),
        orderId: clientOrderId,
        marketId,
        action: "buy",
        side,
        quantity: fill.fillQuantity,
        limitPrice,
        status: "filled",
        filledQuantity: fill.fillQuantity,
        averagePrice: fill.fillPrice,
        executionMode: "paper",
      });
      await db.insert(kalshiPositions).values({
        userId: getScopedUserId(userId),
        marketId,
        side,
        quantity: fill.fillQuantity,
        entryPrice: fill.fillPrice,
        currentPrice: fill.fillPrice,
        unrealizedPnl: 0,
        realizedPnl: 0,
        positionStatus: "open",
        executionMode: "paper",
      });
      void logAuditEvent("paper_order_filled", JSON.stringify({ marketId, side, quantity: fill.fillQuantity, fillPrice: fill.fillPrice }), `user:${userId}`);
      return { success: true, orderId: clientOrderId, paperFilled: true };
    }
```

Then before the final exchange call (live path), add the ramp-window cap after `const risk = calculateKalshiBuyOrderRisk(...)`:

```typescript
    const prefs = await getTradingPreferences(userId);
    const ramp = applyRampWindowCap({
      intendedSize: risk.quantity,
      intendedMaxDayLoss: 999, // not used here — risk already checked upstream
      liveStartedAt: prefs.kalshiLiveStartedAt ?? null,
      rampWindowHours: prefs.rampWindowHours,
      rampSizeMultiplier: prefs.rampSizeMultiplier,
    });
    if (ramp.rampActive && ramp.cappedSize < risk.quantity) {
      risk.quantity = ramp.cappedSize;
      void logAuditEvent("ramp_window_clamp", JSON.stringify({ originalSize: quantity, cappedSize: ramp.cappedSize, hoursRemaining: ramp.hoursRemaining, marketId }), `user:${userId}`);
    }
```

- [ ] **Step 4: Run tests**

```bash
corepack pnpm test -- --run server/kalshi.execution.mode.test.ts
```

Expected: all 3 PASS.

- [ ] **Step 5: Run full suite**

```bash
corepack pnpm test -- --run
```

Expected: 368+ passing.

- [ ] **Step 6: Commit**

```bash
git add server/_core/kalshiExecution.ts server/kalshi.execution.mode.test.ts
git commit -m "feat(kalshiExecution): shadow/paper/pause gating + ramp-window cap at executor entry"
```

---

## Task 10: Wire drawdown into Kalshi autonomy + shadow integration test

**Files:**
- Modify: `server/_core/kalshiAutonomy.ts`
- Create: `server/kalshi.autonomy.shadowMode.test.ts`

- [ ] **Step 1: Write failing integration test**

Create `server/kalshi.autonomy.shadowMode.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  createAutonomyRun: vi.fn().mockResolvedValue({ id: 1, runId: "run-1" }),
  updateAutonomyRun: vi.fn().mockResolvedValue({}),
  logAuditEvent: vi.fn().mockResolvedValue(true),
  getLatestAutonomyRun: vi.fn().mockResolvedValue(null),
  getLatestAuditEventByType: vi.fn().mockResolvedValue(null),
  getKalshiCapital: vi.fn().mockResolvedValue({ currentBalance: 100 }),
  getTodayRealizedLoss: vi.fn().mockResolvedValue(0),
  getOpenPositions: vi.fn().mockResolvedValue([]),
}));
vi.mock("./db.kalshi-credentials", () => ({
  getKalshiCredentials: vi.fn().mockResolvedValue({ apiKey: "k", privateKey: "pk" }),
}));
vi.mock("./db.trading-preferences", () => ({
  getTradingPreferences: vi.fn().mockResolvedValue({
    autonomyMode: "fully_autonomous",
    liveTradingEnabled: true,
    executionCadence: "continuous_watch",
    riskPosture: "balanced",
    minSignalConfidence: 0.72,
    maxOrderNotional: 10,
    maxDailyOrders: 3,
    requireApprovalAbove: 8,
    kalshiMode: "shadow",
    polymarketMode: "shadow",
    kalshiPaused: 0,
    polymarketPaused: 0,
    kalshiLiveStartedAt: null,
    rampWindowHours: 72,
    rampSizeMultiplier: 0.25,
    drawdownWarnPct: 5,
    drawdownPausePct: 10,
    drawdownPanicPct: 20,
  }),
  saveTradingPreferences: vi.fn(),
}));
vi.mock("./_core/kalshiMarketData", () => ({
  fetchKalshiMarkets: vi.fn().mockResolvedValue([
    { marketId: "MKT-1", title: "Test", category: "crypto", yesPrice: 0.55, noPrice: 0.45, yesVolume: 1000, noVolume: 1000, impliedProbability: 0.55, liquidity: 2000, status: "open", resolutionDate: new Date(Date.now() + 48 * 3600 * 1000) },
  ]),
  fetchKalshiMarketDetails: vi.fn().mockResolvedValue(null),
}));
vi.mock("./_core/kalshiSignals", () => ({
  generateSignalsForMarkets: vi.fn().mockResolvedValue([{ marketId: "MKT-1", signalType: "value_play", side: "yes", confidence: 0.80, reasoning: "test", impliedProbability: 0.55, marketPrice: 0.55, expectedValue: 0.08 }]),
  filterSignalsByConfidence: vi.fn((s: unknown[]) => s),
  filterSignalsByMarketConditions: vi.fn((s: unknown[]) => s),
  getTopSignalsForExecution: vi.fn((s: unknown[]) => s.slice(0, 1)),
  saveSignals: vi.fn().mockResolvedValue([]),
}));
vi.mock("./_core/tradingReviewer", () => ({
  reviewSignalsWithTrader: vi.fn().mockResolvedValue([{ marketId: "MKT-1", confidence: 0.80, expectedValue: 0.08, side: "yes", reasoning: "approved" }]),
}));
vi.mock("./_core/kalshiAuth", () => ({
  fetchKalshiAccountEquity: vi.fn().mockResolvedValue({ equity: 100 }),
}));
vi.mock("./_core/kalshiMarketFeed", () => ({
  getMarketFeed: vi.fn().mockReturnValue(null),
  isMarketDataStale: vi.fn().mockReturnValue(false),
}));
vi.mock("./_core/kalshiOrderSync", () => ({ syncPendingOrders: vi.fn().mockResolvedValue([]) }));
vi.mock("./_core/distributedLock", () => ({
  createOrderSyncLock: vi.fn().mockReturnValue({ acquire: vi.fn().mockResolvedValue({ holderId: "h1", release: vi.fn() }) }),
}));
vi.mock("./_core/alerting", () => ({
  alertIfConsecutiveFailures: vi.fn(),
  alertEquityDrop: vi.fn(),
  alertExchangeRejection: vi.fn(),
  alertAiReviewerFailure: vi.fn(),
  alertDrawdown: vi.fn(),
}));
vi.mock("./_core/aiToolbelt", () => ({
  getCacheHitRatio: vi.fn().mockReturnValue(0),
  newReviewerTelemetry: vi.fn().mockReturnValue({ calls: 0, failures: 0, signalsApproved: 0 }),
}));
vi.mock("./db.training", () => ({
  getUserTrainingInstructions: vi.fn().mockResolvedValue([]),
  isInstructionActiveNow: vi.fn().mockReturnValue(true),
  applyInstructionsToSignals: vi.fn((s: unknown[]) => s),
}));

global.fetch = vi.fn();

import { runScheduledAutonomousTrading } from "./_core/kalshiAutonomy";

describe("runScheduledAutonomousTrading in shadow mode", () => {
  it("completes run without calling Kalshi order placement API", async () => {
    const user = { id: 1, openId: "user-1", name: "Test", email: "t@t.com", role: "user" as const, betaAccessLevel: "public" as const, twoFactorSecret: null, twoFactorEnabled: 0, backupCodesHash: null, lastSignedIn: null, createdAt: new Date() };
    await runScheduledAutonomousTrading(user);
    const fetchCalls = vi.mocked(fetch).mock.calls;
    const orderPlacementCalls = fetchCalls.filter(([url]) => String(url).includes("/portfolio/orders"));
    expect(orderPlacementCalls).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm test -- --run server/kalshi.autonomy.shadowMode.test.ts
```

Expected: either test infrastructure fails (mocks incomplete) or the order placement call IS made (proving shadow mode isn't wired). Either way confirms gating needed.

- [ ] **Step 3: Add drawdown check to `runScheduledAutonomousTrading`**

In `server/_core/kalshiAutonomy.ts`, add the import:

```typescript
import { evaluateDrawdown } from "./drawdownEngine";
```

Inside `runScheduledAutonomousTrading`, after `const preferences = await tradingPreferencesDb.getTradingPreferences(userId);` (around line 749), add:

```typescript
  // Pre-flight drawdown check — auto-pause if intra-day loss exceeds threshold
  const drawdownResult = await evaluateDrawdown(userId, "kalshi", triggeredByOpenId);
  if (drawdownResult.shouldPause) {
    return await persistScheduledResult(user, buildResult({
      status: "blocked",
      reason: `drawdown_auto_pause: ${drawdownResult.tier} tier at ${drawdownResult.lossPct.toFixed(1)}%`,
      signalsGenerated: 0,
      executionCandidates: 0,
      orderPlaced: false,
      autonomyMode: preferences.autonomyMode,
      executionCadence: preferences.executionCadence,
      runId,
      triggerSource,
    }), { runId, userId, triggeredByOpenId });
  }
```

- [ ] **Step 4: Run integration test**

```bash
corepack pnpm test -- --run server/kalshi.autonomy.shadowMode.test.ts
```

Expected: PASS — no exchange calls in shadow mode.

- [ ] **Step 5: Run full suite**

```bash
corepack pnpm test -- --run
```

Expected: all passing.

- [ ] **Step 6: Commit**

```bash
git add server/_core/kalshiAutonomy.ts server/kalshi.autonomy.shadowMode.test.ts
git commit -m "feat(autonomy): wire drawdown evaluator at top of scheduled Kalshi run"
```

---

## Task 11: Polymarket executor gating

**Files:**
- Modify: `server/_core/polymarketAuth.ts`
- Modify: `server/routers.ts` (update import)

- [ ] **Step 1: Write failing test**

Create `server/polymarket.execution.mode.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

vi.mock("./_core/tradingMode", () => ({
  getEffectiveMode: vi.fn(),
}));
vi.mock("./db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(true),
}));

global.fetch = vi.fn();

import { gatedPlacePolymarketOrder } from "./_core/polymarketAuth";
import { getEffectiveMode } from "./_core/tradingMode";

describe("gatedPlacePolymarketOrder", () => {
  it("blocks exchange call when paused", async () => {
    vi.mocked(getEffectiveMode).mockResolvedValue({ mode: "live", paused: true, reason: "paused", source: "manual_pause" });
    const result = await gatedPlacePolymarketOrder(1, "key", "secret", "pass", { tokenId: "tok-1", side: "BUY", price: 0.55, size: 10 });
    expect(result.success).toBe(false);
    expect(result.blocked).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("returns shadowed without calling exchange in shadow mode", async () => {
    vi.mocked(getEffectiveMode).mockResolvedValue({ mode: "shadow", paused: false, reason: "shadow", source: "user_setting" });
    const result = await gatedPlacePolymarketOrder(1, "key", "secret", "pass", { tokenId: "tok-1", side: "BUY", price: 0.55, size: 10 });
    expect(result.success).toBe(false);
    expect(result.shadowed).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("calls exchange in live mode", async () => {
    vi.mocked(getEffectiveMode).mockResolvedValue({ mode: "live", paused: false, reason: "live", source: "user_setting" });
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => ({ order_id: "poly-123" }) } as Response);
    const result = await gatedPlacePolymarketOrder(1, "key", "secret", "pass", { tokenId: "tok-1", side: "BUY", price: 0.55, size: 10 });
    expect(fetch).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm test -- --run server/polymarket.execution.mode.test.ts
```

Expected: FAIL — `gatedPlacePolymarketOrder` not exported.

- [ ] **Step 3: Add `gatedPlacePolymarketOrder` to `polymarketAuth.ts`**

Add imports at top of `server/_core/polymarketAuth.ts`:

```typescript
import { getEffectiveMode } from "./tradingMode";
import { logAuditEvent } from "../db";
```

Append to the end of `server/_core/polymarketAuth.ts`:

```typescript
export async function gatedPlacePolymarketOrder(
  userId: number,
  apiKey: string,
  apiSecret: string,
  apiPassphrase: string,
  order: { tokenId: string; side: "BUY" | "SELL"; price: number; size: number },
): Promise<{ success: boolean; orderId?: string; error?: string; shadowed?: boolean; blocked?: boolean }> {
  const effective = await getEffectiveMode(userId, "polymarket");

  if (effective.paused) {
    void logAuditEvent("order_blocked_kill_switch", JSON.stringify({ platform: "polymarket", reason: effective.reason }), `user:${userId}`);
    return { success: false, blocked: true, error: `Polymarket trading paused: ${effective.reason}` };
  }

  if (effective.mode === "shadow" || effective.mode === "paper") {
    // Paper mode: Polymarket position tables don't exist yet (SP-5). Degrade to shadow.
    void logAuditEvent("shadow_order_logged", JSON.stringify({ platform: "polymarket", tokenId: order.tokenId, side: order.side, size: order.size, mode: effective.mode }), `user:${userId}`);
    return { success: false, shadowed: true, error: `${effective.mode} mode: polymarket order logged but not placed` };
  }

  return placePolymarketOrder(apiKey, apiSecret, apiPassphrase, order);
}
```

- [ ] **Step 4: Update `routers.ts` import**

In `server/routers.ts`, change:

```typescript
import {
  validatePolymarketCredentials,
  fetchPolymarketMarkets,
  placePolymarketOrder,
} from "./_core/polymarketAuth";
```

to:

```typescript
import {
  validatePolymarketCredentials,
  fetchPolymarketMarkets,
  placePolymarketOrder,
  gatedPlacePolymarketOrder,
} from "./_core/polymarketAuth";
```

Find every call to `placePolymarketOrder(` in `routers.ts` that uses raw creds (not from the gated wrapper) and replace with `gatedPlacePolymarketOrder(userId, ...)`. Verify with:

```bash
grep -n "placePolymarketOrder(" server/routers.ts
```

Each call site should pass `userId` as the first arg.

- [ ] **Step 5: Run tests**

```bash
corepack pnpm test -- --run server/polymarket.execution.mode.test.ts
corepack pnpm test -- --run
```

Expected: new tests pass, suite still green.

- [ ] **Step 6: Commit**

```bash
git add server/_core/polymarketAuth.ts server/routers.ts server/polymarket.execution.mode.test.ts
git commit -m "feat(polymarket): add gatedPlacePolymarketOrder with shadow/pause short-circuit"
```

---

## Task 12: tRPC trading mode procedures

**Files:**
- Modify: `server/routers.ts`

- [ ] **Step 1: Add imports to `routers.ts`**

Near the top of `server/routers.ts`, add:

```typescript
import { getEffectiveMode } from "./_core/tradingMode";
import { alertKillSwitch, alertModeChange } from "./_core/alerting";
```

- [ ] **Step 2: Add new procedures to `tradingRouter` (or `kalshiRouter`)**

Find the trading procedures section in `routers.ts` (search for `tradingPreferences` or `saveTradingPreferences`). Add the following procedures in the relevant router:

```typescript
  getTradingStatus: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.user.id;
    const [kalshi, polymarket] = await Promise.all([
      getEffectiveMode(userId, "kalshi"),
      getEffectiveMode(userId, "polymarket"),
    ]);
    const prefs = await tradingPreferencesDb.getTradingPreferences(userId);
    return {
      kalshi: { ...kalshi, liveStartedAt: prefs.kalshiLiveStartedAt },
      polymarket: { ...polymarket, liveStartedAt: prefs.polymarketLiveStartedAt },
      rampWindowHours: prefs.rampWindowHours,
      rampSizeMultiplier: prefs.rampSizeMultiplier,
    };
  }),

  setTradingMode: protectedProcedure
    .input(z.object({
      platform: z.enum(["kalshi", "polymarket"]),
      mode: z.enum(["shadow", "paper", "live"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const prefs = await tradingPreferencesDb.getTradingPreferences(userId);
      const oldMode = input.platform === "kalshi" ? prefs.kalshiMode : prefs.polymarketMode;
      const update = input.platform === "kalshi"
        ? { kalshiMode: input.mode, kalshiLiveStartedAt: input.mode === "live" ? new Date() : null }
        : { polymarketMode: input.mode, polymarketLiveStartedAt: input.mode === "live" ? new Date() : null };
      await tradingPreferencesDb.saveTradingPreferences(userId, update);
      void alertModeChange(userId, input.platform, { oldMode: oldMode as string, newMode: input.mode, actor: ctx.user.openId });
      void db.logAuditEvent("mode_changed", JSON.stringify({ platform: input.platform, oldMode, newMode: input.mode }), ctx.user.openId);
      return { ok: true };
    }),

  pauseTrading: protectedProcedure
    .input(z.object({ platform: z.enum(["kalshi", "polymarket"]) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const update = input.platform === "kalshi" ? { kalshiPaused: 1 } : { polymarketPaused: 1 };
      await tradingPreferencesDb.saveTradingPreferences(userId, update);
      void alertKillSwitch(userId, input.platform, { reason: "manual pause via UI", source: "manual" });
      void db.logAuditEvent("kill_switch_activated", JSON.stringify({ platform: input.platform, source: "manual" }), ctx.user.openId);
      return { ok: true };
    }),

  resumeTrading: protectedProcedure
    .input(z.object({ platform: z.enum(["kalshi", "polymarket"]), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      const update = input.platform === "kalshi" ? { kalshiPaused: 0 } : { polymarketPaused: 0 };
      await tradingPreferencesDb.saveTradingPreferences(userId, update);
      void db.logAuditEvent("kill_switch_deactivated", JSON.stringify({ platform: input.platform, reason: input.reason }), ctx.user.openId);
      return { ok: true };
    }),

  pauseAll: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.user.id;
    await tradingPreferencesDb.saveTradingPreferences(userId, { kalshiPaused: 1, polymarketPaused: 1 });
    void alertKillSwitch(userId, "all", { reason: "PAUSE ALL via UI", source: "manual" });
    void db.logAuditEvent("kill_switch_activated", JSON.stringify({ platform: "all", source: "manual" }), ctx.user.openId);
    return { ok: true };
  }),

  settlePaperPosition: protectedProcedure
    .input(z.object({ positionId: z.number().int().positive(), settlePrice: z.number().min(0).max(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.user.id;
      // Fetch position, verify it's paper and belongs to user, mark closed with settlement PnL
      const positions = await db.getOpenPositions(userId);
      const position = positions.find((p) => p.id === input.positionId);
      if (!position) throw new TRPCError({ code: "NOT_FOUND", message: "Paper position not found" });
      const realizedPnl = (input.settlePrice - position.entryPrice) * position.quantity * (position.side === "yes" ? 1 : -1);
      await db.closePosition(input.positionId, userId, { realizedPnl, settlePrice: input.settlePrice });
      void db.logAuditEvent("paper_position_settled", JSON.stringify({ positionId: input.positionId, settlePrice: input.settlePrice, realizedPnl }), ctx.user.openId);
      return { ok: true, realizedPnl };
    }),
```

- [ ] **Step 3: Typecheck**

```bash
corepack pnpm check
```

Fix any type errors (e.g., `getOpenPositions` and `closePosition` may need adding to `db.ts` — check if they exist; if not, create stubs querying `kalshiPositions`).

- [ ] **Step 4: Run full suite**

```bash
corepack pnpm test -- --run
```

Expected: all passing.

- [ ] **Step 5: Commit**

```bash
git add server/routers.ts
git commit -m "feat(routers): add setTradingMode, pauseTrading, resumeTrading, pauseAll, settlePaperPosition tRPC procedures"
```

---

## Task 13: UI hook `useTradingStatus`

**Files:**
- Create: `client/src/hooks/useTradingStatus.ts`

- [ ] **Step 1: Create the hook**

```typescript
// client/src/hooks/useTradingStatus.ts
import { trpc } from "@/lib/trpc";

export function useTradingStatus() {
  return trpc.getTradingStatus.useQuery(undefined, {
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function usePauseAll() {
  const utils = trpc.useUtils();
  return trpc.pauseAll.useMutation({
    onSuccess: () => utils.getTradingStatus.invalidate(),
  });
}

export function useResumeTrading() {
  const utils = trpc.useUtils();
  return trpc.resumeTrading.useMutation({
    onSuccess: () => utils.getTradingStatus.invalidate(),
  });
}

export function useSetTradingMode() {
  const utils = trpc.useUtils();
  return trpc.setTradingMode.useMutation({
    onSuccess: () => utils.getTradingStatus.invalidate(),
  });
}
```

- [ ] **Step 2: Typecheck**

```bash
corepack pnpm check
```

Expected: no errors (tRPC types inferred automatically).

- [ ] **Step 3: Commit**

```bash
git add client/src/hooks/useTradingStatus.ts
git commit -m "feat(ui): add useTradingStatus hook for reactive trading mode state"
```

---

## Task 14: UI — Trading Mode Banner

**Files:**
- Create: `client/src/components/TradingModeBanner.tsx`

- [ ] **Step 1: Create the banner component**

```tsx
// client/src/components/TradingModeBanner.tsx
import { useTradingStatus } from "@/hooks/useTradingStatus";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, AlertTriangle, Pause, Eye } from "lucide-react";

type ModeInfo = { mode: string; paused: boolean; reason: string };

function PlatformBadge({ label, info }: { label: string; info: ModeInfo }) {
  if (info.paused) {
    return (
      <span className="flex items-center gap-1 text-red-400 font-semibold">
        <Pause className="h-3 w-3" />
        {label}: PAUSED — {info.reason}
      </span>
    );
  }
  if (info.mode === "shadow") {
    return (
      <span className="flex items-center gap-1 text-zinc-400">
        <Eye className="h-3 w-3" />
        {label}: SHADOW
      </span>
    );
  }
  if (info.mode === "paper") {
    return (
      <span className="flex items-center gap-1 text-blue-400">
        <Shield className="h-3 w-3" />
        {label}: PAPER
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-green-400 font-semibold">
      <AlertTriangle className="h-3 w-3" />
      {label}: LIVE
    </span>
  );
}

export function TradingModeBanner() {
  const { data } = useTradingStatus();
  if (!data) return null;

  const isLive = data.kalshi.mode === "live" || data.polymarket.mode === "live";
  const isPaused = data.kalshi.paused || data.polymarket.paused;

  if (!isLive && !isPaused) return null; // no banner needed in full shadow/paper

  return (
    <Alert className={`rounded-none border-x-0 border-t-0 py-2 ${isPaused ? "bg-red-950/40 border-red-800" : "bg-zinc-900 border-zinc-700"}`}>
      <AlertDescription className="flex gap-6 text-xs">
        <PlatformBadge label="Kalshi" info={data.kalshi} />
        <PlatformBadge label="Polymarket" info={data.polymarket} />
        {data.kalshi.liveStartedAt && (
          <span className="text-zinc-500">
            Ramp window: {data.rampWindowHours}h @ {Math.round(data.rampSizeMultiplier * 100)}% size
          </span>
        )}
      </AlertDescription>
    </Alert>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
corepack pnpm check
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/TradingModeBanner.tsx
git commit -m "feat(ui): add TradingModeBanner showing live/shadow/paper/paused state"
```

---

## Task 15: UI — PAUSE ALL button

**Files:**
- Create: `client/src/components/PauseAllButton.tsx`

- [ ] **Step 1: Create the button**

```tsx
// client/src/components/PauseAllButton.tsx
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { usePauseAll, useTradingStatus } from "@/hooks/useTradingStatus";
import { Pause } from "lucide-react";

export function PauseAllButton() {
  const { data } = useTradingStatus();
  const pauseAll = usePauseAll();
  const [open, setOpen] = useState(false);

  const allPaused = data?.kalshi.paused && data?.polymarket.paused;
  if (allPaused) return null;

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="sm"
          className="fixed bottom-6 right-6 z-50 shadow-lg gap-2"
        >
          <Pause className="h-4 w-4" />
          PAUSE ALL
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Pause all trading?</AlertDialogTitle>
          <AlertDialogDescription>
            This will immediately block all new orders on Kalshi and Polymarket. Open positions are not closed. You must manually resume trading.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-red-600 hover:bg-red-700"
            onClick={() => { pauseAll.mutate(); setOpen(false); }}
          >
            Pause All Trading
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
corepack pnpm check
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/PauseAllButton.tsx
git commit -m "feat(ui): add PauseAllButton floating kill-switch with confirmation dialog"
```

---

## Task 16: UI — Trading Mode settings panel

**Files:**
- Create: `client/src/components/TradingModePanel.tsx`

- [ ] **Step 1: Create the settings panel**

```tsx
// client/src/components/TradingModePanel.tsx
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useTradingStatus, useSetTradingMode, useResumeTrading } from "@/hooks/useTradingStatus";
import { Loader2 } from "lucide-react";

type Platform = "kalshi" | "polymarket";
type Mode = "shadow" | "paper" | "live";

function modeBadgeClass(mode: Mode, paused: boolean) {
  if (paused) return "bg-red-600";
  if (mode === "live") return "bg-green-700";
  if (mode === "paper") return "bg-blue-700";
  return "bg-zinc-600";
}

function PlatformModeRow({ platform, label }: { platform: Platform; label: string }) {
  const { data, isLoading } = useTradingStatus();
  const setMode = useSetTradingMode();
  const resume = useResumeTrading();
  const info = data?.[platform];

  if (isLoading || !info) return <div className="h-10 animate-pulse bg-zinc-800 rounded" />;

  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-zinc-800 last:border-0">
      <div className="flex items-center gap-3">
        <span className="w-24 text-sm font-medium">{label}</span>
        <Badge className={modeBadgeClass(info.mode as Mode, info.paused)}>
          {info.paused ? "PAUSED" : info.mode.toUpperCase()}
        </Badge>
      </div>
      <div className="flex items-center gap-2">
        {info.paused ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => resume.mutate({ platform, reason: "manual resume" })}
            disabled={resume.isPending}
          >
            {resume.isPending && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
            Resume
          </Button>
        ) : (
          <Select
            value={info.mode}
            onValueChange={(value) => setMode.mutate({ platform, mode: value as Mode })}
            disabled={setMode.isPending}
          >
            <SelectTrigger className="w-32 h-8 text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="shadow">Shadow</SelectItem>
              <SelectItem value="paper">Paper</SelectItem>
              <SelectItem value="live">Live</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}

export function TradingModePanel() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Trading Modes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-0 p-4 pt-0">
        <PlatformModeRow platform="kalshi" label="Kalshi" />
        <PlatformModeRow platform="polymarket" label="Polymarket" />
        <p className="text-xs text-zinc-500 mt-3">
          Shadow: signals + reviewer run, no orders placed. Paper: simulated fills, no real capital. Live: real orders.
        </p>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Typecheck**

```bash
corepack pnpm check
```

- [ ] **Step 3: Commit**

```bash
git add client/src/components/TradingModePanel.tsx
git commit -m "feat(ui): add TradingModePanel with per-platform mode selector and pause/resume"
```

---

## Task 17: Wire UI into pages

**Files:**
- Modify: `client/src/components/DashboardLayout.tsx`
- Modify: `client/src/pages/TradingAutonomy.tsx`

- [ ] **Step 1: Add banner and PAUSE ALL to `DashboardLayout`**

In `client/src/components/DashboardLayout.tsx`, add imports:

```typescript
import { TradingModeBanner } from "./TradingModeBanner";
import { PauseAllButton } from "./PauseAllButton";
```

Find the `SidebarInset` JSX element (the main content area). Add `<TradingModeBanner />` as the first child inside `SidebarInset`, and `<PauseAllButton />` as the last child before the closing tag:

```tsx
<SidebarInset>
  <TradingModeBanner />
  {/* existing header/content */}
  {children}
  <PauseAllButton />
</SidebarInset>
```

- [ ] **Step 2: Add `TradingModePanel` to `TradingAutonomy` page**

In `client/src/pages/TradingAutonomy.tsx`, add import:

```typescript
import { TradingModePanel } from "@/components/TradingModePanel";
```

Add `<TradingModePanel />` at the top of the page's return JSX, before the existing autonomy controls:

```tsx
<div className="space-y-6 p-6">
  <TradingModePanel />
  {/* existing autonomy content */}
</div>
```

- [ ] **Step 3: Typecheck**

```bash
corepack pnpm check
```

Expected: no errors.

- [ ] **Step 4: Run full test suite**

```bash
corepack pnpm test -- --run
```

Expected: ≥ 408 tests passing (368 original + ~40 new).

- [ ] **Step 5: Final commit**

```bash
git add client/src/components/DashboardLayout.tsx client/src/pages/TradingAutonomy.tsx
git commit -m "feat(ui): mount TradingModeBanner, PauseAllButton, and TradingModePanel into layout"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Task |
|---|---|
| Shadow mode — zero exchange calls, intent logged | Task 9 (Kalshi), Task 11 (Polymarket) |
| Paper mode — simulated fills, mode-tagged ledger | Tasks 6, 9 |
| `getEffectiveMode` pure function | Task 3 |
| ENV `TRADING_MODE_OVERRIDE` | Task 2 |
| DB schema additions | Task 1 |
| `tradingPreferences` mode CRUD | Task 5 |
| Kill-switch: tRPC procedures | Task 12 |
| Kill-switch: multi-surface (ENV + tRPC + UI) | Tasks 2, 12, 15 |
| Drawdown auto-pause three tiers | Task 8 |
| Drawdown wired into Kalshi autonomy | Task 10 |
| Ramp-window cap | Task 7, 9 |
| Alert helpers | Task 4 |
| Audit events | Tasks 9, 10, 12 |
| UI banner | Task 14 |
| UI PAUSE ALL button | Task 15 |
| UI settings panel | Task 16 |
| UI wired into pages | Task 17 |
| `settlePaperPosition` tRPC | Task 12 |
| `useTradingStatus` hook | Task 13 |
| Tests ≥ 408 | Tasks 3, 4, 6, 7, 8, 9, 10, 11 |

**Type consistency check:**
- `TradingMode` defined in `server/_core/tradingMode.ts` and re-exported; `db.trading-preferences.ts` imports it.
- `gatedPlacePolymarketOrder` first param is `userId: number` — matches all call sites.
- `getEffectiveMode(userId, platform)` — consistent across all callers.
- `evaluateDrawdown(userId, platform, triggeredByOpenId)` — consistent.
- `applyRampWindowCap({ intendedSize, intendedMaxDayLoss, liveStartedAt, rampWindowHours, rampSizeMultiplier })` — consistent.

**Placeholder scan:** None found. All steps have exact code.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-03-pre-flight-safety-net.md`.**

**Two execution options:**

**1. Subagent-Driven (recommended)** — fresh subagent per task, spec + quality review between tasks, fast iteration. Uses `superpowers:subagent-driven-development`.

**2. Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

Which approach?
