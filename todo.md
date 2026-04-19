# LAURENZO: Real-Data Transformation TODO

## Phase 1: Real-Data Connectors & Empty States

- [x] Database schema extended with 8 new tables for real-data connectors, market data, account state, paper trading, strategies, and governance
- [x] Query helpers built for all real-data operations (40+ functions)
- [x] tRPC procedures created for connector management, account sync, data freshness checks
- [x] Frontend Connectors page built with data and account connector status display
- [x] Empty states for unlinked market data and account feeds
- [x] Loading and error states added to all new pages (Connectors, PaperTrading, Strategies, RiskControls, AuditLog)
- [x] Implement market data adapter interface (Alpha Vantage, Polygon, Alpaca, Kraken APIs)
- [x] Implement account state adapter interface (Alpaca, Interactive Brokers, Kraken)
- [ ] Add data freshness indicators and source provenance to all market/account displays
- [ ] Build data quality layer with stale-data flags and gap detection
- [ ] Replace equity snapshot seeding with real-time balance and position aggregation

## Phase 2: Paper Trading Lab

- [x] Paper trading database tables with immutable journaling
- [x] Frontend PaperTrading page with active/closed trade display
- [x] Trade journal entry creation with founder/system view annotations
- [x] Query helpers for paper trade CRUD and journal management
- [x] tRPC procedures for paper trading operations
- [x] Build post-trade attribution dashboard (regime, signal type, execution quality)
- [ ] Add paper vs. real performance comparison view
- [ ] Create strategy experiment framework with locked methodology

## Phase 3: Hard Risk Architecture

- [x] Risk limits database table with capital, trade, model, and portfolio controls
- [x] Frontend RiskControls page with limit visualization by category
- [x] Query helpers for risk limit CRUD and enforcement
- [x] tRPC procedures for risk limit management
- [x] Kill-switch implementation with automatic position flattening and bot halting
- [x] Audit logging for all risk control changes and overrides
- [ ] Add pre-trade risk checks that override any model decision

## Phase 4: Strategy Registry & Validation

- [x] Strategy registry database table with hypothesis, entry/exit logic, sizing rules
- [x] Frontend Strategies page with strategy list and metadata display
- [x] Query helpers for strategy CRUD and validation recording
- [x] tRPC procedures for strategy management and validation
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

- [x] Audit log database table with immutable event store
- [x] Frontend AuditLog page with event filtering and details
- [x] Query helpers for audit log creation and retrieval
- [x] tRPC procedures for audit logging
- [x] Audit events recorded for all critical operations (strategy changes, risk limit updates, kill-switch activation)
- [ ] Implement post-mortem review workflow for losses and anomalies
- [ ] Create compliance export for regulatory reporting (if needed)
- [ ] Build dashboard for governance metrics and control effectiveness

## Phase 7: Testing & Deployment

- [x] Write integration tests for real-data platform (18 tests, all passing)
- [x] Test data connector queries and account connector management
- [x] Test paper trading CRUD and journal entry creation
- [x] Test strategy registry and validation recording
- [x] Test audit logging and event filtering
- [x] Type check and build validation (no TypeScript errors)
- [ ] Write integration tests for market data connectors (Polygon, Alpha Vantage, Kraken)
- [ ] Write integration tests for account adapters (Alpaca, Interactive Brokers, Kraken)
- [ ] Validate risk controls under stress scenarios
- [ ] Run end-to-end paper trading experiment (30+ days)
- [ ] Deploy to production with real-data mode

## Phase 8: Branding Rename

- [x] Rename "NEXUS OMEGA" to "LAURENZO" throughout the codebase
  - [x] Update all page titles and headers (client/src/**/*.tsx)
  - [x] Update dashboard title and subtitle
  - [x] Update project name in package.json
  - [x] Update window title and meta tags (client/index.html)
  - [x] Verified no remaining NEXUS OMEGA references in source code
  - [x] TypeScript validation passes after rename


## Phase 9: Market Data Adapters

- [x] Create Polygon.io adapter with quote fetching
- [x] Create Alpha Vantage adapter for stocks and crypto
- [x] Create Kraken adapter for crypto data
- [x] Build market data sync service with parallel fetching
- [x] Implement data quality scoring (confidence 0-1)
- [x] Wire marketDataSync into tRPC procedures for live fetching
- [ ] Add scheduled sync jobs (cron or interval)
- [ ] Implement retry logic with exponential backoff
- [ ] Add integration tests for all adapters
- [ ] Surface freshness indicators in Connectors UI
- [ ] Update connector status based on sync results

## Phase 10: Data Quality Layer

- [ ] Build stale-data detection (flag data older than threshold)
- [ ] Add data gap detection (missing timestamps, incomplete candles)
- [ ] Implement freshness indicators on Connectors page
- [ ] Add data quality warnings to Dashboard
- [ ] Build data source provenance tracking
- [ ] Create data quality metrics dashboard

## Phase 11: UI/UX Polish

- [ ] Add real-time data refresh indicators (loading spinners, last-updated timestamps)
- [ ] Improve empty states with actionable guidance
- [ ] Refine responsive design for mobile and tablet
- [ ] Add keyboard shortcuts for power users
- [ ] Implement dark/light theme toggle
- [ ] Add data export functionality (CSV, JSON)
- [ ] Create onboarding flow for first-time users

## Phase 12: Account State Adapters

- [ ] Build Alpaca account adapter for balance and position sync
- [ ] Build Interactive Brokers adapter framework
- [ ] Implement account balance reconciliation
- [ ] Add position state tracking and drift detection
- [ ] Create account health dashboard

## Phase 13: Post-Trade Attribution

- [ ] Build post-trade analysis framework
- [ ] Implement signal quality scoring
- [ ] Add execution quality metrics
- [ ] Create regime attribution analysis
- [ ] Build performance comparison (paper vs. real)

## Phase 14: Final Polish & Deployment

- [ ] Run comprehensive integration tests
- [ ] Performance optimization and profiling
- [ ] Security audit and hardening
- [ ] Documentation and API reference
- [ ] Production deployment and monitoring setup
