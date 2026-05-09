/**
 * Polymarket Exit Monitor
 *
 * Mirror of server/_core/exitMonitor.ts for Polymarket positions.  Reuses
 * the pure exitStrategy.ts logic (initializeExitStrategy, updateTrailingStop,
 * applyTimeDecayToStops, checkExitConditions); the differences vs. Kalshi:
 *
 *   - Current price comes from the gamma-api (no polymarketMarkets table
 *     yet — we fetch markets ad-hoc per tick and index by token id).  The
 *     fetch is bounded so we never page through more markets than the
 *     position count requires.
 *   - "Close" places a SELL order via closePolymarketPosition() (paper-mode
 *     aware) at the current market price.
 *   - State persisted in polymarketPositions.exitState JSONB column.
 *
 * Auto-close is gated by the same AUTO_CLOSE_ON_EXIT_SIGNAL env var as the
 * Kalshi monitor — flip once for both platforms.
 *
 * Known limitation (documented in CLAUDE.md): we do NOT reconcile against
 * the Polymarket /portfolio endpoint.  If the operator manually closes a
 * position on the Polymarket UI while the bot is running, our local DB
 * still thinks it's open and the exit monitor would re-attempt to close
 * (the SELL would fail with insufficient-balance).  Position sync is a
 * follow-up.
 */

import * as db from "../db";
import * as polymarketCredDb from "../db.polymarket-credentials";
import { getOpenPolymarketPositions } from "../db.polymarket";
import { polymarketPositions } from "../../drizzle/schema";
import { eq } from "drizzle-orm";
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
import { fetchPolymarketMarkets, closePolymarketPosition } from "./polymarketAuth";
import { simulatePolymarketPositionClose } from "./paperTrading";
import { withUserLock } from "./userMutex";
import { MARKET_VOLATILITY_DEFAULT } from "./marketVolatility";
import { getEffectivePaperTradeMode } from "./effectivePaperMode";

// Polymarket markets don't yet have a snapshots table, so we use the
// constant for now.  A follow-up pass can build polymarketMarketSnapshots
// + a Polymarket version of estimateMarketVolatility.
const DEFAULT_VOLATILITY = MARKET_VOLATILITY_DEFAULT;
const DEFAULT_ATR = 0.01;
// Bound the market-fetch — the autonomy run uses 80, we want enough to
// cover any positions we hold.  Polymarket markets are paginated; this is
// a reasonable upper bound for a single-owner dashboard.
const POLYMARKET_MARKET_FETCH_LIMIT = 200;

const AUTO_CLOSE_ENABLED =
  (process.env.AUTO_CLOSE_ON_EXIT_SIGNAL ?? "")
    .trim()
    .toLowerCase() === "true";

export type PolymarketExitEvaluation = {
  positionId: number;
  marketId: string;
  tokenId: string;
  side: "yes" | "no";
  entryPrice: number;
  currentPrice: number;
  decision: ExitDecision;
  closed: boolean;
  closeError?: string;
  trailingStopRaised?: boolean;
};

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
    .update(polymarketPositions)
    .set({ exitState: state as unknown as Record<string, unknown> })
    .where(eq(polymarketPositions.id, positionId));
}

/**
 * Build a token-id → current-price map from a single fetchPolymarketMarkets()
 * call.  Returns null if the fetch fails (skip exits this tick).
 */
async function buildTokenPriceMap(): Promise<Map<string, number> | null> {
  try {
    const markets = await fetchPolymarketMarkets({ limit: POLYMARKET_MARKET_FETCH_LIMIT });
    const map = new Map<string, number>();
    for (const m of markets) {
      for (const token of m.tokens) {
        const price = Number(token.price ?? 0);
        if (Number.isFinite(price) && price > 0 && price < 1) {
          map.set(token.token_id, price);
        }
      }
    }
    return map;
  } catch (err) {
    logger.warn({ err }, "[PolymarketExitMonitor] price-map fetch failed");
    return null;
  }
}

