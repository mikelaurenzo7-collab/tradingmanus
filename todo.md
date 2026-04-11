# NEXUS OMEGA: Real-Data Transformation TODO

## Phase 1: Real-Data Connectors & Empty States

- [x] Database schema extended with 8 new tables for real-data connectors, market data, account state, paper trading, strategies, and governance
- [x] Query helpers built for all real-data operations (40+ functions)
- [x] tRPC procedures created for connector management, account sync, data freshness checks
- [ ] Remove all seeded/demo portfolio data from database and UI
- [ ] Add explicit "not connected" states for unlinked market data and account feeds
- [ ] Implement market data adapter interface (Alpha Vantage, Polygon, Alpaca, Kraken APIs)
- [ ] Implement account state adapter interface (Alpaca, Interactive Brokers, Kraken)
- [ ] Add data freshness indicators and source provenance to all market/account displays
- [ ] Build data quality layer with stale-data flags and gap detection
- [ ] Replace equity snapshot seeding with real-time balance and position aggregation

## Phase 2: Paper Trading Lab

- [ ] Build paper trading engine with simulated fills and realistic slippage/fees
- [ ] Create immutable trade journal with timestamp, signal, rationale, entry, exit, outcome
- [ ] Add founder annotation layer for discretionary view vs. system view comparison
- [ ] Implement daily review workflow with tagged outcomes (signal quality, execution, regime)
- [ ] Build post-trade attribution dashboard (regime, signal type, execution quality)
- [ ] Add paper vs. real performance comparison view
- [ ] Create strategy experiment framework with locked methodology

## Phase 3: Hard Risk Architecture

- [ ] Implement capital controls (max daily loss, weekly loss, per-asset exposure)
- [ ] Build trade controls (max order size, notional limits, stale signal rejection)
- [ ] Add model controls (confidence threshold, regime mismatch filter, cooldowns)
- [ ] Implement portfolio controls (correlation caps, sector concentration, cross-market limits)
- [ ] Build operational controls (kill switch, human approval mode, feed degradation halt)
- [ ] Create governance controls (audit logs, model inventory, approval workflow)
- [ ] Add pre-trade risk checks that override any model decision

## Phase 4: Strategy Registry & Validation

- [ ] Build strategy registry with name, hypothesis, market universe, holding period
- [ ] Add entry/exit logic, sizing rules, allowed regimes, expected costs, failure conditions
- [ ] Implement walk-forward validation framework
- [ ] Build post-cost performance calculator (fees, slippage, adverse selection)
- [ ] Create strategy kill criteria checklist
- [ ] Add strategy performance scorecard (out-of-sample, cost survival, regime consistency)
- [ ] Build strategy retirement and archival workflow

## Phase 5: Market Data & Account Connectors

- [ ] Integrate Alpha Vantage or Polygon for US equities (OHLCV, intraday)
- [ ] Integrate Kraken or similar for crypto (real-time OHLCV, order book depth)
- [ ] Integrate prediction market data source (Polymarket, Manifold, or similar)
- [ ] Build Alpaca account adapter (balances, positions, orders, fills, fees)
- [ ] Build Interactive Brokers adapter (optional for stocks/options)
- [ ] Build Kraken account adapter (optional for crypto)
- [ ] Add normalized event stream across all sources

## Phase 6: Governance & Audit Layer

- [ ] Create immutable event store for all model outputs, decisions, overrides
- [ ] Build model inventory with version tracking and approval workflow
- [ ] Add audit trail for risk limit changes and overrides
- [ ] Implement post-mortem review workflow for losses and anomalies
- [ ] Create compliance export for regulatory reporting (if needed)
- [ ] Build dashboard for governance metrics and control effectiveness

## Phase 7: Testing & Deployment

- [ ] Write integration tests for market data connectors
- [ ] Write integration tests for account adapters
- [ ] Test paper trading accuracy against real fills
- [ ] Validate risk controls under stress scenarios
- [ ] Run end-to-end paper trading experiment (30+ days)
- [ ] Type check and build validation
- [ ] Deploy to production with real-data mode
