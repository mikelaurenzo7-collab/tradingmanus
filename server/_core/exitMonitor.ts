/**
 * Exit Monitor — wires the pure exitStrategy.ts logic into the live system.
 *
 * On each tick (scheduled from server/_core/index.ts) this module:
 *   1. Loads all open Kalshi positions for the configured owner
 *   2. Reads the current market price from the latest-known kalshiMarkets row
 *      (upserted on every autonomy run, fresh within the AUTONOMY_INTERVAL_MS
 *      window)
 *   3. Recomputes the per-position stop / profit-target levels from the
 *      entry price + side via initializeExitStrategy() — stateless, no DB
 *      schema additions required to ship safely
 *   4. Calls checkExitConditions() to detect a triggered exit
 *   5. Always emits a `kalshi_position_exit_signal` audit event for visibility
 *   6. If AUTO_CLOSE_ON_EXIT_SIGNAL=true (default false) AND not paper-only,
 *      places a real reverse order via closeKalshiPosition() to actually
 *      liquidate
 *
 * Stateless design rationale: trailing stops + profit-target hit memory
 * require per-position persistent state (high-water mark, hitTargets array).
 * Adding those tables is a follow-up pass.  This pass ships hard stop-loss
 * + profit-target detection, which together capture the majority of the
 * P&L lift from disciplined exits.
 *
 * Auto-close is gated by env so the operator can:
 *   1. Deploy with AUTO_CLOSE_ON_EXIT_SIGNAL unset (or =false)
 *   2. Watch the audit log for a few cycles, validate signals make sense
 *   3. Flip the env to true on the next deploy to enable real liquidation
 */

import * as db from "../db";
import { kalshiMarkets } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { ENV } from "./env";
import { logger } from "./logger";
import {
  initializeExitStrategy,
  checkExitConditions,
  type ExitDecision,
  type ExitStrategyConfig,
} from "./exitStrategy";
import { closeKalshiPosition } from "./kalshiExecution";

// Default volatility used when we don't have a per-market vol estimate.
// 0.15 sits in the medium tier of selectStopPct() → 15 % initial stop.
// Future: replace with a per-market estimate from kalshiSentiment / market
// snapshots so high-vol markets get wider stops and low-vol tighter ones.
const DEFAULT_VOLATILITY = 0.15;

const AUTO_CLOSE_ENABLED =
  (process.env.AUTO_CLOSE_ON_EXIT_SIGNAL ?? "")
    .trim()
    .toLowerCase() === "true";

export type ExitEvaluation = {
  positionId: number;
  marketId: string;
  side: "yes" | "no";
  entryPrice: number;
  currentPrice: number;
  decision: ExitDecision;
  closed: boolean;
  closeError?: string;
};

async function readCurrentMarketPrice(
  marketId: string,
  side: "yes" | "no",
): Promise<number | null> {
  const database = await db.getDb();
  if (!database) return null;
  const rows = await database
    .select({
      yesPrice: kalshiMarkets.yesPrice,
      noPrice: kalshiMarkets.noPrice,
    })
    .from(kalshiMarkets)
    .where(eq(kalshiMarkets.marketId, marketId))
    .limit(1);
  if (rows.length === 0) return null;
  const raw = side === "yes" ? rows[0].yesPrice : rows[0].noPrice;
  const price = Number(raw ?? 0);
  return Number.isFinite(price) && price > 0 && price < 1 ? price : null;
}

export async function evaluateExitsForOpenPositions(
  userId: number,
  triggeredByOpenId: string = "local_scheduler",
): Promise<ExitEvaluation[]> {
  const positions = await db.getOpenKalshiPositions(userId);
  const evaluations: ExitEvaluation[] = [];

  for (const position of positions) {
    const positionId = Number((position as { id: number }).id);
    const marketId = String((position as { marketId: string }).marketId);
    const side = (position as { side: "yes" | "no" }).side;
    const entryPrice = Number((position as { entryPrice: number }).entryPrice);
    const quantity = Number((position as { quantity: number }).quantity ?? 0);

    if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) {
      continue;
    }

    const currentPrice = await readCurrentMarketPrice(marketId, side);
    if (currentPrice === null) {
      // No fresh market price yet (e.g. position on a market the autonomy
      // run hasn't fetched). Skip — we'll re-check next tick.
      continue;
    }

    const config: ExitStrategyConfig = {
      entryPrice,
      side,
      initialRisk: entryPrice * quantity, // dollars at risk if price → 0
      volatility: DEFAULT_VOLATILITY,
    };

    const state = initializeExitStrategy(config);
    const decision = checkExitConditions(state, currentPrice, config);

    const evaluation: ExitEvaluation = {
      positionId,
      marketId,
      side,
      entryPrice,
      currentPrice,
      decision,
      closed: false,
    };

    if (decision.shouldExit) {
      // Always log the signal — operator visibility is the first-line safety
      // net before auto-close is enabled.
      await db.logAuditEvent(
        "kalshi_position_exit_signal",
        JSON.stringify({
          positionId,
          marketId,
          side,
          entryPrice,
          currentPrice,
          reason: decision.reason,
          targetIndex: decision.targetIndex,
          stopLevel: state.stopLevel,
          profitTargets: state.profitTargets,
          autoCloseEnabled: AUTO_CLOSE_ENABLED,
          paperMode: ENV.paperTradeMode,
        }),
        triggeredByOpenId,
      );

      logger.info(
        {
          positionId,
          marketId,
          reason: decision.reason,
          entryPrice,
          currentPrice,
          autoCloseEnabled: AUTO_CLOSE_ENABLED,
        },
        "[ExitMonitor] exit signal triggered",
      );

      if (AUTO_CLOSE_ENABLED) {
        try {
          const result = await closeKalshiPosition(
            userId,
            positionId,
            marketId,
            currentPrice,
            undefined, // closeKalshiPosition reads the user's encrypted credentials internally
            triggeredByOpenId,
          );
          evaluation.closed = result.success;
          if (!result.success) {
            evaluation.closeError = result.error;
            logger.warn(
              { positionId, marketId, err: result.error },
              "[ExitMonitor] auto-close failed",
            );
          }
        } catch (err) {
          evaluation.closeError = err instanceof Error ? err.message : String(err);
          logger.error(
            { err, positionId, marketId },
            "[ExitMonitor] auto-close threw",
          );
        }
      }
    }

    evaluations.push(evaluation);
  }

  return evaluations;
}
