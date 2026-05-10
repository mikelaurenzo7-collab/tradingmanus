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
  await auditSkip("Moonshot play retired; bot now targets true-winner Kalshi trades only");
  return {
    status: "disabled",
    reason: "Moonshot play retired; bot now targets true-winner Kalshi trades only",
  };
}
