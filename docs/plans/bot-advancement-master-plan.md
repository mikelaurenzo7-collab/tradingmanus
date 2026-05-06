# Bot Advancement Master Plan: World-Class Kalshi + Polymarket Trading

**Goal:** Transform both trading bots into institutional-quality systems with maximum profitability through advanced ML-enhanced signals, sophisticated risk management, optimal execution, and continuous learning.

**Execution Method:** Subagent-driven development with spec compliance + code quality reviews

**Status:** Ready for execution

---

## Phase 1: Advanced Signal Intelligence

### Task 1.1: Multi-Timeframe Signal Analysis

**Priority:** Critical  
**Complexity:** High  
**Est. Time:** 3-4 hours  
**Files:** `server/_core/kalshiSignals.ts`, `server/_core/polymarketSignals.ts`, new `server/_core/multiTimeframeAnalysis.ts`

**Context:** Current signals only look at recent data (1-5 minute windows for momentum). Professional traders analyze multiple timeframes simultaneously. We need 5min/15min/1hour/4hour/24hour analysis with confluence scoring.

**Requirements:**
1. Create `multiTimeframeAnalysis.ts` module with timeframe enum: `[M5, M15, H1, H4, D1]`
2. For each market+feed, calculate momentum/volatility/volume across all 5 timeframes
3. Implement timeframe confluence scoring: signals confirmed across multiple timeframes get +30% confidence boost
4. Add `timeframeAlignment` field to signal metadata showing which timeframes agree
5. Calculate trend strength index (TSI) per timeframe: weighted momentum + volume + volatility
6. Generate `multi_timeframe` signal type when 3+ timeframes align (>0.7 correlation)
7. Store timeframe analysis in `marketTimeframeAnalysis` table for historical learning
8. Wire into `generateSignalsForMarket()` - run multiTimeframe analysis before signal generation
9. Add tests for: timeframe calculations, confluence scoring, alignment detection

**Acceptance Criteria:**
- ✅ All 5 timeframes analyzed for each market with feed data
- ✅ Multi-timeframe signals generated when ≥3 timeframes align
- ✅ Confidence boost applied correctly (+30% max)
- ✅ Timeframe data persisted to DB
- ✅ Tests pass with 100% coverage of new functions
- ✅ TypeScript compiles with 0 errors

---

### Task 1.2: Bayesian Probability Updates

**Priority:** Critical  
**Complexity:** High  
**Est. Time:** 4-5 hours  
**Files:** `server/_core/kalshiSignals.ts`, `server/_core/polymarketSignals.ts`, new `server/_core/bayesianUpdater.ts`

**Context:** Current signals use heuristic confidence. Need Bayesian framework to update probabilities as new evidence arrives (news, price moves, volume changes).

**Requirements:**
1. Create `bayesianUpdater.ts` with `BayesianSignalUpdater` class
2. Implement prior probability initialization from category baseline + fundamental estimate
3. Add likelihood calculation from new evidence: price moves, volume spikes, news sentiment
4. Calculate posterior probability using Bayes theorem: P(outcome|evidence) = P(evidence|outcome) * P(outcome) / P(evidence)
5. Track evidence chain: each update stores prior, likelihood, posterior for auditability
6. Add `bayesianProbability` field to signals (separate from confidence and calibratedProbability)
7. Implement evidence weighting: recent evidence gets higher weight (exponential decay)
8. Create `updateSignalWithEvidence(signalId, evidenceType, evidenceValue)` function
9. Auto-update signals when: price moves >2%, volume spike >3x, sentiment shift >0.3
10. Store Bayesian update history in `signalBayesianUpdates` table
11. Add tests for: Bayes calculation, evidence weighting, posterior convergence

**Acceptance Criteria:**
- ✅ Bayesian posteriors calculated correctly (verified against known examples)
- ✅ Evidence chain tracked with full auditability
- ✅ Signals updated automatically on significant market events
- ✅ Posterior probability more accurate than heuristic confidence (backtest validation)
- ✅ Tests cover edge cases: no evidence, conflicting evidence, extreme priors
- ✅ TypeScript compiles, existing tests pass

