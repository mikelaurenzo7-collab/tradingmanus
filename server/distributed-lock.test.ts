import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory simulation of the `distributedLocks` table.  We replace the real
// Drizzle/Neon DB with a tiny mock so we can exercise the lock semantics in
// the test suite without a database.
type LockRow = {
  lockKey: string;
  acquiredAt: Date;
  expiresAt: Date;
  acquiredBy: string;
};

const store = new Map<string, LockRow>();

vi.mock("./db", () => ({
  getDb: async () => fakeDb,
}));

vi.mock("./_core/logger", () => ({
  logger: {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  },
}));

// Minimal Drizzle-shaped fake.  We only model the methods the lock uses:
//   db.delete(table).where(predicate)
//   db.insert(table).values(row).onConflictDoNothing().returning(...)
// Predicates are represented as opaque tagged objects produced by our
// `eq`/`and`/`lt` mocks below; the fake interprets them at execution time.
type Predicate =
  | { kind: "eq"; field: string; value: unknown }
  | { kind: "lt"; field: string; value: unknown }
  | { kind: "and"; preds: Predicate[] };

function matches(row: LockRow, pred: Predicate): boolean {
  if (pred.kind === "eq") {
    return (row as Record<string, unknown>)[pred.field] === pred.value;
  }
  if (pred.kind === "lt") {
    const fieldVal = (row as Record<string, unknown>)[pred.field] as Date;
    return fieldVal.getTime() < (pred.value as Date).getTime();
  }
  return pred.preds.every((p) => matches(row, p));
}

const fakeDb = {
  delete: (_table: unknown) => ({
    where: async (pred: Predicate) => {
      for (const [key, row] of Array.from(store.entries())) {
        if (matches(row, pred)) {
          store.delete(key);
        }
      }
    },
  }),
  insert: (_table: unknown) => ({
    values: (row: LockRow) => ({
      onConflictDoNothing: () => ({
        returning: async (_cols: unknown) => {
          if (store.has(row.lockKey)) return [];
          store.set(row.lockKey, row);
          return [{ lockKey: row.lockKey }];
        },
      }),
    }),
  }),
};

vi.mock("drizzle-orm", () => ({
  eq: (col: { _columnName: string }, value: unknown) => ({
    kind: "eq",
    field: col._columnName,
    value,
  }),
  lt: (col: { _columnName: string }, value: unknown) => ({
    kind: "lt",
    field: col._columnName,
    value,
  }),
  and: (...preds: Predicate[]) => ({ kind: "and", preds }),
}));

vi.mock("../drizzle/schema", () => ({
  distributedLocks: {
    lockKey: { _columnName: "lockKey" },
    acquiredAt: { _columnName: "acquiredAt" },
    expiresAt: { _columnName: "expiresAt" },
    acquiredBy: { _columnName: "acquiredBy" },
  },
}));

import { DistributedLock } from "./_core/distributedLock";

describe("DistributedLock", () => {
  beforeEach(() => {
    store.clear();
  });

  afterEach(() => {
    store.clear();
  });

  it("acquires when no lock is held and releases cleanly", async () => {
    const lock = new DistributedLock("test-key");
    const acquired = await lock.acquire({ ttlMs: 1000, retryCount: 0 });
    expect(acquired).toBe(true);
    expect(store.has("test-key")).toBe(true);

    await lock.release();
    expect(store.has("test-key")).toBe(false);
  });

  it("rejects a second acquirer while the first still holds", async () => {
    const a = new DistributedLock("test-key");
    const b = new DistributedLock("test-key");

    expect(await a.acquire({ ttlMs: 60_000, retryCount: 0 })).toBe(true);
    expect(await b.acquire({ ttlMs: 60_000, retryCount: 0 })).toBe(false);

    await a.release();
    expect(await b.acquire({ ttlMs: 60_000, retryCount: 0 })).toBe(true);
    await b.release();
  });

  it("reaps an expired row so a new acquirer can take over", async () => {
    const a = new DistributedLock("test-key");
    expect(await a.acquire({ ttlMs: 1, retryCount: 0 })).toBe(true);

    // Force the row to look expired.
    const row = store.get("test-key");
    if (row) {
      row.expiresAt = new Date(Date.now() - 1000);
    }

    const b = new DistributedLock("test-key");
    expect(await b.acquire({ ttlMs: 60_000, retryCount: 0 })).toBe(true);
    await b.release();
  });

  it("does NOT wipe a successor's row when an expired holder calls release() late (fencing)", async () => {
    // Holder A acquires, its TTL expires, the row is reaped, and B legitimately
    // takes the lock.  When A's late `release()` finally runs, it must scope its
    // DELETE to its own holderId so it cannot wipe B's row.
    const a = new DistributedLock("test-key");
    expect(await a.acquire({ ttlMs: 60_000, retryCount: 0 })).toBe(true);

    // Simulate A's TTL expiring by force-reaping its row.
    const row = store.get("test-key");
    if (row) {
      row.expiresAt = new Date(Date.now() - 1000);
    }

    const b = new DistributedLock("test-key");
    expect(await b.acquire({ ttlMs: 60_000, retryCount: 0 })).toBe(true);

    // Capture B's holder so we can assert it's still in the store after A
    // calls release().
    const bRow = store.get("test-key");
    expect(bRow).toBeDefined();

    // A's late release MUST be a no-op against B's row.
    await a.release();

    expect(store.get("test-key")).toBe(bRow);
    await b.release();
    expect(store.has("test-key")).toBe(false);
  });

  it("withLock acquires, runs the body, releases, and returns the value", async () => {
    const lock = new DistributedLock("test-key");
    const result = await lock.withLock(async () => "ok", { ttlMs: 1000, retryCount: 0 });
    expect(result).toBe("ok");
    expect(store.has("test-key")).toBe(false);
  });

  it("withLock returns null and does not run the body when the lock is unavailable", async () => {
    const a = new DistributedLock("test-key");
    expect(await a.acquire({ ttlMs: 60_000, retryCount: 0 })).toBe(true);

    const b = new DistributedLock("test-key");
    let ran = false;
    const result = await b.withLock(
      async () => {
        ran = true;
        return "should-not-run";
      },
      { ttlMs: 60_000, retryCount: 0 }
    );
    expect(result).toBeNull();
    expect(ran).toBe(false);

    await a.release();
  });

  it("withLock releases the lock even if the body throws", async () => {
    const lock = new DistributedLock("test-key");
    await expect(
      lock.withLock(
        async () => {
          throw new Error("boom");
        },
        { ttlMs: 1000, retryCount: 0 }
      )
    ).rejects.toThrow("boom");
    expect(store.has("test-key")).toBe(false);
  });
});
