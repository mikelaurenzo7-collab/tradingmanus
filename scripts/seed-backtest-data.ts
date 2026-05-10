/**
 * Seed kalshi_market_snapshots table with synthetic historical data
 * for backtest validation.
 *
 * Usage:
 *   DATABASE_URL='...' corepack pnpm exec tsx scripts/seed-backtest-data.ts
 *
 * Creates backdated snapshots for synthetic markets distributed over
 * the past 90 days with realistic price movements (random walk).
 */
import "dotenv/config";
import { getDb } from "../server/db";
import { saveMarketSnapshot } from "../server/_core/kalshiMarketSnapshots";
import { logger } from "../server/_core/logger";

// Synthetic market templates for backtest seed
const SYNTHETIC_MARKETS = [
  { id: "TEST-MARKET-1", baseYesPrice: 0.45 },
  { id: "TEST-MARKET-2", baseYesPrice: 0.55 },
  { id: "TEST-MARKET-3", baseYesPrice: 0.62 },
  { id: "TEST-MARKET-4", baseYesPrice: 0.38 },
  { id: "TEST-MARKET-5", baseYesPrice: 0.70 },
  { id: "TEST-MARKET-6", baseYesPrice: 0.50 },
  { id: "TEST-MARKET-7", baseYesPrice: 0.42 },
  { id: "TEST-MARKET-8", baseYesPrice: 0.58 },
];

async function main() {
  try {
    // Initialize database connection first
    const dbInstance = await getDb();
    if (!dbInstance) {
      console.log("[Seed] failed to connect to database");
      process.exit(1);
    }

    const now = Date.now();
    const ninetyDaysMs = 90 * 24 * 60 * 60 * 1000;
    const startTime = now - ninetyDaysMs;

    // Create 30 snapshots per market spread over 90 days
    // = 240 trades for testing purposes
    const snapshotsPerMarket = 30;
    const intervalMs = ninetyDaysMs / (snapshotsPerMarket - 1);

    let totalInserted = 0;

    console.log(`[Seed] generating ${SYNTHETIC_MARKETS.length * snapshotsPerMarket} synthetic snapshots...`);

    for (const market of SYNTHETIC_MARKETS) {
      let cumulativePrice = market.baseYesPrice;

      for (let i = 0; i < snapshotsPerMarket; i++) {
        const timestamp = new Date(startTime + i * intervalMs);

        // Random walk: small step with mean reversion toward base price
        const randomStep = (Math.random() - 0.5) * 0.04;
        const reversion = (market.baseYesPrice - cumulativePrice) * 0.1;
        cumulativePrice = Math.max(0.01, Math.min(0.99, cumulativePrice + randomStep + reversion));

        const yesPrice = cumulativePrice;
        const noPrice = 1 - yesPrice;

        await saveMarketSnapshot({
          marketId: market.id,
          timestamp,
          yesPrice,
          noPrice,
          yesVolume: 2000 + Math.random() * 3000,
          noVolume: 2000 + Math.random() * 3000,
          impliedProbability: yesPrice,
        });

        totalInserted++;
      }
    }

    console.log(`[Seed] ✅ inserted ${totalInserted} snapshots across ${SYNTHETIC_MARKETS.length} markets`);
    console.log("[Seed] backtest data ready; run: DATABASE_URL='...' corepack pnpm backtest 90 every-n");
  } catch (error) {
    logger.error({ err: error }, "[Seed] failed");
    console.error("[Seed] failed:", error);
    process.exit(1);
  }
}

main();