---

### Task 1.3: Market Microstructure Analysis

**Priority:** High  
**Complexity:** High  
**Est. Time:** 3-4 hours  
**Files:** new `server/_core/marketMicrostructure.ts`, `server/_core/kalshiSignals.ts`

**Context:** Order flow and market depth provide early signals of price movements. Analyze bid-ask spread, order book imbalance, trade flow toxicity.

**Requirements:**
1. Create `marketMicrostructure.ts` with microstructure analyzer
2. Calculate bid-ask spread changes: narrowing spread = increased liquidity/confidence
3. Measure order book imbalance: (bidVolume - askVolume) / (bidVolume + askVolume)
4. Detect informed trading: large orders, aggressive execution patterns
5. Calculate VPIN (Volume-synchronized Probability of Informed Trading)
6. Add `microstructureScore` to market analysis: combines spread, imbalance, VPIN
7. Generate `order_flow` signal type when microstructure shows strong directional bias
8. Reduce signal confidence by 20% when spread >5% (low liquidity warning)
9. Boost signal confidence by 15% when order book imbalance >0.6 in signal direction
10. Store microstructure metrics in `marketMicrostructure` table
11. Add tests for: spread calculation, imbalance scoring, VPIN calculation

**Acceptance Criteria:**
- ✅ Microstructure metrics calculated for all markets with order book data
- ✅ Order flow signals generated when criteria met
- ✅ Confidence adjustments applied based on microstructure quality
- ✅ VPIN calculation matches academic formula
- ✅ Tests cover: normal conditions, extreme spreads, one-sided books
- ✅ TypeScript compiles, performance <50ms per market

---

## Phase 2: Advanced Risk & Portfolio Management

### Task 2.1: Kelly Criterion Position Sizing

**Priority:** Critical  
**Complexity:** Medium  
**Est. Time:** 2-3 hours  
**Files:** `server/_core/kalshiRisk.ts`, `server/_core/polymarketRisk.ts`, new `server/_core/kellyCriterion.ts`

**Context:** Current position sizing uses fixed percentages. Kelly criterion is mathematically optimal for growth: f* = (p*b - q) / b where p=win rate, q=loss rate, b=odds.

**Requirements:**
1. Create `kellyCriterion.ts` with full/fractional Kelly calculator
2. Implement full Kelly: f* = (expectedValue * winProb - (1-winProb)) / expectedValue
3. Add fractional Kelly (0.25x) for risk management: reduces over-betting
4. Calculate Kelly fraction for each signal using: win probability (calibrated), expected value, odds
5. Apply Kelly sizing in `evaluateExecutionCandidate()` before order placement
6. Add max Kelly cap = 25% of capital (prevents over-concentration)
7. Track Kelly-sized bets vs actual outcomes in learning analytics
8. Add `kellySuggestedSize` field to execution candidate evaluation
9. Create UI display: Kelly size vs actual size comparison
10. Add tests for: Kelly calculation, edge cases (negative EV, probability=1)

**Acceptance Criteria:**
- ✅ Kelly fractions calculated correctly (verified against test cases)
- ✅ Position sizes adjusted based on fractional Kelly (0.25x)
- ✅ Max 25% cap enforced
- ✅ Kelly performance tracked in learning loops
- ✅ Tests cover: positive EV, negative EV, edge cases
- ✅ TypeScript compiles, all existing risk tests pass

---

### Task 2.2: Portfolio-Level Vol Targeting

**Priority:** High  
**Complexity:** High  
**Est. Time:** 3-4 hours  
**Files:** `server/_core/kalshiAdvancedRisk.ts`, `server/_core/kalshiRisk.ts`

**Context:** Professional funds target specific portfolio volatility levels (e.g., 15% annual volatility). Need dynamic position sizing to maintain target vol.

