/**
 * Stop-loss + time-stop scanner for open Kalshi positions.
 *
 * Without this, positions hold to resolution.  That's fine when our
 * thesis is correct, catastrophic when it's wrong: a market drifting
 * against us for days eats max-loss-per-trade silently.
 *
 * Two thresholds, whichever fires first:
 *
 *   STOP-LOSS: realized would-be loss exceeds STOP_LOSS_LOSS_FRACTION
 *     of the entry exposure (default 30%).  We close at the current
 *     market price to lock in the controlled loss.
 *
 *   TIME-STOP: position has been open longer than STOP_LOSS_MAX_HOLD_HOURS
 *     (default 72).  Old positions either resolved already or are dead
 *     money — close and free up the budget.
 *
 * The scanner is idempotent: it only acts on `open` positions, calls
 * existing closeKalshiPosition (which transitions to `closed` and writes
 * realizedPnl + desk-memory).  Each close emits an audit-log event +
 * optional operator alert.
 *
 * Polymarket parity: deferred — Polymarket open positions aren't tracked
 * in a local table (they live on the CLOB).  When we add a positions
 * table for Polymarket, mirror this module.
 */

import * as db from "../db";
import * as polymarketCredDb from "../db.polymarket-credentials";
import { ENV } from "./env";
import { closeKalshiPosition } from "./kalshiExecution";
import { fetchKalshiMarketDetails } from "./kalshiMarketData";
import { fetchPolymarketMarkets, placePolymarketOrder } from "./polymarketAuth";
import { recordPolymarketTradeExit } from "./polymarketLearning";
import { sendOperatorAlert } from "./operatorAlerts";

const HOUR_MS = 60 * 60 * 1000;

export type StopLossDecision = {
  positionId: number;
  marketId: string;
  side: "yes" | "no";
  entryPrice: number;
  currentPrice: number;
  quantity: number;
  unrealizedPnl: number;
  ageHours: number;
  decision: "hold" | "close_stop_loss" | "close_time_stop";
  reason?: string;
};

export type StopLossScanResult = {
  scannedPositions: number;
  decisions: StopLossDecision[];
  closesAttempted: number;
  closesSucceeded: number;
  errors: string[];
};

/**
 * Decide what to do with a single open position.  Pure function of the
 * position state + current market price + thresholds, so it's trivially
 * testable without a DB.
 */
export function decideStopLoss(
  position: {
    id: number;
    marketId: string;
    side: "yes" | "no";
    entryPrice: number;
    currentPrice: number;
    quantity: number;
    openedAt: Date | string;
  },
  thresholds: {
    nowMs: number;
    lossFraction: number;
    maxHoldHours: number;
  },
): StopLossDecision {
  const { nowMs, lossFraction, maxHoldHours } = thresholds;
  const openedMs = new Date(position.openedAt).getTime();
  const ageHours = Math.max(0, (nowMs - openedMs) / HOUR_MS);

  // Compute would-be PnL at current price.  YES side: pnl = (current - entry) * qty.
  // NO side: pnl = (entry - current) * qty (we made money if price dropped).
  const unrealizedPnl =
    position.side === "no"
      ? (position.entryPrice - position.currentPrice) * position.quantity
      : (position.currentPrice - position.entryPrice) * position.quantity;

  const entryExposure = position.entryPrice * position.quantity;
  const lossThresholdDollars = entryExposure * lossFraction;

  let decision: StopLossDecision["decision"] = "hold";
  let reason: string | undefined;

  if (unrealizedPnl <= -lossThresholdDollars) {
    decision = "close_stop_loss";
    reason = `unrealized PnL ${unrealizedPnl.toFixed(2)} ≤ -${lossThresholdDollars.toFixed(2)} (${(lossFraction * 100).toFixed(0)}% of entry exposure)`;
  } else if (ageHours >= maxHoldHours) {
    decision = "close_time_stop";
    reason = `age ${ageHours.toFixed(1)}h ≥ ${maxHoldHours.toFixed(1)}h max hold`;
  }

  return {
    positionId: position.id,
    marketId: position.marketId,
    side: position.side,
    entryPrice: position.entryPrice,
    currentPrice: position.currentPrice,
    quantity: position.quantity,
    unrealizedPnl,
    ageHours,
    decision,
    reason,
  };
}

/**
 * Scan all open Kalshi positions for one user and close any that hit a
 * threshold.  Refreshes currentPrice for each position from the live
 * market endpoint before deciding so stale snapshots don't trigger
 * spurious closes.
 */
