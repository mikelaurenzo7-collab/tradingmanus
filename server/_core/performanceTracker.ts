/**
 * Performance tracker — logs every trade's predicted vs realized outcome and
 * the AI cost spent to produce it. Powers the dashboard's "Cost vs Profit",
 * "Per-Category ROI", and weekly-report tabs.
 *
 * Storage: append-only rows in the `auditLog` table under the
 * `kalshi_trade_outcome_log` event type. Each row carries:
 *   - tradeId, ticker, category
 *   - predictedEvFraction, predictedConfidence, predictedWinProbability
 *   - realizedPnlUsd, realizedReturnFraction
 *   - feeUsd, aiCostUsd
 *   - placedAtMs, settledAtMs
 *
 * Reads are cached for 60 s so the dashboard polls cheaply.
 */

import { logger } from "./logger";
import { logAuditEvent } from "../db";

export type TradeOutcomeRecord = {
  tradeId: string;
  ticker: string;
  category: string;
  side: "yes" | "no";
  count: number;
  entryPriceUsd: number;
  exitPriceUsd?: number;
  predictedEvFraction: number;
  predictedConfidence: number;
  predictedWinProbability: number;
  realizedPnlUsd: number;
  realizedReturnFraction: number;
  feeUsd: number;
  aiCostUsd: number;
  placedAtMs: number;
  settledAtMs: number;
  outcome: "win" | "loss" | "scratch";
};

export interface CategoryRollup {
  category: string;
  trades: number;
  wins: number;
  realizedPnlUsd: number;
  realizedReturnFraction: number;
  predictedEvFraction: number;
  edgeCapturedFraction: number;
  totalAiCostUsd: number;
  totalFeeUsd: number;
  costToProfitRatio: number;
}

export interface PerformanceSummary {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalRealizedPnlUsd: number;
  totalAiCostUsd: number;
  totalFeeUsd: number;
  totalNetPnlUsd: number;
  costToProfitRatio: number;
  byCategory: CategoryRollup[];
  weekly: {
    realizedEdgeFraction: number;
    consecutiveLosses: number;
    realizedPnlUsd: number;
  };
}

export async function logTradeOutcome(
  userId: number,
  outcome: TradeOutcomeRecord,
): Promise<void> {
  try {
    await logAuditEvent(
      "kalshi_trade_outcome_log",
      JSON.stringify({ userId, ...outcome }),
      String(userId),
    );
  } catch (err) {
    logger.warn({ err, tradeId: outcome.tradeId }, "[PerfTracker] log failed");
  }
}

let _summaryCache: { ts: number; data: PerformanceSummary | null } | null = null;
const SUMMARY_TTL_MS = 60_000;

