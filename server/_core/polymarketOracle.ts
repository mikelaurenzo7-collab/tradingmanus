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

const TEMPORAL_KEYWORDS = [
  "today", "tomorrow", "tonight", "thisweek", "nextweek", "thismonth", "nextmonth", "thisyear", "nextyear", "daily", "weekly", "monthly",
  "2024", "2025", "2026", "2027", "2028",
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec"
];

function getTemporalKeywords(s: string): string[] {
  const norm = normalize(s);
  return TEMPORAL_KEYWORDS.filter(k => norm.includes(k));
}

let snapshotCache: { data: PolymarketSnapshot[]; ts: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Fetch top active markets from Polymarket Gamma API with 5-minute caching
 */
export async function fetchPolymarketSnapshots(): Promise<PolymarketSnapshot[]> {
  const now = Date.now();
  if (snapshotCache && (now - snapshotCache.ts < CACHE_TTL_MS)) {
    return snapshotCache.data;
  }

  try {
    // We fetch the top 100 active markets by volume. These are the most
    // accurate signals.
    const url = "https://gamma-api.polymarket.com/v1/markets?active=true&limit=250&order=volume24hr&dir=desc";
    const data = await fetchWithRetry(url);

    if (!Array.isArray(data)) return snapshotCache?.data ?? [];

    const snapshots = data.map((m: any) => {
      const outcomes = (m.outcomes || []) as string[];
      const yesIndex = outcomes.findIndex(o => o.toLowerCase() === "yes");
      const price = Number(m.outcomePrices?.[yesIndex !== -1 ? yesIndex : 0] || 0.5);
      
      return {
        ticker: m.ticker || "",
        title: m.question || m.title || "",
        price,
        volume: Number(m.volume || 0),
      };
    }).filter(m => m.price > 0 && m.price < 1);

    snapshotCache = { data: snapshots, ts: now };
    return snapshots;
  } catch (err) {
    logger.warn({ err }, "[PolymarketOracle] Failed to fetch Polymarket snapshots");
    return snapshotCache?.data ?? [];
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
    
    // Temporal mismatch check: prevent matching "Will Trump win tomorrow?" with "Will Trump win in 2024?"
    const kTemps = getTemporalKeywords(kalshiTitle);
    const pTemps = getTemporalKeywords(p.title);
    const hasTemporalMismatch = kTemps.some(k => !pTemps.includes(k)) || pTemps.some(p => !kTemps.includes(p));
    
    if (hasTemporalMismatch) continue;

    // Exact match
    if (kNorm === pNorm) return p.price;

    // Word-level Jaccard similarity
    const kWords = new Set(kalshiTitle.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2));
    const pWords = new Set(p.title.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(w => w.length > 2));
    
    let intersection = 0;
    for (const w of kWords) {
      if (pWords.has(w)) intersection++;
    }
    
    // Calculate overlap score based on the smaller set of words to allow for titles with extra context
    const minWords = Math.min(kWords.size, pWords.size);
    if (minWords > 0) {
      const score = intersection / minWords;
      
      if (score > bestScore) {
        bestScore = score;
        bestMatch = p;
      }
    }
  }

  // High-confidence threshold (80% word overlap of the shorter title)
  if (bestMatch && bestScore > 0.80) {
    return bestMatch.price;
  }

  return null;
}
