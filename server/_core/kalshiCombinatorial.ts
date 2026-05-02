/**
 * Kalshi Combinatorial Arbitrage
 *
 * Detects arbitrage opportunities across related Kalshi markets by applying
 * logical constraints between their implied probabilities.
 *
 * Two classes of opportunity are detected:
 *
 * 1. **Sum-to-one violation** (mutually exclusive + exhaustive outcomes):
 *    When a set of markets covers all possible outcomes of an event and their
 *    YES prices sum to ≠ $1, guaranteed arbitrage exists.
 *    e.g. "Biden wins" + "Trump wins" + "Other wins" must sum to $1.
 *
 * 2. **Logical implication violation**:
 *    Market A logically implies Market B, so P(A) ≤ P(B) must hold.
 *    e.g. "Republicans win PA by 5%+" implies "Republicans win PA", so
 *    the former price must be ≤ the latter.
 *
 * Based on: arXiv:2508.03474 "Unravelling the Probabilistic Forest:
 * Arbitrage in Prediction Markets" (historical Polymarket data, Apr 2024–Apr 2025).
 */

export interface ArbitrageMarket {
  marketId: string;
  title: string;
  category: string;
  impliedProbabilityYes: number;
  yesPrice: number;
  noPrice: number;
  volume: number;
  liquidity: number;
}

export type CombinatorialArbitrageType =
  | "sum_exceeds_one"    // YES prices sum > $1 → sell the overpriced side
  | "sum_below_one"      // YES prices sum < $1 → buy all YESes for guaranteed profit
  | "implication_violation"; // P(A) > P(B) when A logically implies B

export interface CombinatorialArbitrageOpportunity {
  type: CombinatorialArbitrageType;
  markets: ArbitrageMarket[];
  /** Market(s) to trade and the recommended side */
  trades: Array<{
    marketId: string;
    title: string;
    side: "yes" | "no";
    /** Current price of the recommended side */
    currentPrice: number;
    /** Maximum guaranteed profit per $1 wagered if arbitrage holds */
    expectedProfitPerDollar: number;
  }>;
  /** Sum of YES prices across the group */
  impliedProbabilitySum: number;
  /** Guaranteed profit per $1 invested (before fees) */
  guaranteedProfit: number;
  confidence: number;
  reasoning: string;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
}

/**
 * Group markets that appear to cover the same event and check whether their
 * YES prices violate the sum-to-one constraint.
 *
 * Grouping heuristic: markets in the same category whose titles share a
 * common prefix keyword (e.g. "2024 US Presidential Election:").
 */
