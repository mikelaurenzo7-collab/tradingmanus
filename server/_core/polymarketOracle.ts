/**
 * Polymarket Oracle
 *
 * Uses Polymarket (the world's most liquid prediction market) as a lead
 * indicator for Kalshi markets.
 *
 * Prediction markets are "wisdom of the crowd" engines. Polymarket, with its
 * massive international liquidity and crypto-native user base, is typically
 * faster and more accurate than Kalshi for global events (politics, macro,
 * pop culture).
 *
 * This oracle fetches active Polymarket prices and maps them to Kalshi markets
 * to provide a high-confidence "Expert Prior".
 */

import { fetchWithRetry } from "./fetchWithRetry";
import { logger } from "./logger";

export interface PolymarketSnapshot {
  ticker: string;
  title: string;
  price: number; // Yes price [0,1]
  volume: number;
}

// Simple title-matching fuzzy rules
const NORMALIZATION_REGEX = /[^a-z0-9]/g;

function normalize(s: string): string {
  return s.toLowerCase().replace(NORMALIZATION_REGEX, "");
}

/**
 * Fetch top active markets from Polymarket Gamma API
 */
export async function fetchPolymarketSnapshots(): Promise<PolymarketSnapshot[]> {
  try {
    // We fetch the top 100 active markets by volume. These are the most
    // accurate signals.
    const url = "https://gamma-api.polymarket.com/v1/markets?active=true&limit=100&order=volume24hr&dir=desc";
    const data = await fetchWithRetry(url);

    if (!Array.isArray(data)) return [];

    return data.map((m: any) => ({
      ticker: m.ticker || "",
      title: m.question || m.title || "",
      price: Number(m.outcomePrices?.[0] || 0.5), // Outcome index 0 is usually 'Yes'
      volume: Number(m.volume || 0),
    })).filter(m => m.price > 0 && m.price < 1);
  } catch (err) {
    logger.warn({ err }, "[PolymarketOracle] Failed to fetch Polymarket snapshots");
    return [];
  }
}

/**
 * Find the closest matching Polymarket price for a Kalshi market title.
 * Returns null if no high-confidence match is found.
 */
export function matchPolymarketPrice(
  kalshiTitle: string,
  polymarketSnapshots: PolymarketSnapshot[]
): number | null {
  const kNorm = normalize(kalshiTitle);
  if (kNorm.length < 10) return null; // Too short for safe matching

  let bestMatch: PolymarketSnapshot | null = null;
  let bestScore = 0;

  for (const p of polymarketSnapshots) {
    const pNorm = normalize(p.title);
    
    // Exact match
    if (kNorm === pNorm) return p.price;

    // Fuzzy match: check if one contains the other
    if (kNorm.includes(pNorm) || pNorm.includes(kNorm)) {
      const score = Math.min(kNorm.length, pNorm.length) / Math.max(kNorm.length, pNorm.length);
      if (score > bestScore) {
        bestScore = score;
        bestMatch = p;
      }
    }
  }

  // High-confidence threshold (85% string overlap)
  if (bestMatch && bestScore > 0.85) {
    return bestMatch.price;
  }

  return null;
}
