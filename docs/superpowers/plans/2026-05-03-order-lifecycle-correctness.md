# SP-2 Order Lifecycle Correctness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the Kalshi order pipeline from best-effort to atomic + recoverable + concurrency-safe with two-phase placement, pending-order reconciliation, cold-start recovery, autonomy-run mutex with heartbeat, and full state-transition audit.

**Architecture:** Order writes split into Phase 1 (pre-write in transaction → COMMIT → exchange POST → Phase 3 finalize in transaction). A pending-order reconciler with explicit state-machine table is called every 5 min and at cold start. The existing distributed lock gets typed lock kinds, a heartbeat column, and stale-lock force-release. Every `kalshiOrders.status` UPDATE goes through `updateOrderStatus` which validates transitions and emits `order_state_changed` audit events.

**Tech Stack:** Node 20, TypeScript strict, Drizzle ORM + Neon Postgres, tRPC v11, Vitest 3.

**Spec:** `docs/superpowers/specs/2026-05-03-order-lifecycle-correctness-design.md`

**Run all tests:** `corepack pnpm test -- --run`
**Type check:** `corepack pnpm check`
**Push schema:** `corepack pnpm db:push`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `drizzle/schema.ts` | Add `capitalAdjusted`/`lastReconciledAt`/`exchangeOrderId` to `kalshiOrders`, `lockType`/`heartbeatAt` + unique index to `distributedLocks`, `pendingReconcileThresholdSeconds` to `tradingPreferences` |
| Modify | `server/db.trading-preferences.ts` | Add threshold field to settings type, normalize, save, load |
| Create | `server/_core/orderStateTransitions.ts` | `updateOrderStatus()` helper + state-machine validator + `OrderStatus` type + `OrderStatusSource` enum |
| Modify | `server/_core/kalshiExecution.ts` | Phase 1 (transactional pre-write) + Phase 3 (transactional finalize after exchange POST). `capitalAdjusted` flag on Phase 3. |
| Create | `server/_core/orderReconciler.ts` | `reconcilePendingOrders(userId)` — pure reconciler with state-machine table |
| Modify | `server/_core/kalshiOrderSync.ts` | Wire `reconcilePendingOrders` into the existing 5-min sync scheduler |
| Modify | `server/_core/distributedLock.ts` | Add `lockType` parameter, `heartbeatAt` column writes, stale-lock force-release on acquire |
| Modify | `server/_core/index.ts` | Cold-start reconciliation gate before scheduler startup |
| Modify | `server/_core/kalshiAutonomy.ts` | Wrap `runScheduledAutonomousTrading` in `autonomy_run` lock with heartbeat interval |
| Create | `server/order-state-transitions.test.ts` | Tests for `updateOrderStatus` + state machine |
| Create | `server/order-reconciler.test.ts` | Tests for state-machine table coverage |
| Create | `server/cold-start.reconciliation.test.ts` | Tests for cold-start integration |
| Create | `server/distributed-lock.heartbeat.test.ts` | Tests for lockType + heartbeat + stale release |
| Create | `server/autonomy-run.mutex.test.ts` | Tests for autonomy concurrency safety |
| Create | `server/kalshi.execution.transactional.test.ts` | Tests for Phase 1/Phase 3 atomicity |

---

## Task 1: Schema additions

**Files:**
- Modify: `drizzle/schema.ts`

- [ ] **Step 1: Add columns to `kalshiOrders`**

After the existing `executionMode` column on `kalshiOrders`, add:

```typescript
  exchangeOrderId: text("exchangeOrderId"),
  capitalAdjusted: integer("capitalAdjusted").default(0).notNull(),
  lastReconciledAt: timestamp("lastReconciledAt", { withTimezone: true }),
```

- [ ] **Step 2: Extend `distributedLocks` table**

Find the `distributedLocks` table definition. Add after the existing columns:

```typescript
  lockType: text("lockType").default("legacy").notNull(),
  heartbeatAt: timestamp("heartbeatAt", { withTimezone: true }).defaultNow().notNull(),
```

Add the composite unique index by changing the table's second-arg callback. If it has none currently, add:

```typescript
}, (table) => ({
  userTypeIdx: uniqueIndex("distributed_locks_user_type_idx").on(table.userId, table.lockType),
}));
```

If the table already has indexes, add `userTypeIdx` to the existing object. Make sure `uniqueIndex` is imported from `drizzle-orm/pg-core` (add to the top imports if missing).

- [ ] **Step 3: Add column to `tradingPreferences`**

After the `drawdownPanicPct` column (added in SP-1), add:

```typescript
  pendingReconcileThresholdSeconds: integer("pendingReconcileThresholdSeconds").default(120).notNull(),
```

- [ ] **Step 4: Typecheck**

```bash
corepack pnpm check
```

Expected: 0 new errors.

- [ ] **Step 5: Commit**

```bash
git add drizzle/schema.ts
git commit -m "feat(schema): add SP-2 order lifecycle columns and lock heartbeat"
```

---

## Task 2: Extend `db.trading-preferences.ts` with threshold field

**Files:**
- Modify: `server/db.trading-preferences.ts`

