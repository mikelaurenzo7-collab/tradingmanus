# SP-2 · Order Lifecycle Correctness — Design Spec

**Date:** 2026-05-03
**Status:** Approved
**Scope:** Kalshi (Polymarket parity deferred to SP-5)
**Depends on:** SP-1 Pre-Flight Safety Net
**Followed by:** SP-3 Observability & Alerting, SP-4 Security Hardening, SP-5 Polymarket Parity

---

## Problem

SP-1 added the safety floor (modes, kill-switch, drawdown). When the bot DOES place a real order, the current pipeline is best-effort:

- Order, position, and capital writes happen as three separate `UPDATE`s — a crash between any two leaves the books inconsistent.
- An order can stick in `status='pending'` indefinitely if the exchange-response parsing throws or the network drops the response after the exchange persists it.
- Server restarts (every Railway deploy) reset in-memory state; pending orders from before the restart are not reconciled against exchange truth.
- Two concurrent autonomy runs (Railway scheduler firing before previous run finishes) can both pass risk checks against stale capital state.
- The Postgres distributed lock has no liveness signal; a crashed holder blocks all subsequent runs until manual cleanup.

This spec brings the order lifecycle to: atomic writes, automatic recovery, cold-start reconciliation, concurrency-safe autonomy, and full state-transition auditability.

---

## Goals

1. **Atomic order/position/capital writes** — single Postgres transaction per state change.
2. **Pending-order reconciliation** — orders pending >2 min auto-reconcile against the exchange.
3. **Cold-start reconciliation** — on server startup, reconcile every pending order before schedulers run.
4. **Autonomy-run mutex** — at most one autonomy run per user in flight at a time, enforced via DB lock with TTL.
5. **Lock heartbeat** — long-running operations update a heartbeat; stale locks (>60 s no heartbeat) are auto-expired.
6. **State-transition audit** — every `kalshiOrders.status` change emits an `order_state_changed` event with `from`, `to`, and `source`.

---

## Non-Goals

- Polymarket order lifecycle (deferred to SP-5)
- Webhook-based exchange notifications (Kalshi REST polling is sufficient for current volume)
- Multi-user concurrency (single-owner platform; mutex is per-user)
- Order modification / replacement (current scope is buy/sell only; modify is rare and not currently emitted)
- Full event-sourcing rebuild from audit log (we keep the current relational model; audit log is observational only)

---

## Architecture

### Two-phase order placement

The exchange POST cannot be inside a transaction — a transaction rollback cannot un-place an exchange-side fill. Pattern:

```
Phase 1 (transaction): pre-write order row { status: 'pending', executionMode }
                        → COMMIT
Phase 2 (HTTP):         POST /portfolio/orders → response (or timeout / error)
Phase 3 (transaction): based on response, update order + position + capital atomically
                        → COMMIT
```

If Phase 2 times out or returns 5xx, Phase 3 does not run. The reconciler (next section) finds the orphan and resolves it.

If Phase 3 begins but crashes mid-way, the order's `status` will not match what's in `kalshiPositions` and `kalshiCapital`. The reconciler detects this by querying the exchange for the order's true state and re-running Phase 3 idempotently.

### Idempotent Phase 3

Phase 3 is keyed by `orderId` and `exchange_order_id`. Re-running it must produce the same final state. Implementation:
- `kalshiOrders.status` transition is gated by `WHERE status = 'pending'` (or `'partial'`) — repeated UPDATE on a `'filled'` row is a no-op.
- `kalshiPositions` upsert uses `(userId, marketId, side, executionMode)` composite key.
- `kalshiCapital` decrement is keyed by the order's `orderId`; a new column `kalshiOrders.capitalAdjusted boolean DEFAULT false` records whether the capital decrement has been applied. Reconciler checks this flag before re-applying.

### Pending-order reconciler

`reconcilePendingOrders(userId)` is called:
- Every 5 min by the existing `kalshiOrderSync` scheduler
- At cold start (server boot)
- Manually via tRPC procedure

For each `status='pending'` order >2 min old:

```
GET /portfolio/orders/{exchangeOrderId}
  ↓
  filled / partial → run Phase 3 update (idempotent)
  cancelled       → UPDATE status = 'cancelled'
  open            → no action (still working at exchange)
  404             → UPDATE status = 'lost'; emit order_lost audit event
  5xx / network   → log + retry next tick (exponential backoff via existing fetchWithRetry)
```

