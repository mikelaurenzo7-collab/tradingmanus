/**
 * Daily Sports Play — playground mode.
 *
 * Once per UTC day at the configured hour, picks the SINGLE highest-confidence
 * Kalshi sports market that passes the full ensemble + risk gate stack and
 * places a fixed-pct-of-bankroll trade on it. The trade flows through the
 * same calibration loop as everything else, so the system learns and evolves
 * over time per category × reviewer.
 *
 * This is intentionally distinct from the regular autonomy loop:
 *   - regular loop: opportunistic, multi-category, Kelly-sized
 *   - sports play : one shot per morning, sports-only, fixed-pct sized
 *
 * Both run; they don't conflict because the autonomy loop's
 * "no re-entry while position open" rule prevents double-trading.
 *
 * RISK ACKNOWLEDGED: This is a fixed-size daily play. Sports edge on Kalshi
 * is real but variance is high — treat any single day's outcome as noise.
 * Calibration runs weekly and will adjust EV thresholds based on observed
 * Brier scores. Drawdown breakers, exposure caps, MIN_NET_EV, and
 * MIN_CONFIDENCE_AFTER_ADJUST all still apply.
 */

import { ENV } from "./env";
import { logger } from "./logger";
import { fetchKalshiMarkets } from "./kalshiMarketData";
import {
  generateSignalsForMarkets,
  filterSignalsByConfidence,
} from "./kalshiSignals";
import { applyEnsembleFilter } from "./ensembleConsensus";
import { fetchKalshiAccountEquity } from "./kalshiAuth";
import { placeKalshiOrder } from "./kalshiExecution";
import { checkDrawdownBreaker } from "./drawdownBreaker";
import { getKalshiCredentials } from "../db.kalshi-credentials";
import {
  logAuditEvent,
  getOpenKalshiPositions,
  getPendingKalshiOrders,
  getTodayKalshiOrderCount,
  getTodayRealizedLoss,
  getKalshiTradeHistory,
} from "../db";

export interface DailySportsPlayResult {
  status:
    | "executed"
    | "no_signals"
    | "no_qualifying_play"
    | "drawdown_paused"
    | "credentials_missing"
    | "balance_unknown"
    | "exposure_capped"
    | "error"
    | "disabled";
  reason: string;
  marketId?: string;
  side?: "yes" | "no";
  count?: number;
  notionalUsd?: number;
  confidence?: number;
}

/**
 * Run the daily sports play for one user. Idempotent within a UTC day —
 * the cron tick guards against double-execution.
 */