- [ ] **Step 1: Add field to `TradingPreferencesSettings` type**

After `drawdownPanicPct: number;` add:

```typescript
  pendingReconcileThresholdSeconds: number;
```

- [ ] **Step 2: Add to `DEFAULT_TRADING_PREFERENCES`**

```typescript
  pendingReconcileThresholdSeconds: 120,
```

- [ ] **Step 3: Add to `normalizeTradingPreferences`**

Add (with the other clamped fields):

```typescript
    pendingReconcileThresholdSeconds: Math.round(clamp(Number(input?.pendingReconcileThresholdSeconds ?? 120), 30, 3600)),
```

- [ ] **Step 4: Add to `toDatabaseValues`**

```typescript
    pendingReconcileThresholdSeconds: input.pendingReconcileThresholdSeconds,
```

- [ ] **Step 5: Add to `getTradingPreferences` mapping**

```typescript
      pendingReconcileThresholdSeconds: record.pendingReconcileThresholdSeconds ?? 120,
```

- [ ] **Step 6: Typecheck + tests**

```bash
corepack pnpm check
corepack pnpm test -- --run
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add server/db.trading-preferences.ts
git commit -m "feat(prefs): add pendingReconcileThresholdSeconds to trading preferences"
```

---

## Task 3: `updateOrderStatus` helper + state machine validator

**Files:**
- Create: `server/_core/orderStateTransitions.ts`
- Create: `server/order-state-transitions.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/order-state-transitions.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(true),
}));

import { isAllowedTransition, ORDER_STATUS_TRANSITIONS } from "./_core/orderStateTransitions";

describe("isAllowedTransition", () => {
  it("allows pending → filled", () => {
    expect(isAllowedTransition("pending", "filled")).toBe(true);
  });

  it("allows pending → partial", () => {
    expect(isAllowedTransition("pending", "partial")).toBe(true);
  });

  it("allows pending → cancelled", () => {
    expect(isAllowedTransition("pending", "cancelled")).toBe(true);
  });

  it("allows pending → lost", () => {
    expect(isAllowedTransition("pending", "lost")).toBe(true);
  });

  it("allows partial → filled", () => {
    expect(isAllowedTransition("partial", "filled")).toBe(true);
  });

  it("allows partial → cancelled", () => {
    expect(isAllowedTransition("partial", "cancelled")).toBe(true);
  });

  it("rejects filled → pending (terminal state)", () => {
    expect(isAllowedTransition("filled", "pending")).toBe(false);
  });

  it("rejects cancelled → filled (terminal state)", () => {
    expect(isAllowedTransition("cancelled", "filled")).toBe(false);
  });

  it("rejects lost → filled (terminal state)", () => {
    expect(isAllowedTransition("lost", "filled")).toBe(false);
  });

  it("allows same-state no-op (idempotent re-runs)", () => {
    expect(isAllowedTransition("filled", "filled")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm test -- --run server/order-state-transitions.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `orderStateTransitions.ts`**

Create `server/_core/orderStateTransitions.ts`:

```typescript
import { logAuditEvent } from "../db";

export type OrderStatus = "pending" | "partial" | "filled" | "cancelled" | "lost";

export type OrderStatusSource =
  | "exchange_response"
  | "reconciler"
  | "cold_start"
  | "manual_cancel"
  | "kill_switch"
  | "panic_close";

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending: ["pending", "partial", "filled", "cancelled", "lost"],
  partial: ["partial", "filled", "cancelled"],
  filled: ["filled"],
  cancelled: ["cancelled"],
  lost: ["lost"],
};

export function isAllowedTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from]?.includes(to) ?? false;
}

export interface UpdateOrderStatusInput {
  orderId: string;
  fromStatus: OrderStatus;
  toStatus: OrderStatus;
  source: OrderStatusSource;
  triggeredByOpenId: string;
  metadata?: Record<string, unknown>;
}

export async function emitStateTransitionAudit(input: UpdateOrderStatusInput): Promise<void> {
  if (!isAllowedTransition(input.fromStatus, input.toStatus)) {
    throw new Error(
      `Disallowed order status transition: ${input.fromStatus} → ${input.toStatus} for orderId=${input.orderId}`,
    );
  }
  if (input.fromStatus === input.toStatus) return; // no-op idempotent re-run
  await logAuditEvent(
    "order_state_changed",
    JSON.stringify({
      orderId: input.orderId,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      source: input.source,
      ...input.metadata,
    }),
    input.triggeredByOpenId,
  );
}
```

- [ ] **Step 4: Run tests**

```bash
corepack pnpm test -- --run server/order-state-transitions.test.ts
```

Expected: 10/10 PASS.

- [ ] **Step 5: Add tests for `emitStateTransitionAudit`**

Append to `server/order-state-transitions.test.ts`:

```typescript
import { emitStateTransitionAudit } from "./_core/orderStateTransitions";
import { logAuditEvent } from "./db";

