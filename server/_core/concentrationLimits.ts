/**
 * Concentration limits — block over-exposure to correlated events.
 *
 * "Will candidate X win the primary?", "Will candidate X be the nominee?",
 * "Will candidate X win the general?" are three different markets that
 * resolve on the same underlying truth.  A bot that takes a position in
 * each of them ends up with 3x the exposure to one outcome — a
 * concentration risk that shows up as a 3x drawdown if the underlying
 * thesis is wrong.
 *
 * This module uses the same Jaccard-similarity machinery the cross-bot
 * arbitrage scanner uses to detect "looks-like-the-same-event" markets,
 * then blocks new positions when:
 *   1. There's already an open position in a similar market (by title or
 *      question text) on either platform.
 *   2. The existing same-category exposure exceeds a per-category cap.
 */

import { ENV } from "./env";

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "of", "on", "in",
  "to", "for", "and", "or", "by", "with", "at", "as", "will", "would", "could",
  "should", "do", "does", "did", "this", "that", "than", "before", "after",
  "vs", "vs.", "win", "wins", "winning", "lose", "loses", "losing",
]);

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOPWORDS.has(w)),
  );
}

/** Jaccard similarity of token sets. */
export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  setA.forEach((t) => {
    if (setB.has(t)) intersection += 1;
  });
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export type ExistingExposure = {
  marketId: string;
  /** Question / title text used for similarity matching. */
  text: string;
  /** Category bucket for category-level cap checks. */
  category: string;
  /** Notional dollar exposure of this open position. */
  notionalUsd: number;
};

export type ConcentrationCheckInput = {
  /** The candidate trade we're considering opening. */
  candidate: {
    text: string;
    category: string;
    notionalUsd: number;
  };
  /** All currently open positions across both platforms. */
  existingExposure: ExistingExposure[];
  /** Total account equity for percentage-of-equity caps. */
  equity: number;
  /** Override threshold for "this is the same event" similarity. */
  similarityThresholdOverride?: number;
  /** Override the same-category cap (fraction of equity). */
  categoryCapFractionOverride?: number;
};

export type ConcentrationCheckResult =
  | { allowed: true; reason: "ok" }
  | {
      allowed: false;
      reason: "correlated_event_already_held" | "category_cap_breached";
      details: string;
    };

/**
 * Run the concentration checks for a candidate trade.  Returns
 * { allowed: false, ... } if any cap would be breached by adding this
 * trade; otherwise { allowed: true }.
 */
export function checkConcentration(
  input: ConcentrationCheckInput,
): ConcentrationCheckResult {
  const similarityThreshold =
    input.similarityThresholdOverride ?? ENV.concentrationSimilarityThreshold;
  const categoryCapFraction =
    input.categoryCapFractionOverride ?? ENV.concentrationCategoryCapFraction;

  // Rule 1: refuse if there is an existing open position whose text is
  // similar enough to the candidate that they likely resolve on the same
  // underlying event.
  for (const existing of input.existingExposure) {
    const sim = jaccardSimilarity(existing.text, input.candidate.text);
    if (sim >= similarityThreshold) {
      return {
        allowed: false,
        reason: "correlated_event_already_held",
        details: `existing position in ${existing.marketId} ("${existing.text.slice(0, 60)}") matches candidate at jaccard=${sim.toFixed(2)} (>= ${similarityThreshold})`,
      };
    }
  }

  // Rule 2: same-category exposure cap.
  if (input.equity > 0) {
    const categoryExposure = input.existingExposure
      .filter(
        (e) => e.category.toLowerCase() === input.candidate.category.toLowerCase(),
      )
      .reduce((sum, e) => sum + e.notionalUsd, 0);
    const wouldBeExposure = categoryExposure + input.candidate.notionalUsd;
    const wouldBeFraction = wouldBeExposure / input.equity;
    if (wouldBeFraction > categoryCapFraction) {
      return {
        allowed: false,
        reason: "category_cap_breached",
        details: `category=${input.candidate.category} would-be exposure ${wouldBeExposure.toFixed(2)} / equity ${input.equity.toFixed(2)} = ${(wouldBeFraction * 100).toFixed(1)}% (cap ${(categoryCapFraction * 100).toFixed(1)}%)`,
      };
    }
  }

  return { allowed: true, reason: "ok" };
}