**Requirements:**
1. Add `calculatePortfolioVolatility(userId)` function to advanced risk module
2. Compute realized volatility: stddev of daily P&L over trailing 30 days
3. Calculate position correlation matrix using returns data
4. Estimate portfolio vol = sqrt(w₁²σ₁² + w₂²σ₂² + 2w₁w₂ρσ₁σ₂) for all positions
5. Set target volatility = 15% annual (user-configurable in trading preferences)
6. Scale position sizes when portfolio vol drifts from target:
   - If current vol >20%: reduce all new position sizes by 30%
   - If current vol >25%: reduce by 50%, block high-risk signals
   - If current vol <10%: increase sizes by 20% (more capacity)
7. Add `portfolioVolatility` and `volScalingFactor` to risk metrics
8. Block new positions if they would push portfolio vol >30%
9. Store vol history in `portfolioVolatilityHistory` table
10. Add tests for: vol calculation, correlation matrix, scaling logic

**Acceptance Criteria:**
- ✅ Portfolio vol calculated correctly using correlation-adjusted formula
- ✅ Position sizes scaled dynamically based on current vs target vol
- ✅ Vol constraints enforced (blocks when >30%)
- ✅ Vol history persisted for analysis
- ✅ Tests cover: single position, multiple correlated positions, extreme scenarios
- ✅ TypeScript compiles, existing risk tests pass

---

### Task 2.3: Dynamic Stop-Loss & Take-Profit

**Priority:** High  
**Complexity:** Medium  
**Est. Time:** 2-3 hours  
**Files:** `server/_core/kalshiExecution.ts`, new `server/_core/exitStrategy.ts`

**Context:** Current system has no automated exits. Need trailing stops and dynamic take-profit based on volatility and time decay.

**Requirements:**
1. Create `exitStrategy.ts` with stop-loss and take-profit logic
2. Implement trailing stop: initial stop at -15%, trails at 3xATR below high water mark
3. Add volatility-adjusted stops: wider stops (20%) in high vol, tighter (10%) in low vol
4. Calculate time-decay based exits: as resolution approaches, tighten stops (options-style theta decay)
5. Set profit targets: base target = 2x initial risk (R:R = 2:1), scaling exits at 1x, 2x, 3x
6. Add `exitStrategy` field to positions: stores stop level, profit targets, trailing stop state
7. Create `checkExitConditions(positionId)` function - runs every 5 minutes
8. Auto-submit close orders when stop/profit triggers hit
9. Track exit effectiveness: % of positions stopped out, average exit vs best possible
10. Store exit history in `positionExits` table with trigger reason
11. Add tests for: trailing stop calculation, volatility adjustment, time decay

**Acceptance Criteria:**
- ✅ Trailing stops calculated and updated correctly
- ✅ Volatility adjustments applied (tested with high/low vol scenarios)
- ✅ Time decay logic verified (exits tighten near resolution)
- ✅ Close orders submitted automatically when triggers hit
- ✅ Exit tracking data persisted
- ✅ Tests cover: normal exits, extreme moves, multiple profit targets
- ✅ TypeScript compiles, execution tests pass

---

## Phase 3: ML-Enhanced Signal Generation

### Task 3.1: Signal Ensemble Model

**Priority:** High  
**Complexity:** Very High  
**Est. Time:** 5-6 hours  
**Files:** new `server/_core/mlSignalEnsemble.ts`, `server/_core/kalshiSignals.ts`, `server/_core/polymarketSignals.ts`

**Context:** Current signals are rule-based. Add ML ensemble that learns optimal signal weighting from historical outcomes.

**Requirements:**
1. Create `mlSignalEnsemble.ts` with ensemble learner (no external ML libs, pure TypeScript)
2. Feature engineering: extract 30+ features from each signal:
   - Signal type, confidence, EV, market category, time to resolution
   - Price level, volume, liquidity, volatility, spread
   - Timeframe alignment, Bayesian probability, microstructure score
   - Historical win rate for this signal type + category combination
3. Implement gradient boosting trees (10 trees, max depth 5) for signal score prediction
4. Train on historical signal→outcome data (last 1000 resolved positions)
5. Predict win probability for new signals using ensemble
6. Add `mlEnsembleProbability` field to signals
7. Blend rule-based and ML probabilities: final = 0.6*ML + 0.4*rule-based
8. Retrain model weekly (or after every 100 new outcomes)
9. Store model parameters in `mlEnsembleModels` table (versioned)
10. Track ensemble performance: compare ML predictions vs actual outcomes
11. Add tests for: feature extraction, tree prediction, model serialization