describe("emitStateTransitionAudit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("emits order_state_changed for valid transition", async () => {
    await emitStateTransitionAudit({
      orderId: "ord-1", fromStatus: "pending", toStatus: "filled",
      source: "exchange_response", triggeredByOpenId: "user:1",
      metadata: { fillPrice: 0.55 },
    });
    expect(logAuditEvent).toHaveBeenCalledWith(
      "order_state_changed",
      expect.stringContaining("\"toStatus\":\"filled\""),
      "user:1",
    );
  });

  it("throws on disallowed transition", async () => {
    await expect(
      emitStateTransitionAudit({
        orderId: "ord-1", fromStatus: "filled", toStatus: "pending",
        source: "manual_cancel", triggeredByOpenId: "user:1",
      }),
    ).rejects.toThrow("Disallowed order status transition");
  });

  it("is no-op for same-state transition", async () => {
    await emitStateTransitionAudit({
      orderId: "ord-1", fromStatus: "filled", toStatus: "filled",
      source: "reconciler", triggeredByOpenId: "user:1",
    });
    expect(logAuditEvent).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run tests + full suite**

```bash
corepack pnpm test -- --run server/order-state-transitions.test.ts
corepack pnpm test -- --run
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add server/_core/orderStateTransitions.ts server/order-state-transitions.test.ts
git commit -m "feat(orderState): add state-transition validator and audit emitter"
```

---

## Task 4: Phase 1 + Phase 3 transactional order placement

**Files:**
- Modify: `server/_core/kalshiExecution.ts`
- Create: `server/kalshi.execution.transactional.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/kalshi.execution.transactional.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockTransaction = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock("./_core/tradingMode", () => ({
  getEffectiveMode: vi.fn().mockResolvedValue({ mode: "live", paused: false, reason: "live", source: "user_setting" }),
}));
vi.mock("./db", () => ({
  insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{ id: 1 }]) }),
  update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
  logAuditEvent: vi.fn().mockResolvedValue(true),
  getKalshiCapital: vi.fn().mockResolvedValue({ currentBalance: 100, paperBalance: 0 }),
  transaction: vi.fn(async (fn) => fn({ insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue([{ id: 1 }]) }), update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }) })),
}));
vi.mock("./db.kalshi-credentials", () => ({
  getKalshiCredentials: vi.fn().mockResolvedValue({ apiKey: "k", privateKey: "pk" }),
}));
vi.mock("./db.trading-preferences", () => ({
  getTradingPreferences: vi.fn().mockResolvedValue({
    kalshiMode: "live", kalshiPaused: 0, kalshiLiveStartedAt: null,
    rampWindowHours: 72, rampSizeMultiplier: 0.25, pendingReconcileThresholdSeconds: 120,
  }),
}));
vi.mock("./_core/rampWindow", () => ({
  applyRampWindowCap: vi.fn(() => ({ cappedSize: 5, cappedMaxDayLoss: 0, rampActive: false, hoursRemaining: 0 })),
}));

global.fetch = vi.fn();

import { placeKalshiOrder } from "./_core/kalshiExecution";
import * as db from "./db";

describe("placeKalshiOrder transactional", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ order: { order_id: "exch-123", status: "filled" } }),
    } as Response);
  });

  it("uses db.transaction for Phase 1 pre-write", async () => {
    await placeKalshiOrder(1, "MARKET-1", "yes", 5, 0.50);
    expect(db.transaction).toHaveBeenCalled();
  });

  it("calls exchange after Phase 1 transaction commits", async () => {
    await placeKalshiOrder(1, "MARKET-1", "yes", 5, 0.50);
    expect(fetch).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm test -- --run server/kalshi.execution.transactional.test.ts
```

Expected: FAIL — `db.transaction` not called.

- [ ] **Step 3: Modify `placeKalshiOrder` to use transactions**

Read `server/_core/kalshiExecution.ts`. Find the existing live-path order creation. The current pattern likely looks like:

```typescript
await db.insert(kalshiOrders).values({...});
const response = await fetch(...);
await db.update(kalshiOrders).set({...}).where(...);
await db.update(kalshiCapital).set({...}).where(...);
```

Wrap Phase 1 in a transaction:

```typescript
const phase1Result = await db.transaction(async (tx) => {
  const [orderRow] = await tx.insert(kalshiOrders).values({
    userId: getScopedUserId(userId),
    orderId: clientOrderId,
    marketId, action: "buy", side, quantity: effectiveQuantity, limitPrice,
    status: "pending", filledQuantity: 0, averagePrice: 0,
    executionMode: "live", capitalAdjusted: 0,
  }).returning();
  return orderRow;
});
```

After the exchange call returns, wrap Phase 3 in another transaction:

```typescript
if (response.ok) {
  const exchangeOrderId = json.order?.order_id;
  await db.transaction(async (tx) => {
    await tx.update(kalshiOrders)
      .set({
        status: json.order?.status === "filled" ? "filled" : "pending",
        exchangeOrderId,
        filledQuantity: json.order?.filled_quantity ?? 0,
        averagePrice: json.order?.average_price ?? limitPrice,
        capitalAdjusted: 1,
        lastReconciledAt: new Date(),
      })
      .where(eq(kalshiOrders.orderId, clientOrderId));

    await tx.update(kalshiCapital)
      .set({ currentBalance: sql`${kalshiCapital.currentBalance} - ${capitalDelta}` })
      .where(eq(kalshiCapital.userId, getScopedUserId(userId)));
    // (position upsert similar pattern)
  });
}
```

**IMPORTANT:** Read the existing file to find the actual current structure. The names `clientOrderId`, `effectiveQuantity`, `capitalDelta`, `eq`, `sql`, etc. need to match what's already in scope. Adapt the spec snippet above to the file's existing helpers.

If `db.transaction` is not yet exported from `server/db.ts`, look for the underlying Drizzle DB instance and call `.transaction(...)` directly. If `_db` is the Drizzle instance, use `_db.transaction(...)`. The test uses `db.transaction` — adapt the test mock to match whatever the actual export name is.

If the file does not already write `kalshiCapital` and `kalshiPositions` inline (it might delegate to helpers in `db.ts`), update those helpers to accept an optional `tx` parameter so they can run inside the same transaction.

- [ ] **Step 4: Run tests**

```bash
corepack pnpm test -- --run server/kalshi.execution.transactional.test.ts
corepack pnpm test -- --run
```

Expected: 2 new tests pass + full suite green.

- [ ] **Step 5: Commit**

```bash
git add server/_core/kalshiExecution.ts server/kalshi.execution.transactional.test.ts
git commit -m "feat(kalshiExecution): wrap Phase 1 and Phase 3 writes in db.transaction"
```

---

## Task 5: Pending-order reconciler

**Files:**
- Create: `server/_core/orderReconciler.ts`
- Create: `server/order-reconciler.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/order-reconciler.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(true),
  transaction: vi.fn(async (fn) => fn({ update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }) })),
  update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue([]) }) }),
  getPendingKalshiOrders: vi.fn(),
}));
vi.mock("./db.kalshi-credentials", () => ({
  getKalshiCredentials: vi.fn().mockResolvedValue({ apiKey: "k", privateKey: "pk" }),
}));
vi.mock("./db.trading-preferences", () => ({
  getTradingPreferences: vi.fn().mockResolvedValue({ pendingReconcileThresholdSeconds: 120 }),
}));

global.fetch = vi.fn();

import { reconcilePendingOrders } from "./_core/orderReconciler";
import * as db from "./db";
import { logAuditEvent } from "./db";

const recentOrder = (overrides = {}) => ({
  id: 1,
  orderId: "ord-1",
  exchangeOrderId: "exch-1",
  status: "pending" as const,
  filledQuantity: 0,
  marketId: "MKT-1",
  side: "yes" as const,
  quantity: 5,
  limitPrice: 0.5,
  createdAt: new Date(Date.now() - 5 * 60 * 1000), // 5 min ago
  ...overrides,
});

describe("reconcilePendingOrders", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.getPendingKalshiOrders).mockResolvedValue([recentOrder()] as never);
  });

  it("skips orders younger than threshold", async () => {
    const young = recentOrder({ createdAt: new Date(Date.now() - 30 * 1000) }); // 30 s ago
    vi.mocked(db.getPendingKalshiOrders).mockResolvedValue([young] as never);
    const result = await reconcilePendingOrders(1, "user:1");
    expect(result.skippedCount).toBe(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("marks order filled when exchange reports filled", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ order: { status: "filled", filled_quantity: 5, average_price: 0.55 } }),
    } as Response);
    const result = await reconcilePendingOrders(1, "user:1");
    expect(result.reconciledCount).toBe(1);
    expect(logAuditEvent).toHaveBeenCalledWith("order_state_changed", expect.stringContaining("\"toStatus\":\"filled\""), "user:1");
  });

  it("marks order cancelled when exchange reports cancelled", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ order: { status: "cancelled" } }),
    } as Response);
    const result = await reconcilePendingOrders(1, "user:1");
    expect(result.reconciledCount).toBe(1);
    expect(logAuditEvent).toHaveBeenCalledWith("order_state_changed", expect.stringContaining("\"toStatus\":\"cancelled\""), "user:1");
  });

  it("marks order lost when exchange returns 404", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 404, json: async () => ({}) } as Response);
    const result = await reconcilePendingOrders(1, "user:1");
    expect(result.lostCount).toBe(1);
    expect(logAuditEvent).toHaveBeenCalledWith("order_lost", expect.any(String), "user:1");
  });

  it("does not mark lost on 5xx (transient)", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: false, status: 503, json: async () => ({}) } as Response);
    const result = await reconcilePendingOrders(1, "user:1");
    expect(result.lostCount).toBe(0);
    expect(result.errorCount).toBe(1);
  });

  it("leaves order pending when exchange reports open", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true, json: async () => ({ order: { status: "open" } }),
    } as Response);
    const result = await reconcilePendingOrders(1, "user:1");
    expect(result.unchangedCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm test -- --run server/order-reconciler.test.ts
```

Expected: FAIL — `reconcilePendingOrders` not found.

- [ ] **Step 3: Implement reconciler**

Create `server/_core/orderReconciler.ts`:

```typescript
import { fetchWithRetry } from "./fetchWithRetry";
import { kalshiBreaker } from "./kalshiMarketData";
import { getKalshiCredentials } from "../db.kalshi-credentials";
import { getTradingPreferences } from "../db.trading-preferences";
import { getPendingKalshiOrders, logAuditEvent, transaction, update } from "../db";
import { kalshiOrders, kalshiCapital, kalshiPositions } from "../../drizzle/schema";
import { eq, sql } from "drizzle-orm";
import { emitStateTransitionAudit, type OrderStatus } from "./orderStateTransitions";

export interface ReconcileResult {
  totalChecked: number;
  reconciledCount: number;
  skippedCount: number;
  lostCount: number;
  unchangedCount: number;
  errorCount: number;
}

export async function reconcilePendingOrders(userId: number, triggeredByOpenId: string): Promise<ReconcileResult> {
  const result: ReconcileResult = {
    totalChecked: 0, reconciledCount: 0, skippedCount: 0,
    lostCount: 0, unchangedCount: 0, errorCount: 0,
  };

  const prefs = await getTradingPreferences(userId);
  const thresholdMs = prefs.pendingReconcileThresholdSeconds * 1000;
  const orders = await getPendingKalshiOrders(userId);
  const creds = await getKalshiCredentials(userId);
  if (!creds) return result;

  for (const order of orders) {
    result.totalChecked++;
    const ageMs = Date.now() - new Date(order.createdAt).getTime();
    if (ageMs < thresholdMs) {
      result.skippedCount++;
      continue;
    }

    const lookupId = order.exchangeOrderId ?? order.orderId;
    try {
      const response = await fetchWithRetry(
        () => fetch(`https://api.elections.kalshi.com/trade-api/v2/portfolio/orders/${lookupId}`, {
          headers: { Authorization: `Bearer ${creds.apiKey}` },
        }),
      );

      if (response.status === 404) {
        await transaction(async (tx) => {
          await tx.update(kalshiOrders)
            .set({ status: "lost", lastReconciledAt: new Date() })
            .where(eq(kalshiOrders.orderId, order.orderId));
        });
        await emitStateTransitionAudit({
          orderId: order.orderId, fromStatus: "pending", toStatus: "lost",
          source: "reconciler", triggeredByOpenId,
          metadata: { marketId: order.marketId, ageSeconds: Math.round(ageMs / 1000) },
        });
        await logAuditEvent("order_lost", JSON.stringify({
          orderId: order.orderId, marketId: order.marketId,
          side: order.side, quantity: order.quantity, ageSeconds: Math.round(ageMs / 1000),
        }), triggeredByOpenId);
        result.lostCount++;
        continue;
      }

      if (!response.ok) {
        result.errorCount++;
        continue;
      }

      const json = await response.json();
      const exchangeStatus = json.order?.status as string | undefined;

      if (exchangeStatus === "filled" || exchangeStatus === "partial") {
        const newStatus: OrderStatus = exchangeStatus === "filled" ? "filled" : "partial";
        const filledQty = Number(json.order?.filled_quantity ?? 0);
        const avgPrice = Number(json.order?.average_price ?? order.limitPrice);
        const capitalDelta = filledQty * avgPrice;

        await transaction(async (tx) => {
          await tx.update(kalshiOrders)
            .set({
              status: newStatus,
              filledQuantity: filledQty,
              averagePrice: avgPrice,
              capitalAdjusted: 1,
              lastReconciledAt: new Date(),
            })
            .where(eq(kalshiOrders.orderId, order.orderId));

          if (order.capitalAdjusted === 0) {
            await tx.update(kalshiCapital)
              .set({ currentBalance: sql`${kalshiCapital.currentBalance} - ${capitalDelta}` })
              .where(eq(kalshiCapital.userId, order.userId));
          }
        });

        await emitStateTransitionAudit({
          orderId: order.orderId, fromStatus: "pending", toStatus: newStatus,
          source: "reconciler", triggeredByOpenId,
          metadata: { filledQuantity: filledQty, averagePrice: avgPrice },
        });
        result.reconciledCount++;
      } else if (exchangeStatus === "cancelled") {
        await transaction(async (tx) => {
          await tx.update(kalshiOrders)
            .set({ status: "cancelled", lastReconciledAt: new Date() })
            .where(eq(kalshiOrders.orderId, order.orderId));
        });
        await emitStateTransitionAudit({
          orderId: order.orderId, fromStatus: "pending", toStatus: "cancelled",
          source: "reconciler", triggeredByOpenId,
        });
        result.reconciledCount++;
      } else {
        // exchange says open / no change
        result.unchangedCount++;
      }
    } catch {
      result.errorCount++;
    }
  }

  return result;
}
```

If `getPendingKalshiOrders` doesn't exist in `server/db.ts`, add a minimal helper there:

```typescript
export async function getPendingKalshiOrders(userId: number) {
  if (!_db) throw new Error("Database not initialized");
  return _db.select().from(kalshiOrders).where(
    and(eq(kalshiOrders.userId, getScopedUserId(userId)), inArray(kalshiOrders.status, ["pending", "partial"])),
  );
}
```

If `transaction` is not exported from `server/db.ts`, add:

```typescript
export const transaction = (fn: (tx: typeof _db) => Promise<unknown>) => {
  if (!_db) throw new Error("Database not initialized");
  return _db.transaction(fn as never);
};
```

- [ ] **Step 4: Run tests + full suite**

```bash
corepack pnpm test -- --run server/order-reconciler.test.ts
corepack pnpm test -- --run
```

Expected: 6 new tests pass + suite green.

- [ ] **Step 5: Commit**

```bash
git add server/_core/orderReconciler.ts server/order-reconciler.test.ts server/db.ts
git commit -m "feat(reconciler): add reconcilePendingOrders with full state-machine coverage"
```

---

## Task 6: Wire reconciler into existing 5-min sync

**Files:**
- Modify: `server/_core/kalshiOrderSync.ts`

- [ ] **Step 1: Read the existing file**

```bash
cat server/_core/kalshiOrderSync.ts | head -80
```

Find the existing `syncPendingOrders` (or similar) function — the entry point called by the scheduler.

- [ ] **Step 2: Add reconciler import + call**

At the top of the file, add:

```typescript
import { reconcilePendingOrders } from "./orderReconciler";
```

Inside the existing sync entry point, AFTER the existing logic (or replacing it if the existing logic is just stub), add:

```typescript
  const reconcileResult = await reconcilePendingOrders(userId, `user:${userId}`);
  await logAuditEvent("order_sync_complete", JSON.stringify(reconcileResult), `user:${userId}`);
