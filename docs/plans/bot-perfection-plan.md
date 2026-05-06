# Bot Perfection Plan: Kalshi + Polymarket Accuracy & Profitability

**Goal:** Perfect both trading bots for maximum accuracy and consistent profit generation by addressing signal quality, risk management, execution, learning loops, and operational robustness.

**Status:** Ready for execution via subagent-driven-development

---

## Task 1: Enhanced Signal Probability Calibration

**Priority:** Critical  
**Complexity:** High  
**Files:** `server/_core/kalshiSignals.ts`, `server/_core/polymarketSignals.ts`

**Context:** Current signals use heuristic confidence scores that don't reflect true probability estimates. The assessment notes: "The signal engine is still partly heuristic and not yet portfolio-aware enough."

**Requirements:**
1. Add `calibratedProbability` field to signal output (separate from `confidence`)
2. Implement Platt scaling or isotonic regression for probability calibration
3. Use historical signal→outcome data from `kalshiOrders` + `kalshiPositions` tables
4. Calculate calibration curve (predicted probability vs actual outcome frequency)
5. Apply calibration transform to raw confidence scores before execution ranking
6. Add calibration metrics (Brier score, log loss) to learning analytics
7. Store calibration model parameters in new `signalCalibration` DB table
8. Add `recalibrateSignalProbabilities(userId, lookbackDays)` function
9. Wire into learning loop: auto-recalibrate after every 20 closed trades

**Acceptance Criteria:**
- ✅ `calibratedProbability` appears in signal objects alongside `confidence`
- ✅ Calibration improves Brier score by >10% on historical data
- ✅ Recalibration function runs without errors on real trade data
- ✅ Tests cover: calibration calculation, edge cases (0/1 probabilities), insufficient data handling
- ✅ TypeScript compiles with 0 errors

**References:**
- `server/_core/kalshiLearning.ts` - existing performance tracking
- `drizzle/schema.ts` - add `signalCalibration` table
- `server/kalshi.signals.test.ts` - add calibration tests

---

## Task 2: Portfolio-Level Correlation & Concentration Risk

**Priority:** Critical  
**Complexity:** High  
**Files:** `server/_core/kalshiRisk.ts`, `server/_core/polymarketRisk.ts`, `server/_core/kalshiAdvancedRisk.ts`

**Context:** Risk management currently uses simple per-position caps. Assessment states: "Right now the controls are real, but still coarse." Need correlation-aware position sizing.

**Requirements:**
1. Calculate pairwise correlation between open positions using market category + time-to-expiry
2. Compute portfolio concentration: max % in single category, single event, single expiry
3. Add correlation matrix to `calculateRiskMetrics()` output
4. Implement correlation-adjusted position sizing: reduce size if new position correlates >0.7 with existing
5. Add concentration limits: max 40% in one category, max 30% in one event series
6. Create `checkPortfolioCorrelation(userId, newSignal)` that returns correlation risk score
7. Block new positions if they would push concentration above limits
8. Add portfolio heatmap data: category × expiry exposure grid
9. Wire into `evaluateExecutionCandidate()` before order placement

**Acceptance Criteria:**
- ✅ Correlation matrix calculated for all open positions
- ✅ New orders blocked when concentration exceeds 40% in one category
- ✅ Position size automatically reduced when correlation >0.7 detected
- ✅ Heatmap data structure available for frontend rendering
- ✅ Tests cover: correlation calculation, concentration limits, edge cases (1 position, 0 positions)
- ✅ All existing risk tests still pass

**References:**
- `server/_core/kalshiAdvancedRisk.ts` - existing advanced risk helpers
- `server/_core/kalshiRisk.ts:evaluateExecutionCandidate()` - add correlation check
- `drizzle/schema.ts:kalshiPositions` - source data for correlation

---

## Task 3: Regime Detection & Market Condition Awareness

**Priority:** High  
**Complexity:** High  
**Files:** `server/_core/kalshiSignals.ts`, `server/_core/polymarketSignals.ts`, new `server/_core/regimeDetection.ts`

