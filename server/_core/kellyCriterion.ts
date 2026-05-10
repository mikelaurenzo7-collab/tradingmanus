/**
 * Kelly Criterion position sizing for prediction markets.
 *
 * For a binary market where:
 *   p = estimated probability of winning
 *   q = 1 - p (probability of losing)
 *   b = net odds (amount won per dollar bet, i.e. (1 - marketPrice) / marketPrice)
 *
 * Full Kelly fraction: f* = (p * b - q) / b = p - q/b
 *
 * The fractional-Kelly multiplier and the per-position max are sourced from
 * ENV.profitGuardrails so operator overrides via KELLY_FRACTION / KELLY_MAX_
 * PCT_OF_CAPITAL actually take effect.  Until May 2026 these constants were
 * hardcoded at 0.25/0.25 (quarter-Kelly) which silently overrode the env
 * defaults of 0.50/0.25, halving every recommended bet size.
 */

import { ENV } from "./env";

const MIN_KELLY_FRACTION = 0; // Never negative (no shorting prediction markets)

/** Resolves the active fractional-Kelly multiplier from env. */
function getFractionalKelly(): number {
  const v = ENV.profitGuardrails.kellyFraction;
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.5;
}

/** Resolves the active per-position max as a fraction of capital. */
function getMaxKellyFraction(): number {
  const v = ENV.profitGuardrails.kellyMaxPctOfCapital;
  return Number.isFinite(v) && v > 0 && v <= 1 ? v : 0.25;
}

export interface KellyInput {
  /** p: estimated probability of winning (0–1) */
  winProbability: number;
  /** Net odds: amount won per dollar bet. For binary market at price P: netOdds = (1-P)/P */
  netOdds: number;
  /** Total available capital in dollars */
  totalCapital: number;
}

export interface KellyResult {
  /** f* before fractional scaling (may be negative for negative-EV bets) */
  fullKellyFraction: number;
  /** fractionalKellyFraction = ENV.profitGuardrails.kellyFraction × fullKellyFraction, clamped to [0, kellyMaxPctOfCapital] */
  fractionalKellyFraction: number;
  /** fractionalKellyFraction × totalCapital, in dollars */
  kellySuggestedSize: number;
  /** true when EV > 0 and fullKellyFraction > 0 */
  isPositiveEV: boolean;
}

/**
 * Calculate Kelly Criterion fraction and suggested position size.
 *
 * Guards:
 * - EV ≤ 0 → return zero fractions (no edge)
 * - winProbability ≤ 0 → return zero fractions
 * - winProbability ≥ 1 → cap at MAX_KELLY_FRACTION (guaranteed win, bet max allowed)
 * - totalCapital ≤ 0 → kellySuggestedSize = 0
 */
export function calculateKelly(input: KellyInput): KellyResult {
  const { winProbability, netOdds: expectedValue, totalCapital } = input;

  const zero: KellyResult = {
    fullKellyFraction: 0,
    fractionalKellyFraction: 0,
    kellySuggestedSize: 0,
    isPositiveEV: false,
  };

  // Guard: invalid or non-finite inputs
  if (
    !Number.isFinite(winProbability) ||
    !Number.isFinite(expectedValue) ||
    !Number.isFinite(totalCapital)
  ) {
    return zero;
  }

  // Guard: no edge or zero/negative EV
  if (expectedValue <= 0 || winProbability <= 0) {
    return zero;
  }

  // Guard: guaranteed win — cap at the per-position max
  if (winProbability >= 1) {
    const fraction = getMaxKellyFraction();
    const capital = Math.max(0, totalCapital);
    return {
      fullKellyFraction: 1, // theoretical full Kelly → infinity, practical cap
      fractionalKellyFraction: fraction,
      kellySuggestedSize: fraction * capital,
      isPositiveEV: true,
    };
  }

  const p = winProbability;
  const q = 1 - p;
  const b = expectedValue; // net odds

  // Full Kelly: f* = (p*b - q) / b
  const fullKelly = (p * b - q) / b;

  const fractionalKelly = Math.max(
    MIN_KELLY_FRACTION,
    Math.min(getMaxKellyFraction(), fullKelly * getFractionalKelly()),
  );

  const capital = Math.max(0, totalCapital);
  const kellySuggestedSize = fractionalKelly * capital;

  return {
    fullKellyFraction: fullKelly,
    fractionalKellyFraction: fractionalKelly,
    kellySuggestedSize,
    isPositiveEV: fullKelly > 0,
  };
}

/**
 * Apply Kelly sizing conservatively: returns the smaller of `currentSize`
 * and `kellyResult.kellySuggestedSize`.
 *
 * Kelly can only reduce a position size relative to what the risk guardrails
 * already allow — it never increases beyond the original estimate.
 */
export function applyKellyToPositionSize(
  currentSize: number,
  kellyResult: KellyResult,
): number {
  if (kellyResult.kellySuggestedSize <= 0) return 0;
  return Math.min(currentSize, kellyResult.kellySuggestedSize);
}