export function detectSumToOneArbitrage(
  markets: ArbitrageMarket[],
  options: {
    /** Minimum sum excess to treat as actionable. Default 0.03 (3%). */
    minSumDeviation?: number;
    /** Minimum liquidity per market in the group. Default $500. */
    minLiquidity?: number;
    /** Maximum group size. Larger groups have exponential complexity. */
    maxGroupSize?: number;
  } = {},
): CombinatorialArbitrageOpportunity[] {
  const {
    minSumDeviation = 0.03,
    minLiquidity = 500,
    maxGroupSize = 8,
  } = options;

  const opportunities: CombinatorialArbitrageOpportunity[] = [];

  // Only work with liquid markets
  const liquid = markets.filter(
    (m) =>
      m.liquidity >= minLiquidity &&
      Number.isFinite(m.impliedProbabilityYes) &&
      m.impliedProbabilityYes > 0.01 &&
      m.impliedProbabilityYes < 0.99,
  );

  // Build category groups
  const byCat = new Map<string, ArbitrageMarket[]>();
  for (const m of liquid) {
    const cat = m.category.toLowerCase().trim();
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push(m);
  }

  for (const [, group] of Array.from(byCat)) {
    if (group.length < 2) continue;

    // Build sub-groups of markets that share a common title prefix
    // (up to the first colon or dash) — a simple proxy for "same event"
    const subGroups = buildTitleSubGroups(group, maxGroupSize);

    for (const subGroup of subGroups) {
      if (subGroup.length < 2) continue;

      const sumYes = subGroup.reduce((s, m) => s + m.impliedProbabilityYes, 0);
      const deviation = Math.abs(sumYes - 1);

      if (deviation < minSumDeviation) continue;

      const avgLiquidity = subGroup.reduce((s, m) => s + m.liquidity, 0) / subGroup.length;
      const confidence = clamp(0.55 + Math.min(0.35, deviation * 2), 0, 0.9);

      if (sumYes > 1 + minSumDeviation) {
        // Sum > 1: all YES sides are collectively over-priced.
        // Sell the most over-priced market's YES (buy NO).
        const target = subGroup.slice().sort((a, b) => b.impliedProbabilityYes - a.impliedProbabilityYes)[0]!;
        const noPrice = clamp(1 - target.impliedProbabilityYes, 0.02, 0.98);
        const profit = sumYes - 1;

        opportunities.push({
          type: "sum_exceeds_one",
          markets: subGroup,
          trades: [
            {
              marketId: target.marketId,
              title: target.title,
              side: "no",
              currentPrice: noPrice,
              expectedProfitPerDollar: clamp(profit / noPrice, 0, 10),
            },
          ],
          impliedProbabilitySum: sumYes,
          guaranteedProfit: profit,
          confidence,
          reasoning:
            `Sum-to-one violation: ${subGroup.length} related "${group[0]!.category}" markets ` +
            `have YES prices summing to ${(sumYes * 100).toFixed(1)}¢ (should be $1.00). ` +
            `Excess: ${(profit * 100).toFixed(1)}¢. ` +
            `Fade the most overpriced YES: "${target.title}" by buying NO at ${(noPrice * 100).toFixed(1)}¢. ` +
            `Avg group liquidity: $${avgLiquidity.toFixed(0)}.`,
        });
      } else if (sumYes < 1 - minSumDeviation) {
        // Sum < 1: all YES sides are collectively under-priced.
        // Buy all YES sides — regardless of outcome, one of them resolves YES.
        const profit = 1 - sumYes;
        const totalCost = sumYes;

        opportunities.push({
          type: "sum_below_one",
          markets: subGroup,
          trades: subGroup.map((m) => ({
            marketId: m.marketId,
            title: m.title,
            side: "yes" as const,
            currentPrice: clamp(m.impliedProbabilityYes, 0.02, 0.98),
            expectedProfitPerDollar: clamp(profit / totalCost, 0, 10),
          })),
          impliedProbabilitySum: sumYes,
          guaranteedProfit: profit,
          confidence,
          reasoning:
            `Sum-below-one violation: ${subGroup.length} mutually exclusive "${group[0]!.category}" markets ` +
            `sum to ${(sumYes * 100).toFixed(1)}¢. Buying all YES sides guarantees ` +
            `${(profit * 100).toFixed(1)}¢ profit per $1 invested (${((profit / totalCost) * 100).toFixed(1)}% return). ` +
            `Avg group liquidity: $${avgLiquidity.toFixed(0)}.`,
        });
      }
    }
  }

  return opportunities.sort((a, b) => b.guaranteedProfit - a.guaranteedProfit);
}

/**
 * Detect logical implication violations between pairs of markets.
 *
 * If market A's outcome logically implies market B's outcome, then
 * P(A) must be ≤ P(B).  When P(A) > P(B) + threshold, arbitrage exists:
 * - Sell YES on the over-priced A (or equivalently, buy NO on A)
 * - Buy YES on the under-priced B
 *
 * Implication detection heuristic:
 *   "…by X%+" → implies the base event (e.g., "Republicans win PA by 5%+"
 *   implies "Republicans win PA")
 */
export function detectImplicationViolations(
  markets: ArbitrageMarket[],
  options: {
    /** Minimum probability violation to act on. Default 0.05. */
    minViolation?: number;
    minLiquidity?: number;
  } = {},
): CombinatorialArbitrageOpportunity[] {
  const { minViolation = 0.05, minLiquidity = 500 } = options;

  const liquid = markets.filter(
    (m) =>
      m.liquidity >= minLiquidity &&
      Number.isFinite(m.impliedProbabilityYes) &&
      m.impliedProbabilityYes > 0.01 &&
      m.impliedProbabilityYes < 0.99,
  );

  const opportunities: CombinatorialArbitrageOpportunity[] = [];

  for (let i = 0; i < liquid.length; i++) {
    for (let j = 0; j < liquid.length; j++) {
      if (i === j) continue;
      const a = liquid[i]!;
      const b = liquid[j]!;

      if (a.category.toLowerCase() !== b.category.toLowerCase()) continue;

      // Heuristic: does a's title appear to be a stricter version of b's?
      if (!isLikelyImplication(a.title, b.title)) continue;

      const pA = a.impliedProbabilityYes;
      const pB = b.impliedProbabilityYes;

      // P(A) must be ≤ P(B) if A implies B.  Violation when P(A) > P(B).
      const violation = pA - pB;
      if (violation <= minViolation) continue;

      const confidence = clamp(0.55 + Math.min(0.30, violation * 2), 0, 0.88);
      const profitPerDollar = violation;

      opportunities.push({
        type: "implication_violation",
        markets: [a, b],
        trades: [
          {
            marketId: a.marketId,
            title: a.title,
            side: "no",
            currentPrice: clamp(1 - pA, 0.02, 0.98),
            expectedProfitPerDollar: clamp(violation / (1 - pA), 0, 10),
          },
          {
            marketId: b.marketId,
            title: b.title,
            side: "yes",
            currentPrice: clamp(pB, 0.02, 0.98),
            expectedProfitPerDollar: clamp(violation / pB, 0, 10),
          },
        ],
        impliedProbabilitySum: pA + pB,
        guaranteedProfit: profitPerDollar,
        confidence,
        reasoning:
          `Logical implication violation: "${a.title}" (P=${(pA * 100).toFixed(1)}%) ` +
          `appears to imply "${b.title}" (P=${(pB * 100).toFixed(1)}%), ` +
          `but A's price exceeds B's by ${(violation * 100).toFixed(1)}pp. ` +
          `Arbitrage: buy NO on A at ${((1 - pA) * 100).toFixed(1)}¢ and ` +
          `YES on B at ${(pB * 100).toFixed(1)}¢.`,
      });
    }
  }

  return opportunities.sort((a, b) => b.guaranteedProfit - a.guaranteedProfit);
}