**Context:** Signals don't adapt to market regimes (high volatility, low liquidity, trending vs mean-reverting). Need context-aware signal generation.

**Requirements:**
1. Create `regimeDetection.ts` module with regime classifier
2. Detect 4 regimes: `high_volatility`, `low_liquidity`, `trending`, `mean_reverting`
3. Use rolling 24h market data: price changes, volume, bid-ask spread, turnover
4. Calculate regime scores for each active market category
5. Add `marketRegime` field to normalized market objects
6. Adjust signal confidence based on regime:
   - Reduce momentum signals by 20% in `mean_reverting` regime
   - Reduce value signals by 30% in `trending` regime  
   - Reduce all signals by 40% in `low_liquidity` regime
   - Increase contrarian signals by 15% in `high_volatility` regime
7. Store regime history in `marketRegimeHistory` table for learning
8. Add regime distribution chart to Analytics dashboard data feed

**Acceptance Criteria:**
- ✅ Regime classifier returns 4-category classification for any market history
- ✅ Signal confidence adjusted correctly per regime type
- ✅ Regime history persisted with timestamps
- ✅ Tests cover: regime detection logic, confidence adjustments, edge cases (no history)
- ✅ TypeScript compiles, existing signal tests still pass

**References:**
- `server/_core/kalshiMarketData.ts:normalizeKalshiMarket()` - add regime field
- `server/_core/kalshiSignals.ts:generateSignalsForMarket()` - apply regime adjustments
- `drizzle/schema.ts` - add `marketRegimeHistory` table

---

## Task 4: Liquidity-Adjusted Position Sizing

**Priority:** High  
**Complexity:** Medium  
**Files:** `server/_core/kalshiRisk.ts`, `server/_core/polymarketRisk.ts`, `server/_core/kalshiExecution.ts`

**Context:** Position sizing doesn't account for market liquidity or slippage risk. Assessment: "Paying users will expect capital allocation to reflect liquidity, volatility, slippage risk."

**Requirements:**
1. Calculate liquidity score for each market: `min(volume24h / 1000, liquidityDepth / 500, 1.0)`
2. Add slippage estimate: `estimatedSlippage = orderSize / liquidityDepth * 0.01`
3. Reduce position size when liquidity is low:
   - If liquidity score <0.3: max position size = 50% of normal
   - If liquidity score <0.5: max position size = 75% of normal
4. Add slippage cost to execution candidate evaluation (reduce EV by slippage)
5. Block orders if estimated slippage >5% of order value
6. Store actual vs estimated slippage in `kalshiOrders` for learning
7. Calculate average slippage per market category in learning analytics
8. Add liquidity warnings to execution logs when size is reduced

**Acceptance Criteria:**
- ✅ Position size automatically reduced in low-liquidity markets
- ✅ Orders blocked when slippage estimate exceeds 5%
- ✅ Slippage tracking added to order records
- ✅ Tests cover: liquidity scoring, size reduction logic, slippage estimation
- ✅ All existing execution tests still pass

**References:**
- `server/_core/kalshiRisk.ts:evaluateExecutionCandidate()` - add liquidity check
- `server/_core/kalshiMarketData.ts` - extract liquidity metrics
- `drizzle/schema.ts:kalshiOrders` - add `estimatedSlippage`, `actualSlippage` fields

---

## Task 5: Enhanced Learning Loop with Signal Decay

**Priority:** High  
**Complexity:** Medium  
**Files:** `server/_core/kalshiLearning.ts`, `server/_core/polymarketLearning.ts`, `server/_core/deskMemory.ts`

**Context:** Learning loop tracks performance but doesn't decay old lessons or weight recent outcomes more heavily. Need time-aware learning.

