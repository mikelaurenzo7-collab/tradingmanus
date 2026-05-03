# LAURENZO Codebase Audit

> **Last updated**: 2026-05-03
> This document reflects the codebase after the full Kalshi + Polymarket refactor including Phase 1-3 improvements (logger migration, code splitting, Polymarket tables).

## Current Architecture

### Database (active tables)
- `users` — User authentication, 2FA, beta access level
- `auditLog` — Immutable event store
- `autonomyRuns` — Per-run ledger for every scheduled autonomy execution
- `distributedLocks` — Table-based distributed locking (replaces PostgreSQL advisory locks)
- `kalshiCredentials` — Encrypted API credentials per user
- `kalshiMarkets` / `kalshiMarketSnapshots` / `kalshiOrderBook` — Market data
- `kalshiOrders` / `kalshiFills` / `kalshiPositions` — Order lifecycle
- `kalshiSignals` / `kalshiPerformance` — Signal generation and attribution
- `kalshiCapital` — Capital tracking per user
- `tradingPreferences` — Autonomy mode, cadence, risk posture per user
- `trainingInstructions` / `instructionRules` / `instructionSchedules` / `instructionHistory` — User-defined trading rules
- `polymarketCredentials` — Encrypted Polymarket API credentials
- `polymarketOrders` / `polymarketFills` / `polymarketPositions` — Dedicated Polymarket order lifecycle (USDC CLOB semantics)
- `userPlatformSubscriptions` — Which platforms each user is subscribed to
- `deskMemory` / `botConfigs` / `chatMessages` — AI desk memory and chatbot

---

## Backend Services (active)

### Core Infrastructure
- `server/_core/context.ts` — Auth context
- `server/_core/trpc.ts` — tRPC setup with `protectedProcedure`
- `server/_core/app.ts` — Express app, CORS, CSRF, rate limiting, scheduled endpoints
- `server/_core/index.ts` — Node.js server entry (local scheduler with locking + owner scoping)
- `server/_core/env.ts` — Environment variable validation
- `server/_core/auth.ts` — JWT token management
- `server/_core/cookies.ts` — Secure cookie options
- `server/_core/csrf.ts` — CSRF double-submit cookie middleware (wired)
- `server/_core/rateLimiter.ts` — `apiLimiter`, `authLimiter`, `scheduledLimiter`, `tradingLimiter`
- `server/_core/distributedLock.ts` — Table-based distributed lock (PostgreSQL advisory locks removed)
- `server/_core/correlationId.ts` — Request correlation ID middleware
- `server/_core/logger.ts` — Pino structured logging
- `server/_core/notification.ts` — Owner notifications

### Authentication
- `server/_core/twoFactor.ts` — TOTP 2FA
- `server/_core/kalshiAuth.ts` — Kalshi credential encryption (PBKDF2)
- `server/_core/polymarketAuth.ts` — Polymarket credential validation + market/order proxy

### Trading
- `server/_core/kalshiMarketData.ts` — Kalshi market data adapter
- `server/_core/kalshiMarketFeed.ts` — Polling-based market feed
- `server/_core/kalshiMarketSnapshots.ts` — Market snapshot persistence
- `server/_core/kalshiExecution.ts` — Order placement, cancellation, position closing
- `server/_core/kalshiOrderSync.ts` — Order/position reconciliation
- `server/_core/kalshiSignals.ts` — Signal generation framework
- `server/_core/kalshiRisk.ts` — Pre-trade risk checks
- `server/_core/kalshiAdvancedRisk.ts` — Advanced risk models
- `server/_core/kalshiLearning.ts` — Trade attribution and performance
- `server/_core/kalshiAutonomy.ts` — Scheduled autonomous trading batch
- `server/_core/kalshiCombinatorial.ts` — Combinatorial arbitrage detection
- `server/_core/kalshiBacktest.ts` — Backtesting framework
- `server/_core/kalshiPortfolioOptimization.ts` — Portfolio optimization
- `server/_core/kalshiFunding.ts` — Funding tracking
- `server/_core/kalshiSentiment.ts` — Sentiment analysis
- `server/_core/kalshiArbitrage.ts` — Arbitrage signal detection

### Polymarket (secondary platform — uses Kalshi tables as proxy for performance)
- `server/_core/polymarketSignals.ts` — Signal generation
- `server/_core/polymarketSignalReviewer.ts` — AI-powered signal review
- `server/_core/polymarketRisk.ts` — Risk management
- `server/_core/polymarketAutonomy.ts` — Autonomous trading
- `server/_core/polymarketLearning.ts` — Performance attribution
- `server/_core/polymarketClusterMonitor.ts` — Cluster detection
- `server/_core/polymarketMarketMaking.ts` — Market making

