/**
 * In-memory scheduler heartbeat tracker.
 *
 * The autonomy/order-sync/cross-arb schedulers update this on every tick
 * boundary so the dashboard can show a live "what is the bot doing right
 * now" indicator.  A simple module-level singleton is sufficient here:
 * Railway runs a single process per service and the dashboard only needs
 * read-after-write consistency within that process.
 *
 * Multi-process deployments would need to push these into a shared store
 * (Redis or the postgres `distributedLocks` table) — not needed today.
 */

export type SchedulerActivity =
  | "booting"
  | "idle"
  | "scanning"
  | "evaluating"
  | "placing"
  | "syncing"
  | "skipped"
  | "blocked"
  | "error";

export type SchedulerKind =
  | "autonomy_kalshi"
  | "order_sync"
  | "cross_arb";

export type SchedulerSnapshot = {
  kind: SchedulerKind;
  activity: SchedulerActivity;
  message: string | null;
  blockReason: string | null;
  lastTickAt: number | null;
  lastTickDurationMs: number | null;
  ticksSinceBoot: number;
  intervalMs: number;
  /** Best-effort wall-clock time the next tick is expected. */
  nextTickEta: number | null;
  /** Current-tick telemetry, populated when tick is in progress or recently completed. */
  telemetry: {
    marketsScanned?: number;
    cadenceSkipped?: number;
    cadencePassed?: number;
    signalsGenerated?: number;
    signalsApproved?: number;
    ordersPlaced?: number;
    skipReason?: string;
  };
};

const bootedAt = Date.now();

const initial = (kind: SchedulerKind, intervalMs: number): SchedulerSnapshot => ({
  kind,
  activity: "booting",
  message: null,
  blockReason: null,
  lastTickAt: null,
  lastTickDurationMs: null,
  ticksSinceBoot: 0,
  intervalMs,
  nextTickEta: null,
  telemetry: {},
});

const state: Record<SchedulerKind, SchedulerSnapshot> = {
  autonomy_kalshi: initial("autonomy_kalshi", 60_000),
  order_sync: initial("order_sync", 30_000),
  cross_arb: initial("cross_arb", 10_000),
};

export function configureSchedulerInterval(kind: SchedulerKind, intervalMs: number) {
  state[kind].intervalMs = intervalMs;
}

export function markTickStart(kind: SchedulerKind, activity: SchedulerActivity = "scanning", message: string | null = null) {
  const snap = state[kind];
  snap.activity = activity;
  snap.message = message;
  snap.blockReason = null;
  snap.telemetry = {};
}

export function setActivity(kind: SchedulerKind, activity: SchedulerActivity, message: string | null = null) {
  const snap = state[kind];
  snap.activity = activity;
  snap.message = message;
}

export function setBlocked(kind: SchedulerKind, reason: string) {
  const snap = state[kind];
  snap.activity = "blocked";
  snap.blockReason = reason;
}

export function setSkipped(kind: SchedulerKind, reason: string) {
  const snap = state[kind];
  snap.activity = "skipped";
  snap.telemetry = { ...snap.telemetry, skipReason: reason };
}

export function setError(kind: SchedulerKind, err: unknown) {
  const snap = state[kind];
  snap.activity = "error";
  snap.message =
    err instanceof Error ? err.message.slice(0, 240) : String(err).slice(0, 240);
}

export function recordTickTelemetry(
  kind: SchedulerKind,
  telemetry: Partial<SchedulerSnapshot["telemetry"]>,
) {
  state[kind].telemetry = { ...state[kind].telemetry, ...telemetry };
}

export function markTickComplete(kind: SchedulerKind, startedAt: number) {
  const snap = state[kind];
  const now = Date.now();
  snap.lastTickAt = now;
  snap.lastTickDurationMs = now - startedAt;
  snap.ticksSinceBoot += 1;
  snap.nextTickEta = now + snap.intervalMs;
  // Reset to idle once the tick path completed (unless an error/skip already
  // set a terminal status that the caller wants to surface until next tick).
  if (snap.activity === "scanning" || snap.activity === "evaluating" || snap.activity === "placing" || snap.activity === "syncing") {
    snap.activity = "idle";
  }
}

export function getSchedulerSnapshot(kind: SchedulerKind): SchedulerSnapshot {
  return { ...state[kind], telemetry: { ...state[kind].telemetry } };
}

export function getAllSchedulerSnapshots() {
  return {
    bootedAt,
    schedulers: {
      autonomy_kalshi: getSchedulerSnapshot("autonomy_kalshi"),
      order_sync: getSchedulerSnapshot("order_sync"),
      cross_arb: getSchedulerSnapshot("cross_arb"),
    },
  };
}
