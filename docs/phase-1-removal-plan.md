# Phase 1 — Removal Plan: xAI/Grok → Claude-only

> Authoritative target list for Phase 1. Every match in the Phase 0 grep maps
> to one of: **delete**, **modify**, or **document** below.
> Workflow rule: this plan is committed *before* any code change.

## Goal

Single-AI architecture (Anthropic only). Zero regression in trade gating —
every guardrail (EV, confidence, cold-streak, exposure, correlation, drawdown)
must continue to work. Only the second-AI vote is removed.

## Files to delete

| Path | Lines | Replacement |
|---|---|---|
| `server/_core/grokPersonas.ts` | 140 | `categoryPersonas.ts` (already exists, identical content shape) |
| `server/_core/grokClient.ts` | 97 | none — Grok HTTP client no longer needed |
| `server/_core/reviewerConsensus.ts` | 76 | none — `intersectReviews` callers collapse to single-bot |
| `*.test.ts` exclusively testing Grok modules | — | **none found** (verified via `grep -lE "grokPersonas|grokClient|grokTrader|grokReviewer|XAI_API_KEY"` on `server/**.test.ts`) |

## Files to modify

### Reviewer pipeline (the core of Phase 1)

| Path | Change |
|---|---|
| `server/_core/tradingReviewer.ts` | Remove `intersectReviews` import + dual-bot consensus path. Expose new `ReviewVerdict` type per plan. Drop `provider: "anthropic" \| "grok"` discriminator. Preserve every guardrail (the verdict shape changes; the gates downstream stay identical). |
| `server/_core/polymarketSignalReviewer.ts` | Remove `requestGrokPolymarketReviews`, `intersectReviews` call, `grokInTeam` branch. Polymarket pipeline becomes Claude-only. |
| `server/_core/claudeReviewer.ts` | Replace `getGrokPersona("kalshi", category)` with `getCategoryPersona("kalshi", category)`. Drop `grokVerdict` field from `ClaudeReviewInput`; rewrite user prompt to remove the "Grok's verdict to challenge" block. |
| `server/_core/anthropicClient.ts` | Delete the Grok shim fallback path. The whole `createGrokChatCompletion` translation block goes; if `ANTHROPIC_API_KEY` is unset, throw immediately. |
| `server/_core/ensembleConsensus.ts` | Rename `GrokVerdict` → `Tier1Verdict`. Drop the `claude.haiku-4-5.tier1-synthetic` / `grok.4-1-fast` reviewerId discriminator (only Anthropic now). Re-read the rule comments to remove "Grok" prose. |
| `server/_core/aiCostBudget.ts` | Narrow `provider: "anthropic" \| "grok"` to `"anthropic"`. Remove `grok-3-latest` from pricing table. |
| `server/_core/calibrationJob.ts` | Remove the `grok.kalshi.<category>` reviewer-id fallback. Anthropic is the only branch. |

### Other downstream callers

| Path | Change |
|---|---|
| `server/_core/profitGuardrails.ts` | Remove `minDualBotAgreement` reference; add `// PHASE-2-FEEAWARE` marker where `calculateNetEv` is called (Phase 2 wires the new fee-aware EV gate here). |

### Config + docs

| Path | Change |
|---|---|
| `server/_core/env.ts` | Remove `xaiApiKey`, `grokModel`, `grokTimeoutMs`, `grokSelfConsistencyTemp1`, `grokSelfConsistencyTemp2`, `grokCostPerReviewUsd`, `reviewerPreferGrok`, `minDualBotAgreement`. Drop `XAI_API_KEY` from `REQUIRED_AI_PROVIDERS` (collapse to `ANTHROPIC_API_KEY`-only). |
| `.env.example` | Remove the entire `# ── Grok / xAI ──` section + `MIN_DUAL_BOT_AGREEMENT` + `REVIEWER_PREFER_GROK` lines. |
| `README.md` | Drop all Grok / dual-bot references. Reframe as "Single Claude reviewer with strict fee-aware EV / confidence / drawdown / calibration guardrails." |
| `CODEBASE_AUDIT.md` | Add dated entry "2026-05-09: dual-AI consensus removed; Claude-only." Remove the AI-section Grok prose. |

## Files to leave alone (intentional)

| Path | Why |
|---|---|
| `CLAUDE.md`, `DEPLOY_REMINDER.md` | Touched in Phase 7 (final hygiene pass). |
| `docs/preflight-snapshot.md` | Phase 0 historical record — references Grok files as a target; allowed to keep historical references. The acceptance grep explicitly excludes this path. |
| `pnpm-lock.yaml` | Excluded from acceptance grep. |
| `*.md` in test fixtures | Excluded from acceptance grep. |

## New tests

`server/__tests__/tradingReviewer.test.ts` (or `server/tradingReviewer.test.ts`
to match existing project convention) — mocks the Anthropic client, verifies:

1. `ReviewVerdict` shape matches the plan's interface (`approved`, `grossEv`,
   `netEv`, `confidence`, `reasoning`, `personaId`, `costUsd`,
   `guardrailsPassed`, `guardrailsFailed`, `warmUpActive`).
2. High-EV / high-confidence input → `approved: true`.
3. EV below threshold → `approved: false`, `guardrailsFailed` includes the EV reason.
4. Confidence below threshold → `approved: false`, `guardrailsFailed` includes confidence reason.
5. **No network calls** — `vi.mock("@anthropic-ai/sdk")` enforced.

## ReviewVerdict shape (canonical, from the plan)

```ts
export interface ReviewVerdict {
  approved: boolean;
  grossEv: number;          // pre-cost, ROI per dollar invested
  netEv: number;            // post-cost (Phase 2 wires the fee-aware math;
                            //          Phase 1 defaults to grossEv with TODO)
  confidence: number;       // 0..1
  reasoning: string;
  personaId: string;
  costUsd: number;          // Phase 5 wires real cost telemetry; default 0
  guardrailsPassed: string[];
  guardrailsFailed: string[];
  warmUpActive: boolean;    // Phase 3 wires warm-up gate; default false
}
```

Phase 1 introduces the type but only fills `approved`, `grossEv`, `confidence`,
`reasoning`, `personaId`, `guardrailsPassed`, `guardrailsFailed`. Phase 2 fills
`netEv`, Phase 3 fills `warmUpActive`, Phase 5 fills `costUsd`. Each later
phase has TODO breadcrumbs.

## Acceptance — Phase 1

```
git grep -iE 'xai|grok|GROK|XAI_API_KEY|ENABLE_GROK_TEAM|dualBot|grokPersonas' \
  -- ':!pnpm-lock.yaml' ':!*.md' ':!docs/preflight-snapshot.md'
```

Must return **zero** matches. Plus:

- `pnpm build` green
- `pnpm typecheck` green
- New test file passes; full test suite still green
- PR body lists files deleted, files modified, env vars removed

## Rollback

`git revert` the merge commit, or `git reset --hard pre-hardening-2026-05-09`.
No data migration in this phase.

## TODO outside Claude Code

GitHub repo About: remove the stale `tradingmanus.vercel.app` URL from the
website field. Cannot be done from inside this sandbox; flagged at the top
of the Phase 1 PR description for the operator.
