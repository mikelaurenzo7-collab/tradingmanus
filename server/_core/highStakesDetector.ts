/**
 * High-stakes signal detector.
 *
 * The asymmetric ensemble runs Tier-1 (Claude Haiku) on every signal, but only
 * invokes Claude Sonnet 4.6 on the *high-stakes subset* — trades where a
 * single error would meaningfully dent the bankroll, or where the Tier-1
 * self-consistency check split suggests the model is uncertain.
 *
 * A signal qualifies as high-stakes if ANY of:
 *   1. notionalUsd                    ≥ HIGH_STAKES_NOTIONAL_USD     (default $8)
 *   2. notional / capital             ≥ HIGH_STAKES_PCT_OF_CAPITAL   (default 3%)
 *   3. minutes-to-resolution         ≤ HIGH_STAKES_RESOLUTION_MINUTES (default 1440 = 24h)
 *   4. Tier-1 self-consistency split (the two passes disagreed on direction OR
 *                                     EV adjustment differed by > 0.03)
 *
 * A signal qualifies as catastrophic-bet (extra-caution Tier-2 path) if:
 *   - notional / capital ≥ CATASTROPHIC_PCT_OF_CAPITAL (default 10%)
 */

import { ENV } from "./env";

export interface SignalForClassification {
  notionalUsd: number;
  capitalUsd: number;
  resolutionAtMs: number | null;
  tier1FirstPassApproved: boolean;
  tier1SecondPassApproved: boolean;
  tier1FirstEvAdjustment: number;
  tier1SecondEvAdjustment: number;
}

export interface HighStakesClassification {
  isHighStakes: boolean;
  isCatastrophicBet: boolean;
  triggers: {
    largeNotional: boolean;
    largePctOfCapital: boolean;
    nearResolution: boolean;
    selfConsistencySplit: boolean;
  };
  reasoning: string;
}

export function classifySignal(
  s: SignalForClassification,
): HighStakesClassification {
  const notionalCutoff = ENV.highStakesNotionalUsd;
  const pctCutoff = ENV.highStakesPctOfCapital;
  const minutesCutoff = ENV.highStakesResolutionMinutes;
  const catastrophicCutoff = ENV.catastrophicPctOfCapital;

  const pctOfCapital =
    s.capitalUsd > 0 ? s.notionalUsd / s.capitalUsd : Infinity;

  const minutesToResolution =
    s.resolutionAtMs !== null
      ? Math.max(0, (s.resolutionAtMs - Date.now()) / 60000)
      : Infinity;

  const dirSplit = s.tier1FirstPassApproved !== s.tier1SecondPassApproved;
  const evDelta = Math.abs(
    (s.tier1FirstEvAdjustment ?? 0) - (s.tier1SecondEvAdjustment ?? 0),
  );
  const evSplit = evDelta > 0.03;

  const triggers = {
    largeNotional: s.notionalUsd >= notionalCutoff,
    largePctOfCapital: pctOfCapital >= pctCutoff,
    nearResolution: minutesToResolution <= minutesCutoff,
    selfConsistencySplit: dirSplit || evSplit,
  };

  const isCatastrophicBet = pctOfCapital >= catastrophicCutoff;
  const isHighStakes = Object.values(triggers).some(Boolean) || isCatastrophicBet;

  const why: string[] = [];
  if (triggers.largeNotional)
    why.push(`notional $${s.notionalUsd.toFixed(2)} ≥ $${notionalCutoff}`);
  if (triggers.largePctOfCapital)
    why.push(
      `${(pctOfCapital * 100).toFixed(2)}% of capital ≥ ${(pctCutoff * 100).toFixed(0)}%`,
    );
  if (triggers.nearResolution)
    why.push(`${minutesToResolution.toFixed(0)}m to resolution`);
  if (triggers.selfConsistencySplit)
    why.push(
      `Tier-1 self-consistency split (${dirSplit ? "direction" : "EV Δ=" + evDelta.toFixed(3)})`,
    );
  if (isCatastrophicBet)
    why.push(
      `CATASTROPHIC-BET (${(pctOfCapital * 100).toFixed(2)}% ≥ ${(catastrophicCutoff * 100).toFixed(0)}%)`,
    );

  return {
    isHighStakes,
    isCatastrophicBet,
    triggers,
    reasoning: why.join("; ") || "low-stakes",
  };
}
