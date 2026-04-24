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
   - `VITE_APP_ID`
   - `VITE_OAUTH_PORTAL_URL`
   - `OAUTH_SERVER_URL`
   - `KALSHI_API_KEY`
3. Optional integrations:
   - `OWNER_OPEN_ID`
   - `BUILT_IN_FORGE_API_URL`
   - `BUILT_IN_FORGE_API_KEY`
   - `VITE_FRONTEND_FORGE_API_URL`
   - `VITE_FRONTEND_FORGE_API_KEY`
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
2. Run database migrations before first boot.
3. Validate locally:
   - `corepack pnpm check`
   - `corepack pnpm test`
   - `corepack pnpm build`
4. Start production server:

```bash
corepack pnpm start
```

## Notes

- Optional analytics only load when both analytics environment variables are set.
- Kalshi trading actions now fail clearly when `KALSHI_API_KEY` is missing.
- Encrypted credential storage requires `JWT_SECRET`; there is no fallback key.