The 2-minute threshold avoids racing with normal fast fills. A `pendingThresholdSeconds` config field in `tradingPreferences` allows operator tuning.

### Cold-start reconciliation

In `server/_core/index.ts`, before `startSchedulers()`:

```
await reconcilePendingOrders(ownerUserId);
logAuditEvent('startup_reconciliation_complete', { reconciledCount });
```

Schedulers wait until reconciliation finishes. If reconciliation throws, schedulers do NOT start (fail-safe — better to be down than to operate on inconsistent state). The error is logged and alerted.

### Autonomy-run mutex

Extend existing `distributedLocks` table:
- Add `lockType` column: `'autonomy_run' | 'order_sync' | 'reconciliation'`
- Add `heartbeatAt timestamp` column
- Add composite unique index `(userId, lockType)`

`acquireLock({ userId, lockType, ttlSeconds })`:
1. `INSERT ... ON CONFLICT DO NOTHING` with `expiresAt = now() + ttl`, `heartbeatAt = now()`
2. If insert succeeds → returns `{ holderId, release(), heartbeat() }`
3. If insert fails → check existing row: if `heartbeatAt < now() - 60s` OR `expiresAt < now()`, DELETE and retry once
4. If still failing → return `null` (caller treats as `skipped_locked`)

`runScheduledAutonomousTrading` calls `acquireLock({ lockType: 'autonomy_run' })` at entry. If null, returns `{ status: 'skipped_locked' }` immediately.

Any operation holding a lock heartbeats every 15 s via `setInterval`, regardless of expected duration — this avoids race conditions where a "fast" operation occasionally takes longer than the TTL. On exit (success or error), `release()` clears the heartbeat interval and deletes the lock row. `try/finally` guarantees release even on throw.

### State-transition audit

Every UPDATE to `kalshiOrders.status` is wrapped in a helper:

```typescript
updateOrderStatus({
  orderId, fromStatus, toStatus, source,
  // optional: filledQuantity, averagePrice, capitalDelta
})
```

The helper:
1. Runs the UPDATE in the current transaction (if any)
2. Emits `logAuditEvent('order_state_changed', { orderId, fromStatus, toStatus, source, ...metadata }, ...)` after successful UPDATE
3. Returns the updated row

`source` enum: `'exchange_response' | 'reconciler' | 'cold_start' | 'manual_cancel' | 'kill_switch' | 'panic_close'`.

This makes the entire lifecycle of any order replayable from the audit log:
```
order_state_changed: created → pending (exchange_response)
order_state_changed: pending → partial (reconciler)
order_state_changed: partial → filled (exchange_response)
```

---

## Data Model

### `kalshiOrders` — new columns

```sql
capitalAdjusted     boolean  NOT NULL DEFAULT false
lastReconciledAt    timestamptz
exchangeOrderId     text                            -- nullable; set after exchange POST succeeds
```

This spec separates the client order ID (our generated UUID) from the exchange's issued ID. If the current schema conflates them in `orderId`, the migration introduces `exchangeOrderId` as a new nullable column populated from the exchange response. The reconciler uses `exchangeOrderId` for lookups; if it is null (Phase 2 never returned), the reconciler queries by client `orderId` via Kalshi's `client_order_id` query parameter.

### `distributedLocks` — extended

```sql
lockType        text                                 NOT NULL  -- new
heartbeatAt     timestamptz                          NOT NULL DEFAULT now()  -- new
```

Add unique index `(userId, lockType)`.

### `tradingPreferences` — new column

```sql
pendingReconcileThresholdSeconds  integer  NOT NULL DEFAULT 120
```

Operator-tunable. Range clamp [30, 3600].

---

## Reconciler State Machine

```
Order in DB                Exchange query result        Action
-----------                ----------------------       ------
status=pending             order.status='filled'        → UPDATE status='filled' + capital + position (Phase 3)
status=pending             order.status='partial'       → UPDATE status='partial' + capital + position (partial fill amount)
status=pending             order.status='cancelled'     → UPDATE status='cancelled' (no capital change)
status=pending             order.status='open'          → no-op (still working)
status=pending             404 / not found              → UPDATE status='lost' + audit event
status=partial             order.status='filled'        → UPDATE status='filled' + delta capital + delta position
status=partial             order.status='partial'       → no-op if quantity unchanged
status=partial             order.status='cancelled'     → UPDATE status='cancelled' (kept partial position; remaining qty cancelled)
status=filled              any                          → no-op (terminal state)
status=cancelled           any                          → no-op (terminal state)
status=lost                any                          → no-op (terminal state; ops review only)
```