**Acceptance Criteria:**
- ✅ Ensemble model trains without errors on historical data
- ✅ Predictions improve over rule-based (validated on hold-out test set)
- ✅ Model retrains automatically and versions are tracked
- ✅ Blended probabilities used in signal ranking
- ✅ Tests cover: training, prediction, feature engineering, edge cases
- ✅ TypeScript compiles, performance <100ms per signal

---

### Task 3.2: Sentiment Analysis Enhancement

**Priority:** Medium  
**Complexity:** High  
**Est. Time:** 4 hours  
**Files:** `server/_core/kalshiSentiment.ts`, new `server/_core/sentimentAggregator.ts`

**Context:** Current sentiment uses GDELT only. Need multi-source aggregation: news, social (Twitter/Reddit), prediction market consensus, expert forecasts.

**Requirements:**
1. Create `sentimentAggregator.ts` with multi-source sentiment merger
2. Add Reddit sentiment scraper: fetch top posts from relevant subreddits, analyze tone
3. Add Twitter/X sentiment (if API available): track mention volume, sentiment polarity
4. Fetch Metaculus/Good Judgment Open forecasts for comparable questions  
5. Calculate consensus prediction from external prediction markets (PredictIt, Manifold) 
6. Implement source weighting: GDELT 30%, Reddit 15%, Twitter 15%, expert 25%, market consensus 15%
7. Detect sentiment momentum: rate of change in sentiment over 12h/24h/48h windows
8. Add `sentimentMomentum` field: accelerating positive sentiment = stronger signal
9. Generate alerts when sentiment shifts >0.4 within 6 hours (breaking news indicator)
10. Store aggregated sentiment in `marketSentimentHistory` table
11. Add tests for: source aggregation, weighting, momentum calculation

**Acceptance Criteria:**
- ✅ Multi-source sentiment aggregated correctly
- ✅ Source weights applied as specified
- ✅ Sentiment momentum calculated and tracked
- ✅ Alerts generated on significant shifts
- ✅ Tests cover: single source, multi-source, conflicting sources
- ✅ TypeScript compiles, sentiment tests pass

---

## Phase 4: Execution Optimization

### Task 4.1: Smart Order Routing

**Priority:** High  
**Complexity:** Medium  
**Est. Time:** 3 hours  
**Files:** `server/_core/kalshiExecution.ts`, new `server/_core/smartOrderRouter.ts`

**Context:** Currently using market orders. Need limit orders, TWAPscaling, iceberg orders for large positions.

**Requirements:**
1. Create `smartOrderRouter.ts` with order type strategies
2. Implement limit order logic: place limits at favorable prices (1% better than market)
3. Add TWAP (Time-Weighted Average Price): split large orders across 5-10 smaller orders over time
4. Create iceberg orders: show small size, hide large reserve (prevents market impact)
5. Add order monitoring: cancel and re-place limits if not filled within 5 minutes
6. Implement slippage tracking: compare actual fill vs expected price
7. Choose order type based on urgency and size:
   - Small orders (<$100): market order
   - Medium orders ($100-500): limit order
   - Large orders (>$500): TWAP over 15 minutes
8. Add `orderExecutionStrategy` field to positions
9. Store execution quality metrics: slippage, fill rate, time to fill
10. Add tests for: order type selection, TWAP scheduling, limit order placement

**Acceptance Criteria:**
- ✅ Order types selected correctly based on size/urgency
- ✅ TWAP execution splits orders as specified
- ✅ Limit orders placed and monitored correctly
- ✅ Slippage tracking accurate  
- ✅ Tests cover: all order types, edge cases
- ✅ TypeScript compiles, execution tests pass

---

### Task 4.2: Market Impact Modeling

**Priority:** Medium  
**Complexity:** High  
**Est. Time:** 3-4 hours  
**Files:** new `server/_core/marketImpactModel.ts`, `server/_core/kalshiRisk.ts`

