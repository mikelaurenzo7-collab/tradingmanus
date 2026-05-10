/**
 * Seed kalshi_market_snapshots with REAL historical data from Kalshi candlestick API.
 * Fetches daily candlesticks for liquid open markets over the past 90 days.
 *
 * Usage:
 *   DATABASE_URL='...' KALSHI_API_KEY_ID='...' KALSHI_PRIVATE_KEY='...' \
 *     corepack pnpm exec tsx scripts/seed-real-kalshi-history.ts
 */
import "dotenv/config";
import crypto from "crypto";
import { getDb } from "../server/db";
import { kalshiMarketSnapshots } from "../drizzle/schema";
import { logger } from "../server/_core/logger";

const BASE_URL = "https://trading-api.kalshi.com/trade-api/v2";
const PUBLIC_BASE_URL = "https://api.elections.kalshi.com/trade-api/v2";
const KEY_ID = process.env.KALSHI_API_KEY_ID!;
const PRIVATE_KEY_PEM = process.env.KALSHI_PRIVATE_KEY!;

function buildSignedHeaders(method: string, path: string) {
  const timestamp = Date.now().toString();
  const message = `${timestamp}${method.toUpperCase()}${path}`;
  const keyObject = crypto.createPrivateKey({ key: PRIVATE_KEY_PEM, format: "pem" });
  const signature = crypto.sign("sha256", Buffer.from(message, "utf8"), {
    key: keyObject,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });
  return {
    Accept: "application/json",
    "KALSHI-ACCESS-KEY": KEY_ID,
    "KALSHI-ACCESS-SIGNATURE": signature.toString("base64"),
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
  };
}

async function kalshiGet(path: string, useAuth = true): Promise<any> {
  const baseUrl = useAuth ? BASE_URL : PUBLIC_BASE_URL;
  const fullPath = `/trade-api/v2${path}`;
  const url = `${baseUrl}${path}`;
  const headers: Record<string, string> = useAuth
    ? buildSignedHeaders("GET", fullPath) as unknown as Record<string, string>
    : { Accept: "application/json" };
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Kalshi ${path}: HTTP ${res.status} — ${body.slice(0, 120)}`);
  }
  return res.json();
}

async function fetchLiquidMarkets(): Promise<string[]> {
  // Settled markets have completed histories; try those first
  const data = await kalshiGet(`/markets?status=settled&limit=200`, false);
  const markets: any[] = data.markets ?? [];

  // Sort by volume desc, take top 30
  const sorted = markets
    .filter((m: any) => m.ticker)
    .sort((a: any, b: any) => Number(b.volume ?? 0) - Number(a.volume ?? 0));

  return sorted.slice(0, 30).map((m: any) => m.ticker);
}

interface Candlestick {
  end_period_ts: number;
  price: { open: number; high: number; low: number; close: number };
  yes_bid: { close: number };
  yes_ask: { close: number };
  volume: number;
}

async function fetchCandlesticks(ticker: string, startTs: number, endTs: number): Promise<Candlestick[]> {
  const path = `/markets/${encodeURIComponent(ticker)}/candlesticks?start_ts=${startTs}&end_ts=${endTs}&period_interval=60`;
  try {
    const data = await kalshiGet(path, true); // requires auth
    return data.candlesticks ?? [];
  } catch {
    return [];
  }
}

async function main() {
  if (!KEY_ID || !PRIVATE_KEY_PEM) {
    console.error("[Seed] KALSHI_API_KEY_ID and KALSHI_PRIVATE_KEY must be set");
    process.exit(1);
  }

  const db = await getDb();
  if (!db) {
    console.error("[Seed] Database not initialized");
    process.exit(1);
  }

  console.log("[Seed] Fetching liquid Kalshi markets...");
  let tickers: string[];
  try {
    tickers = await fetchLiquidMarkets();
  } catch (err) {
    console.error("[Seed] Failed to list markets:", err);
    process.exit(1);
  }
  console.log(`[Seed] Found ${tickers.length} liquid markets`);

  const now = Math.floor(Date.now() / 1000);
  const startTs = now - 90 * 86400;
  let totalSnapshots = 0;
  let marketsWithData = 0;

  for (const ticker of tickers) {
    const candles = await fetchCandlesticks(ticker, startTs, now);
    if (candles.length === 0) continue;

    marketsWithData++;
    for (const c of candles) {
      const snapshotTime = new Date(c.end_period_ts * 1000);
      // Kalshi candlestick prices are in dollars (0-1 scale)
      const yesPrice = c.price.close;
      const noPrice = 1 - yesPrice;

      if (yesPrice <= 0 || yesPrice >= 1) continue;

      try {
        await db.insert(kalshiMarketSnapshots).values({
          marketId: ticker,
          yesPrice,
          noPrice,
          yesVolume: c.volume ?? 0,
          noVolume: 0,
          impliedProbability: yesPrice,
          liquidity: c.volume ?? 0,
          snapshotTime,
        }).onConflictDoNothing();
        totalSnapshots++;
      } catch {
        // Skip dupes silently
      }
    }

    process.stdout.write(`  ${ticker}: ${candles.length} daily candles\n`);
  }

  console.log(`\n[Seed] ✅ Inserted ${totalSnapshots} real snapshots across ${marketsWithData} markets`);
  if (marketsWithData === 0) {
    console.log("[Seed] ⚠️  No markets had 90-day daily candlestick data (likely new markets)");
    console.log("[Seed]    Try reducing start_ts or using hourly intervals (period_interval=60)");
  }
}

main().catch(err => {
  console.error("[Seed] Fatal:", err);
  process.exit(1);
});
