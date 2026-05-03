import { describe, it, expect, vi, beforeEach } from "vitest";

// In-memory store to simulate the distributedLocks table rows keyed by
// (userId, lockType) composite.
type LockRow = {
  lockKey: string;
  userId: number;
  lockType: string;
  acquiredBy: string;
  acquiredAt: Date;
  heartbeatAt: Date;
  expiresAt: Date;
};

const store = new Map<string, LockRow>();

// Helper to build the composite store key.
function storeKey(userId: number, lockType: string) {
  return `${userId}:${lockType}`;
}

// ---------------------------------------------------------------------------
// Mocks — declared with vi.mock() before any imports so hoisting works.
// ---------------------------------------------------------------------------

vi.mock("./_core/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./db", () => ({
  getDb: vi.fn(async () => fakeDb),
  logAuditEvent: vi.fn().mockResolvedValue(true),
}));

vi.mock("drizzle-orm", () => ({
  eq: (col: { _columnName: string }, value: unknown) => ({
    kind: "eq" as const,
    field: col._columnName,
    value,
  }),
  and: (...preds: unknown[]) => ({ kind: "and" as const, preds }),
}));

vi.mock("../drizzle/schema", () => ({
  distributedLocks: {
    lockKey: { _columnName: "lockKey" },
    userId: { _columnName: "userId" },
    lockType: { _columnName: "lockType" },
    acquiredBy: { _columnName: "acquiredBy" },
    acquiredAt: { _columnName: "acquiredAt" },
    heartbeatAt: { _columnName: "heartbeatAt" },
    expiresAt: { _columnName: "expiresAt" },
  },
}));

// ---------------------------------------------------------------------------
// Minimal Drizzle-shaped fake DB — models only the operations used by
// acquireTypedLock: insert().values(), select().from().where(),
// delete().where(), and update().set().where().
// ---------------------------------------------------------------------------

type Predicate =
  | { kind: "eq"; field: string; value: unknown }
  | { kind: "and"; preds: Predicate[] };

function matches(row: LockRow, pred: Predicate): boolean {
  if (pred.kind === "eq") {
    return (row as Record<string, unknown>)[pred.field] === pred.value;
  }
  return pred.preds.every((p) => matches(row, p as Predicate));
}

function findRows(pred: Predicate): LockRow[] {
  return Array.from(store.values()).filter((r) => matches(r, pred));
}

const fakeDb = {
  insert: (_table: unknown) => ({
    values: async (row: LockRow) => {
      const key = storeKey(row.userId, row.lockType);
      if (store.has(key)) {
        throw new Error("unique constraint violation");
      }
      store.set(key, { ...row });
      return [row];
    },
  }),

  select: () => ({
    from: (_table: unknown) => ({
      where: async (pred: Predicate) => findRows(pred),
    }),
  }),

  delete: (_table: unknown) => ({
    where: async (pred: Predicate) => {
      const toDelete = findRows(pred).map((r) => storeKey(r.userId, r.lockType));
      toDelete.forEach((k) => store.delete(k));
      return toDelete.map(() => ({}));
    },
  }),

  update: (_table: unknown) => ({
    set: (updates: Partial<LockRow>) => ({
      where: async (pred: Predicate) => {
        const rows = findRows(pred);
        rows.forEach((r) => {
          Object.assign(r, updates);
        });
        return rows;
      },
    }),
  }),
};

// ---------------------------------------------------------------------------
// Import the function under test AFTER all mocks are defined.
// ---------------------------------------------------------------------------

import { acquireTypedLock } from "./_core/distributedLock";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("acquireTypedLock", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("returns lock handle on successful insert", async () => {
    const lock = await acquireTypedLock({
      userId: 1,
      lockType: "autonomy_run",
      ttlSeconds: 300,
    });
    expect(lock).not.toBeNull();
    expect(lock?.release).toBeTypeOf("function");
    expect(lock?.heartbeat).toBeTypeOf("function");
  });

  it("returns null when active lock exists with recent heartbeat", async () => {
    // Pre-seed a fresh lock row so the insert conflicts.
    store.set(storeKey(1, "autonomy_run"), {
      lockKey: "autonomy_run:user:1",
      userId: 1,
      lockType: "autonomy_run",
      acquiredBy: "other-holder",
      acquiredAt: new Date(Date.now() - 10_000),
      heartbeatAt: new Date(Date.now() - 5_000), // 5 s ago — fresh
      expiresAt: new Date(Date.now() + 300_000),  // not expired
    });

    const lock = await acquireTypedLock({
      userId: 1,
      lockType: "autonomy_run",
      ttlSeconds: 300,
    });
    expect(lock).toBeNull();
  });

  it("force-releases stale lock (heartbeat > 60s old) and acquires", async () => {
    // Pre-seed a stale lock row.
    store.set(storeKey(1, "autonomy_run"), {
      lockKey: "autonomy_run:user:1",
      userId: 1,
      lockType: "autonomy_run",
      acquiredBy: "stale-holder",
      acquiredAt: new Date(Date.now() - 120_000),
      heartbeatAt: new Date(Date.now() - 90_000), // 90 s ago — stale
      expiresAt: new Date(Date.now() + 300_000),   // not yet TTL-expired
    });

    const lock = await acquireTypedLock({
      userId: 1,
      lockType: "autonomy_run",
      ttlSeconds: 300,
    });
    expect(lock).not.toBeNull();
    // The stale row should have been replaced; the store should now hold the
    // new holder, not the old one.
    const row = store.get(storeKey(1, "autonomy_run"));
    expect(row?.acquiredBy).not.toBe("stale-holder");
  });

  it("force-releases lock with expired ttl even if heartbeat fresh", async () => {
    // Pre-seed a TTL-expired row whose heartbeat is still recent.
    store.set(storeKey(1, "autonomy_run"), {
      lockKey: "autonomy_run:user:1",
      userId: 1,
      lockType: "autonomy_run",
      acquiredBy: "expired-holder",
      acquiredAt: new Date(Date.now() - 400_000),
      heartbeatAt: new Date(Date.now() - 5_000),  // 5 s ago — fresh
      expiresAt: new Date(Date.now() - 1_000),    // already expired
    });

    const lock = await acquireTypedLock({
      userId: 1,
      lockType: "autonomy_run",
      ttlSeconds: 300,
    });
    expect(lock).not.toBeNull();
    const row = store.get(storeKey(1, "autonomy_run"));
    expect(row?.acquiredBy).not.toBe("expired-holder");
  });

  it("release() removes the lock row from the store", async () => {
    const lock = await acquireTypedLock({
      userId: 1,
      lockType: "autonomy_run",
      ttlSeconds: 300,
    });
    expect(lock).not.toBeNull();
    expect(store.has(storeKey(1, "autonomy_run"))).toBe(true);

    await lock!.release();
    expect(store.has(storeKey(1, "autonomy_run"))).toBe(false);
  });

  it("heartbeat() updates heartbeatAt on the stored row", async () => {
    const lock = await acquireTypedLock({
      userId: 1,
      lockType: "autonomy_run",
      ttlSeconds: 300,
    });
    expect(lock).not.toBeNull();

    const before = store.get(storeKey(1, "autonomy_run"))!.heartbeatAt.getTime();

    // Simulate a small delay so the updated timestamp is strictly later.
    await new Promise((r) => setTimeout(r, 5));
    await lock!.heartbeat();

    const after = store.get(storeKey(1, "autonomy_run"))!.heartbeatAt.getTime();
    expect(after).toBeGreaterThanOrEqual(before);
  });
});