### AI
- `server/_core/llm.ts` — LLM integration (Anthropic)
- `server/_core/aiToolbelt.ts` — AI toolbelt (web search, extended thinking, prompt cache)
- `server/_core/tradingReviewer.ts` — Kalshi AI trading reviewer
- `server/_core/arbitrageReviewer.ts` — Arbitrage AI reviewer
- `server/_core/crossBotStrategies.ts` — Cross-platform signal merging
- `server/_core/crossPlatformArbitrage.ts` — Cross-platform arbitrage
- `server/_core/categoryPersonas.ts` — Category-specific reviewer personas
- `server/_core/marketCategoryRouter.ts` — Market category routing
- `server/_core/alerting.ts` — Operational alerts (webhook)

---

## Frontend Pages (active)
- `client/src/pages/Dashboard.tsx` — Main dashboard
- `client/src/pages/Positions.tsx` — Open positions
- `client/src/pages/Trades.tsx` — Trade history
- `client/src/pages/Signals.tsx` — Signal generation and performance
- `client/src/pages/RiskControls.tsx` — Risk controls (adapted for $100 capital)
- `client/src/pages/AuditLog.tsx` — Audit log viewer
- `client/src/pages/Connect.tsx` — Kalshi account connection onboarding
- `client/src/pages/Training.tsx` — User-defined trading instructions
- `client/src/pages/Performance.tsx` — Learning dashboard
- `client/src/pages/TradingAutonomy.tsx` — Autonomy settings and run history
- `client/src/pages/SentimentAnalysis.tsx` — Sentiment analysis
- `client/src/pages/PortfolioOptimization.tsx` — Portfolio optimization
- `client/src/pages/Backtesting.tsx` — Backtesting
- `client/src/pages/Analytics.tsx` — Analytics
- `client/src/pages/Funding.tsx` — Funding
- `client/src/pages/ClusterMonitor.tsx` — Polymarket cluster monitor
- `client/src/pages/Strategies.tsx` — Strategies overview
- `client/src/pages/Chat.tsx` — AI chatbot

---

## Open Items / Known Gaps

### Distributed Lock Schema
Run `corepack pnpm db:push` to push the updated schema (including new `polymarketOrders`, `polymarketFills`, `polymarketPositions` tables) before deploying.

### CRON_SECRET Required in Production
Without `CRON_SECRET` (≥ 32 chars), the Vercel cron trigger falls back to JWT auth and silently fails — autonomous trading will not run. See `server/_core/env.ts`.


**Database:**
- `users` - User authentication
- `auditLog` - Immutable event store
- `riskLimits` - Capital controls (will adapt for $100 Kalshi)
- `paperTrades` - Trade journal (will use for Kalshi trades)
- `reasoningLogs` - Signal reasoning (will use for Kalshi signals)

**Backend Services:**
- `server/_core/context.ts` - Auth context
- `server/_core/trpc.ts` - tRPC setup with protectedProcedure
- `server/_core/notification.ts` - Owner notifications
- `server/_core/llm.ts` - LLM integration (for signal generation)
- `server/db.ts` - Core query helpers (will extend for Kalshi)

**Frontend:**
- `client/src/App.tsx` - Routing (will simplify to Kalshi pages)
- `client/src/components/DashboardLayout.tsx` - Navigation sidebar
- `client/src/index.css` - Retro-futuristic styling (keep as-is)
- `client/src/lib/trpc.ts` - tRPC client setup

---

## What Goes (Non-Kalshi Adapters)

**Market Data Adapters (remove):**
- `server/_core/marketDataAdapter.ts` - Polygon, Alpha Vantage, Alpaca, Kraken (REMOVE)
- `server/_core/marketDataSync.ts` - Generic market data sync (REMOVE)
- `server/_core/marketDataScheduler.ts` - Generic scheduler (REMOVE)

**Account State Adapters (remove):**
- `server/_core/accountStateAdapter.ts` - Alpaca, IB, Kraken adapters (REMOVE)

**Attribution (remove for now):**
- `server/_core/postTradeAttribution.ts` - Will rebuild Kalshi-specific (REMOVE)
- `server/_core/attributionRouter.ts` - Will rebuild Kalshi-specific (REMOVE)