The transitions above are the **only** allowed transitions. Any other transition (e.g. `filled → pending`) is a programming error and throws.

---

## Audit Events

| Event | When | Payload |
|---|---|---|
| `order_state_changed` | every status UPDATE | `{ orderId, fromStatus, toStatus, source }` + status-specific metadata |
| `order_lost` | reconciler finds 404 | `{ orderId, marketId, side, quantity, limitPrice, ageSeconds }` |
| `startup_reconciliation_complete` | after cold-start reconciler | `{ reconciledCount, lostCount, durationMs }` |
| `autonomy_run_skipped_locked` | mutex acquire fails | `{ userId, existingLockHolderId, existingLockAge }` |
| `lock_expired_force_released` | acquire detects stale lock | `{ userId, lockType, ageSeconds }` |
| `phase_3_retry` | reconciler re-runs idempotent Phase 3 | `{ orderId, attemptCount }` |

---

## Error Handling

- **Exchange 5xx during Phase 2** → order stays `pending`; reconciler picks it up after threshold.
- **Network timeout during Phase 2** → same as 5xx (order stays `pending`).
- **DB error in Phase 1** → caller receives error; order never created (clean fail).
- **DB error in Phase 3** → order stuck mid-state; reconciler detects via `capitalAdjusted=false` AND `status='filled'` mismatch on next tick.
- **Reconciler 404** → `status='lost'` + alert; manual operator review (rare).
- **Mutex acquire fails** → autonomy run returns `skipped_locked` (audit + counter); next scheduled run tries again.
- **Heartbeat fails (DB unreachable)** → log warning; do NOT abort the in-flight operation. Lock will expire naturally; next run picks up.

All errors emit alerts via existing `sendAlert` shape (full webhook wiring is SP-3).

---

## Testing Plan

~25 new tests across:

**`server/order-lifecycle.transactional.test.ts`** — Phase 3 atomicity:
- Mid-transaction crash leaves DB consistent (no partial position write without capital adjustment)
- Idempotent re-run produces same state
- `capitalAdjusted` flag prevents double-decrement

**`server/order-reconciler.test.ts`** — pending-order reconciler:
- Each row of the state machine table above (10+ cases)
- Threshold honored (orders <2 min old skipped)
- 5xx exchange response retried, not marked lost
- 404 marks lost + emits audit

**`server/cold-start.reconciliation.test.ts`** — startup integration:
- Reconciler runs before schedulers
- Schedulers blocked if reconciler throws
- Audit event emitted with counts

**`server/distributed-lock.heartbeat.test.ts`** — lock liveness:
- Stale lock (heartbeatAt > 60s) is force-released on next acquire
- Active lock (recent heartbeat) blocks acquire
- Heartbeat failure logged but doesn't abort operation
- Release deletes the lock row

**`server/autonomy-run.mutex.test.ts`** — autonomy concurrency:
- Concurrent `runScheduledAutonomousTrading` → second returns `skipped_locked`
- Heartbeat keeps lock alive during long run
- Crashed run leaves lock; next run force-releases after 60s

**`server/order-state-transitions.test.ts`** — audit events:
- Every UPDATE through `updateOrderStatus` emits `order_state_changed`
- Disallowed transitions throw (e.g. `filled → pending`)
- `source` field correctly attributed

Baseline: 425 tests. Target after SP-2: ≥ 450 tests passing.

---

## Migration

One Drizzle migration:
- Add 3 columns to `kalshiOrders`
- Add 2 columns to `distributedLocks` + composite unique index
- Add 1 column to `tradingPreferences`

All new columns have safe defaults; no backfill required. Existing pending orders will be picked up by the reconciler on first cold-start after deploy.

---

## Definition of Done

- [ ] All `placeKalshiOrder` writes use `db.transaction(...)` for Phase 1 and Phase 3
- [ ] `reconcilePendingOrders` implemented with full state-machine table coverage
- [ ] Cold-start reconciliation wired into `_core/index.ts` before schedulers
- [ ] `acquireLock`/`heartbeat`/`release` extended with `lockType` and heartbeat liveness
- [ ] `runScheduledAutonomousTrading` wrapped in autonomy_run lock + heartbeat
- [ ] All `kalshiOrders.status` UPDATEs go through `updateOrderStatus` helper
- [ ] All new audit events emitted at correct call sites
- [ ] Drizzle migration written
- [ ] ≥ 450 tests passing, typecheck clean
- [ ] Committed and pushed
