# LAURENZO Codebase Audit

## What Stays (Core Framework)

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