**Database Tables (remove):**
- `dataConnectors` - Generic data connector tracking (REMOVE)
- `accountConnectors` - Generic account connector tracking (REMOVE)
- `marketDataSnapshots` - Generic market data storage (REMOVE)
- `accountSnapshots` - Generic account state storage (REMOVE)
- `strategies` - Generic strategy registry (REMOVE - will rebuild Kalshi-specific)
- `bots` - Generic bot status (REMOVE - will rebuild Kalshi-specific)
- `positions` - Generic positions (REMOVE - will rebuild Kalshi-specific)
- `trades` - Generic trades (REMOVE - will rebuild Kalshi-specific)
- `equitySnapshots` - Generic equity tracking (REMOVE - will rebuild Kalshi-specific)
- `alerts` - Generic alerts (REMOVE - will rebuild Kalshi-specific)
- `killSwitchEvents` - Generic kill-switch (KEEP - will adapt)

**Frontend Pages (remove):**
- `client/src/pages/Connectors.tsx` - Generic connectors (REMOVE)
- `client/src/pages/PaperTrading.tsx` - Generic paper trading (REMOVE)
- `client/src/pages/Strategies.tsx` - Generic strategies (REMOVE)
- `client/src/pages/RiskControls.tsx` - Generic risk controls (KEEP - adapt for $100)
- `client/src/pages/AuditLog.tsx` - Generic audit log (KEEP)
- `client/src/pages/Analytics.tsx` - Generic analytics (REMOVE)
- `client/src/pages/Trades.tsx` - Generic trades (REMOVE)
- `client/src/pages/Bots.tsx` - Generic bots (REMOVE)
- `client/src/pages/Positions.tsx` - Generic positions (REMOVE)
- `client/src/pages/ReasoningLog.tsx` - Generic reasoning (REMOVE)
- `client/src/pages/Dashboard.tsx` - Generic dashboard (KEEP - adapt for Kalshi)

---

## What's New (Kalshi-Specific)

**Database Tables (create):**
- `kalshiMarkets` - Market metadata (category, description, resolution, liquidity)
- `kalshiOrders` - Order tracking (symbol, side, quantity, price, status)
- `kalshiFills` - Fill tracking (order_id, fill_price, fill_quantity, timestamp)
- `kalshiPositions` - Position tracking (market, quantity, entry_price, current_price, P&L)
- `kalshiSignals` - Signal generation (market, signal_type, confidence, reasoning)
- `kalshiPerformance` - Signal performance (signal_id, outcome, accuracy, attribution)

**Backend Services (create):**
- `server/_core/kalshiMarketData.ts` - Kalshi market data adapter
- `server/_core/kalshiExecution.ts` - Kalshi order execution layer
- `server/_core/kalshiSignals.ts` - Signal generation framework
- `server/_core/kalshiLearning.ts` - Learning loop and attribution

**tRPC Routers (create):**
- `kalshi.getMarkets` - Fetch all Kalshi markets
- `kalshi.getMarketDetails` - Market metadata and order book
- `kalshi.subscribeMarketFeed` - Real-time market updates
- `kalshi.placeOrder` - Execute trade
- `kalshi.cancelOrder` - Cancel order
- `kalshi.getPositions` - Current positions
- `kalshi.getOrderStatus` - Order tracking
- `kalshi.generateSignals` - Generate trading signals
- `kalshi.getTradeHistory` - Trade journal
- `kalshi.getAttributionAnalysis` - Signal performance
- `kalshi.getRiskLimits` - Capital controls
- `kalshi.killSwitch` - Flatten all positions

**Frontend Pages (create):**
- `client/src/pages/KalshiMarkets.tsx` - Market browser and watchlist
- `client/src/pages/KalshiTrading.tsx` - Live trading interface
- `client/src/pages/KalshiSignals.tsx` - Signal generation and performance
- `client/src/pages/KalshiJournal.tsx` - Trade journal with attribution
- `client/src/pages/KalshiPerformance.tsx` - Learning dashboard (win rate, Sharpe, signal accuracy)

---

## Migration Path

1. **Backup current schema** (save for reference)
2. **Drop non-Kalshi tables** from database
3. **Create Kalshi-specific tables**
4. **Delete non-Kalshi adapters and routers**
5. **Create Kalshi adapters and routers**
6. **Delete non-Kalshi pages**
7. **Create Kalshi pages**
8. **Update navigation in DashboardLayout**
9. **Test all Kalshi procedures**
10. **Deploy**

---

## Code Organization Summary

**Before:** Multi-market framework (Stocks, Crypto, Prediction Markets)
**After:** Kalshi-focused trading agent

**Kept:** 30% (core framework, auth, risk controls, audit logging)
**Removed:** 50% (generic adapters, multi-market pages)
**New:** 70% (Kalshi-specific adapters, execution, signals, learning)

**Result:** Lean, focused codebase optimized for Kalshi trading with $100 capital.
