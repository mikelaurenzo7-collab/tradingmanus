# LAURENZO: Kalshi Trading Agent

**Mission:** Build a Kalshi prediction markets trading agent starting with $100 capital next Friday. Learn from every trade, refine signals, scale profitably.

## Phase 1: Audit & Organize

- [ ] Document all existing adapters (Polygon, Alpha Vantage, Alpaca, Kraken, IB)
- [ ] Identify what stays (core framework, risk controls, audit logging)
- [ ] Identify what goes (non-Kalshi market adapters)
- [ ] Refactor schema to Kalshi-specific tables (markets, orders, fills, signals)
- [ ] Clean up routers.ts to remove non-Kalshi procedures
- [ ] Update UI navigation to Kalshi-only pages

## Phase 2: Kalshi Market Data

- [x] Build Kalshi market data adapter (fetch all markets, odds, volumes)
- [x] Implement polling-based market feed subscription (5s interval, 1-hour history)
- [ ] Persist market snapshots to database with timestamped history
- [x] Track market metadata (category, description, resolution date)
- [x] Add data freshness tracking and quality scoring
- [x] Wire into tRPC: `kalshi.getMarkets`, `kalshi.getMarketDetails`, `kalshi.subscribeMarketFeed`
- [ ] Implement order-book fetching and persistence
- [ ] Add liquidity tracking to market metadata

## Phase 3: Kalshi Trading Execution

- [ ] Build Kalshi order execution layer (place orders, cancel, modify)
- [ ] Implement order status tracking (pending, filled, cancelled, rejected)
- [ ] Track fills with timestamps, prices, quantities
- [ ] Implement position tracking (open orders, filled positions, P&L)
- [ ] Add order validation and pre-trade risk checks
- [ ] Wire into tRPC: `kalshi.placeOrder`, `kalshi.cancelOrder`, `kalshi.getPositions`, `kalshi.getOrderStatus`

## Phase 4: Capital Controls ($100)

- [x] Set hard capital limits: $100 starting capital
- [x] Max loss per trade: $5 (5% of capital)
- [x] Max loss per day: $10 (10% of capital)
- [x] Max position size: $20 (20% of capital)
- [x] Max open positions: 5
- [x] Implement pre-trade checks that block violations
- [x] Add kill-switch to flatten all positions instantly
- [x] Wire into tRPC: `kalshi.getRiskLimits`, `kalshi.killSwitch`

## Phase 5: Signal Generation

- [x] Define signal framework (value play, momentum, contrarian)
- [x] Build market analysis service (implied probability, volume patterns)
- [x] Implement signal scoring (confidence 0-1)
- [x] Create signal types (value play, momentum, contrarian)
- [x] Add signal filtering (only trade high-confidence signals)
- [x] Wire into tRPC: `kalshi.generateSignals`, `kalshi.getSignalHistory`
- [ ] Implement arbitrage signal detection
- [ ] Add sentiment analysis (defer or integrate external API)
- [x] Wire signal generation into frontend UI with loading/error states

## Phase 6: Learning Loop

- [ ] Track every trade: entry signal, entry price, exit price, outcome, P&L
- [ ] Calculate attribution: signal quality, execution quality, regime
- [ ] Identify winning signals vs losing signals
- [ ] Measure signal accuracy over time
- [ ] Refine signals based on outcomes
- [ ] Build dashboard: signal performance, win rate, Sharpe ratio
- [ ] Wire into tRPC: `kalshi.getTradeHistory`, `kalshi.getAttributionAnalysis`, `kalshi.getSignalPerformance`

## Phase 7: Kalshi API Integration

- [ ] Request Kalshi API credentials
- [ ] Wire API key into environment
- [ ] Test market data fetching
- [ ] Test order execution (paper trading first)
- [ ] Validate all risk controls
- [ ] Run end-to-end test

## Phase 8: Live Deployment

- [ ] Deploy to production
- [ ] Monitor first 24 hours
- [ ] Track P&L and signal quality
- [ ] Refine signals based on live results
- [ ] Scale capital as profitability increases

---

## Current Status

**Backend:** Real-data framework complete (adapters, risk controls, audit logging)
**Frontend:** 11-page dashboard with retro-futuristic UI - MIGRATED to Kalshi-only architecture
**Tests:** 46/47 passing
**Completed:** Phase 1 (Audit & Organize) - Frontend pages refactored to use Kalshi router
**Database:** All Kalshi tables created and initialized with $100 capital
**In Progress:** OAuth flow verification
**Next:** Test OAuth login and implement Phase 2 (Kalshi Market Data)

## Recent Changes (Frontend Migration)

- [x] Migrated all 11 frontend pages from multi-market architecture to Kalshi-focused
- [x] Updated all pages to use kalshi router procedures (getCapital, getPositions, getRecentSignals, getAuditLog)
- [x] Fixed all TypeScript compilation errors (0 errors)
- [x] Aligned data structures to use kalshiCapital schema
- [x] Verified dev server is running and frontend is responsive

- [x] Implement and test a robust kill switch that returns detailed per-position outcomes
- [ ] Add `kalshi.updateRiskLimits` or explicitly defer it after validating scope
- [x] Add Vitest coverage for `kalshi.getRiskLimits` and `kalshi.killSwitch`
- [x] Wire risk control procedures into the frontend and verify loading, error, and success states

- [x] Add trade-history database helper and expose via tRPC
- [x] Add focused router-level tests for trade-history retrieval
- [x] Improve market-data adapter with dedicated market-details helper
- [x] Add implied-probability calculation to market data
- [x] Persist fetched market metadata through the router
- [x] Add focused market-data router tests
