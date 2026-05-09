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
  saveSignals,
} from "./kalshiSignals";
import { applyEnsembleFilter } from "./ensembleConsensus";
import { reviewSignalsWithTrader } from "./tradingReviewer";
import { fetchKalshiAccountEquity } from "./kalshiAuth";
import { placeKalshiOrder } from "./kalshiExecution";
import { withUserLock } from "./userMutex";
import { checkDrawdownBreaker } from "./drawdownBreaker";
import { getKalshiCredentials } from "../db.kalshi-credentials";
import { getTradingPreferences } from "../db.trading-preferences";
import {
  logAuditEvent,
  getOpenKalshiPositions,
  getPendingKalshiOrders,
  getTodayKalshiOrderCount,
  getTodayRealizedLoss,
  getKalshiTradeHistory,
} from "../db";
import {
  insertDailyPlayPick,
  linkPositionToPick,
} from "../db.daily-play-picks";

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
  // Anchor playDate to run-start so a long AI-review pass that crosses
  // UTC midnight doesn't write the pick under tomorrow's date and drift
  // off the (userId, platform, playType, playDate) idempotency key.
  const runPlayDate = new Date().toISOString().slice(0, 10);
  if (!ENV.enableDailySportsPlay) {
    return {
      status: "disabled",
      reason: "ENABLE_DAILY_SPORTS_PLAY is not set",
    };
  }

  // Honor the user's trading-preferences arm/disarm switch. The autonomy
  // path checks all three via shouldSkipScheduledRun; the daily play must
  // respect them too — a user who toggled liveTradingEnabled=0 or
  // autonomyMode=manual must NOT have a daily play placed.
  const prefs = await getTradingPreferences(userId).catch(() => null);
  if (!prefs || !prefs.liveTradingEnabled) {
    return {
      status: "disabled",
      reason: "liveTradingEnabled=0 — operator has disarmed live trading",
    };
  }
  if (prefs.autonomyMode === "manual") {
    return {
      status: "disabled",
      reason: "autonomyMode=manual — operator opt-out of automated trading",
    };
  }
  if (prefs.executionCadence === "manual_only") {
    return {
      status: "disabled",
      reason: "executionCadence=manual_only — operator opt-out of cron-driven trades",
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

  // CRITICAL: run the primary AI reviewer (Tier 1 = Claude Haiku) BEFORE
  // the ensemble post-filter. The ensemble
  // post-filter fabricates a Tier-1-approved verdict — it assumes the
  // autonomy candidate path already ran the real reviewer. Without this,
  // low-stakes sports picks (most of them at 2.5 % of bankroll) take the
  // ensemble's "low-stakes → trust Tier 1" branch immediately and never
  // see actual AI review.
  const reviewedSignals = await reviewSignalsWithTrader(
    {
      markets: sportsMarkets,
      signals: confidenceFiltered,
      maxSignals: confidenceFiltered.length,
    },
    { userId },
  );
  if (reviewedSignals.length === 0) {
    return {
      status: "no_qualifying_play",
      reason: "All sports candidates vetoed by primary AI reviewer (Tier 1)",
    };
  }

  // Run reviewer-approved signals through the ensemble for high-stakes /
  // catastrophic-bet escalation (Sonnet adversarial, Opus tiebreaker /
  // unanimous gate). The fabricated Tier-1 approval inside applyEnsembleFilter
  // is now legitimate because we just ran the real reviewer above.
  const ensembleInputs = reviewedSignals.map((sig) => {
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

  // Emit `kalshi_ensemble_review` so getAiSpendSummary captures the AI
  // cost incurred by the daily play. Without this, the dashboard's
  // pay-for-yourself math undercounts daily-play AI spend → false sense
  // of profitability.
  const totalAiCostUsd = ensembleResult.verdicts.reduce(
    (a, v) => a + (v.ensemble.totalAiCostUsd ?? 0),
    0,
  );
  if (ensembleResult.verdicts.length > 0) {
    await logAuditEvent(
      "kalshi_ensemble_review",
      JSON.stringify({
        liveCapitalUsd,
        totalCandidates: ensembleInputs.length,
        ensembleApproved: ensembleResult.approvedSignals.length,
        totalAiCostUsd,
        source: "daily_sports_play",
        verdicts: ensembleResult.verdicts.map((v) => ({
          marketId: v.marketId,
          approved: v.ensemble.approved,
          reasoning: v.ensemble.reasoning,
          reviewers: v.ensemble.reviews.map((r) => r.reviewerId),
        })),
      }),
      `user:${userId}`,
    ).catch(() => {});
  }

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
  // Fail-closed risk-state reads. Earlier version caught DB errors as
  // []/0, which made every gate evaluate "safe" on a transient outage and
  // the trade went through. The autonomy candidate path fails closed on
  // any of these — match that. ANY read failure aborts the play; next
  // 5-min tick within the configured hour retries.
  let openPositions: any[];
  let pendingOrders: any[];
  let todayOrderCount: number;
  let todayRealizedLoss: number;
  let closedTrades7d: any[];
  try {
    const [op, po, toc, trl, cth] = await Promise.all([
      getOpenKalshiPositions(userId),
      getPendingKalshiOrders(userId),
      getTodayKalshiOrderCount(userId),
      getTodayRealizedLoss(userId),
      getKalshiTradeHistory(500, userId).then((rows: any[]) =>
        rows.filter((t: any) => {
          if (t.positionStatus !== "closed") return false;
          const closedAt = t.closedAt ? new Date(t.closedAt).getTime() : 0;
          return closedAt > Date.now() - 7 * 24 * 60 * 60 * 1000;
        }),
      ),
    ]);
    openPositions = op as any[];
    pendingOrders = po as any[];
    todayOrderCount = Number(toc ?? 0);
    todayRealizedLoss = Number(trl ?? 0);
    closedTrades7d = cth as any[];
  } catch (err) {
    logger.warn(
      { err, userId },
      "[DailySportsPlay] risk-state ledger reads failed; aborting play (fail-closed)",
    );
    return {
      status: "error",
      reason: "Risk-state ledger reads failed; refusing to trade until DB is healthy",
    };
  }

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

  // Persist the entry signal to kalshiSignals BEFORE placing the order so
  // the calibration-outcome lookup at close-time can find it. Without
  // this, `logCalibrationOutcomeFromClose` falls back to default values
  // and corrupts Brier-score samples for every daily-play trade. Pull
  // the original reviewed signal record so we save the post-Tier-1
  // values, not the post-ensemble-adjusted ones (the entry sizing used
  // the post-ensemble values, but the reviewer's stated confidence/EV
  // is what calibration scores).
  const entrySignal = reviewedSignals.find(
    (rs) =>
      rs.marketId === top.marketId &&
      rs.side === top.side &&
      String(rs.signalType ?? "default") === top.signalType,
  );
  if (entrySignal) {
    try {
      await saveSignals([entrySignal], userId);
    } catch (err) {
      logger.warn(
        { err, marketId: top.marketId, userId },
        "[DailySportsPlay] saveSignals failed; calibration may use fallback values",
      );
    }
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
      reasoning: ensembleResult.verdicts.find(
        (v) =>
          v.marketId === top.marketId &&
          v.side === top.side &&
          v.signalType === top.signalType,
      )?.ensemble.reasoning,
    }),
    `user:${userId}`,
  ).catch(() => {});

  // Place the order via the existing risk-gate stack — drawdown breaker,
  // exposure caps, daily-loss backstop, per-user mutex all still apply.
  // We size at 2.5 % regardless of Kelly's recommendation; Kelly's cap
  // (4 % default) means 2.5 % is below the per-position ceiling, but
  // exposure caps may still veto if the operator already has open sports
  // positions accumulating to the per-category limit.
  // Per-user mutex wraps the order placement. The scheduled autonomy
  // path already holds this lock when it calls placeKalshiOrder; the
  // daily play does NOT come from inside that lock, so we acquire it
  // here. Without this, the daily play could race with autonomy or
  // tRPC for the same user (TOCTOU on positions/orders).
  const result = await withUserLock(userId, () =>
    placeKalshiOrder(
      userId,
      top.marketId,
      top.side,
      finalCount,
      Math.max(0.01, top.marketPrice),
    ),
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

  // Persist the pick lifecycle row.  Best-effort: the insert is idempotent
  // (ON CONFLICT DO NOTHING) and a DB hiccup must NEVER block a successful
  // order placement.  Linkage to the position row happens lazily via
  // linkPositionToPick once the order-sync surfaces the open position.
  const playDate = runPlayDate;
  try {
    const pick = await insertDailyPlayPick({
      userId,
      platform: "kalshi",
      playType: "sports",
      playDate,
      marketId: top.marketId,
      side: top.side,
      stakeUsd: trueNotionalUsd,
      entryPrice: top.marketPrice,
      quantity: finalCount,
      confidence: top.confidence,
      expectedValue: top.expectedValue,
      reasoning:
        ensembleResult.verdicts.find(
          (v) =>
            v.marketId === top.marketId &&
            v.side === top.side &&
            v.signalType === top.signalType,
        )?.ensemble.reasoning ?? null,
    });
    // Schedule a deferred linkage attempt at +60s — by then position-sync
    // should have surfaced the open position row.
    if (pick) {
      setTimeout(async () => {
        try {
          const positions = await getOpenKalshiPositions(userId);
          const match = (positions as Array<{ id: number; marketId: string }>).find(
            (p) => p.marketId === top.marketId,
          );
          if (match) {
            await linkPositionToPick({
              userId,
              platform: "kalshi",
              playType: "sports",
              marketId: top.marketId,
              playDate,
              linkedPositionId: match.id,
            });
          }
        } catch (err) {
          logger.debug({ err, userId, marketId: top.marketId }, "[DailySportsPlay] deferred linkage failed");
        }
      }, 60_000).unref?.();
    }
  } catch (err) {
    logger.warn({ err, userId, marketId: top.marketId }, "[DailySportsPlay] dailyPlayPicks insert failed");
  }

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