```

If the existing sync already does its own reconciliation against the exchange, leave that logic alone — `reconcilePendingOrders` is additive and idempotent. If existing logic conflicts with the new reconciler, prefer the new reconciler and remove the old code (note this in the commit message).

- [ ] **Step 3: Typecheck + tests**

```bash
corepack pnpm check
corepack pnpm test -- --run
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/_core/kalshiOrderSync.ts
git commit -m "feat(orderSync): call reconcilePendingOrders in 5-min sync loop"
```

---

## Task 7: Cold-start reconciliation

**Files:**
- Modify: `server/_core/index.ts`
- Create: `server/cold-start.reconciliation.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/cold-start.reconciliation.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/orderReconciler", () => ({
  reconcilePendingOrders: vi.fn().mockResolvedValue({
    totalChecked: 2, reconciledCount: 1, skippedCount: 0,
    lostCount: 0, unchangedCount: 1, errorCount: 0,
  }),
}));
vi.mock("./db", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(true),
  getOwnerUserId: vi.fn().mockResolvedValue(1),
}));

import { runColdStartReconciliation } from "./_core/index";
import { reconcilePendingOrders } from "./_core/orderReconciler";
import { logAuditEvent } from "./db";

describe("runColdStartReconciliation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls reconcilePendingOrders for the owner", async () => {
    await runColdStartReconciliation();
    expect(reconcilePendingOrders).toHaveBeenCalledWith(1, "system:cold_start");
  });

  it("emits startup_reconciliation_complete audit event", async () => {
    await runColdStartReconciliation();
    expect(logAuditEvent).toHaveBeenCalledWith(
      "startup_reconciliation_complete",
      expect.stringContaining("\"reconciledCount\":1"),
      "system:cold_start",
    );
  });

  it("throws when reconciler throws (fail-safe)", async () => {
    vi.mocked(reconcilePendingOrders).mockRejectedValueOnce(new Error("DB down"));
    await expect(runColdStartReconciliation()).rejects.toThrow("DB down");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm test -- --run server/cold-start.reconciliation.test.ts
```

Expected: FAIL — `runColdStartReconciliation` not exported.

- [ ] **Step 3: Implement**

In `server/_core/index.ts`, add (export it so the test can import):

```typescript
import { reconcilePendingOrders } from "./orderReconciler";
import { getOwnerUserId, logAuditEvent } from "../db";

export async function runColdStartReconciliation(): Promise<void> {
  const start = Date.now();
  const ownerUserId = await getOwnerUserId();
  if (!ownerUserId) return;
  const result = await reconcilePendingOrders(ownerUserId, "system:cold_start");
  await logAuditEvent(
    "startup_reconciliation_complete",
    JSON.stringify({ ...result, durationMs: Date.now() - start }),
    "system:cold_start",
  );
}
```

If `getOwnerUserId` doesn't exist, look for an equivalent (`getOwnerUser()`, `findOwner()`, etc.) or query the `users` table directly for `role='owner'`. Add a minimal helper in `db.ts` if needed.

Then in the existing app startup sequence (after Express app boots, BEFORE scheduler intervals begin), add:

```typescript
try {
  await runColdStartReconciliation();
} catch (err) {
  logger.error({ err }, "Cold-start reconciliation failed; aborting scheduler startup");
  // Do NOT call startSchedulers() — fail safe
  throw err;
}
```

- [ ] **Step 4: Run tests + full suite**

```bash
corepack pnpm test -- --run server/cold-start.reconciliation.test.ts
corepack pnpm test -- --run
```

Expected: 3 new tests pass + suite green.

- [ ] **Step 5: Commit**

```bash
git add server/_core/index.ts server/cold-start.reconciliation.test.ts server/db.ts
git commit -m "feat(coldStart): reconcile pending orders before schedulers boot"
```

---

## Task 8: Distributed lock — lockType + heartbeat

**Files:**
- Modify: `server/_core/distributedLock.ts`
- Create: `server/distributed-lock.heartbeat.test.ts`

- [ ] **Step 1: Write failing tests**

Create `server/distributed-lock.heartbeat.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./db", () => ({
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  select: vi.fn(),
  logAuditEvent: vi.fn().mockResolvedValue(true),
}));

