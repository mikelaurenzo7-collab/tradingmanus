# Preflight Snapshot — Hardening Pass Phase 0

> Captured before any Phase 1+ behavioral change.
> Rollback target if any later phase regresses.

## Identity

| Field | Value |
|---|---|
| Captured at (UTC) | 2026-05-09 |
| Branch | `hardening/phase-0-preflight` |
| Base commit (main) | `db62b064126bc3784fc9dba36155156f4cd23e9e` |
| Rollback tag | `pre-hardening-2026-05-09` |

## Recent commit history (last 20)

```text
db62b06 fix(audit): clob-client for balance + EV units in remaining gates (#62)
edd8feb fix(audit): use clob-client for balance + correct EV units in all gates
9cfe0b6 fix: EV units + Polymarket balance endpoint + signal noise (#61)
ab76466 fix(profit): correct EV units + Polymarket balance endpoint + signal noise
8e08458 fix(polymarket): add Authorization header to CLOB balance fetch (#60)
b14f50e fix(polymarket): add Authorization header to CLOB /balance request
a826ffb fix: adaptive thinking format + bayesianProbability migration + CLOB balance (#59)
a81d54d fix(polymarket): use CLOB /balance for wallet balance instead of on-chain USDC.e
b33f34c fix: remove effort field from adaptive thinking + add bayesianProbability migration
8be6ea4 ui(connect): hide Coinbase panel + show Polymarket USDC balance (#58)
ae4f91f feat(polymarket): show live USDC.e wallet balance on Connect page
347dbc9 ui(connect): hide Coinbase panel until Phase 10 trading logic lands
997c1d5 feat: arm live trading + daily sports scoreboard + Coinbase scaffold (#57)
d15d993 fix(coderabbit): fallback playDate from position openedAt; moonshot skipped audit events
103ea54 fix(coderabbit): batch 8 correctness findings on PR #57
1017dc3 feat: Polymarket daily sports play + dailyPlayPicks scoreboard + Coinbase scaffold + CodeRabbit fixes
adcb233 fix(polymarket): correct NO-side Kelly sizing + gate live orders on owner address
e01f534 feat(strategies): awards precursor, linguistic tells, Wikipedia watcher + CodeRabbit fixes
744a5ea fix(polymarket): skip 405-prone CLOB GET validation on connect
d5543fe Merge pull request #55 from mikelaurenzo7-collab/claude/polymarket-derive-keys-ui
```

## Build / typecheck / test status

| Check | Command | Result |
|---|---|---|
| Build | `corepack pnpm build` | green — `built in 1.65s`, 13 client chunks emitted |
| Typecheck | `corepack pnpm typecheck` | green — `tsc --noEmit` clean |
| Test | `corepack pnpm test -- --run` | green — **1009 passed, 1 skipped (1010 total)** across 84 files |

The skipped test is `server/gnews.secret.test.ts` (env-gated), not a missing-test finding.

## Bankroll figures (operator-stated, manual verification deferred — see DB snapshot section)

| Field | Operator-stated value |
|---|---|
| Kalshi cash | $300.00 |
| Polymarket cash | $227.70 |
| Open positions value | $0.00 |

## DB row counts (operator must run; sandbox IP blocked by Neon allowlist)

`DATABASE_URL` was provided in this Phase 0 session, but the production Neon DB
has IP allowlisting enabled and rejected the sandbox with HTTP 403 "Host not in
allowlist". The Phase 0 deliverable instead ships a read-only snapshot script:

```bash
DATABASE_URL='postgresql://...' corepack pnpm exec node scripts/preflightSnapshot.mjs
```

(Or run from Railway: `railway run node scripts/preflightSnapshot.mjs`.)

The script issues only `SELECT` statements — no schema or data writes — and
prints:

1. Row counts for `kalshiCapital`, `kalshi{Positions,Orders,Fills}`, `polymarket{Positions,Orders,Fills}` (owner resolved via `users.openId='owner:primary'`).
2. **Halt-check** for any `polymarketPositions` row with `sizeUsdc > 0` and `positionStatus IN ('open', 'closing')` — if non-empty, the script exits with code 2 (halt the hardening pass and report — contradicts "fully cash" precondition).
3. Latest 3 `kalshiCapital` rows (the operator-stated $300.00 should appear here).
4. Owner's `tradingPreferences` row (cadence, autonomy mode, paper-mode flag).

Operator: paste the script output back when convenient. Phases 3–4 will need
this to confirm the bankroll baseline and the Phase 6 `tradingPreferences`
shape before deletion. **It does not gate Phase 1 — the doc-only Phase 0 PR
can land first while the operator runs the script.**