**Requirements:**
1. Add `generatedAt` timestamp weighting to signal performance analysis
2. Implement exponential decay: `weight = exp(-days_ago / 30)` for outcomes older than 30 days
3. Recalculate weighted success rate, weighted profit factor in `analyzeSignalPerformanceFromData()`
4. Add `signalQualityTrend` (improving/stable/declining) based on last 20 vs previous 20 trades
5. Auto-downgrade signal types with declining trend: reduce confidence by 25%
6. Store decay-adjusted metrics in desk memory lessons
7. Add "stale lesson" detection: flag lessons older than 90 days with <5 recent trades
8. Add `pruneStaleSignalTypes(userId)` function: disable signal types with <40% success rate over 50+ trades
9. Wire decay into autonomy runs: apply before execution candidate ranking

**Acceptance Criteria:**
- ✅ Recent outcomes weighted more heavily than old ones (exponential decay)
- ✅ Signal quality trend correctly identifies improving/declining patterns
- ✅ Declining signal types get confidence penalty applied
- ✅ Stale lessons flagged and optionally pruned
- ✅ Tests cover: decay calculation, trend detection, pruning logic
- ✅ Existing learning tests still pass

**References:**
- `server/_core/kalshiLearning.ts:analyzeSignalPerformanceFromData()` - add weighting
- `server/_core/deskMemory.ts` - store decay-adjusted lessons
- `server/_core/kalshiAutonomy.ts` - apply decay before ranking

---

## Task 6: AI Reviewer Citation Quality Scoring

**Priority:** Medium  
**Complexity:** Medium  
**Files:** `server/_core/tradingReviewer.ts`, `server/_core/aiToolbelt.ts`

**Context:** AI reviewer uses web_search but doesn't weight sources by credibility. Need to score citation quality and adjust confidence accordingly.

**Requirements:**
1. Create source credibility tiers:
   - **Tier 1** (high): espn.com, nytimes.com, wsj.com, bloomberg.com, reuters.com (+10% confidence)
   - **Tier 2** (medium): foxnews.com, cnn.com, associated press, nbc (+5% confidence)
   - **Tier 3** (low): social media, blogs, unknown (0% adjustment)
   - **Tier 4** (penalty): known unreliable sources (-15% confidence)
2. Parse citation URLs from Claude's web_search response
3. Calculate `citationQualityScore` based on tier distribution
4. Adjust signal confidence: `finalConfidence = baseConfidence * (1 + citationQualityScore)`
5. Add citation breakdown to signal reasoning: `[cites: 2 tier-1, 1 tier-2]`
6. Store citation URLs in `kalshiSignals.metadata` JSON field
7. Track citation quality vs outcome in learning analytics
8. Add domain blocklist for known misinformation sources (auto-reject if cited)

**Acceptance Criteria:**
- ✅ Citations parsed and scored by tier correctly
- ✅ Signal confidence adjusted based on citation quality
- ✅ Citation breakdown visible in signal reasoning
- ✅ Signals rejected if blocklisted source cited
- ✅ Tests cover: tier classification, confidence adjustment, blocklist
- ✅ Existing reviewer tests still pass

**References:**
- `server/_core/tradingReviewer.ts:reviewSignalsWithTrader()` - add citation parsing
- `server/_core/aiToolbelt.ts` - extract citations from web_search response
- `drizzle/schema.ts:kalshiSignals` - ensure `metadata` field supports JSON

---

## Task 7: Comprehensive Audit Trail Enrichment

**Priority:** Medium  
**Complexity:** Low  
**Files:** `server/db.ts`, `server/_core/kalshiAutonomy.ts`, `server/_core/polymarketAutonomy.ts`

**Context:** Assessment notes: "The audit trail is useful, but not yet a full operations ledger." Need richer event logging for operational transparency.

**Requirements:**
1. Add audit events for all signal pipeline stages (currently missing):
   - `kalshi_markets_fetched` - count, API latency
   - `kalshi_markets_normalized` - count, validation failures
   - `kalshi_pre_filtered` - count, filter reasons
2. Enrich existing `kalshi_signal_pipeline` event with per-filter breakdown:
   - `minConfidenceFiltered`, `marketConditionsFiltered`, `instructionsFiltered`, `reviewerRejected`