export async function runDailySportsPlay(
  userId: number,
): Promise<DailySportsPlayResult> {
  if (!ENV.enableDailySportsPlay) {
    return {
      status: "disabled",
      reason: "ENABLE_DAILY_SPORTS_PLAY is not set",
    };
  }

  // Load credentials FIRST — without them we can't size or execute.
  const creds = await getKalshiCredentials(userId).catch(() => null);
  if (
    !creds ||
    ("needsReauth" in creds && creds.needsReauth) ||
    !("apiKey" in creds) ||
    !creds.apiKey ||
    !creds.privateKey
  ) {
    return {
      status: "credentials_missing",
      reason: "Kalshi credentials missing or stale; reconnect required",
    };
  }

  // Live equity for sizing. Refuse to trade if we can't read it.
  const equityResult = await fetchKalshiAccountEquity(
    creds.apiKey,
    creds.privateKey,
  );
  if (equityResult.error || !Number.isFinite(equityResult.equity) || equityResult.equity <= 0) {
    return {
      status: "balance_unknown",
      reason: `Live equity refresh failed: ${equityResult.error ?? "non-positive balance"}`,
    };
  }
  const liveCapitalUsd = equityResult.equity;
  const stakeUsd = liveCapitalUsd * ENV.dailySportsPlayPctOfCapital;

  // Fetch markets, filter to sports, pick from the most-liquid subset.
  const allMarkets = await fetchKalshiMarkets({ status: "open" });
  const sportsMarkets = allMarkets.filter(
    (m) => (m.category ?? "").toLowerCase() === "sports",
  );

  if (sportsMarkets.length === 0) {
    return {
      status: "no_signals",
      reason: "No open Kalshi sports markets discovered",
    };
  }

  // Generate signals (heuristic), then filter to high-confidence + clear-rules.
  const allSignals = await generateSignalsForMarkets(sportsMarkets);
  const confidenceFiltered = filterSignalsByConfidence(
    allSignals,
    ENV.profitGuardrails.minConfidenceAfterAdjust,
  );
  if (confidenceFiltered.length === 0) {
    return {
      status: "no_signals",
      reason: "No sports signals cleared the heuristic confidence floor",
    };
  }

  // Run them through the ensemble — Sonnet on high-stakes, Opus on
  // disagreement / catastrophic-bet. Returns approved + adjusted signals.
  const ensembleInputs = confidenceFiltered.map((sig) => {
    const market = sportsMarkets.find((m) => m.id === sig.marketId);
    const closeMs = market?.resolutionDate
      ? new Date(market.resolutionDate).getTime()
      : null;
    // Estimate the actual stake — for the sports play it's a FIXED 2.5%
    // (not Kelly), so the high-stakes detector should see the real number.
    const estimatedCount = Math.max(
      1,
      Math.floor(stakeUsd / Math.max(0.01, sig.marketPrice)),
    );
    return {
      marketId: sig.marketId,
      signalType: String(sig.signalType ?? "default"),
      ticker: sig.marketId,
      category: "sports" as const,
      side: sig.side,
      confidence: sig.confidence,
      impliedProbability: sig.impliedProbability,
      marketPrice: sig.marketPrice,
      expectedValue: sig.expectedValue,
      count: estimatedCount,
      resolutionAtMs: Number.isFinite(closeMs) && closeMs !== null ? closeMs : null,
      resolutionPrimary: market?.description ?? null,
      resolutionSecondary: null,
    };
  });

  const ensembleResult = await applyEnsembleFilter(ensembleInputs, {
    liveCapitalUsd,
  });

  if (ensembleResult.approvedSignals.length === 0) {
    return {
      status: "no_qualifying_play",
      reason: "All sports candidates vetoed by ensemble (Sonnet/Opus)",
    };
  }

  // Pick the top approved signal — highest confidence × |EV|.
  const top = ensembleResult.approvedSignals.slice().sort((a, b) => {
    const aScore = a.confidence * Math.max(0, a.expectedValue);
    const bScore = b.confidence * Math.max(0, b.expectedValue);
    return bScore - aScore;
  })[0];
  if (!top) {
    return {
      status: "no_qualifying_play",
      reason: "Ensemble approved 0 sports candidates",
    };
  }

  // ── Pre-execution risk gates ─────────────────────────────────────────────
  // Mirrors the regular autonomy candidate path. Without these checks
  // `placeKalshiOrder` only normalizes + submits the order; the dollar caps,
  // exposure caps, drawdown breakers, daily order cap, and same-market
  // re-entry rules all live in the autonomy hot path. Inline them here so
  // the daily play never trades when the regular executor would block the
  // same market.
  const [
    openPositions,
    pendingOrders,
    todayOrderCount,
    todayRealizedLoss,
    closedTrades7d,
  ] = await Promise.all([
    getOpenKalshiPositions(userId).catch(() => [] as any[]),
    getPendingKalshiOrders(userId).catch(() => [] as any[]),
    getTodayKalshiOrderCount(userId).catch(() => 0),
    getTodayRealizedLoss(userId).catch(() => 0),
    getKalshiTradeHistory(500, userId)
      .then((rows: any[]) =>
        rows.filter((t: any) => {
          if (t.positionStatus !== "closed") return false;
          const closedAt = t.closedAt ? new Date(t.closedAt).getTime() : 0;
          return closedAt > Date.now() - 7 * 24 * 60 * 60 * 1000;
        }),
      )
      .catch(() => [] as any[]),
  ]);

  // Any side already open on the same market? Block on marketId alone —
  // a YES + NO on the same Kalshi contract is a structural error
  // (you'd be hedged for no reason and pay double fees), not just a
  // same-side conflict. Mirrors the autonomy candidate path's rule.
  const hasOpenAnySide = openPositions.some(
    (p: any) =>
      p.marketId === top.marketId &&
      String(p.positionStatus).toLowerCase() !== "closed",
  );
  if (hasOpenAnySide) {
    return {
      status: "no_qualifying_play",
      reason: `Already have an open position on ${top.marketId} (any side)`,
    };
  }

  // Any pending order on the same market? Block by marketId alone — the
  // autonomy candidate path does the same. A YES + NO pending pair on
  // the same Kalshi contract creates double-fill exposure (both can fill
  // and you end up paying double fees on a hedged position).
  const hasPending = pendingOrders.some(
    (o: any) =>
      o.marketId === top.marketId &&
      String(o.status).toLowerCase() === "pending",
  );
  if (hasPending) {
    return {
      status: "no_qualifying_play",
      reason: `Already have a pending order on ${top.marketId} (any side)`,
    };
  }

  // Drawdown breaker (same 4 rules: daily, weekly, cold-streak count, edge).
  const weeklyPnlUsd = closedTrades7d.reduce(
    (acc: number, t: any) => acc + Number(t.realizedPnl ?? 0),
    0,
  );
  const newestFirst = [...closedTrades7d].sort((a: any, b: any) => {
    const aTs = a.closedAt ? new Date(a.closedAt).getTime() : 0;
    const bTs = b.closedAt ? new Date(b.closedAt).getTime() : 0;
    return bTs - aTs;
  });
  let consecutiveLosses = 0;
  for (const t of newestFirst) {
    if (Number(t.realizedPnl ?? 0) < 0) consecutiveLosses += 1;
    else break;
  }
  const weeklyNotional = closedTrades7d.reduce(
    (acc: number, t: any) =>
      acc + Number(t.entryPrice ?? 0) * Number(t.quantity ?? 0),
    0,
  );
  const weeklyRealizedEdgePct =
    weeklyNotional > 0 ? weeklyPnlUsd / weeklyNotional : 1;

  const drawdown = checkDrawdownBreaker({
    capitalUsd: liveCapitalUsd,
    todayPnlUsd: -Number(todayRealizedLoss ?? 0),
    weeklyPnlUsd,
    consecutiveLosses,
    weeklyRealizedEdgePct,
  });
  if (!drawdown.allowed) {
    return { status: "drawdown_paused", reason: drawdown.reason };
  }

  // Total open exposure cap.
  const currentExposureUsd = openPositions.reduce(
    (acc: number, p: any) =>
      acc + Number(p.entryPrice ?? 0) * Number(p.quantity ?? 0),
    0,
  );
  const maxPortfolioUsd =
    liveCapitalUsd * ENV.profitGuardrails.maxPortfolioExposurePct;
  if (currentExposureUsd + stakeUsd > maxPortfolioUsd) {
    return {
      status: "exposure_capped",
      reason: `Total exposure $${(currentExposureUsd + stakeUsd).toFixed(2)} would exceed ${(ENV.profitGuardrails.maxPortfolioExposurePct * 100).toFixed(0)}% cap ($${maxPortfolioUsd.toFixed(2)})`,
    };
  }

  // Per-category (sports) exposure cap.
  // `kalshiPositions` has no category column, so we can't read it off
  // the position row. Cross-reference against the open-Kalshi-markets
  // list we just fetched + (for safety) all open Kalshi markets, since
  // an open sports position might be on a market that's no longer in
  // our top-N sports-markets cache.
  const sportsMarketIds = new Set(
    sportsMarkets.map((m) => String(m.id)),
  );
  // Also include any market in `allMarkets` whose category is "sports"
  // — `sportsMarkets` was already filtered to that, but `allMarkets`
  // covers the wider universe in case our local cache was bounded.
  for (const m of allMarkets) {
    if ((m.category ?? "").toLowerCase() === "sports") {
      sportsMarketIds.add(String(m.id));
    }
  }
  const sportsExposureUsd = openPositions.reduce((acc: number, p: any) => {
    if (!sportsMarketIds.has(String(p.marketId))) return acc;
    return acc + Number(p.entryPrice ?? 0) * Number(p.quantity ?? 0);
  }, 0);
  const maxCategoryUsd =
    liveCapitalUsd * ENV.profitGuardrails.maxCorrelatedGroupPct;
  if (sportsExposureUsd + stakeUsd > maxCategoryUsd) {
    return {
      status: "exposure_capped",
      reason: `Sports exposure $${(sportsExposureUsd + stakeUsd).toFixed(2)} would exceed ${(ENV.profitGuardrails.maxCorrelatedGroupPct * 100).toFixed(0)}% per-category cap ($${maxCategoryUsd.toFixed(2)})`,
    };
  }

  // Daily order count cap (uses the env-default global cap; per-user
  // preferences for maxDailyOrders aren't loaded here).
  const dailyOrderCap = 50; // sane upper bound; per-user override not loaded
  if (todayOrderCount >= dailyOrderCap) {
    return {
      status: "no_qualifying_play",
      reason: `Daily order count ${todayOrderCount} ≥ cap ${dailyOrderCap}`,
    };
  }

  // Compute final count from stake. If stake can't even buy one contract,
  // skip — forcing a 1-contract floor would silently exceed the configured
  // 2.5 % cap (especially on high-priced markets or small accounts).
  const rawCount = Math.floor(stakeUsd / Math.max(0.01, top.marketPrice));
  if (rawCount < 1) {
    return {
      status: "no_qualifying_play",
      reason: `Stake $${stakeUsd.toFixed(2)} cannot buy one contract at $${top.marketPrice.toFixed(2)} on ${top.marketId}`,
    };
  }
  const finalCount = rawCount;
  // Recompute true notional based on integer count + market price, then
  // re-check the exposure caps. The earlier checks used `stakeUsd` (the
  // intended target); rounding down to integer contracts can leave us
  // BELOW or above stake, but if it pushes us above the per-category /
  // total cap, we need to catch that here too.
  const trueNotionalUsd = finalCount * top.marketPrice;
  if (currentExposureUsd + trueNotionalUsd > maxPortfolioUsd) {
    return {
      status: "exposure_capped",
      reason: `True notional $${(currentExposureUsd + trueNotionalUsd).toFixed(2)} would exceed ${(ENV.profitGuardrails.maxPortfolioExposurePct * 100).toFixed(0)}% portfolio cap ($${maxPortfolioUsd.toFixed(2)})`,
    };
  }
  if (sportsExposureUsd + trueNotionalUsd > maxCategoryUsd) {
    return {
      status: "exposure_capped",
      reason: `True sports notional $${(sportsExposureUsd + trueNotionalUsd).toFixed(2)} would exceed ${(ENV.profitGuardrails.maxCorrelatedGroupPct * 100).toFixed(0)}% per-category cap ($${maxCategoryUsd.toFixed(2)})`,
    };
  }

  await logAuditEvent(
    "kalshi_daily_sports_play_attempt",
    JSON.stringify({
      userId,
      marketId: top.marketId,
      side: top.side,
      count: finalCount,
      stakeUsd,
      pctOfCapital: ENV.dailySportsPlayPctOfCapital,
      liveCapitalUsd,
      confidence: top.confidence,
      expectedValue: top.expectedValue,
      reasoning: ensembleResult.verdicts.find((v) => v.marketId === top.marketId)
        ?.ensemble.reasoning,
    }),
    `user:${userId}`,
  ).catch(() => {});

  // Place the order via the existing risk-gate stack — drawdown breaker,
  // exposure caps, daily-loss backstop, per-user mutex all still apply.
  // We size at 2.5 % regardless of Kelly's recommendation; Kelly's cap
  // (4 % default) means 2.5 % is below the per-position ceiling, but
  // exposure caps may still veto if the operator already has open sports
  // positions accumulating to the per-category limit.
  const result = await placeKalshiOrder(
    userId,
    top.marketId,
    top.side,
    finalCount,
    Math.max(0.01, top.marketPrice),
  ).catch((err) => ({ success: false, error: err instanceof Error ? err.message : String(err) }));

  if (!("success" in result) || !result.success) {
    const err = "error" in result ? result.error : "unknown failure";
    await logAuditEvent(
      "kalshi_daily_sports_play_blocked",
      JSON.stringify({
        userId,
        marketId: top.marketId,
        side: top.side,
        reason: err,
      }),
      `user:${userId}`,
    ).catch(() => {});
    // Common cases the executor returns: drawdown_breaker / exposure_capped /
    // already-have-position. Map "drawdown" specifically; everything else
    // → "error" with the executor's reason as detail.
    if (typeof err === "string" && /drawdown|cold[ _-]?streak/i.test(err)) {
      return { status: "drawdown_paused", reason: err };
    }
    if (typeof err === "string" && /exposure|cap|position[ _-]?size/i.test(err)) {
      return { status: "exposure_capped", reason: err };
    }
    return { status: "error", reason: typeof err === "string" ? err : "executor blocked the trade" };
  }

  await logAuditEvent(
    "kalshi_daily_sports_play_executed",
    JSON.stringify({
      userId,
      marketId: top.marketId,
      side: top.side,
      count: finalCount,
      stakeUsd,
      pctOfCapital: ENV.dailySportsPlayPctOfCapital,
      liveCapitalUsd,
      confidence: top.confidence,
      expectedValue: top.expectedValue,
    }),
    `user:${userId}`,
  ).catch(() => {});

  logger.info(
    {
      userId,
      marketId: top.marketId,
      side: top.side,
      count: finalCount,
      stakeUsd,
      pctOfCapital: ENV.dailySportsPlayPctOfCapital,
      confidence: top.confidence,
    },
    "[DailySportsPlay] executed",
  );

  return {
    status: "executed",
    reason: "Daily sports play placed",
    marketId: top.marketId,
    side: top.side,
    count: finalCount,
    notionalUsd: stakeUsd,
    confidence: top.confidence,
  };
}
