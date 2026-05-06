/**
 * Exit Strategy Module
 * Pure logic for stop-loss, take-profit, and trailing stop calculations.
 * No DB calls, no HTTP calls — only deterministic price math.
 */

// ── Named constants ─────────────────────────────────────────────────────────

const INITIAL_STOP_PCT = 0.15;          // 15% initial stop loss
const TRAILING_STOP_ATR_MULTIPLE = 3;   // trail at 3x ATR below HWM
const HIGH_VOL_STOP_PCT = 0.20;         // wider stop in high vol
const LOW_VOL_STOP_PCT = 0.10;          // tighter stop in low vol
const HIGH_VOL_THRESHOLD = 0.20;        // vol threshold for wide stops
const LOW_VOL_THRESHOLD = 0.10;         // vol threshold for tight stops
const BASE_RR_RATIO = 2;                // 2:1 reward-to-risk (unused directly, kept for reference)
const PROFIT_TARGET_SCALE_1 = 1;        // first target = 1x initial risk
const PROFIT_TARGET_SCALE_2 = 2;        // second target = 2x initial risk
const PROFIT_TARGET_SCALE_3 = 3;        // third target = 3x initial risk
const CLOSE_RESOLUTION_HOURS = 24;      // tighten stops when <24h to resolution

// Prediction market price bounds
const PRICE_MIN = 0.02;
const PRICE_MAX = 0.98;

// ── Types ───────────────────────────────────────────────────────────────────

export interface ExitStrategyConfig {
  entryPrice: number;       // price at position entry (0–1)
  side: "yes" | "no";       // position direction
  initialRisk: number;      // initial risk amount in dollars
  volatility: number;       // current market volatility (0–1 normalized)
  resolutionDate?: Date;    // when the market resolves
}

export interface ExitStrategyState {
  stopLevel: number;        // current stop price (0–1)
  profitTargets: number[];  // [1x, 2x, 3x R] target prices
  highWaterMark: number;    // best price seen since entry
  trailingStop: number;     // trailing stop level (0–1)
  hitTargets: number[];     // indices of already-hit profit targets
}

export type ExitReason =
  | "stop_loss"
  | "trailing_stop"
  | "profit_target_1"
  | "profit_target_2"
  | "profit_target_3"
  | "time_decay"
  | "volatility_adjustment";

export interface ExitDecision {
  shouldExit: boolean;
  reason?: ExitReason;
  targetIndex?: number;   // which profit target was hit (1-based)
  exitPrice?: number;     // the triggering price
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number): number {
  return Math.min(PRICE_MAX, Math.max(PRICE_MIN, value));
}