export async function getPerformanceSummary(
  userId: number,
  options: { trailingDays?: number; force?: boolean } = {},
): Promise<PerformanceSummary | null> {
  const now = Date.now();
  if (
    !options.force &&
    _summaryCache &&
    now - _summaryCache.ts < SUMMARY_TTL_MS
  ) {
    return _summaryCache.data;
  }
  try {
    const rows = await fetchTradeOutcomeRows(userId, options.trailingDays ?? 30);
    if (rows.length === 0) {
      _summaryCache = { ts: now, data: null };
      return null;
    }

    const wins = rows.filter((r) => r.outcome === "win").length;
    const losses = rows.filter((r) => r.outcome === "loss").length;
    const realized = rows.reduce((acc, r) => acc + r.realizedPnlUsd, 0);
    // Phase 1 renamed `grokCostUsd` → `aiCostUsd`. Existing audit-log rows
    // written before Phase 1 still carry the legacy field name; coalesce so
    // historical rows don't surface `NaN` in the totals.
    const aiCostOf = (r: TradeOutcomeRecord): number => {
      const direct = Number(r.aiCostUsd);
      if (Number.isFinite(direct)) return direct;
      const legacy = Number((r as unknown as { grokCostUsd?: number }).grokCostUsd);
      return Number.isFinite(legacy) ? legacy : 0;
    };
    const aiCost = rows.reduce((acc, r) => acc + aiCostOf(r), 0);
    const feeUsd = rows.reduce((acc, r) => acc + r.feeUsd, 0);

    const byCategoryMap = new Map<string, TradeOutcomeRecord[]>();
    for (const r of rows) {
      const list = byCategoryMap.get(r.category) ?? [];
      list.push(r);
      byCategoryMap.set(r.category, list);
    }

    const byCategory: CategoryRollup[] = [];
    for (const [category, list] of byCategoryMap.entries()) {
      const cWins = list.filter((r) => r.outcome === "win").length;
      const cReal = list.reduce((a, r) => a + r.realizedPnlUsd, 0);
      const cFee = list.reduce((a, r) => a + r.feeUsd, 0);
      const cAi = list.reduce((a, r) => a + aiCostOf(r), 0);
      const cPredictedEv =
        list.reduce((a, r) => a + r.predictedEvFraction, 0) / list.length;
      const cReturnFrac =
        list.reduce((a, r) => a + r.realizedReturnFraction, 0) / list.length;
      const edgeCaptured =
        cPredictedEv === 0 ? 0 : Math.min(1.5, cReturnFrac / cPredictedEv);
      byCategory.push({
        category,
        trades: list.length,
        wins: cWins,
        realizedPnlUsd: cReal,
        realizedReturnFraction: cReturnFrac,
        predictedEvFraction: cPredictedEv,
        edgeCapturedFraction: edgeCaptured,
        totalAiCostUsd: cAi,
        totalFeeUsd: cFee,
        costToProfitRatio:
          cReal <= 0 ? Number.POSITIVE_INFINITY : (cAi + cFee) / cReal,
      });
    }
    byCategory.sort((a, b) => b.realizedPnlUsd - a.realizedPnlUsd);

    const sevenDaysAgoMs = now - 7 * 24 * 60 * 60 * 1000;
    const weeklyRows = rows.filter((r) => r.settledAtMs >= sevenDaysAgoMs);
    const weeklyPnl = weeklyRows.reduce((a, r) => a + r.realizedPnlUsd, 0);
    const weeklyNotional = weeklyRows.reduce(
      (a, r) => a + Math.abs(r.entryPriceUsd * r.count),
      0,
    );
    const weeklyEdgeFraction =
      weeklyNotional > 0 ? weeklyPnl / weeklyNotional : 0;

    let consecutiveLosses = 0;
    const sortedDesc = [...rows].sort((a, b) => b.settledAtMs - a.settledAtMs);
    for (const r of sortedDesc) {
      if (r.outcome === "loss") consecutiveLosses += 1;
      else break;
    }

    const data: PerformanceSummary = {
      totalTrades: rows.length,
      wins,
      losses,
      winRate: rows.length > 0 ? wins / rows.length : 0,
      totalRealizedPnlUsd: realized,
      totalAiCostUsd: aiCost,
      totalFeeUsd: feeUsd,
      totalNetPnlUsd: realized - aiCost - feeUsd,
      costToProfitRatio:
        realized <= 0
          ? Number.POSITIVE_INFINITY
          : (aiCost + feeUsd) / realized,
      byCategory,
      weekly: {
        realizedEdgeFraction: weeklyEdgeFraction,
        consecutiveLosses,
        realizedPnlUsd: weeklyPnl,
      },
    };
    _summaryCache = { ts: now, data };
    return data;
  } catch (err) {
    logger.warn({ err, userId }, "[PerfTracker] summary fetch failed");
    return null;
  }
}

async function fetchTradeOutcomeRows(
  userId: number,
  trailingDays: number,
): Promise<TradeOutcomeRecord[]> {
  // Late-import drizzle to avoid pulling the schema into test bootstraps.
  const { getDb } = await import("../db");
  const { auditLog } = await import("../../drizzle/schema");
  const { eq, and, gte, desc } = await import("drizzle-orm");
  const database = await getDb();
  if (!database) return [];

  const sinceMs = Date.now() - trailingDays * 24 * 60 * 60 * 1000;
  const sinceDate = new Date(sinceMs);

  const rows = await database
    .select({ details: auditLog.details, createdAt: auditLog.createdAt })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.triggeredByOpenId, String(userId)),
        eq(auditLog.eventType, "kalshi_trade_outcome_log"),
        gte(auditLog.createdAt, sinceDate),
      ),
    )
    .orderBy(desc(auditLog.createdAt));

  const decoded: TradeOutcomeRecord[] = [];
  for (const row of rows) {
    let payload: unknown = null;
    try {
      payload = row.details ? JSON.parse(row.details) : null;
    } catch {
      // skip malformed rows
    }
    if (payload && typeof payload === "object") {
      decoded.push(payload as TradeOutcomeRecord);
    }
  }
  return decoded;
}

export function _resetPerformanceCacheForTests(): void {
  _summaryCache = null;
}