**Context:** Large orders move prices against us. Need to model and minimize market impact.

**Requirements:**
1. Create `marketImpactModel.ts` with impact estimator
2. Implement square-root model: impact = σ * sqrt(orderSize / dailyVolume)
3. Calculate temporary impact (immediate price move) vs permanent impact (lasting)
4. Add liquidity adjustment: reduce order size if estimated impact >3%
5. Model order book depth: count bids/asks at each price level
6. Estimate slippage from order book walk: simulate filling order through book levels
7. Add `estimatedMarketImpact` to execution candidate evaluation
8. Reduce position size when impact >5% of expected value
9. Add impact cost to execution scoring (reduces signal attractiveness)
10. Track actual vs estimated impact in learning analytics
11. Add tests for: impact calculation, size reduction, order book simulation

**Acceptance Criteria:**
- ✅ Market impact estimated using square-root model
- ✅ Position sizes reduced when impact excessive  
- ✅ Order book depth incorporated into estimates
- ✅ Actual impact tracked and validated against estimates
- ✅ Tests cover: small orders, large orders, thin books
- ✅ TypeScript compiles, risk tests pass

---

## Phase 5: Cross-Platform Optimization

### Task 5.1: Real-Time Arbitrage Scanner

**Priority:** High  
**Complexity:** High  
**Est. Time:** 4-5 hours  
**Files:** `server/_core/crossPlatformArbitrage.ts`, `server/_core/kalshiAutonomy.ts`

**Context:** Current arbitrage is basic. Need real-time scanning with latency consideration, partial fills, and dynamic hedge ratios.

**Requirements:**
1. Enhance `crossPlatformArbitrage.ts` with real-time monitoring
2. Scan all comparable Kalshi/Polymarket markets every 10 seconds
3. Calculate net arbitrage after fees: Kalshi fee 3%, Polymarket fee 2%
4. Model execution latency: 500ms Kalshi, 3s Polymarket (block chain delay)
5. Estimate price movement during execution (slippage risk)
6. Only execute arb if net edge >5% after fees + slippage + latency risk
7. Implement dynamic hedge ratios: adjust position sizes if one leg moves adversely
 8. Add partial leg tracking: if first leg fills but second doesn't, auto-hedge or exit
9. Store arbitrage execution detail in `crossPlatformArbitrageExecutions` table
10. Calculate arbitrage PnL attribution: how much profit came from pure arb vs market moves
11. Add tests for: arb detection, fee calculation, hedge ratio adjustment

**Acceptance Criteria:**
- ✅ Arbitrage opportunities scanned in real-time (every 10s)
- ✅ Net edge calculated with fees + slippage + latency
- ✅ Hedge ratios adjusted dynamically
- ✅ Partial fills handled gracefully
- ✅ PnL attribution accurate
- ✅ Tests cover: normal arb, failed legs, fee edge cases
- ✅ TypeScript compiles, arb tests pass

---

### Task 5.2: Platform-Specific Strategy Adaptation

**Priority:** Medium  
**Complexity:** Medium  
**Est. Time:** 3 hours  
**Files:** `server/_core/kalshiSignals.ts`, `server/_core/polymarketSignals.ts`

**Context:** Kalshi and Polymarket have different user bases and dynamics. Need platform-specific signal adjustments.

**Requirements:**
1. Identify platform quirks from historical data:
   - Kalshi: retail-heavy, momentum often overshoots
   - Polymarket: crypto-native, reacts fast to news
2. Add platform-specific confidence adjustments:
   - Kalshi momentum: reduce confidence by 10% (overshooting risk)
   - Polymarket sentiment: boost confidence by 15% (faster news incorporation)
3. Implement category-specific rules per platform:
   - Kalshi politics: reduce contrarian signals (sticky beliefs)
   - Polymarket crypto: boost value plays (more mispricing)
4. Add `platformBehaviorProfile` to signal metadata
5. Track platform-specific performance in learning loops
6. Auto-adapt adjustments based on recent performance (every 100 trades)
7. Add tests for: platform detection, adjustment application, adaptation logic

