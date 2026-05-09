/**
 * Daily Moonshot Play — aggressive playground mode.
 *
 * Once per UTC day at the configured hour, picks the SINGLE highest-edge
 * Kalshi underdog (any category) priced ≤ DAILY_MOONSHOT_MAX_PRICE where
 * the AI sees materially more probability than the market is pricing.
 * Sized at DAILY_MOONSHOT_PCT_OF_CAPITAL (default 1.5 % of bankroll —
 * lottery-ticket discipline; most expire worthless).
 *
 * Selection logic (vs the daily sports play):
 *   - Category: ANY (sports, politics, weather, crypto, etc.)
 *   - Price filter: marketPrice ≤ DAILY_MOONSHOT_MAX_PRICE
 *   - Probability ratio: AI confidence ≥ MIN_PROB_RATIO × market implied
 *     (default 1.5× — market thinks 10%, AI thinks ≥15%)
 *   - Net-EV floor: DAILY_MOONSHOT_MIN_NET_EV (default 15 %, STRICTER
 *     than the main 5 % floor). The earlier 4 % floor was inert because
 *     real moonshots produce 30-50 %+ net EV by structure (low contract
 *     price × decent edge ratio = huge per-dollar EV). 15 % filters out
 *     marginal candidates that just barely cleared the prob-ratio gate.
 *   - Side: typically YES (the underdog is "this unlikely thing happens").
 *     NO-side moonshots also work if the AI sees the favorite is
 *     overpriced — selection logic handles both.
 *
 * Ranking: top by `(confidence / impliedProbability) × payout_multiple`,
 * i.e., the trade with the biggest edge-vs-implied ratio AND the biggest
 * payout if it hits. This is the "best lottery ticket" objective.
 *
 * Same risk gates as the daily sports play (no-reentry, drawdown breaker,
 * exposure caps, per-category cap, daily order count, fail-closed on DB
 * read failures). The per-category exposure cap means moonshots can't
 * stack inside one category — if you've already deployed 10 % into
 * politics from the autonomy loop, the moonshot scanner won't add a
 * political moonshot today.
 *
 * RISK ACKNOWLEDGED: This is a lottery ticket. Even with positive EV,
 * individual moonshots lose 70-90 % of the time. The strategy works only
 * over many tickets — variance smooths to expectation eventually. Do not
 * size up because one hit early.
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
import { calculateNetEv } from "./feeCalculator";
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

export interface DailyMoonshotPlayResult {
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
  impliedProbability?: number;
  payoutMultiple?: number;
}

export async function runDailyMoonshotPlay(
  userId: number,
): Promise<DailyMoonshotPlayResult> {
  // Anchor playDate to run-start so a long AI-review pass that crosses
  // UTC midnight doesn't write the pick under tomorrow's date and drift
  // off the (userId, platform, playType, playDate) idempotency key.
  const runStartedAt = new Date();
  const runPlayDate = runStartedAt.toISOString().slice(0, 10);
  const auditActor = `user:${userId}`;
  const auditSkip = (reason: string) =>
    logAuditEvent(
      "kalshi_daily_moonshot_play_skipped",
      JSON.stringify({ userId, runPlayDate, reason }),
      auditActor,
    ).catch(() => {});
  if (!ENV.enableDailyMoonshot) {
    return {
      status: "disabled",
      reason: "ENABLE_DAILY_MOONSHOT is not set",
    };
  }

  // Honor the user's trading-preferences arm/disarm switch (mirrors the
  // autonomy path's shouldSkipScheduledRun gates).
  const prefs = await getTradingPreferences(userId).catch(() => null);
  if (!prefs || !prefs.liveTradingEnabled) {
    await auditSkip("liveTradingEnabled=0 — operator has disarmed live trading");
    return {
      status: "disabled",
      reason: "liveTradingEnabled=0 — operator has disarmed live trading",
    };
  }
  if (prefs.autonomyMode === "manual") {
    await auditSkip("autonomyMode=manual — operator opt-out of automated trading");
    return {
      status: "disabled",
      reason: "autonomyMode=manual — operator opt-out of automated trading",
    };
  }
  if (prefs.executionCadence === "manual_only") {
    await auditSkip("executionCadence=manual_only — operator opt-out of cron-driven trades");
    return {
      status: "disabled",
      reason: "executionCadence=manual_only — operator opt-out of cron-driven trades",
    };
  }

  const creds = await getKalshiCredentials(userId).catch(() => null);
  if (
    !creds ||
    ("needsReauth" in creds && creds.needsReauth) ||
    !("apiKey" in creds) ||
    !creds.apiKey ||
    !creds.privateKey
  ) {
    await auditSkip("Kalshi credentials missing or stale; reconnect required");
    return {
      status: "credentials_missing",
      reason: "Kalshi credentials missing or stale; reconnect required",
    };
  }

  const equityResult = await fetchKalshiAccountEquity(
    creds.apiKey,
    creds.privateKey,
  );
  if (
    equityResult.error ||
    !Number.isFinite(equityResult.equity) ||
    equityResult.equity <= 0
  ) {
    await auditSkip(`Live equity refresh failed: ${equityResult.error ?? "non-positive balance"}`);
    return {
      status: "balance_unknown",
      reason: `Live equity refresh failed: ${equityResult.error ?? "non-positive balance"}`,
    };
  }
  const liveCapitalUsd = equityResult.equity;
  const stakeUsd = liveCapitalUsd * ENV.dailyMoonshotPctOfCapital;

  const allMarkets = await fetchKalshiMarkets({ status: "open" });
  // Underdog filter: market priced ≤ MAX_PRICE on the YES side.
  // For NO-side moonshots (overpriced favorites where AI sees them as
  // overvalued), the YES price would be ≥ 1 - MAX_PRICE. Both directions
  // count as moonshots.
  const moonshotCandidateMarkets = allMarkets.filter((m) => {
    const yesPrice = Number(m.yesPrice ?? 0);
    return (
      yesPrice <= ENV.dailyMoonshotMaxPrice ||
      yesPrice >= 1 - ENV.dailyMoonshotMaxPrice
    );
  });
  if (moonshotCandidateMarkets.length === 0) {
    return {
      status: "no_signals",
      reason: `No open markets priced ≤ ${ENV.dailyMoonshotMaxPrice} or ≥ ${1 - ENV.dailyMoonshotMaxPrice}`,
    };
  }

  // Generate heuristic signals on the underdog universe.
  const allSignals = await generateSignalsForMarkets(moonshotCandidateMarkets);
  const confidenceFiltered = filterSignalsByConfidence(
    allSignals,
    ENV.profitGuardrails.minConfidenceAfterAdjust,
  );
  if (confidenceFiltered.length === 0) {
    return {
      status: "no_signals",
      reason: "No moonshot candidates cleared the heuristic confidence floor",
    };
  }

  // Probability-ratio filter — AI confidence must be materially higher
  // than market implied (default 1.5× → market 10 %, AI ≥ 15 %).
  // For NO-side trades, "winning" means YES doesn't resolve, so the
  // relevant probabilities flip. Compute side-aware "edge ratio" =
  // p(this side wins per AI) / p(this side wins per market).
  const moonshotFiltered = confidenceFiltered.filter((sig) => {
    const aiWinProb = sig.confidence;
    const marketWinProb =
      sig.side === "yes"
        ? Math.max(0.001, sig.impliedProbability)
        : Math.max(0.001, 1 - sig.impliedProbability);
    const ratio = aiWinProb / marketWinProb;
    return ratio >= ENV.dailyMoonshotMinProbRatio;
  });
  if (moonshotFiltered.length === 0) {
    return {
      status: "no_signals",
      reason: `No candidates with AI/implied probability ratio ≥ ${ENV.dailyMoonshotMinProbRatio}`,
    };
  }

  // Run real Tier-1 AI reviewer FIRST (Claude Sonnet by default, or Grok
  // in legacy mode). Without this the ensemble post-filter fabricates a
  // Tier-1 approval and low-stakes moonshots bypass real review.
  const reviewedSignals = await reviewSignalsWithTrader(
    {
      markets: moonshotCandidateMarkets,
      signals: moonshotFiltered,
      maxSignals: moonshotFiltered.length,
    },
    { userId },
  );
  if (reviewedSignals.length === 0) {
    return {
      status: "no_qualifying_play",
      reason: "All moonshot candidates vetoed by primary AI reviewer (Tier 1)",
    };
  }

  // Ensemble post-filter for high-stakes / catastrophic-bet escalation.
  // For 1.5 %-of-capital sizing, most moonshots will be classified as
  // low-stakes and the ensemble's "trust Tier 1" branch fires — which is
  // legit since we just ran the real reviewer.
  const ensembleInputs = reviewedSignals.map((sig) => {
    const market = moonshotCandidateMarkets.find((m) => m.id === sig.marketId);
    const closeMs = market?.resolutionDate
      ? new Date(market.resolutionDate).getTime()
      : null;
    const estimatedCount = Math.max(
      1,
      Math.floor(stakeUsd / Math.max(0.01, sig.marketPrice)),
    );
    return {
      marketId: sig.marketId,
      signalType: String(sig.signalType ?? "default"),
      ticker: sig.marketId,
      category: String(market?.category ?? "other"),
      side: sig.side,
      confidence: sig.confidence,
      impliedProbability: sig.impliedProbability,
      marketPrice: sig.marketPrice,
      expectedValue: sig.expectedValue,
      count: estimatedCount,
      resolutionAtMs:
        Number.isFinite(closeMs) && closeMs !== null ? closeMs : null,
      resolutionPrimary: market?.description ?? null,
      resolutionSecondary: null,
    };
  });

  const ensembleResult = await applyEnsembleFilter(ensembleInputs, {
    liveCapitalUsd,
  });

  // Emit `kalshi_ensemble_review` so getAiSpendSummary captures the AI
  // cost incurred by the moonshot. Without this, the dashboard's
  // pay-for-yourself math undercounts moonshot AI spend.
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
        source: "daily_moonshot_play",
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
      reason: "All moonshot candidates vetoed by ensemble (Sonnet/Opus)",
    };
  }

  // Apply LOOSER moonshot-specific net-EV floor (default 4 % vs main 6.5 %).
  // Moonshots are inherently low-sharpe; the main system floor would reject
  // every legitimate lottery ticket. Still rejects negative-EV trades.
  const moonshotApproved = ensembleResult.approvedSignals.filter((sig) => {
    // Composite-key match — multiple signals can exist per market.
    const verdict = ensembleResult.verdicts.find(
      (v) =>
        v.marketId === sig.marketId &&
        v.side === sig.side &&
        v.signalType === String(sig.signalType ?? "default"),
    );
    const ensembleCost = verdict?.ensemble.totalAiCostUsd ?? 0;
    const net = calculateNetEv({
      count: sig.count,
      entryPrice: sig.marketPrice,
      grossEvFraction: sig.expectedValue,
      amortizedAiCostUsd: ensembleCost,
    });
    return net.netEvFraction >= ENV.dailyMoonshotMinNetEv;
  });
  if (moonshotApproved.length === 0) {
    return {
      status: "no_qualifying_play",
      reason: `No candidate cleared moonshot MIN_NET_EV ${(ENV.dailyMoonshotMinNetEv * 100).toFixed(1)}% after AI cost`,
    };
  }

  // Pick top by best lottery-ticket score: edge_ratio × payout_multiple.
  // - Payout: signal.marketPrice is ALREADY the side-specific contract
  //   price (signal generator stores market.yesPrice for YES signals
  //   and market.noPrice for NO signals). Both pay $1 per contract on
  //   resolution, so payout = 1 / marketPrice for both sides. The
  //   earlier `1 / (1 - marketPrice)` for NO was wrong — turned a $0.10
  //   NO moonshot's true 10× payout into a 1.11× under-rank.
  // - Edge ratio: market's view of "this side wins" for NO is
  //   1 - YES_implied (impliedProbability is always YES).
  const top = moonshotApproved.slice().sort((a, b) => {
    const aPayout = 1 / Math.max(0.01, a.marketPrice);
    const bPayout = 1 / Math.max(0.01, b.marketPrice);
    const aMarketProb =
      a.side === "yes"
        ? Math.max(0.001, a.impliedProbability)
        : Math.max(0.001, 1 - a.impliedProbability);
    const bMarketProb =
      b.side === "yes"
        ? Math.max(0.001, b.impliedProbability)
        : Math.max(0.001, 1 - b.impliedProbability);
    const aEdge = a.confidence / aMarketProb;
    const bEdge = b.confidence / bMarketProb;
    return bEdge * bPayout - aEdge * aPayout;
  })[0];

  if (!top) {
    return {
      status: "no_qualifying_play",
      reason: "No moonshot survived the post-cost filter",
    };
  }

  // ── Pre-execution risk gates (mirrors the autonomy candidate path) ──────
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
      "[DailyMoonshotPlay] risk-state ledger reads failed; aborting (fail-closed)",
    );
    return {
      status: "error",
      reason: "Risk-state ledger reads failed; refusing to trade until DB is healthy",
    };
  }

  // No re-entry on same market (any side).
  const hasOpenAnySide = openPositions.some(
    (p: any) =>
      p.marketId === top.marketId &&
      String(p.positionStatus).toLowerCase() !== "closed",
  );
  if (hasOpenAnySide) {
    return {
      status: "no_qualifying_play",
      reason: `Already have an open position on ${top.marketId}`,
    };
  }

  // No pending order on same market (any side).
  const hasPending = pendingOrders.some(
    (o: any) =>
      o.marketId === top.marketId &&
      String(o.status).toLowerCase() === "pending",
  );
  if (hasPending) {
    return {
      status: "no_qualifying_play",
      reason: `Already have a pending order on ${top.marketId}`,
    };
  }

  // Drawdown breaker (daily, weekly, cold-streak, edge — all 4 rules).
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
    todayPnlUsd: -todayRealizedLoss,
    weeklyPnlUsd,
    consecutiveLosses,
    weeklyRealizedEdgePct,
  });
  if (!drawdown.allowed) {
    return { status: "drawdown_paused", reason: drawdown.reason };
  }

  // Exposure caps (total + per-category).
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
      reason: `Total exposure $${(currentExposureUsd + stakeUsd).toFixed(2)} would exceed portfolio cap $${maxPortfolioUsd.toFixed(2)}`,
    };
  }

  // Per-category cap. Cross-reference open positions against the markets
  // we fetched to find their category (kalshiPositions doesn't store it).
  const categoryById = new Map<string, string>();
  for (const m of allMarkets) {
    categoryById.set(String(m.id), String(m.category ?? "other").toLowerCase());
  }
  const targetCategory = String(top.category ?? "other").toLowerCase();
  const categoryExposureUsd = openPositions.reduce((acc: number, p: any) => {
    const posCategory = categoryById.get(String(p.marketId)) ?? "other";
    if (posCategory !== targetCategory) return acc;
    return acc + Number(p.entryPrice ?? 0) * Number(p.quantity ?? 0);
  }, 0);
  const maxCategoryUsd =
    liveCapitalUsd * ENV.profitGuardrails.maxCorrelatedGroupPct;
  if (categoryExposureUsd + stakeUsd > maxCategoryUsd) {
    return {
      status: "exposure_capped",
      reason: `${targetCategory} exposure $${(categoryExposureUsd + stakeUsd).toFixed(2)} would exceed per-category cap $${maxCategoryUsd.toFixed(2)}`,
    };
  }

  const dailyOrderCap = 50;
  if (todayOrderCount >= dailyOrderCap) {
    return {
      status: "no_qualifying_play",
      reason: `Daily order count ${todayOrderCount} ≥ cap ${dailyOrderCap}`,
    };
  }

  // Compute final integer count + re-check exposure with TRUE notional.
  const rawCount = Math.floor(stakeUsd / Math.max(0.01, top.marketPrice));
  if (rawCount < 1) {
    return {
      status: "no_qualifying_play",
      reason: `Stake $${stakeUsd.toFixed(2)} cannot buy one contract at $${top.marketPrice.toFixed(2)} on ${top.marketId}`,
    };
  }
  const finalCount = rawCount;
  const trueNotionalUsd = finalCount * top.marketPrice;
  if (currentExposureUsd + trueNotionalUsd > maxPortfolioUsd) {
    return {
      status: "exposure_capped",
      reason: `True notional would exceed portfolio cap`,
    };
  }
  if (categoryExposureUsd + trueNotionalUsd > maxCategoryUsd) {
    return {
      status: "exposure_capped",
      reason: `True notional would exceed ${targetCategory} per-category cap`,
    };
  }

  // Payout multiple = $1 / contract price. signal.marketPrice is the
  // side-specific contract price for both YES and NO trades.
  const payoutMultiple = 1 / Math.max(0.01, top.marketPrice);

  // Persist the entry signal to kalshiSignals BEFORE placing the order so
  // the calibration-outcome lookup at close-time can find it. Without
  // this, `logCalibrationOutcomeFromClose` falls back to default values
  // and corrupts Brier-score samples for every moonshot trade.
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
        "[DailyMoonshotPlay] saveSignals failed; calibration may use fallback values",
      );
    }
  }

  await logAuditEvent(
    "kalshi_daily_moonshot_play_attempt",
    JSON.stringify({
      userId,
      marketId: top.marketId,
      side: top.side,
      count: finalCount,
      stakeUsd,
      pctOfCapital: ENV.dailyMoonshotPctOfCapital,
      liveCapitalUsd,
      confidence: top.confidence,
      impliedProbability: top.impliedProbability,
      payoutMultiple,
      category: top.category,
      reasoning: ensembleResult.verdicts.find(
        (v) =>
          v.marketId === top.marketId &&
          v.side === top.side &&
          v.signalType === top.signalType,
      )?.ensemble.reasoning,
    }),
    `user:${userId}`,
  ).catch(() => {});

  // Per-user mutex wraps the order placement (same reasoning as the
  // sports play — daily plays don't run inside the autonomy's outer lock).
  const result = await withUserLock(userId, () =>
    placeKalshiOrder(
      userId,
      top.marketId,
      top.side,
      finalCount,
      Math.max(0.01, top.marketPrice),
    ),
  ).catch((err) => ({
    success: false,
    error: err instanceof Error ? err.message : String(err),
  }));

  if (!("success" in result) || !result.success) {
    const err = "error" in result ? result.error : "unknown failure";
    await logAuditEvent(
      "kalshi_daily_moonshot_play_blocked",
      JSON.stringify({
        userId,
        marketId: top.marketId,
        side: top.side,
        reason: err,
      }),
      `user:${userId}`,
    ).catch(() => {});
    if (typeof err === "string" && /drawdown|cold[ _-]?streak/i.test(err)) {
      return { status: "drawdown_paused", reason: err };
    }
    if (typeof err === "string" && /exposure|cap|position[ _-]?size/i.test(err)) {
      return { status: "exposure_capped", reason: err };
    }
    return {
      status: "error",
      reason: typeof err === "string" ? err : "executor blocked the trade",
    };
  }

  await logAuditEvent(
    "kalshi_daily_moonshot_play_executed",
    JSON.stringify({
      userId,
      marketId: top.marketId,
      side: top.side,
      count: finalCount,
      stakeUsd,
      pctOfCapital: ENV.dailyMoonshotPctOfCapital,
      liveCapitalUsd,
      confidence: top.confidence,
      impliedProbability: top.impliedProbability,
      payoutMultiple,
      category: top.category,
    }),
    `user:${userId}`,
  ).catch(() => {});

  // Persist the moonshot lifecycle row (best-effort).
  const playDate = runPlayDate;
  try {
    const pick = await insertDailyPlayPick({
      userId,
      platform: "kalshi",
      playType: "moonshot",
      playDate,
      marketId: top.marketId,
      side: top.side,
      stakeUsd: trueNotionalUsd,
      entryPrice: top.marketPrice,
      quantity: finalCount,
      confidence: top.confidence,
      expectedValue: top.expectedValue,
    });
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
              playType: "moonshot",
              marketId: top.marketId,
              playDate,
              linkedPositionId: match.id,
            });
          }
        } catch (err) {
          logger.debug({ err, userId, marketId: top.marketId }, "[DailyMoonshotPlay] deferred linkage failed");
        }
      }, 60_000).unref?.();
    }
  } catch (err) {
    logger.warn({ err, userId, marketId: top.marketId }, "[DailyMoonshotPlay] dailyPlayPicks insert failed");
  }

  logger.info(
    {
      userId,
      marketId: top.marketId,
      side: top.side,
      count: finalCount,
      stakeUsd,
      pctOfCapital: ENV.dailyMoonshotPctOfCapital,
      confidence: top.confidence,
      impliedProbability: top.impliedProbability,
      payoutMultiple,
    },
    "[DailyMoonshotPlay] executed",
  );

  return {
    status: "executed",
    reason: "Daily moonshot play placed",
    marketId: top.marketId,
    side: top.side,
    count: finalCount,
    notionalUsd: trueNotionalUsd,
    confidence: top.confidence,
    impliedProbability: top.impliedProbability,
    payoutMultiple,
  };
}
