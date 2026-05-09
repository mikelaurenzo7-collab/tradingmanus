/**
 * Polymarket Daily Sports Play — playground mode (mirrors dailySportsPlay.ts).
 *
 * Once per UTC day at the configured hour, picks the SINGLE highest-EV
 * Polymarket sports market that passes the AI reviewer + risk gate stack
 * and places a fixed-pct-of-bankroll BUY on it.  Reuses the operator's
 * `tradingPreferences.{liveTradingEnabled, autonomyMode, executionCadence}`
 * gates — the same kill-switch arms BOTH the Kalshi and Polymarket daily
 * plays uniformly.
 *
 * Bankroll proxy: Polymarket has no public balance API for the proxy
 * wallet, so we currently size off Kalshi capital as a proxy.  This is
 * documented in the plan (`sparkling-churning-dusk.md` §"Bankroll proxy").
 * Future improvement: poll USDC balance on Polygon and use that directly.
 *
 * Risk gates (mirror polymarketAutonomy.ts):
 *   - existing-position check on (marketId, tokenId)
 *   - drawdown breaker via 7-day closed-trade history
 *   - portfolio exposure cap
 *   - per-category sports exposure cap
 *   - daily order count cap
 */

import { ENV } from "./env";
import { logger } from "./logger";
import { fetchPolymarketMarkets, placePolymarketOrder } from "./polymarketAuth";
import { generatePolymarketSignals } from "./polymarketSignals";
import { reviewPolymarketSignalsWithTrader } from "./polymarketSignalReviewer";
import { simulatePolymarketOrderFill } from "./paperTrading";
import { withUserLock } from "./userMutex";
import { getEffectivePaperTradeMode } from "./effectivePaperMode";
import { checkDrawdownBreaker } from "./drawdownBreaker";
import { classifyMarketCategory } from "./marketCategoryRouter";
import * as polymarketCredDb from "../db.polymarket-credentials";
import { getTradingPreferences } from "../db.trading-preferences";
import {
  getOpenPolymarketPositions,
  getPolymarketPositions,
  getTodayPolymarketOrderCount,
} from "../db.polymarket";
import { getKalshiCapital, logAuditEvent } from "../db";
import {
  insertDailyPlayPick,
  linkPositionToPick,
  voidDailyPlayPick,
} from "../db.daily-play-picks";

export interface PolymarketDailySportsPlayResult {
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
  tokenId?: string;
  side?: "yes" | "no";
  sizeUsdc?: number;
  confidence?: number;
}

/**
 * Run the Polymarket daily sports play for one user.  Idempotent within a
 * UTC day — the cron tick + DB unique index both guard against double-fire.
 */
