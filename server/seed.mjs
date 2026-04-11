#!/usr/bin/env node

/**
 * Seed script for NEXUS OMEGA Dashboard
 * Populates database with realistic trading data for development and testing
 * Run with: node server/seed.mjs
 */

import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL environment variable is required");
  process.exit(1);
}

async function seed() {
  console.log("[Seed] Starting database population...");

  const connection = await mysql.createConnection(DATABASE_URL);

  try {
    // Clear existing data
    console.log("[Seed] Clearing existing data...");
    await connection.query("DELETE FROM trades");
    await connection.query("DELETE FROM positions");
    await connection.query("DELETE FROM bots");
    await connection.query("DELETE FROM reasoningLogs");
    await connection.query("DELETE FROM equitySnapshots");
    await connection.query("DELETE FROM alerts");

    // Seed bots
    console.log("[Seed] Creating bots...");
    const now = new Date();
    
    await connection.query(
      `INSERT INTO bots (botKey, name, market, strategy, botStatus, lastActionAt, createdAt, updatedAt) VALUES
       (?, ?, ?, ?, ?, ?, ?, ?),
       (?, ?, ?, ?, ?, ?, ?, ?),
       (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "bot_stocks_momentum", "Stocks Momentum", "stocks", "Mean Reversion + Momentum", "running", now, now, now,
        "bot_crypto_arbitrage", "Crypto Arbitrage", "crypto", "Cross-Exchange Arbitrage", "running", now, now, now,
        "bot_prediction_market", "Prediction Markets", "prediction", "Sentiment Analysis + ML", "paused", now, now, now,
      ]
    );

    // Get bot IDs
    const [bots] = await connection.query("SELECT id FROM bots ORDER BY id");
    const botIds = bots.map(b => b.id);

    // Seed positions
    console.log("[Seed] Creating open positions...");
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);

    await connection.query(
      `INSERT INTO positions (botId, symbol, market, positionSide, size, entryPrice, markPrice, realizedPnl, positionStatus, strategyTag, openedAt, updatedAt) VALUES
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        botIds[0], "AAPL", "stocks", "long", 100, 185.5, 187.2, 0, "open", "momentum_breakout", twoHoursAgo, now,
        botIds[0], "MSFT", "stocks", "short", 50, 425.0, 423.5, 0, "open", "mean_reversion", oneHourAgo, now,
        botIds[1], "BTC", "crypto", "long", 0.5, 68500, 69200, 0, "open", "arbitrage_spot", oneHourAgo, now,
        botIds[2], "ELECTION_2026", "prediction", "yes", 1000, 0.65, 0.68, 0, "open", "sentiment_analysis", twoHoursAgo, now,
      ]
    );

    // Seed trades
    console.log("[Seed] Creating trade history...");
    const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const fourHoursAgo = new Date(now.getTime() - 4 * 60 * 60 * 1000);

    await connection.query(
      `INSERT INTO trades (botId, symbol, market, positionSide, tradeAction, quantity, fillPrice, pnl, strategyTag, executedAt) VALUES
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        botIds[0], "AAPL", "stocks", "long", "open", 100, 185.5, 0, "momentum_breakout", twoHoursAgo,
        botIds[0], "GOOGL", "stocks", "long", "close", 75, 142.8, 225.0, "momentum_breakout", threeHoursAgo,
        botIds[1], "ETH", "crypto", "short", "open", 5, 3500, 0, "arbitrage_spot", fourHoursAgo,
        botIds[1], "ETH", "crypto", "short", "close", 5, 3480, 100.0, "arbitrage_spot", threeHoursAgo,
      ]
    );

    // Seed reasoning logs
    console.log("[Seed] Creating reasoning logs...");
    await connection.query(
      `INSERT INTO reasoningLogs (botId, market, signal, correlationScore, confidenceScore, headline, explanation, regimeSummary, opportunityTitle, createdAt) VALUES
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?),
       (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        botIds[0], "stocks", "trade", 0.82, 0.91, "AAPL Momentum Breakout Detected",
        "Strong positive momentum detected with RSI > 70 and price above 20-day MA. Volume spike confirms institutional buying.",
        "Bullish regime with strong uptrend. Tech sector outperforming broader market. Fed signals suggest continued support.",
        "Long AAPL with 2% stop loss", now,
        
        botIds[1], "crypto", "hold", 0.65, 0.78, "BTC Consolidation Pattern",
        "Bitcoin consolidating in tight range. Awaiting breakout above $69,500 resistance. Funding rates suggest balanced sentiment.",
        "Neutral regime with mixed signals. On-chain metrics show accumulation by large holders. Macro headwinds present.",
        "Wait for breakout confirmation", new Date(now.getTime() - 30 * 60 * 1000),
        
        botIds[2], "prediction", "trade", 0.71, 0.85, "Election 2026 Sentiment Surge",
        "Sentiment analysis shows 73% positive mentions across news sources. Prediction market YES shares undervalued relative to fundamentals.",
        "Positive sentiment environment. Recent policy announcements favor incumbent. Betting markets show 68% probability.",
        "Long YES shares at 0.65", new Date(now.getTime() - 60 * 60 * 1000),
      ]
    );

    // Seed equity snapshots (one by one to avoid placeholder issues)
    console.log("[Seed] Creating equity snapshots...");
    for (let i = 30; i >= 0; i--) {
      const snapshotTime = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      const baseEquity = 100000;
      const randomPnL = Math.random() * 5000 - 2500;
      const totalEquity = baseEquity + randomPnL * (30 - i);

      await connection.query(
        `INSERT INTO equitySnapshots (analyticsScope, totalEquity, dailyPnl, realizedPnl, unrealizedPnl, winRate, sharpeRatio, drawdownPct, recordedAt) 
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "global",
          totalEquity,
          randomPnL,
          randomPnL * 0.6,
          randomPnL * 0.4,
          0.55 + Math.random() * 0.1,
          1.2 + Math.random() * 0.5,
          Math.random() * 5,
          snapshotTime,
        ]
      );
    }

    // Seed alerts
    console.log("[Seed] Creating alerts...");
    await connection.query(
      `INSERT INTO alerts (alertType, alertSeverity, title, content, dedupeKey, createdAt) VALUES
       (?, ?, ?, ?, ?, ?),
       (?, ?, ?, ?, ?, ?)`,
      [
        "position_open", "info", "Position Opened: AAPL Long", "AAPL long position opened at $185.50 with 100 shares", `position_open_aapl_${now.getTime()}`, twoHoursAgo,
        "position_close", "info", "Position Closed: GOOGL Long", "GOOGL long position closed at $142.80 with +$225 PnL", `position_close_googl_${threeHoursAgo.getTime()}`, threeHoursAgo,
      ]
    );

    console.log("[Seed] ✅ Database seeding completed successfully!");
    console.log("[Seed] Created:");
    console.log("  - 3 bots");
    console.log("  - 4 open positions");
    console.log("  - 4 trades");
    console.log("  - 3 reasoning logs");
    console.log("  - 31 equity snapshots");
    console.log("  - 2 alerts");
  } catch (error) {
    console.error("[Seed] ❌ Seeding failed:", error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

seed();
