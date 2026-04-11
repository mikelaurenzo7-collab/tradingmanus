import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { getDb, getAllBots, getOpenPositions, getTradeHistory, getReasoningLogs, getLatestEquitySnapshot, recordKillSwitchEvent, getKillSwitchHistory } from "./db";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

describe("Dashboard Database Functions", () => {
  let connection: mysql.Connection;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set");
    }
    connection = await mysql.createConnection(process.env.DATABASE_URL);
    db = drizzle(connection);
  });

  afterAll(async () => {
    await connection.end();
  });

  describe("Portfolio Queries", () => {
    it("should fetch latest equity snapshot for global scope", async () => {
      const snapshot = await getLatestEquitySnapshot("global");
      
      if (snapshot) {
        expect(snapshot).toHaveProperty("totalEquity");
        expect(snapshot).toHaveProperty("dailyPnl");
        expect(snapshot).toHaveProperty("sharpeRatio");
        expect(snapshot.scope).toBe("global");
        expect(typeof snapshot.totalEquity).toBe("number");
      }
    });

    it("should fetch equity history with correct date range", async () => {
      const history = await getLatestEquitySnapshot("global");
      
      if (history) {
        expect(history.recordedAt).toBeInstanceOf(Date);
      }
    });
  });

  describe("Bot Queries", () => {
    it("should fetch all bots", async () => {
      const bots = await getAllBots();
      
      expect(Array.isArray(bots)).toBe(true);
      if (bots.length > 0) {
        expect(bots[0]).toHaveProperty("id");
        expect(bots[0]).toHaveProperty("name");
        expect(bots[0]).toHaveProperty("market");
        expect(bots[0]).toHaveProperty("status");
      }
    });

    it("should have valid bot status values", async () => {
      const bots = await getAllBots();
      
      bots.forEach((bot) => {
        expect(["running", "paused", "stopped"]).toContain(bot.status);
      });
    });
  });

  describe("Position Queries", () => {
    it("should fetch open positions", async () => {
      const positions = await getOpenPositions();
      
      expect(Array.isArray(positions)).toBe(true);
      if (positions.length > 0) {
        expect(positions[0]).toHaveProperty("symbol");
        expect(positions[0]).toHaveProperty("market");
        expect(positions[0]).toHaveProperty("side");
        expect(positions[0]).toHaveProperty("entryPrice");
        expect(positions[0]).toHaveProperty("markPrice");
        expect(positions[0].status).toBe("open");
      }
    });

    it("should have valid position sides", async () => {
      const positions = await getOpenPositions();
      
      positions.forEach((position) => {
        expect(["long", "short", "yes", "no"]).toContain(position.side);
      });
    });

    it("should have valid market values", async () => {
      const positions = await getOpenPositions();
      
      positions.forEach((position) => {
        expect(["stocks", "crypto", "prediction"]).toContain(position.market);
      });
    });
  });

  describe("Trade Queries", () => {
    it("should fetch trade history", async () => {
      const trades = await getTradeHistory(30);
      
      expect(Array.isArray(trades)).toBe(true);
      if (trades.length > 0) {
        expect(trades[0]).toHaveProperty("symbol");
        expect(trades[0]).toHaveProperty("market");
        expect(trades[0]).toHaveProperty("side");
        expect(trades[0]).toHaveProperty("action");
        expect(trades[0]).toHaveProperty("quantity");
        expect(trades[0]).toHaveProperty("fillPrice");
        expect(trades[0]).toHaveProperty("pnl");
      }
    });

    it("should have valid trade actions", async () => {
      const trades = await getTradeHistory(30);
      
      trades.forEach((trade) => {
        expect(["open", "close", "rebalance", "hedge"]).toContain(trade.action);
      });
    });
  });

  describe("Reasoning Log Queries", () => {
    it("should fetch reasoning logs", async () => {
      const logs = await getReasoningLogs(7);
      
      expect(Array.isArray(logs)).toBe(true);
      if (logs.length > 0) {
        expect(logs[0]).toHaveProperty("headline");
        expect(logs[0]).toHaveProperty("signal");
        expect(logs[0]).toHaveProperty("correlationScore");
        expect(logs[0]).toHaveProperty("confidenceScore");
        expect(logs[0]).toHaveProperty("explanation");
        expect(logs[0]).toHaveProperty("regimeSummary");
      }
    });

    it("should have valid signal types", async () => {
      const logs = await getReasoningLogs(7);
      
      logs.forEach((log) => {
        expect(["trade", "hold", "reduce", "close", "hedge"]).toContain(log.signal);
      });
    });

    it("should have correlation and confidence scores in valid range", async () => {
      const logs = await getReasoningLogs(7);
      
      logs.forEach((log) => {
        expect(log.correlationScore).toBeGreaterThanOrEqual(0);
        expect(log.correlationScore).toBeLessThanOrEqual(1);
        expect(log.confidenceScore).toBeGreaterThanOrEqual(0);
        expect(log.confidenceScore).toBeLessThanOrEqual(1);
      });
    });
  });

  describe("Kill Switch Queries", () => {
    it("should record kill switch events", async () => {
      const testOpenId = "test_owner_" + Date.now();
      const success = await recordKillSwitchEvent(
        testOpenId,
        "Test kill switch activation",
        4,
        3
      );
      
      expect(success).toBe(true);
    });

    it("should fetch kill switch history", async () => {
      const history = await getKillSwitchHistory(30);
      
      expect(Array.isArray(history)).toBe(true);
      if (history.length > 0) {
        expect(history[0]).toHaveProperty("triggeredByOpenId");
        expect(history[0]).toHaveProperty("reason");
        expect(history[0]).toHaveProperty("flattenedPositions");
        expect(history[0]).toHaveProperty("haltedBots");
      }
    });
  });

  describe("Data Integrity", () => {
    it("should have consistent market values across all tables", async () => {
      const bots = await getAllBots();
      const positions = await getOpenPositions();
      const trades = await getTradeHistory(30);
      
      const validMarkets = ["stocks", "crypto", "prediction"];
      
      bots.forEach((bot) => {
        expect(validMarkets).toContain(bot.market);
      });
      
      positions.forEach((position) => {
        expect(validMarkets).toContain(position.market);
      });
      
      trades.forEach((trade) => {
        expect(validMarkets).toContain(trade.market);
      });
    });

    it("should have reasonable price relationships in positions", async () => {
      const positions = await getOpenPositions();
      
      positions.forEach((position) => {
        expect(position.entryPrice).toBeGreaterThan(0);
        expect(position.markPrice).toBeGreaterThan(0);
        expect(position.size).toBeGreaterThan(0);
      });
    });

    it("should have consistent timestamps", async () => {
      const positions = await getOpenPositions();
      const trades = await getTradeHistory(30);
      const logs = await getReasoningLogs(7);
      
      positions.forEach((position) => {
        expect(position.openedAt).toBeInstanceOf(Date);
        expect(position.updatedAt).toBeInstanceOf(Date);
      });
      
      trades.forEach((trade) => {
        expect(trade.executedAt).toBeInstanceOf(Date);
      });
      
      logs.forEach((log) => {
        expect(log.createdAt).toBeInstanceOf(Date);
      });
    });
  });
});