3. Add `kalshi_execution_candidate_evaluated` event with full risk breakdown:
   - availableCapital, maxBudget, quantity, exposureCheck, concentrationCheck, liquidityCheck
4. Add `kalshi_order_rejected` event (separate from generic `error`) with structured reason codes
5. Store scheduler invocation ID in all autonomy-run events for correlation
6. Add execution decision snapshot: serialize full candidate signal + risk checks to audit log
7. Create `getAuditTrailForRun(runId)` query that returns full event sequence
8. Add audit log export endpoint: `GET /api/admin/audit-export?from=...&to=...`

**Acceptance Criteria:**
- ✅ Every signal pipeline stage emits audit event
- ✅ Execution candidate evaluation includes full risk breakdown
- ✅ Order rejections captured with structured reason codes
- ✅ Audit trail query returns full event sequence for a run
- ✅ Export endpoint returns CSV with all audit events in time range
- ✅ Tests cover: event emission, structured data format, query accuracy

**References:**
- `server/db.ts:logAuditEvent()` - add new event types
- `server/_core/kalshiAutonomy.ts` - add missing audit calls
- `server/routers.ts` - add audit export endpoint

---

## Task 8: Transaction Isolation for Concurrent Order Placement

**Priority:** Medium  
**Complexity:** Medium  
**Files:** `server/db.ts`, `server/_core/kalshiExecution.ts`, `server/_core/polymarketAuth.ts`

**Context:** todo.md notes: "No transaction isolation - Concurrent trades could cause race conditions." Need DB-level isolation for capital/position checks.

**Requirements:**
1. Wrap order placement in DB transaction with `SERIALIZABLE` isolation level
2. Use Postgres row-level locking: `SELECT FOR UPDATE` on `kalshiCapital` before order placement
3. Re-check available capital inside transaction (prevent TOCTOU race)
4. Implement optimistic locking: add `version` column to `kalshiCapital`, increment on update
5. Handle version conflict: retry transaction up to 3 times with exponential backoff
6. Add distributed lock check: fail fast if another process holds autonomy lock
7. Add concurrent order placement test: spawn 2 orders simultaneously, verify only 1 succeeds when capital insufficient
8. Log transaction conflicts in audit log as `kalshi_order_conflict` events

**Acceptance Criteria:**
- ✅ Order placement wrapped in SERIALIZABLE transaction
- ✅ Row-level locking prevents concurrent capital depletion
- ✅ Optimistic locking detects version conflicts
- ✅ Transaction retry logic handles conflicts gracefully
- ✅ Concurrent order test proves race condition eliminated
- ✅ Tests cover: successful transaction, conflict retry, exhausted retries

**References:**
- `server/db.ts:placeKalshiOrder()` - wrap in transaction
- `server/_core/userMutex.ts` - existing in-process mutex (keep, add DB layer)
- `drizzle/schema.ts:kalshiCapital` - add `version` integer field

---

## Task 9: Cross-Platform Arbitrage Position Hedging

**Priority:** Medium  
**Complexity:** High  
**Files:** `server/_core/crossPlatformArbitrage.ts`, `server/_core/crossBotStrategies.ts`, `server/_core/arbitrageReviewer.ts`

**Context:** Cross-platform arbitrage exists but doesn't auto-hedge when one leg moves. Need position monitoring + auto-hedge.

**Requirements:**
1. After cross-arb execution, monitor both legs' prices every 30 seconds
2. Calculate hedge requirement: if spread narrows to <1% (below profit threshold), hedge is due
3. Implement auto-hedge logic:
   - If Kalshi leg up +15%: place offsetting sell order on Kalshi
   - If Polymarket leg down -15%: place offsetting buy order on Polymarket