export async function evaluatePolymarketExitsForOpenPositions(
  userId: number,
  triggeredByOpenId: string = "local_scheduler",
): Promise<PolymarketExitEvaluation[]> {
  const positions = await getOpenPolymarketPositions(userId);
  if (positions.length === 0) return [];

  const priceMap = await buildTokenPriceMap();
  if (!priceMap) return [];

  // Resolve per-user paper-mode once for this tick.  Owner gets live by
  // default; non-owner users (or the global emergency switch) are paper.
  const userPaperMode = await getEffectivePaperTradeMode(userId);

  // Fetch credentials once per user (only needed for live close, but
  // hoisting keeps the loop tidy).
  const creds = userPaperMode ? null : await polymarketCredDb.getPolymarketCredentials(userId);

  const evaluations: PolymarketExitEvaluation[] = [];

  for (const position of positions) {
    const positionId = Number((position as { id: number }).id);
    const marketId = String((position as { marketId: string }).marketId);
    const tokenId = String((position as { tokenId: string }).tokenId);
    const side = (position as { side: "yes" | "no" }).side;
    const entryPrice = Number((position as { entryPrice: number }).entryPrice);
    const sizeUsdc = Number((position as { sizeUsdc: number }).sizeUsdc ?? 0);
    const persistedRaw = (position as { exitState?: unknown }).exitState;

    if (!Number.isFinite(entryPrice) || entryPrice <= 0 || entryPrice >= 1) continue;

    const currentPrice = priceMap.get(tokenId);
    if (currentPrice === undefined) continue;

    const config: ExitStrategyConfig = {
      entryPrice,
      side,
      initialRisk: sizeUsdc,
      volatility: DEFAULT_VOLATILITY,
      // Polymarket markets table is not yet wired — resolutionDate undefined
      // so applyTimeDecayToStops() is a no-op.  Follow-up pass.
    };

    const initialState = parsePersistedState(persistedRaw) ?? initializeExitStrategy(config);
    const previousTrailingStop = initialState.trailingStop;

    let state = updateTrailingStop(initialState, currentPrice, DEFAULT_ATR, side);
    state = applyTimeDecayToStops(state, config);
    const trailingStopRaised = state.trailingStop !== previousTrailingStop;

    const decision = checkExitConditions(state, currentPrice, config);

    if (decision.shouldExit && typeof decision.targetIndex === "number") {
      const idx = decision.targetIndex - 1;
      if (!state.hitTargets.includes(idx)) {
        state = { ...state, hitTargets: [...state.hitTargets, idx] };
      }
    }

    try {
      await persistExitState(positionId, state);
    } catch (err) {
      logger.warn(
        { err, positionId, marketId },
        "[PolymarketExitMonitor] failed to persist exit state",
      );
    }

    const evaluation: PolymarketExitEvaluation = {
      positionId,
      marketId,
      tokenId,
      side,
      entryPrice,
      currentPrice,
      decision,
      closed: false,
      trailingStopRaised,
    };

    if (decision.shouldExit) {
      await db.logAuditEvent(
        "polymarket_position_exit_signal",
        JSON.stringify({
          positionId,
          marketId,
          tokenId,
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
          paperMode: userPaperMode,
        }),
        triggeredByOpenId,
      );

      logger.info(
        { positionId, marketId, reason: decision.reason, entryPrice, currentPrice, autoCloseEnabled: AUTO_CLOSE_ENABLED },
        "[PolymarketExitMonitor] exit signal triggered",
      );

      if (AUTO_CLOSE_ENABLED) {
        try {
          // Wrap the close in withUserLock so a concurrent autonomy run
          // can't read stale position state mid-close (mirrors the Kalshi
          // closeKalshiPosition design).
          const result = await withUserLock(userId, async () => {
            if (userPaperMode) {
              return simulatePolymarketPositionClose(userId, positionId, currentPrice, triggeredByOpenId);
            }
            if (
              !creds ||
              creds.accountStatus !== "connected" ||
              !creds.apiKey ||
              !creds.apiSecret ||
              !creds.apiPassphrase
            ) {
              return { success: false, error: "Polymarket credentials not connected or incomplete" };
            }
            return closePolymarketPosition(creds.apiKey, creds.apiSecret, creds.apiPassphrase, {
              tokenId,
              sizeUsdc,
              price: currentPrice,
            });
          });
          evaluation.closed = result.success;
          if (!result.success) {
            evaluation.closeError = result.error;
            logger.warn(
              { positionId, marketId, err: result.error },
              "[PolymarketExitMonitor] auto-close failed",
            );
          } else {
            // For live close (not paper), mark the position as 'closing' in
            // the local DB so the next exit-monitor tick doesn't re-trigger
            // before the SELL fills.  Paper close already marks it 'closed'.
            if (!userPaperMode) {
              const database = await db.getDb();
              if (database) {
                await database
                  .update(polymarketPositions)
                  .set({ positionStatus: "closing", currentPrice })
                  .where(eq(polymarketPositions.id, positionId));
              }
            }
          }
        } catch (err) {
          evaluation.closeError = err instanceof Error ? err.message : String(err);
          logger.error(
            { err, positionId, marketId },
            "[PolymarketExitMonitor] auto-close threw",
          );
        }
      }
    }

    evaluations.push(evaluation);
  }

  return evaluations;
}
