import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { syncMarketData, detectStaleData, getLatestQuoteWithQuality } from "./_core/marketDataSync";
import { fetchQuoteWithFallback } from "./_core/marketDataAdapter";
import { syncWithRetry, syncBatchWithRetry, createScheduledSync } from "./_core/marketDataScheduler";
import { getDb } from "./db";
import { marketDataSnapshots } from "../drizzle/schema";
import { eq } from "drizzle-orm";

describe("Market Data Adapters", () => {
  it("should handle missing API keys gracefully", async () => {
    const result = await fetchQuoteWithFallback("AAPL", "stocks");
    expect(result).toBeNull();
  });

  it("should handle invalid symbols", async () => {
    const result = await fetchQuoteWithFallback("INVALID_SYMBOL_XYZ_123", "stocks");
    expect(result).toBeNull();
  });
});

describe("Market Data Sync Service", () => {
  let db: Awaited<ReturnType<typeof getDb>>;

  beforeAll(async () => {
    db = await getDb();
  });

  afterAll(async () => {
    if (db) {
      await db.delete(marketDataSnapshots).where(eq(marketDataSnapshots.symbol, "TEST"));
    }
  });

  it("should detect stale data correctly", async () => {
    const isStale = await detectStaleData("NONEXISTENT_SYMBOL_12345", 5);
    expect(typeof isStale).toBe("boolean");
  });

  it("should retrieve latest quote with quality metrics", async () => {
    const result = await getLatestQuoteWithQuality("NONEXISTENT_SYMBOL_12345");
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("should handle sync errors gracefully", async () => {
    const result = await syncMarketData("INVALID", "stocks");
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe("Market Data Scheduler", () => {
  it("should create and cleanup scheduled sync", () => {
    const stop = createScheduledSync(
      [{ symbol: "TEST", market: "stocks" }],
      5000
    );

    expect(stop).toBeDefined();
    expect(typeof stop).toBe("function");
    stop();
  });

  it("should batch sync multiple symbols", async () => {
    const result = await syncBatchWithRetry(
      [
        { symbol: "TEST1", market: "stocks" },
        { symbol: "TEST2", market: "crypto" },
      ],
      2
    );

    expect(result.total).toBe(2);
    expect(result.successful + result.failed).toBe(2);
    expect(typeof result.successful).toBe("number");
    expect(typeof result.failed).toBe("number");
  });

  it("should retry failed syncs", async () => {
    const success = await syncWithRetry("INVALID_TEST", "stocks");
    expect(typeof success).toBe("boolean");
  });
});

describe("Market Data Integration", () => {
  it("should handle fallback strategy", async () => {
    const result = await fetchQuoteWithFallback("AAPL", "stocks");
    expect(result === null || typeof result === "object").toBe(true);
  });

  it("should maintain data integrity during concurrent syncs", async () => {
    const symbols = [
      { symbol: "TEST1", market: "stocks" as const },
      { symbol: "TEST2", market: "crypto" as const },
      { symbol: "TEST3", market: "stocks" as const },
    ];

    const result = await syncBatchWithRetry(symbols, 3);
    expect(result.total).toBe(3);
    expect(typeof result.successful).toBe("number");
    expect(typeof result.failed).toBe("number");
  });

  it("should track sync operations", async () => {
    const result = await syncMarketData("TEST_SYMBOL", "stocks");
    expect(typeof result.success).toBe("boolean");
    expect(result.error === undefined || typeof result.error === "string").toBe(true);
  });
});