**Acceptance Criteria:**
- ✅ Platform-specific adjustments applied correctly
- ✅ Category × platform rules implemented
- ✅ Performance tracked per platform + category
- ✅ Adaptation logic updates parameters correctly
- ✅ Tests cover: Kalshi-specific, Polymarket-specific scenarios
- ✅ TypeScript compiles, platform tests pass

---

## Phase 6: Advanced Learning & Adaptation

### Task 6.1: Online Learning System

**Priority:** Critical  
**Complexity:** Very High  
**Est. Time:** 5-6 hours  
**Files:** new `server/_core/onlineLearning.ts`, `server/_core/kalshiLearning.ts`, `server/_core/polymarketLearning.ts`

**Context:** Current learning is batch (periodic retraining). Need online learning that adapts continuously as new outcomes arrive.

**Requirements:**
1. Create `onlineLearning.ts` with incremental learning engine
2. Implement stochastic gradient descent for model updates (no full retraining)
3. Update signal weights immediately after each trade resolution:
   - Win: boost similar signal types by +5%
   - Loss: reduce similar signal types by -8%
4. Use exponential moving average for gradual adaptation (α=0.1)
5. Track concept drift: detect when market regime changes (distribution shift)
6. Reset model partially if concept drift detected (recency-weighted learning)
7. Add `modelVersion` tracking: new version after every 50 updates
8. Store update history in `onlineLearningUpdates` table
9. Implement Thompson sampling for exploration vs exploitation:
   - Try sub-optimal strategies 10% of time to discover new edges
10. Add confidence bounds: wider bounds when uncertain, narrower after many observations
11. Add tests for: gradient updates, concept drift detection, exploration logic

**Acceptance Criteria:**
- ✅ Model updates after each trade outcome without full retraining
- ✅ Signal weights adjusted correctly (boost winners, penalize losers)
- ✅ Concept drift detected and handled appropriately
- ✅ Thompson sampling provides appropriate exploration
- ✅ Tests cover: multiple updates, drift scenarios, exploration
- ✅ TypeScript compiles, learning tests pass

---

### Task 6.2: Performance Attribution System

**Priority:** Medium  
**Complexity:** Medium  
**Est. Time:** 3 hours  
**Files:** new `server/_core/performanceAttribution.ts`, `server/_core/kalshiLearning.ts`

**Context:** Need to decompose P&L into sources: signal quality, execution, luck, timing.

**Requirements:**
1. Create `performanceAttribution.ts` with decomposition logic
2. Break down P&L by source:
   - Signal alpha: profit from signal accuracy (vs random)
   - Execution: profit from good fills vs expected slippage
   - Timing: profit from entry/exit timing
   - Luck: residual variance (unexplained)
3. Calculate Sharpe ratio by attribution source
4. Identify best-performing signal types + categories
5. Detect losing patterns: which signals consistently underperform?
6. Add `attributionBreakdown` to position close events
7. Store attribution history in `performanceAttribution` table
8. Create dashboard data feed: attribution pie chart, time series by source
9. Add tests for: P&L decomposition, Sharpe calculation, pattern detection

**Acceptance Criteria:**
- ✅ P&L decomposed into 4 sources correctly
- ✅ Sharpe ratios calculated by source
- ✅ Losing patterns identified and flagged
- ✅ Attribution data persisted and queryable
- ✅ Dashboard integration ready
- ✅ Tests cover: profitable positions, losing positions, attribution edge cases
- ✅ TypeScript compiles, analytics tests pass

---

## Phase 7: Integration & Validation

### Task 7.1: End-to-End Bot Testing

**Priority:** Critical  
**Complexity:** High  
**Est. Time:** 3-4 hours  
**Files:** new `server/bot.integration.test.ts`

**Context:** Need comprehensive integration tests that validate entire signal→execution→outcome loop.

**Requirements:**
1. Create integration test suite with realistic market data
2. Test complete autonomy flow:
   - Fetch markets → generate signals → apply filters → review → execute → track
3. Mock external APIs: Kalshi, Polymarket, GDELT, news sources
4. Simulate market scenarios:
   - Normal market (moderate vol, good liquidity)
   - High volatility (>30% moves)
   - Low liquidity (thin order books)
   - News event (sudden sentiment shift)