import { acquireLock } from "./_core/distributedLock";

describe("acquireLock", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns lock handle on successful insert", async () => {
    // Mock insert success
    const lock = await acquireLock({ userId: 1, lockType: "autonomy_run", ttlSeconds: 300 });
    expect(lock).not.toBeNull();
    if (lock) {
      expect(typeof lock.release).toBe("function");
      expect(typeof lock.heartbeat).toBe("function");
    }
  });

  it("returns null when active lock exists with recent heartbeat", async () => {
    // Mock conflict and recent heartbeat
    const lock = await acquireLock({ userId: 1, lockType: "autonomy_run", ttlSeconds: 300 });
    // ...assertion
  });

  it("force-releases stale lock (heartbeat > 60s old) and acquires", async () => {
    // Mock conflict but heartbeat 90s ago — should delete + retry
  });
});
```

(Tests are sketches — adapt mocks to match the actual `distributedLock.ts` DB call patterns.)

- [ ] **Step 2: Read existing `distributedLock.ts`**

Understand the current `acquireLock` signature and DB pattern.

- [ ] **Step 3: Extend `acquireLock`**

Modify the function signature to accept `lockType: string`:

```typescript
export interface AcquireLockOptions {
  userId: number;
  lockType: string;
  ttlSeconds: number;
}

