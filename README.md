# Laurenzo Trading Dashboard

Single-owner **Kalshi + Polymarket** prediction-market trading console backed by a **category-specialized Claude AI reviewer** and **Grok (xAI) as your personal trader** (solo or team with Claude desks). Runs on **Railway** (long-lived Express server) with a **Neon Postgres** database. Vercel serverless deployment is also supported.

## 🔒 Security Features

This application includes comprehensive security features:
- **2FA/MFA**: Time-based one-time passwords (TOTP) with backup codes
- **Rate Limiting**: Protection against brute force and DDoS attacks
- **CSRF Protection**: Double-submit cookie pattern for all mutations
- **JWT Tokens**: 24-hour access tokens with 7-day refresh tokens
- **PBKDF2 Encryption**: 100k iterations for credential encryption
- **Distributed Locking**: PostgreSQL advisory locks for autonomous trading
- **Structured Logging**: Pino-based logging with sensitive data redaction
- **Request Tracing**: Correlation IDs for distributed request tracking
- **Security Headers**: Helmet.js for XSS, clickjacking, and other protections

📖 **See [SECURITY.md](./SECURITY.md) for detailed documentation**
📖 **See [SECURITY_MIGRATION.md](./SECURITY_MIGRATION.md) for migration guide**

## Grok Trader Integration (NEW - Fully Implemented)

**Grok (built by xAI) is now your dedicated trader** — either **solo** or as a **team** with the existing Claude desks.