function selectStopPct(volatility: number): number {
  if (volatility > HIGH_VOL_THRESHOLD) return HIGH_VOL_STOP_PCT;
  if (volatility < LOW_VOL_THRESHOLD) return LOW_VOL_STOP_PCT;
  return INITIAL_STOP_PCT;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute initial stop level, profit targets, and trailing stop state for a
 * new position.
 */
export function initializeExitStrategy(config: ExitStrategyConfig): ExitStrategyState {
  const { entryPrice, side, volatility } = config;
  const stopPct = selectStopPct(volatility);

  let stopLevel: number;
  let profitTargets: number[];

  if (side === "yes") {
    stopLevel = clamp(entryPrice * (1 - stopPct));
    profitTargets = [
      clamp(entryPrice * (1 + PROFIT_TARGET_SCALE_1 * stopPct)),
      clamp(entryPrice * (1 + PROFIT_TARGET_SCALE_2 * stopPct)),
      clamp(entryPrice * (1 + PROFIT_TARGET_SCALE_3 * stopPct)),
    ];
  } else {
    stopLevel = clamp(entryPrice * (1 + stopPct));
    profitTargets = [
      clamp(entryPrice * (1 - PROFIT_TARGET_SCALE_1 * stopPct)),
      clamp(entryPrice * (1 - PROFIT_TARGET_SCALE_2 * stopPct)),
      clamp(entryPrice * (1 - PROFIT_TARGET_SCALE_3 * stopPct)),
    ];
  }

  return {
    stopLevel,
    profitTargets,
    highWaterMark: entryPrice,
    trailingStop: stopLevel,
    hitTargets: [],
  };
}

/**
 * Update the trailing stop based on a new current price and the current ATR.
 * Returns a new (immutable) state object.
 *
 * `side` is taken explicitly because once the high-water mark moves past the
 * first profit target (the realistic trailing-stop case), inferring side from
 * `profitTargets[0] > highWaterMark` flips and corrupts the ratchet.
 */
export function updateTrailingStop(
  state: ExitStrategyState,
  currentPrice: number,
  atr: number,
  side: "yes" | "no",
): ExitStrategyState {
  let { highWaterMark, trailingStop } = state;

  if (side === "yes") {
    if (currentPrice > highWaterMark) {
      highWaterMark = currentPrice;
      const newTrailing = currentPrice - TRAILING_STOP_ATR_MULTIPLE * atr;
      trailingStop = Math.max(trailingStop, clamp(newTrailing));
    }
  } else {
    if (currentPrice < highWaterMark) {
      highWaterMark = currentPrice;
      const newTrailing = currentPrice + TRAILING_STOP_ATR_MULTIPLE * atr;
      trailingStop = Math.min(trailingStop, clamp(newTrailing));
    }
  }

  return { ...state, highWaterMark, trailingStop };
}

/**
 * Evaluate whether the current price triggers any exit condition.
 * Stop loss takes priority over trailing stop, which takes priority over
 * profit targets.
 */
export function checkExitConditions(
  state: ExitStrategyState,
  currentPrice: number,
  config: ExitStrategyConfig,
): ExitDecision {
  const { side } = config;
  const { stopLevel, trailingStop, profitTargets, hitTargets } = state;

  // 1. Hard stop loss
  if (side === "yes" && currentPrice <= stopLevel) {
    return { shouldExit: true, reason: "stop_loss", exitPrice: currentPrice };
  }
  if (side === "no" && currentPrice >= stopLevel) {
    return { shouldExit: true, reason: "stop_loss", exitPrice: currentPrice };
  }

  // 2. Trailing stop
  if (side === "yes" && currentPrice <= trailingStop) {
    return { shouldExit: true, reason: "trailing_stop", exitPrice: currentPrice };
  }
  if (side === "no" && currentPrice >= trailingStop) {
    return { shouldExit: true, reason: "trailing_stop", exitPrice: currentPrice };
  }

  // 3. Profit targets (in order, skip already-hit ones)
  const targetReasons: ExitReason[] = [
    "profit_target_1",
    "profit_target_2",
    "profit_target_3",
  ];

  for (let i = 0; i < profitTargets.length; i++) {
    if (hitTargets.includes(i)) continue;

    const target = profitTargets[i];
    const hit =
      side === "yes" ? currentPrice >= target : currentPrice <= target;

    if (hit) {
      return {
        shouldExit: true,
        reason: targetReasons[i],
        targetIndex: i + 1,
        exitPrice: currentPrice,
      };
    }
  }

  return { shouldExit: false };
}

/**
 * Simple ATR proxy: mean of consecutive absolute price differences.
 * Returns 0.01 when fewer than 2 prices are provided.
 */
export function calculateATR(priceHistory: number[]): number {
  if (priceHistory.length < 2) return 0.01;

  let totalRange = 0;
  for (let i = 1; i < priceHistory.length; i++) {
    totalRange += Math.abs(priceHistory[i] - priceHistory[i - 1]);
  }
  return totalRange / (priceHistory.length - 1);
}

/**
 * Tighten stop level as the market approaches resolution (options-style theta
 * decay). Returns state unchanged if more than CLOSE_RESOLUTION_HOURS remain
 * or no resolutionDate is set.
 */
export function applyTimeDecayToStops(
  state: ExitStrategyState,
  config: ExitStrategyConfig,
  now: Date = new Date(),
): ExitStrategyState {
  if (!config.resolutionDate) return { ...state };

  const hoursToResolution =
    (config.resolutionDate.getTime() - now.getTime()) / 3_600_000;

  if (hoursToResolution > CLOSE_RESOLUTION_HOURS) return { ...state };

  // tightenPct: 0 at CLOSE_RESOLUTION_HOURS, 0.5 at 0 hours remaining
  const tightenPct = (1 - hoursToResolution / CLOSE_RESOLUTION_HOURS) * 0.5;

  let newStopLevel: number;
  if (config.side === "yes") {
    // Move stop up (tighter) but keep it below entry price
    newStopLevel = Math.min(
      state.stopLevel * (1 + tightenPct),
      config.entryPrice - PRICE_MIN, // stay below entry
    );
  } else {
    // Move stop down (tighter) but keep it above entry price
    newStopLevel = Math.max(
      state.stopLevel * (1 - tightenPct),
      config.entryPrice + PRICE_MIN, // stay above entry
    );
  }

  return { ...state, stopLevel: clamp(newStopLevel) };
}