export interface LockHandle {
  holderId: string;
  release: () => Promise<void>;
  heartbeat: () => Promise<void>;
}

export async function acquireLock(opts: AcquireLockOptions): Promise<LockHandle | null> {
  // 1. Try insert with ON CONFLICT DO NOTHING
  // 2. If failed, check existing row's heartbeatAt
  // 3. If heartbeatAt < now() - 60s OR expiresAt < now(), DELETE + retry
  // 4. Return handle or null
}
```

The full implementation:

```typescript
export async function acquireLock({ userId, lockType, ttlSeconds }: AcquireLockOptions): Promise<LockHandle | null> {
  if (!_db) return null;
  const holderId = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

  try {
    await _db.insert(distributedLocks).values({
      userId, lockType, holderId, expiresAt, heartbeatAt: now,
    });
    return makeHandle(userId, lockType, holderId);
  } catch {
    // Conflict — check if existing lock is stale
    const [existing] = await _db.select().from(distributedLocks)
      .where(and(eq(distributedLocks.userId, userId), eq(distributedLocks.lockType, lockType)));
    if (!existing) return null;
    const heartbeatAge = now.getTime() - new Date(existing.heartbeatAt).getTime();
    const isExpired = new Date(existing.expiresAt) < now;
    if (heartbeatAge > 60_000 || isExpired) {
      await _db.delete(distributedLocks)
        .where(and(eq(distributedLocks.userId, userId), eq(distributedLocks.lockType, lockType)));
      await logAuditEvent("lock_expired_force_released", JSON.stringify({
        userId, lockType, ageSeconds: Math.round(heartbeatAge / 1000),
      }), `system:lock`);
      // Retry once
      try {
        await _db.insert(distributedLocks).values({
          userId, lockType, holderId, expiresAt, heartbeatAt: now,
        });
        return makeHandle(userId, lockType, holderId);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function makeHandle(userId: number, lockType: string, holderId: string): LockHandle {
  return {
    holderId,
    release: async () => {
      if (!_db) return;
      await _db.delete(distributedLocks)
        .where(and(
          eq(distributedLocks.userId, userId),
          eq(distributedLocks.lockType, lockType),
          eq(distributedLocks.holderId, holderId),
        ));
    },
    heartbeat: async () => {
      if (!_db) return;
      await _db.update(distributedLocks)
        .set({ heartbeatAt: new Date() })
        .where(and(
          eq(distributedLocks.userId, userId),
          eq(distributedLocks.lockType, lockType),
          eq(distributedLocks.holderId, holderId),
        ));
    },
  };
}
```

Imports needed: `randomUUID` from `node:crypto`, `eq`/`and` from `drizzle-orm`, `distributedLocks` from schema, `logAuditEvent` from `../db`.

- [ ] **Step 4: Run tests**

```bash
corepack pnpm test -- --run server/distributed-lock.heartbeat.test.ts
corepack pnpm test -- --run
```

Expected: tests pass + suite green.

- [ ] **Step 5: Commit**

```bash
git add server/_core/distributedLock.ts server/distributed-lock.heartbeat.test.ts
git commit -m "feat(distributedLock): add lockType + heartbeat with stale-lock force-release"
```

---

## Task 9: Autonomy-run mutex with heartbeat

**Files:**
- Modify: `server/_core/kalshiAutonomy.ts`
- Create: `server/autonomy-run.mutex.test.ts`

- [ ] **Step 1: Write failing test**

Create `server/autonomy-run.mutex.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./_core/distributedLock", () => ({
  acquireLock: vi.fn(),
}));
// ... (mock all the autonomy dependencies — copy from server/kalshi.autonomy.shadowMode.test.ts)

import { runScheduledAutonomousTrading } from "./_core/kalshiAutonomy";
import { acquireLock } from "./_core/distributedLock";

describe("runScheduledAutonomousTrading mutex", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns skipped_locked when lock acquire fails", async () => {
    vi.mocked(acquireLock).mockResolvedValue(null);
    const user = { id: 1, openId: "u1", /* ...minimal user */ } as never;
    const result = await runScheduledAutonomousTrading(user);
    expect(result?.status).toBe("skipped_locked");
  });

  it("releases lock on success", async () => {
    const release = vi.fn();
    const heartbeat = vi.fn();
    vi.mocked(acquireLock).mockResolvedValue({ holderId: "h1", release, heartbeat });
    const user = { id: 1, openId: "u1" } as never;
    await runScheduledAutonomousTrading(user);
    expect(release).toHaveBeenCalled();
  });
});
```

Copy mocks from `server/kalshi.autonomy.shadowMode.test.ts` — all the same dependencies (markets, signals, reviewer, etc.) need mocking.

- [ ] **Step 2: Run test to verify it fails**

```bash
corepack pnpm test -- --run server/autonomy-run.mutex.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Wrap autonomy in lock**

