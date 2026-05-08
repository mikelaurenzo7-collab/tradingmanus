/**
 * Shared dual-bot consensus logic for the prediction-market trading reviewers.
 *
 * Both the Kalshi reviewer (`tradingReviewer.ts`) and the Polymarket reviewer
 * (`polymarketSignalReviewer.ts`) run Claude (primary) and Grok (parallel)
 * in parallel and intersect the verdicts: a trade is approved only if BOTH
 * bots return approved=true.  This module centralises the intersection
 * semantics so the two platforms cannot drift out of sync.
 *
 * Strict-mode rules:
 *   - When `strict=true` (Grok actually ran and returned ≥1 verdict): a
 *     marketId missing from Grok's response is a VETO.  This protects
 *     against partial / parse-truncated Grok output letting solo Claude
 *     approval reach execution under the team-mode banner.
 *   - When `strict=false` (Grok unavailable entirely — no key, network
 *     error, parse failure → empty reviews): Claude's verdict carries.
 *     Graceful degradation; audit log records grokFailures.
 */

export type ConsensusReview = {
  marketId: string;
  approved: boolean;
  confidenceAdjustment?: number;
  expectedValueAdjustment?: number;
  reasoning?: string;
};

export function intersectReviews(
  claudeReviewsByMarket: Map<string, ConsensusReview>,
  grokReviews: ConsensusReview[],
  strict: boolean,
): Map<string, ConsensusReview> {
  if (!strict && grokReviews.length === 0) {
    return claudeReviewsByMarket;
  }
  const grokByMarket = new Map(grokReviews.map((r) => [r.marketId, r]));
  const merged = new Map<string, ConsensusReview>();
  for (const [marketId, claudeReview] of claudeReviewsByMarket) {
    const grokReview = grokByMarket.get(marketId);
    if (!grokReview) {
      if (strict) {
        merged.set(marketId, {
          marketId,
          approved: false,
          reasoning: "Grok omitted this market from its response; dual-bot consensus requires both verdicts.",
        });
      } else {
        merged.set(marketId, claudeReview);
      }
      continue;
    }
    if (!claudeReview.approved || !grokReview.approved) {
      merged.set(marketId, {
        marketId,
        approved: false,
        reasoning: claudeReview.approved
          ? `Grok dissent: ${grokReview.reasoning ?? "(no reason)"}`
          : claudeReview.reasoning,
      });
      continue;
    }
    // Both approved — take the more conservative adjustments.
    const claudeConf = Number(claudeReview.confidenceAdjustment ?? 0);
    const grokConf = Number(grokReview.confidenceAdjustment ?? 0);
    const claudeEv = Number(claudeReview.expectedValueAdjustment ?? 0);
    const grokEv = Number(grokReview.expectedValueAdjustment ?? 0);
    merged.set(marketId, {
      marketId,
      approved: true,
      confidenceAdjustment: Math.min(claudeConf, grokConf),
      expectedValueAdjustment: Math.min(claudeEv, grokEv),
      reasoning: claudeReview.reasoning,
    });
  }
  return merged;
}