5. Validate all new features work together:
   - Multi-timeframe + Bayesian + microstructure → combined signal
   - Kelly sizing + vol targeting → correct position size
   - Risk checks + correlation → portfolio constraints respected
6. Test error handling: API failures, data corruption, edge cases
7. Verify audit trail: every decision logged correctly
8. Measure performance: full cycle should complete in <30 seconds
9. Add monitoring: detect regressions in bot behavior

**Acceptance Criteria:**
- ✅ Full autonomy cycle executes without errors
- ✅ All market scenarios handled correctly
- ✅ All new features integrated and working
- ✅ Error handling prevents crashes
- ✅ Audit logs complete and accurate
- ✅ Performance <30s for full cycle
- ✅ Tests run in CI/CD pipeline

---

### Task 7.2: Backtest Validation

**Priority:** High  
**Complexity:** High  
**Est. Time:** 4-5 hours  
**Files:** new `server/_core/advancedBacktest.ts`, UI integration

**Context:** Validate advanced features improve historical performance vs baseline.

**Requirements:**
1. Create comprehensive backtest framework
2. Load historical market data (last 6 months minimum)
3. Run baseline bot (current simple signals) vs advanced bot (all new features)
4. Metrics to compare:
   - Total return, Sharpe ratio, max drawdown
   - Win rate, average win/loss, profit factor
   - Turnover, transaction costs, market impact costs
5. Test robustness: run on different time periods, market conditions
6. Calculate improvement: advanced vs baseline (target: +20% Sharpe minimum)
7. Identify which features contribute most to improvement
8. Generate backtest report: performance charts, attribution breakdown, trade list
9. Add statistical significance test: is improvement real or luck?
10. Store backtest runs in `backtestRuns` table
11. Create UI display: comparison charts, metrics table, trade-by-trade analysis

**Acceptance Criteria:**
- ✅ Backtest runs on historical data without errors
- ✅ Baseline vs advanced comparison shows clear improvement
- ✅ Sharpe ratio improves by ≥20% (or return improves with similar risk)
- ✅ Attribution shows which features add most value
- ✅ Statistical significance confirmed (p < 0.05)
- ✅ Results displayed in UI with charts
- ✅ Performance validated across multiple time periods

---

## Success Metrics

**Quantitative Targets:**
- Sharpe ratio: >1.5 (professional fund quality)
- Win rate: >55% (after costs)
- Average profit factor: >1.8 (wins 1.8x bigger than losses)
- Max drawdown: <20% (risk management)
- Monthly return: >5% (target 60%+ annual)
- Signal accuracy: >60% (calibrated probability)

**Qualitative Goals:**
- Signals adapt to changing market conditions
- Risk management prevents catastrophic losses
- Execution minimizes slippage and impact
- System learns and improves continuously
- Code is maintainable and well-tested

**Business Validation:**
- Back-test shows consistent profitability across 6+ months
- Forward-test (paper trading) validates live performance
- Ready for real capital deployment
- Positioning as institutional-quality trading system credible

---

## Execution Plan

1. **Phase 1-2 (Signals + Risk):** Days 1-3
2. **Phase 3 (ML):** Days 4-5
3. **Phase 4-5 (Execution + Cross-platform):** Days 6-7
4. **Phase 6-7 (Learning + Validation):** Days 8-10

**Total Estimated Time:** 10 days (assuming 6-8 productive hours/day)

**Dependencies:**
- All tasks build on existing bot infrastructure
- Each task is independently testable
- Integration happens continuously (no big-bang integration)

**Risk Mitigation:**
- Each task has tests before moving to next
- Spec compliance review catches scope creep
- Code quality review maintains standards
- Can deploy phases incrementally (Phase 1→2→3)

---

## Notes

- This plan builds on `bot-perfection-plan.md` foundation
- Focuses on institutional-quality features
- Emphasizes continuous learning and adaptation
- Prioritizes risk management and robustness
- Maintains backward compatibility (gradual enhancement)
- All changes preserve audit trail and explainability
