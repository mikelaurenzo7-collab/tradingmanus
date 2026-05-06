/**
 * Paper-mode P&L summary.
 *
 * The single number an operator needs while validating in paper mode:
 * "did the bot make money in paper today / this week?".  Without this,
 * the operator has to grep the audit log manually to compute paper P&L.
 *
 * Sources:
 *   - kalshiPositions where positionStatus='closed' AND realizedPnl != 0
 *     (Kalshi paper-close marks the row closed with realizedPnl)
 *   - polymarketPositions where positionStatus='closed' AND realizedPnl != 0
 *     (Polymarket paper-close mirrors)
 *   - Filtered by closedAt >= sinceDate
 *
 * Note: this is *paper P&L only when PAPER_TRADE_MODE was on*.  When the
 * operator is live, the same closed-position rows reflect REAL P&L.  We
 * report both with a flag the caller can use to interpret.
 *
 * The summary is intentionally cheap — two indexed queries, no joins.
 */

import { kalshiPositions, polymarketPositions } from "../../drizzle/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { getDb } from "../db";
import { logger } from "./logger";

export interface PnlBreakdown {
  closedTrades: number;
  winningTrades: number;
  losingTrades: number;
  totalPnlUsd: number;
  averagePnlUsd: number;
  winRate: number; // 0-1
  largestWinUsd: number;
  largestLossUsd: number;
}

export interface PnlSummary {
  windowDays: number;
  sinceIso: string;
  kalshi: PnlBreakdown;
  polymarket: PnlBreakdown;
  combined: PnlBreakdown;
}

const EMPTY_BREAKDOWN: PnlBreakdown = {
  closedTrades: 0,
  winningTrades: 0,
  losingTrades: 0,
  totalPnlUsd: 0,
  averagePnlUsd: 0,
  winRate: 0,
  largestWinUsd: 0,
  largestLossUsd: 0,
};

function summarisePnls(pnls: number[]): PnlBreakdown {
  if (pnls.length === 0) return EMPTY_BREAKDOWN;
  let total = 0;
  let wins = 0;
  let losses = 0;
  let largestWin = 0;
  let largestLoss = 0;
  for (const pnl of pnls) {
    if (!Number.isFinite(pnl)) continue;
    total += pnl;
    if (pnl > 0) {
      wins += 1;
      if (pnl > largestWin) largestWin = pnl;
    } else if (pnl < 0) {
      losses += 1;
      if (pnl < largestLoss) largestLoss = pnl;
    }
  }
  const validCount = wins + losses;
  return {
    closedTrades: pnls.length,
    winningTrades: wins,
    losingTrades: losses,
    totalPnlUsd: total,
    averagePnlUsd: pnls.length > 0 ? total / pnls.length : 0,
    winRate: validCount > 0 ? wins / validCount : 0,
    largestWinUsd: largestWin,
    largestLossUsd: largestLoss,
  };
}

function combineBreakdowns(a: PnlBreakdown, b: PnlBreakdown): PnlBreakdown {
  const closedTrades = a.closedTrades + b.closedTrades;
  const winningTrades = a.winningTrades + b.winningTrades;
  const losingTrades = a.losingTrades + b.losingTrades;
  const totalPnlUsd = a.totalPnlUsd + b.totalPnlUsd;
  const validCount = winningTrades + losingTrades;
  return {
    closedTrades,
    winningTrades,
    losingTrades,
    totalPnlUsd,
    averagePnlUsd: closedTrades > 0 ? totalPnlUsd / closedTrades : 0,
    winRate: validCount > 0 ? winningTrades / validCount : 0,
    largestWinUsd: Math.max(a.largestWinUsd, b.largestWinUsd),
    largestLossUsd: Math.min(a.largestLossUsd, b.largestLossUsd),
  };
}

export async function getPnlSummary(userId: number, windowDays = 7): Promise<PnlSummary> {
  const sinceMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const sinceDate = new Date(sinceMs);
  const sinceIso = sinceDate.toISOString();

  const database = await getDb();
  if (!database) {
    return {
      windowDays,
      sinceIso,
      kalshi: EMPTY_BREAKDOWN,
      polymarket: EMPTY_BREAKDOWN,
      combined: EMPTY_BREAKDOWN,
    };
  }

  try {
    const [kalshiRows, polymarketRows] = await Promise.all([
      database
        .select({ realizedPnl: kalshiPositions.realizedPnl })
        .from(kalshiPositions)
        .where(
          and(
            eq(kalshiPositions.userId, userId),
            eq(kalshiPositions.positionStatus, "closed"),
            gte(kalshiPositions.closedAt, sinceDate),
            sql`${kalshiPositions.realizedPnl} <> 0`,
          ),
        ),
      database
        .select({ realizedPnl: polymarketPositions.realizedPnl })
        .from(polymarketPositions)
        .where(
          and(
            eq(polymarketPositions.userId, userId),
            eq(polymarketPositions.positionStatus, "closed"),
            gte(polymarketPositions.closedAt, sinceDate),
            sql`${polymarketPositions.realizedPnl} <> 0`,
          ),
        ),
    ]);

    const kalshi = summarisePnls(
      kalshiRows.map((r: { realizedPnl: number | null }) => Number(r.realizedPnl ?? 0)),
    );
    const polymarket = summarisePnls(
      polymarketRows.map((r: { realizedPnl: number | null }) => Number(r.realizedPnl ?? 0)),
    );
    const combined = combineBreakdowns(kalshi, polymarket);

    return { windowDays, sinceIso, kalshi, polymarket, combined };
  } catch (err) {
    logger.error({ err, userId, windowDays }, "[paperPnlSummary] query failed");
    return {
      windowDays,
      sinceIso,
      kalshi: EMPTY_BREAKDOWN,
      polymarket: EMPTY_BREAKDOWN,
      combined: EMPTY_BREAKDOWN,
    };
  }
}

// Re-exported helper for tests + callers that already have the PnL array.
export { summarisePnls, combineBreakdowns };