## Grep findings (Phase 1 / Phase 3 / Phase 6 targets)

### Phase 1 — Grok / xAI footprint (430 raw matches, code-only files)

**Modules to delete (Phase 1):**

| Path | Status |
|---|---|
| `server/_core/grokPersonas.ts` | exists — delete |
| `server/_core/grokClient.ts` | exists — delete (plan didn't list but it's the OpenAI-shape Grok HTTP client) |
| `server/_core/grokTrader.ts` | **absent** |
| `server/_core/grokReviewer.ts` | **absent** |

**Files that import Grok modules (Phase 1 must rewire these):**

- `server/_core/anthropicClient.ts` — has a Grok shim fallback when `ANTHROPIC_API_KEY` is unset (delete the shim entirely)
- `server/_core/claudeReviewer.ts` — imports `getGrokPersona` for shared persona mandate; `ClaudeReviewInput.grokVerdict` field; user prompt has "Grok's verdict to challenge" block (rewrite to Claude-native single-pass review)
- `server/_core/polymarketSignalReviewer.ts` — also uses Grok-flavored types (verify and rewire)
- `server/_core/tradingReviewer.ts` — central pipeline; uses `intersectReviews`, dual-provider type, Grok consensus. **Phase 1's biggest rewrite.**

**Env / config touchpoints (Phase 1 must remove):**

- `.env.example` lines 52–105 — entire Grok section + `MIN_DUAL_BOT_AGREEMENT` + `REVIEWER_PREFER_GROK`
- `server/_core/env.ts:91–115` — `xaiApiKey`, `grokModel`, `grokTimeoutMs`, `grokSelfConsistencyTemp1/Temp2`, `grokCostPerReviewUsd`
- `server/_core/env.ts:160` — `reviewerPreferGrok`
- `server/_core/env.ts:208–212` — `minDualBotAgreement` in `profitGuardrails`
- `server/_core/env.ts:469–471` — `REQUIRED_AI_PROVIDERS` array (must collapse to Anthropic-only)

**Audit-log + telemetry surfaces:**

- `server/_core/aiCostBudget.ts` — has `provider: "anthropic" | "grok"` discriminator throughout; pricing table includes `grok-3-latest`. Phase 1 should narrow type to `"anthropic"` and drop the Grok pricing row.
- `server/_core/calibrationJob.ts:222–227` — falls back to `grok.kalshi.<category>` reviewer id when Anthropic isn't set. Phase 1 should make Anthropic the only branch.
- `server/_core/ensembleConsensus.ts` — heavy Grok branding on the `GrokVerdict` type and reviewer ids `grok.4-1-fast`. Phase 1 will rename to a neutral "Tier 1 verdict" vocabulary or fold into the `ReviewVerdict` shape from the plan.

**README / CLAUDE.md / CODEBASE_AUDIT.md / DEPLOY_REMINDER.md** — extensive prose references. Phase 1 updates README + CODEBASE_AUDIT per the plan; CLAUDE.md and DEPLOY_REMINDER are touched in Phase 7.

**Total Phase 1 surface estimate:** 430 raw matches → after `.md` filtering and conscious scoping, expect to touch ~12 server files, the env file, the env example, and README + CODEBASE_AUDIT. Plan's "delete + modify + document" rule will produce `phase-1-removal-plan.md` before the code changes.

### Phase 3 — Hardcoded capital figures (filtered to real findings)

The raw 469-match grep was 95% Tailwind/CSS/percentage-formatting noise (`width="100%"`,
`* 100`, `100ms` animation delays, etc.). Real hardcoded dollar references:

| File | Line | Context |
|---|---|---|
| `client/src/components/PreLiveChecklist.tsx` | 55 | UI string: "Start with $100–$500 capital allocation" |
| `client/src/components/PreLiveChecklist.tsx` | 64 | UI string: "Start with $50–$100 allocation only" |
| `server/_core/alerting.ts` | 165 | Doc comment example: "$10 for a $100 account" |
| `server/_core/smartOrderRouter.ts` | 9 | `MARKET_ORDER_THRESHOLD = 100` (real threshold) |
| `server/_core/smartOrderRouter.ts` | 10 | `LIMIT_ORDER_THRESHOLD = 500` (real threshold) |
| `server/_core/smartOrderRouter.ts` | 80, 82 | doc-comment for the thresholds above |
| `server/kalshi.autonomy.test.ts` | 631 | test-fixture comment: "$100 balance → maxLossPerDay = clamp(...)" |
| `server/smart-order-router.test.ts` | 38 | test description: "below $100 threshold" |

**Phase 3 actions:**