export async function runPolymarketDailySportsPlay(
  userId: number,
): Promise<PolymarketDailySportsPlayResult> {
  // Anchor playDate to run-start so a long AI-review pass that crosses
  // UTC midnight doesn't write the pick under tomorrow's date and drift
  // off the (userId, platform, playType, playDate) idempotency key.
  const runPlayDate = new Date().toISOString().slice(0, 10);

  if (!ENV.enablePolymarketDailySportsPlay) {
    return {
      status: "disabled",
      reason: "ENABLE_POLYMARKET_DAILY_SPORTS_PLAY is not set",
    };
  }

  // Honor per-user trading-preferences arm/disarm.  Same gate as Kalshi
  // daily play so a single liveTradingEnabled=0 toggles BOTH platforms off.
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

  // Honor the per-user maxDailyOrders cap so the daily play doesn't slip
  // an extra order through when the autonomy loop has already exhausted
  // today's Polymarket budget.  Same per-platform interpretation Kalshi
  // uses (the autonomy loop checks getTodayKalshiOrderCount independently).
  const polymarketOrdersToday = await getTodayPolymarketOrderCount(userId).catch(() => 0);
  if (polymarketOrdersToday >= prefs.maxDailyOrders) {
    return {
      status: "disabled",
      reason: `Polymarket daily order cap reached (${polymarketOrdersToday}/${prefs.maxDailyOrders})`,
    };
  }

  // Connection + credentials check.
  const connected = await polymarketCredDb.isPolymarketConnected(userId).catch(() => false);
  if (!connected) {
    return {
      status: "credentials_missing",
      reason: "Polymarket account not connected",
    };
  }
  const creds = await polymarketCredDb.getPolymarketCredentials(userId).catch(() => null);
  if (!creds || creds.accountStatus !== "connected") {
    return {
      status: "credentials_missing",
      reason: "Polymarket credentials missing or stale; reconnect required",
    };
  }

  const effectivePaperMode = await getEffectivePaperTradeMode(userId);

  // For LIVE placements, wallet credentials are required.  Paper mode is
  // simulated locally and doesn't need them.
  if (!effectivePaperMode) {
    if (!creds.walletPrivateKey || !creds.walletAddress) {
      return {
        status: "credentials_missing",
        reason:
          "Polymarket wallet private key + funder address required for live order signing",
      };
    }
  }

  // Bankroll proxy via Kalshi capital.  Documented limitation; replace
  // with a Polygon USDC balance poll when that's wired.
  const kalshiCapital = await getKalshiCapital(userId).catch(() => null);
  const liveCapitalUsd = Number(kalshiCapital?.currentBalance ?? 0);
  if (!Number.isFinite(liveCapitalUsd) || liveCapitalUsd <= 0) {
    return {
      status: "balance_unknown",
      reason: "Kalshi capital (bankroll proxy) is non-positive; cannot size",
    };
  }
  const stakeUsdc = liveCapitalUsd * ENV.polymarketDailySportsPlayPctOfCapital;

  // Fetch markets and filter to sports.  Polymarket's `category` strings
  // are messier than Kalshi's, so we accept either a literal "sports"
  // match or the deterministic classifier's verdict.
  const allMarkets = await fetchPolymarketMarkets({ limit: 200 });
  const sportsMarkets = allMarkets.filter((m) => {
    const cat = (m.category ?? "").toLowerCase();
    if (cat === "sports") return true;
    const classified = classifyMarketCategory({
      category: m.category,
      title: m.question,
    });
    return classified === "sports";
  });
  if (sportsMarkets.length === 0) {
    return {
      status: "no_signals",
      reason: "No open Polymarket sports markets discovered",
    };
  }

  // Generate signals + Tier-1 AI reviewer.
  const allSignals = generatePolymarketSignals(sportsMarkets, {
    minConfidence: ENV.profitGuardrails.minConfidenceAfterAdjust,
    minLiquidity: 200,
    userId,
  }).filter((s) => s.signalType !== "wash_volume_warning");

  if (allSignals.length === 0) {
    return {
      status: "no_signals",
      reason: "No Polymarket sports signals cleared the heuristic floor",
    };
  }

  const reviewedSignals = await reviewPolymarketSignalsWithTrader(
    {
      markets: sportsMarkets,
      signals: allSignals,
      maxSignals: allSignals.length,
    },
    { userId },
  );
  if (reviewedSignals.length === 0) {
    return {
      status: "no_qualifying_play",
      reason: "All Polymarket sports candidates vetoed by AI reviewer",
    };
  }

  // Top pick by confidence × max(0, EV).  EV semantics differ slightly
  // between platforms; clamp to ≥0 so a negative-EV row never out-ranks
  // a positive-EV peer with the same confidence.
  const top = reviewedSignals
    .slice()
    .sort((a, b) => {
      const aScore = a.confidence * Math.max(0, a.expectedValue);
      const bScore = b.confidence * Math.max(0, b.expectedValue);
      return bScore - aScore;
    })[0];
  if (!top) {
    return { status: "no_qualifying_play", reason: "Reviewer returned 0 candidates" };
  }

  // Pre-execution risk gates.  Fail-closed on any DB read error.  We pull
  // the full position history (open + closed) so we can compute the 7-day
  // realized P&L window for the drawdown breaker.
  let openPositions: Awaited<ReturnType<typeof getOpenPolymarketPositions>>;
  let closedTrades7d: Awaited<ReturnType<typeof getPolymarketPositions>>;
  try {
    const [op, allPos] = await Promise.all([
      getOpenPolymarketPositions(userId),
      getPolymarketPositions(userId),
    ]);
    openPositions = op;
    closedTrades7d = allPos.filter((p) => {
      if (p.positionStatus !== "closed") return false;
      const closedAt = p.closedAt ? new Date(p.closedAt).getTime() : 0;
      return closedAt > Date.now() - 7 * 24 * 60 * 60 * 1000;
    });
  } catch (err) {
    logger.warn(
      { err, userId },
      "[PolymarketDailySportsPlay] risk-state ledger reads failed; aborting (fail-closed)",
    );
    return {
      status: "error",
      reason: "Risk-state ledger reads failed; refusing to trade until DB is healthy",
    };
  }

  // Block if we already have a position on this token (any side hedge is
  // a structural error on Polymarket too).
  const hasOpenSameToken = openPositions.some(
    (p) =>
      p.marketId === top.marketId &&
      (top.tokenId == null || p.tokenId === top.tokenId) &&
      String(p.positionStatus).toLowerCase() !== "closed",
  );
  if (hasOpenSameToken) {
    return {
      status: "no_qualifying_play",
      reason: `Already have an open position on ${top.marketId} / ${top.tokenId}`,
    };
  }

  // Drawdown breaker (same 4 rules).
  const weeklyPnlUsd = closedTrades7d.reduce(
    (acc, t) => acc + Number(t.realizedPnl ?? 0),
    0,
  );
  const newestFirst = [...closedTrades7d].sort((a, b) => {
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
    (acc, t) => acc + Number(t.sizeUsdc ?? 0),
    0,
  );
  const weeklyRealizedEdgePct =
    weeklyNotional > 0 ? weeklyPnlUsd / weeklyNotional : 1;
  const drawdown = checkDrawdownBreaker({
    capitalUsd: liveCapitalUsd,
    todayPnlUsd: 0, // intraday Polymarket P&L not yet tracked separately
    weeklyPnlUsd,
    consecutiveLosses,
    weeklyRealizedEdgePct,
  });
  if (!drawdown.allowed) {
    return { status: "drawdown_paused", reason: drawdown.reason };
  }

  // Portfolio exposure cap (USDC).
  const currentExposureUsd = openPositions.reduce(
    (acc, p) => acc + Number(p.sizeUsdc ?? 0),
    0,
  );
  const maxPortfolioUsd =
    liveCapitalUsd * ENV.profitGuardrails.maxPortfolioExposurePct;
  if (currentExposureUsd + stakeUsdc > maxPortfolioUsd) {
    return {
      status: "exposure_capped",
      reason: `Portfolio exposure $${(currentExposureUsd + stakeUsdc).toFixed(2)} would exceed ${(ENV.profitGuardrails.maxPortfolioExposurePct * 100).toFixed(0)}% cap ($${maxPortfolioUsd.toFixed(2)})`,
    };
  }

  // Per-category sports exposure cap.  Cross-reference open positions
  // against the sports-market id set we just fetched.
  const sportsMarketIds = new Set(sportsMarkets.map((m) => m.marketId));
  const sportsExposureUsd = openPositions.reduce((acc, p) => {
    if (!sportsMarketIds.has(p.marketId)) return acc;
    return acc + Number(p.sizeUsdc ?? 0);
  }, 0);
  const maxCategoryUsd =
    liveCapitalUsd * ENV.profitGuardrails.maxCorrelatedGroupPct;
  if (sportsExposureUsd + stakeUsdc > maxCategoryUsd) {
    return {
      status: "exposure_capped",
      reason: `Sports exposure $${(sportsExposureUsd + stakeUsdc).toFixed(2)} would exceed ${(ENV.profitGuardrails.maxCorrelatedGroupPct * 100).toFixed(0)}% per-category cap ($${maxCategoryUsd.toFixed(2)})`,
    };
  }

  if (stakeUsdc < 0.5) {
    return {
      status: "no_qualifying_play",
      reason: `Stake $${stakeUsdc.toFixed(2)} below $0.50 minimum order size`,
    };
  }

  // Convert USDC budget → token quantity (matches polymarketAutonomy convention).
  const tokens = Math.max(
    0,
    Math.floor((stakeUsdc / Math.max(top.limitPrice, 1e-6)) * 100) / 100,
  );

  await logAuditEvent(
    "polymarket_daily_sports_play_attempt",
    JSON.stringify({
      userId,
      marketId: top.marketId,
      tokenId: top.tokenId,
      side: top.side,
      sizeUsdc: stakeUsdc,
      tokens,
      pctOfCapital: ENV.polymarketDailySportsPlayPctOfCapital,
      liveCapitalUsd,
      confidence: top.confidence,
      expectedValue: top.expectedValue,
    }),
    `user:${userId}`,
  ).catch(() => {});

  // Reserve the daily slot via the unique-index-protected insert BEFORE
  // any external side effect.  This makes the run idempotent at the DB
  // level: a retry/crash between insert and order placement, or a
  // concurrent run, will hit ON CONFLICT DO NOTHING and short-circuit
  // here.  On order failure below we void the reservation so the audit
  // trail records the attempt (and the unique key still blocks same-day
  // duplicates — intentional "one shot per day" semantics).
  const reservation = await insertDailyPlayPick({
    userId,
    platform: "polymarket",
    playType: "sports",
    playDate: runPlayDate,
    marketId: top.marketId,
    tokenId: top.tokenId,
    side: top.side,
    stakeUsd: stakeUsdc,
    entryPrice: top.limitPrice,
    quantity: tokens,
    confidence: top.confidence,
    expectedValue: top.expectedValue,
    reasoning: top.reasoning ?? null,
  }).catch((err) => {
    logger.warn(
      { err, userId, marketId: top.marketId },
      "[PolymarketDailySportsPlay] reservation insert failed",
    );
    return null;
  });
  if (!reservation) {
    return {
      status: "disabled",
      reason:
        "Polymarket daily sports play already ran today (reservation row exists)",
    };
  }

  // Place the order under the per-user mutex (matches polymarketAutonomy).
  const orderResult = await withUserLock(userId, async () => {
    if (effectivePaperMode) {
      return simulatePolymarketOrderFill(
        userId,
        {
          marketId: top.marketId,
          tokenId: top.tokenId,
          positionSide: top.side,
          price: top.limitPrice,
          sizeUsdc: stakeUsdc,
        },
        `user:${userId}`,
      );
    }
    if (!creds.walletPrivateKey || !creds.walletAddress) {
      return {
        success: false,
        error: "Polymarket wallet credentials missing for live order signing",
      };
    }
    return placePolymarketOrder(
      creds.apiKey,
      creds.apiSecret,
      creds.apiPassphrase,
      {
        tokenId: top.tokenId,
        side: "BUY",
        price: top.limitPrice,
        size: tokens,
        walletPrivateKey: creds.walletPrivateKey,
        walletAddress: creds.walletAddress,
        signatureType: creds.signatureType,
      },
    );
  }).catch((err) => ({
    success: false,
    error: err instanceof Error ? err.message : String(err),
  }));

  if (!("success" in orderResult) || !orderResult.success) {
    const errStr = "error" in orderResult ? String(orderResult.error ?? "") : "";
    // Void the reservation so the row reflects the failed attempt (still
    // blocks same-day retries via the unique key — that's the intended
    // "one shot per day" rule).
    await voidDailyPlayPick({
      pickId: reservation.id,
      reason: `order failed: ${errStr || "unknown"}`,
    });
    await logAuditEvent(
      "polymarket_daily_sports_play_blocked",
      JSON.stringify({
        userId,
        marketId: top.marketId,
        tokenId: top.tokenId,
        side: top.side,
        reason: errStr,
      }),
      `user:${userId}`,
    ).catch(() => {});
    if (/drawdown|cold[ _-]?streak/i.test(errStr)) {
      return { status: "drawdown_paused", reason: errStr };
    }
    if (/exposure|cap|position[ _-]?size/i.test(errStr)) {
      return { status: "exposure_capped", reason: errStr };
    }
    return {
      status: "error",
      reason: errStr || "executor blocked the trade",
    };
  }

  await logAuditEvent(
    "polymarket_daily_sports_play_executed",
    JSON.stringify({
      userId,
      marketId: top.marketId,
      tokenId: top.tokenId,
      side: top.side,
      sizeUsdc: stakeUsdc,
      tokens,
      pctOfCapital: ENV.polymarketDailySportsPlayPctOfCapital,
      liveCapitalUsd,
      confidence: top.confidence,
      expectedValue: top.expectedValue,
    }),
    `user:${userId}`,
  ).catch(() => {});

  // Reservation row already inserted above — schedule deferred linkage
  // at +60s once position-sync has surfaced the open position row.
  setTimeout(async () => {
    try {
      const positions = await getOpenPolymarketPositions(userId);
      const match = positions.find(
        (p) => p.marketId === top.marketId && p.tokenId === top.tokenId,
      );
      if (match) {
        await linkPositionToPick({
          userId,
          platform: "polymarket",
          playType: "sports",
          marketId: top.marketId,
          tokenId: top.tokenId,
          playDate: runPlayDate,
          linkedPositionId: match.id,
        });
      }
    } catch (err) {
      logger.debug(
        { err, userId, marketId: top.marketId },
        "[PolymarketDailySportsPlay] deferred linkage failed",
      );
    }
  }, 60_000).unref?.();

  logger.info(
    {
      userId,
      marketId: top.marketId,
      tokenId: top.tokenId,
      side: top.side,
      sizeUsdc: stakeUsdc,
      tokens,
      pctOfCapital: ENV.polymarketDailySportsPlayPctOfCapital,
      confidence: top.confidence,
    },
    "[PolymarketDailySportsPlay] executed",
  );

  return {
    status: "executed",
    reason: "Polymarket daily sports play placed",
    marketId: top.marketId,
    tokenId: top.tokenId,
    side: top.side,
    sizeUsdc: stakeUsdc,
    confidence: top.confidence,
  };
}
