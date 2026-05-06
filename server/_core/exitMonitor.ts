/**
 * Exit Monitor — wires the pure exitStrategy.ts logic into the live system.
 *
 * On each tick (scheduled from server/_core/index.ts) this module:
 *   1. Loads all open Kalshi positions for the configured owner
 *   2. Reads the current market price from the latest-known kalshiMarkets row
 *      (upserted on every autonomy run, fresh within the AUTONOMY_INTERVAL_MS
 *      window)
 *   3. Loads persisted ExitStrategyState from the position row's `exitState`
 *      JSONB column (or initialises fresh from entry price + side when the
 *      column is null — backward compatible with pre-migration rows)
 *   4. Calls updateTrailingStop() to ratchet the trailing stop up as price
 *      makes new highs (the high-water mark is the only thing carried
 *      across ticks; without it, trailing stops can't function)
 *   5. Calls applyTimeDecayToStops() to tighten the stop as the market
 *      approaches resolution (within 24 h)
 *   6. Calls checkExitConditions() to detect a triggered exit
 *   7. Persists the updated state back to the position row so the next tick
 *      starts where this one left off
 *   8. Always emits a `kalshi_position_exit_signal` audit event for visibility
 *   9. If AUTO_CLOSE_ON_EXIT_SIGNAL=true, places a real reverse order via
 *      closeKalshiPosition() to actually liquidate
 *
 * Auto-close is gated by env so the operator can:
 *   1. Deploy with AUTO_CLOSE_ON_EXIT_SIGNAL unset (or =false)
 *   2. Watch the audit log for a few cycles, validate signals make sense
 *   3. Flip the env to true on the next deploy to enable real liquidation
 */

import * as db from "../db";
import { kalshiMarkets, kalshiPositions } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
import { ENV } from "./env";
import { logger } from "./logger";
import {
  initializeExitStrategy,
  updateTrailingStop,
  applyTimeDecayToStops,
  checkExitConditions,
  type ExitDecision,
  type ExitStrategyConfig,
  type ExitStrategyState,
} from "./exitStrategy";
import { closeKalshiPosition } from "./kalshiExecution";
import { estimateMarketVolatility } from "./marketVolatility";

// ATR proxy used by updateTrailingStop().  Conservative default; a follow-up
// pass can compute this per-market from the kalshiMarketSnapshots table.
const DEFAULT_ATR = 0.01;

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
  /** True when the trailing stop ratcheted up this tick. */
  trailingStopRaised?: boolean;
};

type MarketRow = {
  yesPrice: number | null;
  noPrice: number | null;
  resolutionDate: Date | null;
};

async function readMarketRow(marketId: string): Promise<MarketRow | null> {
  const database = await db.getDb();
  if (!database) return null;
  const rows = await database
    .select({
      yesPrice: kalshiMarkets.yesPrice,
      noPrice: kalshiMarkets.noPrice,
      resolutionDate: kalshiMarkets.resolutionDate,
    })
    .from(kalshiMarkets)
    .where(eq(kalshiMarkets.marketId, marketId))
    .limit(1);
  return rows.length === 0 ? null : (rows[0] as MarketRow);
}

function pickPriceFor(side: "yes" | "no", row: MarketRow): number | null {
  const raw = side === "yes" ? row.yesPrice : row.noPrice;
  const price = Number(raw ?? 0);
  return Number.isFinite(price) && price > 0 && price < 1 ? price : null;
}

/**
 * Coerce the JSONB blob from the DB into a valid ExitStrategyState.  Returns
 * null if the persisted shape is unrecognised so the caller can re-initialise.
 */
function parsePersistedState(raw: unknown): ExitStrategyState | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "object") return null;
  const s = raw as Record<string, unknown>;
  const stopLevel = Number(s.stopLevel);
  const trailingStop = Number(s.trailingStop);
  const highWaterMark = Number(s.highWaterMark);
  const profitTargets = Array.isArray(s.profitTargets)
    ? s.profitTargets.map((v) => Number(v)).filter((v) => Number.isFinite(v))
    : [];
  const hitTargets = Array.isArray(s.hitTargets)
    ? s.hitTargets.map((v) => Number(v)).filter((v) => Number.isInteger(v))
    : [];
  if (
    !Number.isFinite(stopLevel) ||
    !Number.isFinite(trailingStop) ||
    !Number.isFinite(highWaterMark) ||
    profitTargets.length === 0
  ) {
    return null;
  }
  return { stopLevel, trailingStop, highWaterMark, profitTargets, hitTargets };
}

async function persistExitState(positionId: number, state: ExitStrategyState): Promise<void> {
  const database = await db.getDb();
  if (!database) return;
  await database
    .update(kalshiPositions)
    .set({ exitState: state as unknown as Record<string, unknown> })
    .where(eq(kalshiPositions.id, positionId));
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
    const persistedRaw = (position as { exitState?: unknown }).exitState;

    if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) {
      continue;
    }

    const marketRow = await readMarketRow(marketId);
    if (!marketRow) continue;
    const currentPrice = pickPriceFor(side, marketRow);
    if (currentPrice === null) continue;

    // Per-market volatility from recent snapshots (high-vol → wider stops,
    // low-vol → tighter).  Falls back to a constant on insufficient history.
    const volatility = await estimateMarketVolatility(marketId);

    const config: ExitStrategyConfig = {
      entryPrice,
      side,
      initialRisk: entryPrice * quantity,
      volatility,
      resolutionDate: marketRow.resolutionDate ?? undefined,
    };

    // Load persisted state, or initialise on first sight (or if shape is
    // unrecognised, e.g. pre-migration rows or rows touched by an older
    // server build).
    const initialState =
      parsePersistedState(persistedRaw) ?? initializeExitStrategy(config);
    const previousTrailingStop = initialState.trailingStop;

    // 1. Ratchet trailing stop on new highs (lows for "no" side).
    let state = updateTrailingStop(initialState, currentPrice, DEFAULT_ATR, side);
    // 2. Tighten stop within the close-to-resolution window.
    state = applyTimeDecayToStops(state, config);
    const trailingStopRaised = state.trailingStop !== previousTrailingStop;

    const decision = checkExitConditions(state, currentPrice, config);

    // Mark hit targets (so we don't re-trigger the same target next tick).
    if (decision.shouldExit && typeof decision.targetIndex === "number") {
      const idx = decision.targetIndex - 1;
      if (!state.hitTargets.includes(idx)) {
        state = { ...state, hitTargets: [...state.hitTargets, idx] };
      }
    }

    // Persist updated state regardless of exit decision so the trailing
    // stop and HWM survive ticks.  Failure to persist is not fatal.
    try {
      await persistExitState(positionId, state);
    } catch (err) {
      logger.warn(
        { err, positionId, marketId },
        "[ExitMonitor] failed to persist exit state",
      );
    }

    const evaluation: ExitEvaluation = {
      positionId,
      marketId,
      side,
      entryPrice,
      currentPrice,
      decision,
      closed: false,
      trailingStopRaised,
    };

    if (decision.shouldExit) {
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
          trailingStop: state.trailingStop,
          highWaterMark: state.highWaterMark,
          profitTargets: state.profitTargets,
          hitTargets: state.hitTargets,
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
            undefined,
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
