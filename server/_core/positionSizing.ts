/**
 * Kelly-fractional position sizing.
 *
 * The full Kelly criterion sizes each bet at f* = (bp - q) / b, where
 *   p = win probability,
 *   q = 1 - p,
 *   b = net odds (payoff per $1 risked given a win).
 *
 * Full Kelly maximizes long-run geometric growth but has *brutal* short-run
 * drawdowns — empirically Kelly users routinely take 50%+ drawdowns.  We
 * use a fractional Kelly (default 25%) with hard caps on equity fraction,
 * which loses a small amount of theoretical growth in exchange for
 * surviving the inevitable streak of bad luck without blowing up the
 * account.
 *
 * For binary prediction markets the math simplifies:
 *   Buy YES at price p_market with belief p_belief about resolution=YES.
 *   If YES resolves, payoff per $1 = (1 / p_market) - 1 = (1 - p_market) / p_market.
 *   If NO resolves, you lose your stake.
 *   Win probability = p_belief, lose probability = 1 - p_belief.
 *   Kelly fraction f* = (p_belief * (1 - p_market) / p_market - (1 - p_belief)) / ((1 - p_market) / p_market)
 *                     = p_belief - (1 - p_belief) * p_market / (1 - p_market)
 *   Simplified: f* = (p_belief - p_market) / (1 - p_market)
 *
 * For NO bets just substitute (1 - p_belief) and (1 - p_market).
 *
 * Edge cases:
 *   - f* <= 0 → no positive expectancy, bet 0.
 *   - f* > 1 → cap at 1 (would never want to bet more than equity anyway).
 *   - Apply user's fractional Kelly multiplier (default 0.25) for safety.
 *   - Apply hard cap (default 5% of equity) so even Kelly's recommendation
 *     can't drive concentration risk.
 */

export type KellySizingInput = {
  /** Side being bet on. */
  side: "yes" | "no";
  /** Current market price for YES (must be in (0, 1)). */
  marketYesPrice: number;
  /**
   * Strategy's belief about resolution=YES probability (must be in (0, 1)).
   * Sourced from signal.confidence + signal direction, OR an explicit
   * fundamental estimate if available.
   */
  beliefYesProbability: number;
  /** Account equity in dollars. */
  equity: number;
  /**
   * Fraction of full Kelly to actually deploy.  0.25 = quarter Kelly,
   * 0.5 = half Kelly, 1.0 = full Kelly (NOT recommended in production).
   */
  kellyFraction?: number;
  /**
   * Hard cap on bet size as a fraction of equity, regardless of Kelly's
   * recommendation.  Default 0.05 = no single bet > 5% of equity.
   */
  maxFractionOfEquity?: number;
  /**
   * Optional minimum bet size in dollars.  If Kelly's recommendation is
   * non-zero but below this, the bet is dropped (avoids dust orders that
   * cost more in fees than they can earn).
   */
  minBetDollars?: number;
};

export type KellySizingResult = {
  /** Recommended bet size in dollars. 0 means "do not bet". */
  betDollars: number;
  /** The raw Kelly fraction (before fractional Kelly + caps). */
  fullKellyFraction: number;
  /** Effective fraction of equity actually being bet. */
  effectiveFraction: number;
  /**
   * Reason this size was chosen, useful for audit logs.  One of:
   *   "no_edge"      — Kelly says don't bet
   *   "below_min"    — sized but below minimum
   *   "kelly_capped" — Kelly fraction exceeded the equity cap
   *   "kelly_sized"  — sized at fractional Kelly within caps
   *   "invalid"      — input out of bounds
   */
  reason:
    | "no_edge"
    | "below_min"
    | "kelly_capped"
    | "kelly_sized"
    | "invalid";
};

function clamp(value: number, lo: number, hi: number) {
  if (!Number.isFinite(value)) return lo;
  return Math.max(lo, Math.min(hi, value));
}

/**
 * Compute the Kelly bet size for a binary-market trade.  All inputs are
 * defensively clamped — this never throws, even on absurd input, so it
 * can be called from the hot path of the autonomy loop.
 */
export function computeKellyBet(input: KellySizingInput): KellySizingResult {
  const kellyFraction = clamp(input.kellyFraction ?? 0.25, 0, 1);
  const maxFraction = clamp(input.maxFractionOfEquity ?? 0.05, 0, 1);
  const minBet = Math.max(0, input.minBetDollars ?? 0);

  // Defensive bounds checking.
  if (
    !Number.isFinite(input.equity) ||
    input.equity <= 0 ||
    !Number.isFinite(input.marketYesPrice) ||
    input.marketYesPrice <= 0 ||
    input.marketYesPrice >= 1 ||
    !Number.isFinite(input.beliefYesProbability) ||
    input.beliefYesProbability <= 0 ||
    input.beliefYesProbability >= 1
  ) {
    return {
      betDollars: 0,
      fullKellyFraction: 0,
      effectiveFraction: 0,
      reason: "invalid",
    };
  }

  // Convert (side, market YES price, belief YES prob) into the (price, belief)
  // for the side being bet on.
  const marketPrice =
    input.side === "yes" ? input.marketYesPrice : 1 - input.marketYesPrice;
  const beliefWin =
    input.side === "yes" ? input.beliefYesProbability : 1 - input.beliefYesProbability;

  // Kelly for binary at decimal odds 1/marketPrice (so net odds = (1-marketPrice)/marketPrice).
  // f* = (belief - marketPrice) / (1 - marketPrice)
  const kelly = (beliefWin - marketPrice) / (1 - marketPrice);

  if (!Number.isFinite(kelly) || kelly <= 0) {
    return {
      betDollars: 0,
      fullKellyFraction: kelly,
      effectiveFraction: 0,
      reason: "no_edge",
    };
  }

  const fractional = kelly * kellyFraction;
  const cappedFraction = Math.min(fractional, maxFraction, 1);
  const wasCapped = fractional > maxFraction;

  const betDollars = cappedFraction * input.equity;

  if (betDollars < minBet) {
    return {
      betDollars: 0,
      fullKellyFraction: kelly,
      effectiveFraction: cappedFraction,
      reason: "below_min",
    };
  }

  return {
    betDollars,
    fullKellyFraction: kelly,
    effectiveFraction: cappedFraction,
    reason: wasCapped ? "kelly_capped" : "kelly_sized",
  };
}

/**
 * Convenience: derive a belief probability from a signal's confidence and
 * its declared direction.
 *
 * The signal generators emit `confidence` in [0, 1] meaning "how strongly
 * the strategy believes this side wins".  Map to a YES probability:
 *   side=yes, confidence=c → belief P(YES)=c (clamped)
 *   side=no,  confidence=c → belief P(YES)=1-c (clamped)
 *
 * In production we'd want a calibrated mapping (a confidence of 0.7 doesn't
 * literally mean 70% chance of YES — strategies are uncalibrated until you
 * fit their actual hit rate to claimed confidence).  For an MVP this naive
 * mapping is the right starting point; once we have hit-rate data we can
 * fit a calibration curve.
 */
export function beliefFromSignal(
  signalSide: "yes" | "no",
  signalConfidence: number,
  options: { calibration?: (raw: number) => number } = {},
): number {
  const cal = options.calibration ?? ((x) => x);
  const calibrated = clamp(cal(clamp(signalConfidence, 0, 1)), 0.01, 0.99);
  return signalSide === "yes" ? calibrated : 1 - calibrated;
}
