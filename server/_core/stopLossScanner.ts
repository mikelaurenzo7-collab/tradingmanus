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
import { ENV } from "./env";
import { closeKalshiPosition } from "./kalshiExecution";
import { fetchKalshiMarketDetails } from "./kalshiMarketData";
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