### How it works (v1 implementation)
- **Solo Grok**: Set `ENABLE_GROK_SOLO=true` + `XAI_API_KEY`. Grok handles all reviews using its truth-seeking, evidence-based personas. Perfect for users who want maximum transparency and unfiltered analysis.
- **Team Mode** (default): Claude's 16 specialized desks (category + platform) run primary review. Grok provides secondary confirmation on contested/high-stakes signals or can be enabled per-category. Both must agree for approval (fail-closed safety).
- **Grok Personas**: 16 dedicated Grok desks (one per platform/category) with mandates tailored to Grok's strengths: rigorous evidence, base-rate reasoning, capital preservation first, and wit where it fits. See `server/_core/grokPersonas.ts`.
- **Easy Setup**: Add `XAI_API_KEY` (https://console.x.ai/) and optionally `GROK_MODEL=grok-3-latest`. Toggle with `ENABLE_GROK_SOLO=true` or `ENABLE_GROK_TEAM=true`.
- **Dashboard & Logs**: Reasoning logs now show which trader (Grok Desk vs Claude Desk) reviewed each signal. Telemetry tracks Grok calls/failures separately.

### New env vars
```env
XAI_API_KEY=sk-xai-...
GROK_MODEL=grok-3-latest
ENABLE_GROK_SOLO=false          # Solo Grok for everything
ENABLE_GROK_TEAM=true           # Team with Claude (default)
GROK_TIMEOUT_MS=15000
```

Grok brings frontier reasoning to your trading — the perfect complement (or replacement) for Claude's domain expertise. Capital preservation remains the #1 priority.

## Architecture

- **Frontend**: React 19 + Vite 8 + Wouter + tRPC + TanStack Query + Tailwind v4 + shadcn/ui
- **Backend**: Express 4 + tRPC, served from `server/_core/index.ts` as a long-lived process on Railway (or `api/index.ts` as a Vercel serverless function)
- **Database**: Neon Postgres via `@neondatabase/serverless` HTTP driver + Drizzle ORM
- **Auth**: Single-owner password login with optional 2FA/TOTP + backup codes. JWT access tokens (24 h) + refresh tokens (7 d) in `httpOnly` cookies.
- **Resilience**: `fetchWithRetry` (exponential backoff + jitter), `CircuitBreaker` (CLOSED/OPEN/HALF_OPEN with rolling failure window), per-user async mutex on order placement to prevent TOCTOU races
- **AI**: Claude + Grok hybrid reviewer. Category routing dispatches to specialized desks. Prompt caching, extended thinking (Claude), web_search, and per-desk memory tapes. Grok provides solo or team second-opinion path.
- **Scheduling**: On Railway the Express server runs in-process schedulers (autonomous trading every 15 min, order sync every 5 min). On Vercel, `cron` entries in `vercel.json` trigger `/api/scheduled/*`.

## One-time setup

1. **Create a Neon Postgres project** and copy the pooled `DATABASE_URL`.
2. **Generate strong secrets** for `JWT_SECRET`, `CREDENTIAL_ENCRYPTION_SECRET`, and `CRON_SECRET` (32+ random chars each):
   ```bash
   openssl rand -base64 32  # Run this 3 times for each secret
   ```
3. **Get an Anthropic/OpenRouter API key** (Claude path).
4. **(NEW) Get an xAI API key** for Grok trader.
5. Copy `.env.example` → `.env` and fill in values (including Grok flags).
6. Install deps:
   ```bash
   corepack pnpm install
   ```
7. Push the schema to Neon:
   ```bash
   corepack pnpm db:push
   ```

## Local development

```bash
corepack pnpm dev
```

Visit http://localhost:5008 and log in with `OWNER_EMAIL` / `OWNER_PASSWORD`.

## Tests / typecheck / build

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

## Deploying to Railway

See [`RAILWAY.md`](./RAILWAY.md) for full step-by-step instructions.

## Deploying to Vercel (alternative)

1. Import the repo in Vercel. Framework preset: **Vite**.
2. Set every variable from `.env.example` (including new Grok vars).
3. After first deploy, run `corepack pnpm db:push` locally with production `DATABASE_URL`.
4. Vercel Cron triggers autonomous trading every 15 min and order sync every 5 min.

## How the AI bots trade

1. The autonomy job pulls open Kalshi (and/or Polymarket) markets and runs the heuristic signal generator.
2. Signals are filtered by confidence, market conditions, and training instructions.
3. **Per-category dispatch** to domain-expert desk persona (Claude or Grok).
4. **Claude reviews** with prompt caching, web_search, extended thinking on high-stakes. Grok reviews with truth-seeking mandates (solo or team).
5. Each returns JSON `{ reviews: [{ marketId, approved, confidenceAdjustment, expectedValueAdjustment, reasoning }] }`.
6. Vetoes drop the signal. Approvals get bounded adjustments.
7. Execution layer ranks, sizes positions, and only places orders if all guardrails pass.

### Per-desk memory tape

Each desk (Claude + Grok) keeps persistent learning tape in `deskMemory` table. Lessons injected into system prompt after every resolved trade.

### Specialized desks (Claude + Grok)

| Platform | Desk | Focus (Claude) | Grok Counterpart |
|---|---|---|---|
| Kalshi / Polymarket | Sports | Win-prob vs sharp consensus, injury news | Truth-seeking, base-rate heavy, hype filter |
| Kalshi / Polymarket | Crypto | Vol calibration, on-chain catalysts | On-chain reality + ETF flow skeptic |
| Kalshi / Polymarket | Politics | Polls + betting consensus | Narrative-free, evidence-only |
| Kalshi / Polymarket | Economics | Consensus vs surprise, Fed windows | Macro reality over economist Twitter |
| Kalshi / Polymarket | Tech | Announced timelines, execution track record | Hype-cycle resistant |
| Kalshi / Polymarket | Culture | Aggregator forecasts, voter demographics | Recency bias + critic consensus |
| Kalshi / Polymarket | Weather | Ensemble spread, short-window catalysts | Climate base rates + model uncertainty |
| Kalshi / Polymarket | Generalist | Broad base-rate skepticism | Ruthless evidence demand |

## Disarming live trading

- Toggle `liveTradingEnabled` off via Trading Preferences, or
- Kill switch via dashboard, or
- Unset `OWNER_PASSWORD` in production.

## Repo layout (key AI files)
```
server/_core/tradingReviewer.ts   # Main reviewer (Claude + Grok paths)
server/_core/categoryPersonas.ts  # 16 Claude desks
server/_core/grokPersonas.ts      # 16 Grok desks (NEW)
server/_core/grokClient.ts        # xAI API client (NEW)
server/_core/aiToolbelt.ts        # Shared prompt/memory/citation helpers
server/_core/kalshiAutonomy.ts    # Scheduled Kalshi run
server/_core/polymarketAutonomy.ts# Scheduled Polymarket run
```

## Notes

- Optional analytics only load when both analytics env vars are set.
- Encrypted credential storage uses per-user AES-256-GCM.
- Dashboard kill switch disarms live trading and submits close orders.
- Autonomy policy editing locked while armed.