/**
 * Run all combinatorial arbitrage detectors and return deduplicated results.
 */
export function detectAllCombinatorialArbitrage(
  markets: ArbitrageMarket[],
  options: {
    minSumDeviation?: number;
    minViolation?: number;
    minLiquidity?: number;
  } = {},
): CombinatorialArbitrageOpportunity[] {
  const sumOpps = detectSumToOneArbitrage(markets, {
    minSumDeviation: options.minSumDeviation,
    minLiquidity: options.minLiquidity,
  });
  const implOpps = detectImplicationViolations(markets, {
    minViolation: options.minViolation,
    minLiquidity: options.minLiquidity,
  });

  // Deduplicate by market pair key
  const seen = new Set<string>();
  const deduped: CombinatorialArbitrageOpportunity[] = [];

  for (const opp of [...sumOpps, ...implOpps]) {
    const key = opp.markets
      .map((m) => m.marketId)
      .sort()
      .join("|");
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(opp);
    }
  }

  return deduped.sort((a, b) => b.guaranteedProfit - a.guaranteedProfit);
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Group markets into sub-groups whose titles share a common prefix.
 * The prefix is extracted as the text before the first ":" or " vs " or " -".
 */
function buildTitleSubGroups(
  markets: ArbitrageMarket[],
  maxGroupSize: number,
): ArbitrageMarket[][] {
  const prefixMap = new Map<string, ArbitrageMarket[]>();

  for (const m of markets) {
    const prefix = extractTitlePrefix(m.title);
    if (!prefixMap.has(prefix)) prefixMap.set(prefix, []);
    prefixMap.get(prefix)!.push(m);
  }

  const groups: ArbitrageMarket[][] = [];
  for (const [, group] of Array.from(prefixMap)) {
    if (group.length >= 2 && group.length <= maxGroupSize) {
      groups.push(group);
    }
    // If > maxGroupSize, still create groups of up to maxGroupSize
    if (group.length > maxGroupSize) {
      for (let i = 0; i < group.length; i += maxGroupSize) {
        const slice = group.slice(i, i + maxGroupSize);
        if (slice.length >= 2) groups.push(slice);
      }
    }
  }

  return groups;
}

function extractTitlePrefix(title: string): string {
  const lower = title.toLowerCase().trim();
  // Split on ":", " vs ", " - ", or " winner"
  const separators = [":", " vs ", " - ", " winner", " wins?", " will "];
  for (const sep of separators) {
    const idx = lower.indexOf(sep);
    if (idx > 8 && idx < 80) {
      return lower.slice(0, idx).trim();
    }
  }
  // Fall back to first 40 chars
  return lower.slice(0, 40).trim();
}

/**
 * Heuristic: title A looks like a stricter constraint than title B.
 * Examples:
 *   A = "Will Republicans win PA by 5+ points?" → implies
 *   B = "Will Republicans win PA?"
 */
function isLikelyImplication(titleA: string, titleB: string): boolean {
  const a = titleA.toLowerCase();
  const b = titleB.toLowerCase();

  if (a === b) return false;

  // A is stricter if it contains a margin qualifier that B does not
  const marginQualifiers = [
    "by 5", "by 10", "by 15", "by 20",
    "> 5%", "> 10%", "> 15%", "> 20%",
    "at least", "or more", "or higher",
    "+5", "+10", "+15", "+20",
  ];

  const aHasMargin = marginQualifiers.some((q) => a.includes(q));
  const bHasMargin = marginQualifiers.some((q) => b.includes(q));

  if (!aHasMargin || bHasMargin) return false;

  // B should look like a base version of A (same core entity)
  // Simple check: most words in B appear in A
  const bWords = b.split(/\s+/).filter((w) => w.length > 3);
  if (bWords.length === 0) return false;
  const matchCount = bWords.filter((w) => a.includes(w)).length;
  return matchCount / bWords.length >= 0.6;
}
