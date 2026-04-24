# Risk and Performance Dashboard Upgrade Notes

## Current UI state
- `client/src/pages/RiskControls.tsx` already uses `kalshi.getRiskLimits`, `kalshi.getCapital`, `kalshi.getPerformanceOverview`, and `advanced.risk.generateRiskAlerts`.
- `client/src/pages/Performance.tsx` already shows core metrics, attribution cards, and signal-performance summaries from `kalshi.getPerformanceOverview`.

## Available backend capability not fully surfaced yet
- `server/_core/kalshiAdvancedRisk.ts` also supports volatility calculation, volatility-adjusted sizing, stop levels, and recommendation generation.
- `server/_core/kalshiLearning.ts` exposes rich performance metrics including avg win/loss, breakeven trades, profit factor, drawdown, recovery factor, realized/unrealized PnL, active positions, and signal-level recommendations.
- `server/_core/kalshiBacktest.ts` includes comparison helpers that could support consistency-style performance framing if needed.

## Candidate next upgrade direction
1. Extend Risk Controls with recommendation panels, volatility-adjusted sizing guidance, and clearer risk-budget diagnostics.
2. Extend Performance with avg win/loss, breakeven count, profit-factor framing, and stronger attribution/learning cards.
3. Add focused client-side helper tests before final runtime verification.