4. Add `arbOpportunityId` field to link orders across platforms
5. Store arb-pair lifecycle: `detected → executed → monitoring → hedged/expired`
6. Add profit realization tracking: actual P&L vs expected spread at execution
7. Create `monitorActiveArbitragePositions(userId)` background task (runs every 60s)
8. Add arb-specific risk limit: max 3 simultaneous cross-platform pairs open
9. Log hedge decisions as `cross_arb_hedged` audit events with reason

**Acceptance Criteria:**
- ✅ Active arb pairs monitored every 30-60 seconds
- ✅ Auto-hedge triggered when spread narrows <1% or leg moves >15%
- ✅ Arb pair lifecycle tracked from detection to close
- ✅ Max simultaneous pairs limit enforced (3)
- ✅ Tests cover: hedge trigger logic, pair tracking, edge cases (one leg fails)
- ✅ Existing arb tests still pass

**References:**
- `server/_core/crossPlatformArbitrage.ts:detectCrossPlatformArbitrage()` - starting point
- `server/_core/crossBotStrategies.ts:executeCrossArb()` - add monitoring hook
- `drizzle/schema.ts` - add `crossArbPairs` table with status tracking

---

## Task 10: Training Instructions Enforcement

**Priority:** High  
**Complexity:** Low  
**Files:** `server/db.training.ts`, `server/_core/kalshiAutonomy.ts`, `server/_core/polymarketAutonomy.ts`

**Context:** todo.md notes: "Training instructions not enforced - Agent doesn't actually filter signals by training rules." Critical gap in user control.

**Requirements:**
1. Fix `applyInstructionsToSignals()` - ensure it actually filters out non-matching signals
2. Test instruction rule types: `must_have_keyword`, `must_not_have_keyword`, `min_volume`, `max_price`, `category_whitelist`, `category_blacklist`
3. Add instruction match logging: for each signal, log which instructions passed/failed
4. Move instruction filtering BEFORE AI reviewer (save reviewer cost on filtered-out signals)
5. Add instruction override: `bypassInstructions` flag on autonomy run (emergency trading)
6. Store instruction match results in signal metadata: `instructionMatches: { rule1: true, rule2: false }`
7. Add instruction effectiveness tracking: success rate of signals that matched vs didn't match
8. Create instruction suggestion engine: "Markets matching rule X have 70% win rate - consider adding"

**Acceptance Criteria:**
- ✅ Signals filtered out when instructions don't match (verified with tests)
- ✅ All 6 instruction rule types work correctly
- ✅ Instruction filtering happens before AI review (cost savings)
- ✅ Match results stored in signal metadata
- ✅ Tests cover: each rule type, multiple rules, no rules, override flag
- ✅ Existing training tests updated and passing

**References:**
- `server/db.training.ts:applyInstructionsToSignals()` - fix implementation
- `server/_core/kalshiAutonomy.ts` - move instruction filter earlier in pipeline
- `server/routers.ts:training.*` - add instruction effectiveness endpoints

---

## Execution Plan

**Total Tasks:** 10  
**Estimated Effort:** 8-12 hours (with subagents)  
**Dependencies:** Tasks are mostly independent (can run in parallel batches)

**Batch 1 (Critical Path - Do First):**
- Task 1: Signal Probability Calibration
- Task 2: Portfolio Correlation Risk
- Task 10: Training Instructions Enforcement

**Batch 2 (Core Quality):**
- Task 3: Regime Detection
- Task 4: Liquidity-Adjusted Sizing
- Task 5: Enhanced Learning Loop

**Batch 3 (Refinements):**
- Task 6: AI Citation Scoring
- Task 7: Audit Trail Enrichment
- Task 8: Transaction Isolation

**Batch 4 (Advanced):**
- Task 9: Cross-Platform Arb Hedging

**Success Metrics:**
- Signal win rate improves by >10% after calibration + regime detection
- Risk-adjusted returns (Sharpe ratio) improves by >15% with portfolio correlation controls
- Zero race conditions in concurrent order placement (transaction isolation)
- Training instructions actually enforced (user control gap closed)
- Audit trail complete enough to debug any trading decision retroactively
