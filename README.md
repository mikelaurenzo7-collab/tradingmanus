# Laurenzo Trading Dashboard

**High-Leverage Wins Only** — strict dual-AI (Claude + Grok) guardrails for profitable trading.

- **Owner (you)**: Trade live immediately with high-leverage filters.
- **Other users**: Must paper trade first and graduate (55%+ win rate over 30+ trades + positive EV) before live access.
- No guarantees — trading involves risk of loss. These rules improve odds by filtering low-edge trades.

## High-Leverage Profit Guardrails (both bots)

Live orders only pass if they meet **strict criteria**:
- EV ≥ 3.5% (owner: 3.0%)
- Confidence ≥ 68% after adjustments (owner: 65%)
- Dual-bot consensus (Grok must approve in team mode)
- No cold-streak trading
- Portfolio exposure capped at 20% total / 10% per correlated group

This produces **fewer but higher-quality trades** — exactly what you asked for.

## Paper Graduation for Non-Owners

Non-owners start in paper mode. They graduate automatically when:
- ≥ 30 paper trades
- Win rate ≥ 55%
- Cumulative EV > 0

Owner bypasses paper entirely (but still subject to high-leverage guardrails).

## Quick Setup
```env
OWNER_EMAIL=your@email.com          # You = live immediately
XAI_API_KEY=sk-xai-...              # Grok trader
ENABLE_GROK_TEAM=true               # Claude + Grok consensus (recommended)
PAPER_TRADE_MODE=false              # Global override (emergency only)
PAPER_GRADUATION_WIN_RATE=0.55
PAPER_MIN_TRADES=30
```

## Architecture
- `effectivePaperMode.ts` — owner live, users graduate
- `profitGuardrails.ts` — high-leverage EV/confidence/dual-bot gates
- `tradingReviewer.ts` — both bots + guardrails filter every signal
- `grokPersonas.ts` + `categoryPersonas.ts` — 32 specialized desks total

Pull latest, set your env, and start with paper mode for testing. High-leverage only — quality over quantity.