export async function runStopLossScan(
  userId: number,
  options: {
    triggeredByOpenId?: string;
    nowMs?: number;
  } = {},
): Promise<StopLossScanResult> {
  if (!ENV.enableStopLossScanner) {
    return {
      scannedPositions: 0,
      decisions: [],
      closesAttempted: 0,
      closesSucceeded: 0,
      errors: [],
    };
  }

  const triggeredByOpenId = options.triggeredByOpenId ?? `user:${userId}`;
  const nowMs = options.nowMs ?? Date.now();
  const lossFraction = ENV.stopLossLossFraction;
  const maxHoldHours = ENV.stopLossMaxHoldHours;

  const openPositions = await db.getOpenKalshiPositions(userId);
  const decisions: StopLossDecision[] = [];
  const errors: string[] = [];
  let closesAttempted = 0;
  let closesSucceeded = 0;

  for (const position of openPositions) {
    let currentPrice = Number(position.currentPrice ?? position.entryPrice);
    try {
      const market = await fetchKalshiMarketDetails(position.marketId);
      if (market) {
        currentPrice =
          position.side === "yes"
            ? Number(market.yesPrice ?? currentPrice)
            : Number(market.noPrice ?? currentPrice);
      }
    } catch (error) {
      errors.push(
        `marketDetails ${position.marketId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    const decision = decideStopLoss(
      {
        id: position.id,
        marketId: position.marketId,
        side: position.side as "yes" | "no",
        entryPrice: Number(position.entryPrice),
        currentPrice,
        quantity: Number(position.quantity),
        openedAt: position.openedAt,
      },
      { nowMs, lossFraction, maxHoldHours },
    );
    decisions.push(decision);

    if (decision.decision === "hold") continue;

    closesAttempted += 1;
    try {
      const closeResult = await closeKalshiPosition(
        userId,
        position.id,
        position.marketId,
        currentPrice,
      );
      if (!closeResult.success) {
        errors.push(`close ${position.id}: ${closeResult.error ?? "unknown"}`);
        continue;
      }
      closesSucceeded += 1;
      await db.logAuditEvent(
        decision.decision === "close_stop_loss"
          ? "kalshi_stop_loss_triggered"
          : "kalshi_time_stop_triggered",
        JSON.stringify({
          positionId: decision.positionId,
          marketId: decision.marketId,
          side: decision.side,
          entryPrice: decision.entryPrice,
          exitPrice: currentPrice,
          quantity: decision.quantity,
          unrealizedPnl: decision.unrealizedPnl,
          ageHours: decision.ageHours,
          reason: decision.reason,
        }),
        triggeredByOpenId,
      );
      await sendOperatorAlert({
        kind: "stop_loss_triggered",
        severity: decision.decision === "close_stop_loss" ? "warn" : "info",
        message: `Closed Kalshi ${decision.marketId} (${decision.side}) — ${decision.reason}`,
        details: {
          positionId: decision.positionId,
          marketId: decision.marketId,
          side: decision.side,
          unrealizedPnl: decision.unrealizedPnl,
          ageHours: decision.ageHours,
        },
        triggeredByOpenId,
      });
    } catch (error) {
      errors.push(
        `close ${position.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    scannedPositions: openPositions.length,
    decisions,
    closesAttempted,
    closesSucceeded,
    errors,
  };
}

/**
 * Polymarket stop-loss + time-stop scan.
 *
 * Synthesizes "open positions" from polymarket_trade_entry / _exit audit
 * events (no positions table required), looks up the current token
 * mid-price from the live CLOB markets endpoint, runs the same
 * decideStopLoss thresholds, and closes by placing a SELL order at the
 * current price + writing a polymarket_trade_exit audit event so the
 * memory tape and circuit breaker stay in sync.
 *
 * Failures (no creds, market lookup, sell order rejected) are swallowed
 * into the errors list rather than thrown — the cron runs idempotently
 * across many users and one failed user shouldn't poison the run.
 */
export async function runPolymarketStopLossScan(
  userId: number,
  options: {
    triggeredByOpenId?: string;
    nowMs?: number;
  } = {},
): Promise<StopLossScanResult> {
  if (!ENV.enableStopLossScanner) {
    return {
      scannedPositions: 0,
      decisions: [],
      closesAttempted: 0,
      closesSucceeded: 0,
      errors: [],
    };
  }

  const triggeredByOpenId = options.triggeredByOpenId ?? `user:${userId}`;
  const nowMs = options.nowMs ?? Date.now();
  const lossFraction = ENV.stopLossLossFraction;
  const maxHoldHours = ENV.stopLossMaxHoldHours;

  const open = await db.getOpenPolymarketPositions(userId);
  const decisions: StopLossDecision[] = [];
  const errors: string[] = [];
  let closesAttempted = 0;
  let closesSucceeded = 0;

  if (open.length === 0) {
    return { scannedPositions: 0, decisions, closesAttempted, closesSucceeded, errors };
  }

  // Look up creds once per scan; if missing we can audit-decide but can't
  // actually close.  We still log the decisions so operators see them.
  const creds = await polymarketCredDb.getPolymarketCredentials(userId);

  // Pull a single market snapshot list and index by marketId for fast
  // lookups — Polymarket's gamma endpoint is paged, so this is a coarse
  // approximation suitable for a 10-min cron.
  let marketsById = new Map<string, Awaited<ReturnType<typeof fetchPolymarketMarkets>>[number]>();
  try {
    const markets = await fetchPolymarketMarkets({ limit: 200 });
    for (const m of markets) marketsById.set(m.marketId, m);
  } catch (error) {
    errors.push(
      `fetchPolymarketMarkets: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const position of open) {
    const market = marketsById.get(position.marketId);
    let currentPrice = position.entryPrice;
    if (market) {
      const yesTok = market.tokens.find((t) => t.outcome.toLowerCase() === "yes");
      const noTok = market.tokens.find((t) => t.outcome.toLowerCase() === "no");
      if (position.side === "yes" && yesTok?.price) currentPrice = Number(yesTok.price);
      else if (position.side === "no" && noTok?.price) currentPrice = Number(noTok.price);
    }

    const decision = decideStopLoss(
      {
        // Polymarket positions don't have a numeric id; encode the tradeId
        // hash so logs can correlate.  Decision struct still uses number;
        // 0 is a sentinel meaning "synthesized from audit log".
        id: 0,
        marketId: position.marketId,
        side: position.side,
        entryPrice: position.entryPrice,
        currentPrice,
        // Polymarket size is in USDC, not contracts — but the math is
        // identical when entryPrice * quantity = USDC notional, which
        // we encode by setting quantity = entrySizeUsdc / entryPrice.
        quantity:
          position.entryPrice > 0
            ? position.entrySizeUsdc / position.entryPrice
            : position.entrySizeUsdc,
        openedAt: position.openedAt,
      },
      { nowMs, lossFraction, maxHoldHours },
    );
    decisions.push(decision);

    if (decision.decision === "hold") continue;
    closesAttempted += 1;

    if (!creds || creds.accountStatus !== "connected") {
      errors.push(`no connected polymarket creds for user ${userId} — close skipped`);
      continue;
    }
    if (!market) {
      errors.push(`market ${position.marketId} not in current snapshot — close skipped`);
      continue;
    }

    try {
      const sellResult = await placePolymarketOrder(
        creds.apiKey,
        creds.apiSecret,
        creds.apiPassphrase,
        {
          tokenId: position.tokenId,
          side: "SELL",
          price: currentPrice,
          size: position.entrySizeUsdc,
        },
      );
      if (!sellResult.success) {
        errors.push(
          `polymarket close ${position.tradeId}: ${sellResult.error ?? "unknown"}`,
        );
        continue;
      }
      closesSucceeded += 1;

      // Compute realized PnL in dollars (entry - exit price differential
      // times size).  YES side wins when price goes up; NO when down.
      const realizedPnl =
        (position.side === "yes" ? currentPrice - position.entryPrice : position.entryPrice - currentPrice) *
        (position.entryPrice > 0
          ? position.entrySizeUsdc / position.entryPrice
          : position.entrySizeUsdc);

      await recordPolymarketTradeExit(
        userId,
        position.tradeId,
        currentPrice,
        position.entrySizeUsdc,
        {
          marketId: position.marketId,
          marketTitle: market.question,
          marketCategoryTag: market.category,
          side: position.side,
          entryPrice: position.entryPrice,
          realizedPnl,
        },
      );
      await db.logAuditEvent(
        decision.decision === "close_stop_loss"
          ? "polymarket_stop_loss_triggered"
          : "polymarket_time_stop_triggered",
        JSON.stringify({
          tradeId: position.tradeId,
          marketId: position.marketId,
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice: currentPrice,
          sizeUsdc: position.entrySizeUsdc,
          realizedPnl,
          ageHours: decision.ageHours,
          reason: decision.reason,
        }),
        triggeredByOpenId,
      );
      await sendOperatorAlert({
        kind: "stop_loss_triggered",
        severity: decision.decision === "close_stop_loss" ? "warn" : "info",
        message: `Closed Polymarket ${position.marketId} (${position.side}) — ${decision.reason}`,
        details: {
          tradeId: position.tradeId,
          marketId: position.marketId,
          side: position.side,
          realizedPnl,
          ageHours: decision.ageHours,
        },
        triggeredByOpenId,
      });
    } catch (error) {
      errors.push(
        `polymarket close ${position.tradeId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return {
    scannedPositions: open.length,
    decisions,
    closesAttempted,
    closesSucceeded,
    errors,
  };
}