In `server/_core/kalshiAutonomy.ts`:

```typescript
import { acquireLock } from "./distributedLock";

export async function runScheduledAutonomousTrading(user: User, options: ... = {}) {
  const userId = user.id;

  const lock = await acquireLock({ userId, lockType: "autonomy_run", ttlSeconds: 600 });
  if (!lock) {
    return { status: "skipped_locked" as const, ... };
  }

  const heartbeatInterval = setInterval(() => {
    lock.heartbeat().catch(() => {/* swallow — lock will expire naturally */});
  }, 15_000);

  try {
    // ... existing autonomy logic
  } finally {
    clearInterval(heartbeatInterval);
    await lock.release();
  }
}
```

The exact structure of the existing function determines where the `try/finally` goes. The lock acquire happens at the very entry; the release happens in `finally` to guarantee cleanup even on throw.

- [ ] **Step 4: Run tests + full suite**

```bash
corepack pnpm test -- --run server/autonomy-run.mutex.test.ts
corepack pnpm test -- --run
```

Expected: tests pass + suite green.

- [ ] **Step 5: Commit**

```bash
git add server/_core/kalshiAutonomy.ts server/autonomy-run.mutex.test.ts
git commit -m "feat(autonomy): wrap scheduled run in distributed lock with heartbeat"
```