- Update `PreLiveChecklist.tsx` UI strings to reference live equity ranges, not literal dollar bands.
- `smartOrderRouter.ts` thresholds (`MARKET_ORDER_THRESHOLD`, `LIMIT_ORDER_THRESHOLD`) are not "starting capital" but they ARE hardcoded dollar thresholds. Decide in Phase 3 whether to scale to a fraction of live equity (e.g. 5% / 25%) or keep as absolute.
- `kalshi.autonomy.test.ts:631` — test asserts dynamic-risk-limit math at $100 balance. Update to use the new live-equity reader if Phase 3 changes the limit math.
- No `STARTING_CAPITAL` or `HARDCODED_CAPITAL` constants exist (plan greps came up empty for those identifiers — good).

### Phase 6 — Paper-mode / multi-user surface (128 matches, real footprint)

**Already minimal — `effectivePaperMode.ts` is 38 lines of no-op-or-thin-read wrappers.**

Per-user `paperTradeMode` field still exists in `tradingPreferences` (DB column + `db.trading-preferences.ts` round-trip + `TradingAutonomy.tsx` UI toggle) despite `effectivePaperMode.ts` ignoring it. Phase 6 must:

- Delete `effectivePaperMode.ts`, rewire all 16 call sites listed below to check `tradingPreferences.autonomyMode === 'paused'` (Phase 3/4 introduces this enum value).
- Drop the per-user `paperTradeMode` column or hold it as a deprecated field — recommend dropping after the kill-switch + auto-pause are in place.
- Remove `TradingAutonomy.tsx:386–428` (the live/paper toggle UI block).

**`getEffectivePaperTradeMode` call sites (16, all to be rewired in Phase 6):**

- `server/_core/exitMonitor.ts:45,141`
- `server/_core/kalshiAutonomy.ts:39,2011`
- `server/_core/kalshiExecution.ts:18,204,454,755`
- `server/_core/polymarketAutonomy.ts:41,704`
- `server/_core/polymarketDailySportsPlay.ts:31,136`
- `server/_core/polymarketExitMonitor.ts:46,144`

**`betaAccessLevel` references (Phase 6 owner-only middleware enables deletion of this column-as-gate, but the column stays — see `server/_core/auth.ts:115,125` and `server/db.ts:143,182,183`):**

- `betaAccessLevel: "internal"` is hardcoded for owner login (`server/_core/auth.ts:125`)
- Schema enum stays for backward compat; Phase 6 just stops gating on it.

**`userPlatformSubscriptions` table** — still in schema (`drizzle/schema.ts`), referenced in 8 places. Phase 6 plan offers two options: a singleton `ownerSubscriptions` config row or env vars `OWNER_USES_KALSHI=true`, `OWNER_USES_POLYMARKET=true`. Recommend env vars for simplicity; defer the table drop to a Phase 7 cleanup if needed.

## Open questions / decisions deferred to phase PRs

1. **Phase 3 — `autonomyMode='paused'` enum value:** `autonomyModeEnum` is `['manual', 'approval_required', 'semi_autonomous', 'fully_autonomous']`. Phase 3/4 needs `'paused'`. Recommend Drizzle migration adds it; Phase 6's `effectivePaperMode` deletion depends on this.

2. **Phase 3 — `polymarketCapital` table shape vs existing `kalshiCapital`:** Plan creates `polymarketCapital` mirroring `kalshiCapital`. Need to inspect actual `kalshiCapital` columns when the schema review for Phase 3 runs (verified pulled from current Drizzle definitions).

3. **Phase 3 — hardcoded `smartOrderRouter` thresholds:** $100 / $500 cutoffs. Either scale (recommended: 5% / 25% of live equity) or keep absolute and document. Will decide in Phase 3 PR.

4. **Phase 6 — `auth.signupOwner` route:** raised pre-flight, no clear answer yet. Recommend leaving the singleton route intact (already gated to a single owner) and only locking `/signup` if such a route exists.

## Acceptance — Phase 0

- [x] Build green (`pnpm build`)
- [x] Typecheck green (`pnpm typecheck`)
- [x] Tests green (1009 passed, 1 skipped)
- [x] Snapshot file present (`docs/preflight-snapshot.md`)
- [ ] Tag `pre-hardening-2026-05-09` pushed (created in this PR; pushed on merge)
- [ ] Operator runs DB snapshot SQL and pastes output (deferred — does not gate Phase 1)

## Rollback

```bash
git checkout main
git reset --hard pre-hardening-2026-05-09
git push --force-with-lease origin main   # ← only if approved
```

For phase-by-phase rollback, revert the corresponding PR (every phase is one merge commit).
