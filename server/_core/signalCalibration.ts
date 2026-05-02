/**
 * Confidence calibration.
 *
 * Strategies emit `confidence` in [0, 1].  We want this to mean "P(side
 * wins) at resolution".  Out of the box it doesn't — confidence comes
 * from heuristics like (fundamental - price) × 2 with no guarantee
 * that empirical hit rate matches.  An overconfident strategy
 * paired with Kelly sizing systematically over-bets.
 *
 * This module fits a calibration curve from historical closed trades:
 *   bucket signals by claimed confidence
 *   measure realized win rate per bucket
 *   smooth into a monotonic mapping confidence → estimated P(win)
 *
 * The mapping is then plugged into beliefFromSignal so Kelly sees the
 * empirical probability rather than the raw heuristic.
 *
 * Pulls from the audit log so it doesn't need a positions table for
 * Polymarket: each closed trade leaves both an entry event (with its
 * confidence) and an exit event (with realized PnL).  Match by tradeId
 * for Polymarket; match by marketId for Kalshi (positions table doesn't
 * carry signal confidence directly so we cross-reference via signals).
 */

import * as db from "../db";

export type CalibrationBucket = {
  /** Lower bound of the confidence bucket, inclusive. */
  lo: number;
  /** Upper bound of the confidence bucket, exclusive (or 1.0 inclusive on the last). */
  hi: number;
  /** Count of closed trades in this bucket. */
  trades: number;
  /** Wins in this bucket. */
  wins: number;
  /** Empirical win rate (wins / trades). */
  winRate: number;
};

export type CalibrationCurve = {
  buckets: CalibrationBucket[];
  /** Total closed trades scanned. */
  totalTrades: number;
  /**
   * Sample-weighted overall win rate across all buckets — useful as a
   * sanity check ("is this strategy net positive?").
   */
  overallWinRate: number;
};

export const DEFAULT_BUCKETS: Array<[number, number]> = [
  [0, 0.4],
  [0.4, 0.55],
  [0.55, 0.65],
  [0.65, 0.75],
  [0.75, 0.85],
  [0.85, 1.0001], // include 1.0
];

/**
 * Pure helper: given (confidence, won) trade observations, compute
 * per-bucket win rates.  Used by the calibration builder; testable
 * without a DB.
 */
export function bucketize(
  observations: Array<{ confidence: number; won: boolean }>,
  bucketRanges: Array<[number, number]> = DEFAULT_BUCKETS,
): CalibrationCurve {
  const buckets: CalibrationBucket[] = bucketRanges.map(([lo, hi]) => ({
    lo,
    hi,
    trades: 0,
    wins: 0,
    winRate: 0,
  }));

  for (const obs of observations) {
    const c = obs.confidence;
    if (!Number.isFinite(c)) continue;
    const bucket = buckets.find((b) => c >= b.lo && c < b.hi);
    if (!bucket) continue;
    bucket.trades += 1;
    if (obs.won) bucket.wins += 1;
  }

  let totalTrades = 0;
  let totalWins = 0;
  for (const b of buckets) {
    b.winRate = b.trades === 0 ? 0 : b.wins / b.trades;
    totalTrades += b.trades;
    totalWins += b.wins;
  }

  return {
    buckets,
    totalTrades,
    overallWinRate: totalTrades === 0 ? 0 : totalWins / totalTrades,
  };
}

/**
 * Smooth the bucketized curve into a monotonic mapping.  We use simple
 * isotonic-flavored monotonization: sweep low-to-high, replace any
 * decreasing bucket with its predecessor's win rate.  Then clamp to
 * (0.01, 0.99) so Kelly never sees 0 or 1 (which would imply infinite
 * leverage).
 *
 * For empty buckets we interpolate between neighbors so the curve
 * doesn't return zeros for confidence ranges that have no data.
 */
export function buildMonotoneCurve(curve: CalibrationCurve): CalibrationBucket[] {
  const out = curve.buckets.map((b) => ({ ...b }));

  // Forward fill empty buckets from the left, then backward fill from the right.
  let lastObserved: number | null = null;
  for (let i = 0; i < out.length; i++) {
    if (out[i]!.trades === 0 && lastObserved !== null) {
      out[i]!.winRate = lastObserved;
    } else if (out[i]!.trades > 0) {
      lastObserved = out[i]!.winRate;
    }
  }
  let nextObserved: number | null = null;
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i]!.trades === 0 && nextObserved !== null) {
      out[i]!.winRate = nextObserved;
    } else if (out[i]!.trades > 0) {
      nextObserved = out[i]!.winRate;
    }
  }

  // Monotonize: sweep left-to-right, never let win rate decrease.
  let runningMax = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i]!.winRate < runningMax) {
      out[i]!.winRate = runningMax;
    } else {
      runningMax = out[i]!.winRate;
    }
  }

  // Clamp to (0.01, 0.99).
  for (const b of out) {
    b.winRate = Math.max(0.01, Math.min(0.99, b.winRate));
  }

  return out;
}

/**
 * Curve evaluator: map a raw confidence value to its calibrated win rate
 * via lookup into the monotonized bucket list.  Returns the input value
 * (clamped) when the bucket list is empty.
 */
export function calibrateConfidence(
  confidence: number,
  monotone: CalibrationBucket[],
): number {
  const safe = Math.max(0, Math.min(1, Number.isFinite(confidence) ? confidence : 0));
  if (monotone.length === 0) return Math.max(0.01, Math.min(0.99, safe));
  const bucket = monotone.find((b) => safe >= b.lo && safe < b.hi)
    ?? monotone[monotone.length - 1];
  return bucket!.winRate;
}

/**
 * Build a calibration curve from this user's audit-log history.
 *
 * Polymarket path: each polymarket_trade_entry has `confidence` (we'll
 * persist it below as part of this commit so future entries carry it),
 * matched to its polymarket_trade_exit by tradeId; won = realizedPnl > 0.
 *
 * Kalshi path: each kalshi_signal saved row carries confidence; closed
 * positions carry realizedPnl by marketId.  We approximate by picking
 * the most recent saved signal per marketId at the time the position
 * opened.
 *
 * Both paths fall back to the raw confidence when there's no history yet.
 */
export async function buildCalibrationFromHistory(
  userId: number,
): Promise<CalibrationBucket[]> {
  const observations = await db.collectClosedTradeObservations(userId);
  if (observations.length < 10) {
    // Not enough data — return identity buckets so Kelly uses raw confidence.
    return DEFAULT_BUCKETS.map(([lo, hi]) => ({
      lo,
      hi,
      trades: 0,
      wins: 0,
      // Identity: midpoint of the bucket.
      winRate: Math.max(0.01, Math.min(0.99, (lo + Math.min(hi, 1)) / 2)),
    }));
  }
  const curve = bucketize(observations);
  return buildMonotoneCurve(curve);
}