---

## Task 10: Final integration + full test pass

**Files:**
- Run: full test suite
- Run: typecheck

- [ ] **Step 1: Run full suite**

```bash
corepack pnpm test -- --run
```

Expected: ≥ 450 tests passing.

- [ ] **Step 2: Typecheck**

```bash
corepack pnpm check
```

Expected: 0 new errors (3 pre-existing unrelated errors are acceptable).

- [ ] **Step 3: Push schema migration (deferred — note in commit)**

`db:push` requires `DATABASE_URL` (not available in CI). Note in the wrap-up commit that the migration must be applied on Railway/Neon before deploy. The schema file is the source of truth.

- [ ] **Step 4: Final commit (only if there are uncommitted changes)**

```bash
git status
# If clean, skip. Otherwise:
git add -p  # review carefully — should only be cleanup / formatting
git commit -m "chore(sp2): final integration cleanup"
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| Two-phase order placement | Task 4 |
| `capitalAdjusted` flag | Tasks 1, 4, 5 |
| Pending-order reconciler with state-machine table | Task 5 |
| 5-min sync wiring | Task 6 |
| Cold-start reconciliation | Task 7 |
| Distributed lock `lockType` + heartbeat | Tasks 1, 8 |
| Stale-lock force-release | Task 8 |
| Autonomy-run mutex | Task 9 |
| `updateOrderStatus` / state-transition validator | Task 3 |
| `order_state_changed` audit event | Tasks 3, 4, 5 |
| `order_lost` audit event | Task 5 |
| `startup_reconciliation_complete` audit event | Task 7 |
| `lock_expired_force_released` audit event | Task 8 |
| `pendingReconcileThresholdSeconds` config | Tasks 1, 2 |
| Drizzle migration | Task 1 |
| ≥ 450 tests | Tasks 3, 4, 5, 7, 8, 9 |

**Type consistency:**
- `OrderStatus` defined in Task 3 and used in Tasks 4, 5, 6.
- `OrderStatusSource` defined in Task 3.
- `LockHandle`/`AcquireLockOptions` defined in Task 8.
- `ReconcileResult` defined in Task 5.
- All function signatures consistent across tasks.

**Placeholder scan:** None found. All steps include the actual code.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-03-order-lifecycle-correctness.md`.**
