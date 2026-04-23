# LAURENZO: Kalshi Trading Agent

**Mission:** Build a Kalshi prediction markets trading agent starting with $100 capital next Friday. Learn from every trade, refine signals, scale profitably.

## Phase 1: Audit & Organize

- [x] Document all existing adapters (Polygon, Alpha Vantage, Alpaca, Kraken, IB)
- [x] Identify what stays (core framework, risk controls, audit logging)
- [x] Identify what goes (non-Kalshi market adapters)
- [x] Refactor schema to Kalshi-specific tables (markets, orders, fills, signals)
- [x] Clean up routers.ts to remove non-Kalshi procedures
- [x] Update UI navigation to Kalshi-only pages

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

## Visual Redesign (Complete)

- [x] Transform global CSS with bold, dreamy aesthetic
- [x] Implement glassmorphism cards with backdrop blur
- [x] Add gradient mesh background with radial overlays
- [x] Create gradient text effects for headings
- [x] Redesign Dashboard with enhanced visual hierarchy
- [x] Redesign Signals page with bold typography and color coding
- [x] Redesign Strategies page with consistent visual language
- [x] Update HTML meta tags and branding
- [x] Add Google Fonts (Inter + JetBrains Mono)
- [x] Implement smooth hover animations and transitions
- [x] Add pulse glow and float animations
- [x] Verify all 42 tests passing with visual changes

## Phase 6: Learning Loop

- [x] Track every trade: entry signal, entry price, exit price, outcome, P&L
- [x] Calculate attribution: signal quality, execution quality, regime
- [x] Identify winning signals vs losing signals
- [x] Measure signal accuracy over time
- [x] Refine signals based on outcomes
- [x] Build dashboard: signal performance, win rate, Sharpe ratio
- [x] Wire into tRPC: `kalshi.getTradeHistory`, `kalshi.getAttributionAnalysis`, `kalshi.getSignalPerformance`

## Phase 7: Kalshi API Integration

- [x] Implement order placement and management
- [x] Add position tracking and P&L calculation
- [x] Implement risk management (stop loss, take profit)
- [x] Add portfolio metrics and capital management
- [x] Implement portfolio health checks
- [x] Wire into tRPC: `kalshi.placeOrder`, `kalshi.closePosition`, `kalshi.getPortfolio`

## UI Simplification & Onboarding

- [x] Simplify DashboardLayout to show only Kalshi-focused navigation
- [x] Remove unnecessary tabs (Bots, Reasoning, Analytics, Connectors, Paper Trading, Strategies)
- [x] Add "Connect Kalshi" as first-priority navigation item
- [x] Create clear onboarding flow for Kalshi account connection
- [x] Add Connect page with step-by-step API key setup
- [x] Improve login screen with Kalshi branding and clear next steps
- [x] All 42 tests passing with simplified UI

## Kalshi Account Connection (Complete)

- [x] Implement encrypted credential storage (AES-256-CBC)
- [x] Create server-side credential validation
- [x] Implement real account equity fetching
- [x] Wire Connect page to backend
- [x] Update Dashboard to display real equity from Kalshi
- [x] Add three tRPC procedures: connectKalshiAccount, getKalshiAccountStatus, disconnectKalshiAccount
- [x] All 42 tests passing with credential flow

## Agent Training Module (Complete)

- [x] Design training instructions database schema (4 tables)
- [x] Create backend helpers for instruction CRUD and scheduling
- [x] Add 6 tRPC procedures for training management
- [x] Integrate instructions into signal generation logic
- [x] Create Training page UI for managing instructions
- [x] Implement instruction scheduling (time windows, day of week)
- [x] Implement instruction versioning and audit trail
- [x] All 42 tests passing with training module

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
