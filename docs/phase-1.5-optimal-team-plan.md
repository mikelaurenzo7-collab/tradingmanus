# Phase 1.5 — Optimal Claude Team

> Inserted into the hardening sequence at operator request after Phase 1
> shipped. Scope: small, additive — does NOT change the hard guardrails
> introduced by Phase 1 (every EV/confidence/cold-streak/exposure/drawdown
> floor still fires).

## Goal

Concentrate AI compute where it changes the trade decision, leave it
cheap where it doesn't. Specifically:

1. **Catch Haiku model-flake on borderline trades** — random sampling
   variance can flip an `approved` verdict back-and-forth across two
   stochastic samples even with identical inputs. We add Haiku
   self-consistency: two parallel passes at different temperatures, both
   must approve, disagreement auto-escalates to Sonnet.
2. **Concentrate Sonnet on actually-borderline trades** — current threshold
   is `notional ≥ 3 % of capital`. At a $300-500 bankroll, that's $9-15.
   Reasonable but slightly loose. Tighten to 2 % and add tail-probability +
   self-consistency-split triggers.
3. **Keep Opus** for the rare catastrophic / contested-high-EV cases. The
   Opus tier was the only safety net for true outliers; removing it would
   create a single-point-of-failure for trades that could materially dent
   the bankroll.

## Non-goals

- No fee-aware EV math (that's Phase 2).
- No calibration auto-pause (that's Phase 4).
- No per-category Brier-score routing (that's Phase 4 / 5).
- No prompt cache surgery (that's Phase 5).

## Architecture

```
Tier 1: Haiku 4.5 (self-consistency)
  • Pass A: temp=0.2 (deterministic floor)
  • Pass B: temp=0.7 (creative variance)
  • Intersect approvals:
      A✓ + B✓ → APPROVE, average the confidence/EV adjustments
      A✗ + B✗ → REJECT
      A✓ + B✗ or A✗ + B✓ → ESCALATE to Sonnet tiebreaker
  • Cache makes pass B's input tokens essentially free

Tier 2: Sonnet 4.6 (extended thinking) — fires on ANY of:
  • Notional ≥ HIGH_STAKES_PCT_OF_CAPITAL (default tightened 0.03 → 0.02)
  • Resolution ≤ HIGH_STAKES_RESOLUTION_MINUTES (default tightened 1440 → 2160 → 36 h)
  • Tail probability impliedProbability ≤ 0.10 or ≥ 0.90
  • Confidence ≥ 0.80
  • Tier-1 self-consistency split (NEW)

Tier 3: Opus 4.7 — UNCHANGED behavior, tightened thresholds:
  • Catastrophic-bet (notional ≥ CATASTROPHIC_PCT_OF_CAPITAL,
    default tightened 0.10 → 0.08)
  • Sonnet contests Tier-1 approval AND gross EV ≥
    OPUS_ESCALATION_MIN_GROSS_EV (default tightened 0.05 → 0.07)
```

## Cost projection

Per firing tick (post prompt-cache warm-up):

| Tier | Tokens (in/out) | Cost/call |
|---|---|---|
| Haiku call A | 600 fresh + 2400 cache-create + 800 out | ~$0.005 |
| Haiku call B | 0 fresh + 3000 cache-read + 800 out | ~$0.004 |
| Sonnet | 600 fresh + 2400 cache-read + 1500 out | ~$0.025 |
| Opus | 600 fresh + 2400 cache-read + 4000 out | ~$0.310 |

At 60 firing ticks/day × call counts:

- Haiku self-consistency: 60 × $0.009 = **$0.54**
- Sonnet escalation: ~12 calls × $0.025 = **$0.30**
  - ~9 from high-stakes triggers (notional/resolution/tail/confidence)
  - ~3 from self-consistency splits (~5 % split rate × 60 ticks)
- Opus rare review: ~0.5 × $0.31 = **$0.16**
- **Total: ~$1.00 / day = ~$30 / month**

vs current ~$0.50/day = ~$15/month. Roughly 2× cost for materially better
coverage on the failure modes most likely to lose money at this bankroll.

## Files to modify

| Path | Change |
|---|---|
| `server/_core/env.ts` | Add `claudeSelfConsistency*` env vars (enabled, temp1, temp2, escalateOnSplit). Tighten `HIGH_STAKES_PCT_OF_CAPITAL` 0.03 → 0.02, `HIGH_STAKES_RESOLUTION_MINUTES` 1440 → 2160, `CATASTROPHIC_PCT_OF_CAPITAL` 0.10 → 0.08, `OPUS_ESCALATION_MIN_GROSS_EV` 0.05 → 0.07. |
| `server/_core/tradingReviewer.ts` | Modify `requestAnthropicReviews` to accept a temperature override (so a single call can request Pass A or Pass B). Add a `runSelfConsistency` helper that runs both passes in parallel and intersects. Modify `runCategoryReview` to surface "self-consistency split" markets for the ensemble's Sonnet escalation. |
| `server/_core/polymarketSignalReviewer.ts` | Same pattern. |
| `server/_core/ensembleConsensus.ts` | Add a `tier1SelfConsistencySplit` field on `Tier1Verdict`; when true, force Sonnet escalation regardless of high-stakes classification. |
| `server/_core/highStakesDetector.ts` | Add `tier1SelfConsistencySplit` as an additional `isHighStakes` trigger (so Sonnet fires automatically). |
| `.env.example` | Document the new self-consistency knobs. |
| `README.md` | Update the AI-tier table to reflect self-consistency on Tier 1. |

## New tests

`server/tradingReviewer.selfConsistency.test.ts`:

1. Both passes approve with similar adjustments → APPROVE with averaged adjustments.
2. Both passes reject → REJECT.
3. Disagreement → marked for Sonnet escalation (no plain veto).
4. Self-consistency disabled via env → falls back to single-pass behavior.
5. No network calls (mocked).

## Acceptance — Phase 1.5

- [ ] `corepack pnpm typecheck` — green
- [ ] `corepack pnpm test -- --run` — green; new tests pass
- [ ] `corepack pnpm build` — green
- [ ] Audit log on next autonomy tick shows self-consistency stats:
      `tier1SelfConsistencyCalls`, `tier1SelfConsistencySplits`,
      `tier1SelfConsistencyEscalations`.
- [ ] PR body includes one Railway-log snippet showing both Haiku passes
      firing and the resulting verdict (or paper-mode equivalent).

## Rollback

`CLAUDE_HAIKU_SELF_CONSISTENCY_ENABLED=false` instantly reverts to single-pass
behavior. Threshold tightenings revert via the standard env knobs.
Fully revertable PR with no schema or data changes.
