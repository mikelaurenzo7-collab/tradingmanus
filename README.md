# tradingmanus

Kalshi-focused trading dashboard for local testing and deployment validation.

## Prerequisites

- Node.js 20+
- Corepack enabled
- MySQL-compatible database reachable via `DATABASE_URL`

## Environment setup

1. Copy `.env.example` to `.env`.
2. Fill in the required values:
   - `DATABASE_URL`
   - `JWT_SECRET`
   - `CREDENTIAL_ENCRYPTION_SECRET`
   - `VITE_APP_ID`
   - `VITE_OAUTH_PORTAL_URL`
   - `OAUTH_SERVER_URL`
3. Optional integrations:
   - `OWNER_OPEN_ID`
   - `KALSHI_API_KEY` (only needed for future server-level Kalshi data integrations; user trading uses user-connected credentials)
   - `BUILT_IN_FORGE_API_URL` (optional Manus Forge proxy base URL for auxiliary app services, not Kalshi)
   - `BUILT_IN_FORGE_API_KEY` (optional server-side Forge proxy key)
   - `VITE_FRONTEND_FORGE_API_URL` (optional browser-facing Forge proxy URL, for example a Maps proxy)
   - `VITE_FRONTEND_FORGE_API_KEY` (optional browser-facing Forge proxy key)
   - `VITE_ANALYTICS_ENDPOINT`
   - `VITE_ANALYTICS_WEBSITE_ID`

The server now fails fast at startup if the required server-side variables are missing.

## Install

```bash
corepack pnpm install --frozen-lockfile
```

## Local personal testing

```bash
corepack pnpm check
corepack pnpm test
corepack pnpm build
corepack pnpm dev
```

Useful endpoints:

- App: `http://localhost:3000`
- Health check: `http://localhost:3000/api/health`

## Deployment checklist

1. Set all required environment variables from `.env.example`.
2. Run database migrations before first boot. Startup migrations fail on unknown SQL errors; do not proceed if any migration error is reported.
3. Validate locally:
   - `corepack pnpm check`
   - `corepack pnpm test`
   - `corepack pnpm build`
4. Start production server:

```bash
corepack pnpm start
```

## Personal Kalshi dogfood checklist

Before enabling live trading on your own Kalshi account:

1. Confirm `JWT_SECRET` and `CREDENTIAL_ENCRYPTION_SECRET` are strong, distinct production secrets.
2. Sign in as the intended operator account and connect only that Kalshi account under Connect Kalshi.
3. Confirm the dashboard shows the expected live Kalshi equity before arming.
4. Review Trading Autonomy while disarmed, save policy changes, then use the separate Arm live trading action.
5. Keep maximum order notional and maximum daily orders small for the first dogfood session.
6. Confirm the header shows Live trading armed only when expected; use the header Kill switch or dashboard kill switch to disarm and submit close orders for open positions.
7. Review Audit Log, Positions, Trades, and Kalshi directly after each early autonomous cycle.

## Multi-user production isolation

The app is hardened for a single deployment serving multiple authenticated users with separate Kalshi accounts:

- Every live trading ledger path for orders, fills, positions, signals, performance, capital, credentials, preferences, and training instructions requires an explicit authenticated `userId`.
- Missing or invalid user scope fails closed instead of falling back to user 1.
- Credential encryption is bound to the owning user context; another user context cannot decrypt the stored envelope.
- Audit-log reads are scoped to the authenticated actor and no longer expose a global all-user view through normal app helpers.
- Runtime order-sync guards are keyed by validated user scope so one user cannot block or consume another user's sync loop.
- Startup migrations verify that user-scoped Kalshi tables have `userId` columns that are `NOT NULL` and have no default value.

For future team or organization accounts, add an explicit organization/tenant model and scope admin roles to that tenant before allowing shared-team administration. The current production boundary is authenticated-user isolation.

## Future prediction-market platforms

Launch v1 should stay Kalshi-first. The current backend, database tables, router namespace, and UI copy are intentionally optimized for Kalshi live trading, API-key credentials, and regulated real-money account controls.

Other platforms need an adapter sprint rather than a small patch:

- Polymarket has a materially different wallet/signing and CLOB integration model.
- Manifold has public APIs, but its market mechanics and play-money/social use case do not map directly to Kalshi live-cash risk controls.
- PredictIt and similar legacy venues require fresh legal/API verification before any integration plan.

Before adding another exchange, introduce a platform adapter boundary with typed operations for credentials, account equity, market discovery, order placement, order sync, positions, and risk normalization. Then either add platform-aware generic ledgers or explicit platform columns/indexes so every order, fill, position, signal, audit event, and capital record remains user-scoped and exchange-scoped. The frontend should move from direct `kalshi` assumptions to a platform selector and capability-aware copy.

## Manus Forge endpoint

`https://forge.manus.ai` is a Manus-hosted Forge proxy endpoint. In this codebase, Forge settings are optional auxiliary infrastructure for app services such as LLM calls, data proxies, storage/map/notification helpers, or browser map proxying. They are separate from Kalshi and are not the API endpoint used to place trades.

For Kalshi launch testing, the important live-trading credentials are the user-connected Kalshi API key ID and private key entered through Connect Kalshi. Leave Forge variables blank unless a specific auxiliary feature you use requires them.

## Notes

- Optional analytics only load when both analytics environment variables are set.
- User Kalshi trading actions use the user's encrypted API key/private key pair and stay scoped to that user's ledger.
- Encrypted credential storage uses per-user AES-256-GCM envelopes derived from `CREDENTIAL_ENCRYPTION_SECRET`.
- The dashboard kill switch both disarms live trading and submits exchange close orders for the user's open positions.
- Autonomy policy editing is intentionally locked while live trading is armed; disarm, edit/save, then arm again.
