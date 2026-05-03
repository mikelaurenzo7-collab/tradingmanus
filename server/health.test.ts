/**
 * Unit tests for the DB health-check primitives:
 *   - pingDb  — lightweight connectivity probe
 *   - checkDbHealth — latency-measuring wrapper used by the health routes
 *
 * Instead of trying to spy on intra-module calls (which ESM does not support),
 * we mock the external @neondatabase/serverless and drizzle-orm/neon-http
 * libraries so that getDb() returns a fully controllable mock database object.
 * The _core/env mock lets us set or clear DATABASE_URL per test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── Controllable fakes ────────────────────────────────────────────────────────

// executeMock is shared with the fake drizzle instance that getDb() caches.
// Resetting it between tests is enough — no module re-import needed.
const { envControl, executeMock } = vi.hoisted(() => ({
  envControl: { databaseUrl: "postgres://test" as string },
  executeMock: vi.fn<() => Promise<unknown>>(),
}));

vi.mock("./_core/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_core/env")>();
  return {
    ...actual,
    ENV: new Proxy(actual.ENV, {
      get(target, prop) {
        if (prop === "databaseUrl") return envControl.databaseUrl;
        return Reflect.get(target, prop);
      },
    }),
  };
});

// neon() is called once by initializeDb(); its return value (the sql tag) is
// only passed to drizzle() so we just need it to return something non-null.
vi.mock("@neondatabase/serverless", () => ({
  neon: vi.fn(() => vi.fn()),
}));

// drizzle() wraps the neon tag and returns the db client.  We return a simple
// object whose execute method is our controllable executeMock.
vi.mock("drizzle-orm/neon-http", () => ({
  drizzle: vi.fn(() => ({ execute: executeMock })),
}));

import { checkDbHealth, pingDb } from "./db";

// ─── pingDb ──────────────────────────────────────────────────────────────────

describe("pingDb", () => {
  beforeEach(() => {
    envControl.databaseUrl = "postgres://test";
    executeMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns false when DATABASE_URL is empty (no DB configured)", async () => {
    envControl.databaseUrl = "";
    await expect(pingDb()).resolves.toBe(false);
  });

  it("returns true when SELECT 1 resolves", async () => {
    executeMock.mockResolvedValue([{ "?column?": 1 }]);
    await expect(pingDb()).resolves.toBe(true);
  });

  it("returns false when execute() rejects", async () => {
    executeMock.mockRejectedValue(new Error("connection refused"));
    await expect(pingDb()).resolves.toBe(false);
  });

  it("returns false when the query exceeds the timeout", async () => {
    // execute() never settles within the given timeout window.
    executeMock.mockImplementation(() => new Promise(() => {}));
    // Use a 1 ms budget so the test does not block.
    await expect(pingDb(1)).resolves.toBe(false);
  });

  it("clears the timer when the query resolves before the timeout", async () => {
    // If clearTimeout is missing, a 10 s timer fires after the fast query
    // completes and could pollute subsequent tests in CI.
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    executeMock.mockResolvedValue([{ "?column?": 1 }]);

    await pingDb(10_000);

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});

// ─── checkDbHealth ────────────────────────────────────────────────────────────

describe("checkDbHealth", () => {
  beforeEach(() => {
    envControl.databaseUrl = "postgres://test";
    executeMock.mockReset();
  });

  it("returns status ok with a non-negative latencyMs on success", async () => {
    executeMock.mockResolvedValue([{ "?column?": 1 }]);
    const result = await checkDbHealth();
    expect(result.status).toBe("ok");
    expect(typeof result.latencyMs).toBe("number");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns status error when execute() rejects", async () => {
    executeMock.mockRejectedValue(new Error("query failed"));
    const result = await checkDbHealth();
    expect(result.status).toBe("error");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("returns status error when DATABASE_URL is empty", async () => {
    envControl.databaseUrl = "";
    const result = await checkDbHealth();
    expect(result.status).toBe("error");
  });
});
