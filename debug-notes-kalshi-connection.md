# Kalshi Connection Debug Notes

## Current findings

The in-app Kalshi connection flow is intended to store each user's personal Kalshi API key and private key in the app database after validation, not in Manus project settings.

The current router flow is:

1. `kalshi.connectKalshiAccount` validates the submitted key pair with `validateKalshiCredentials`.
2. It then fetches account equity with `fetchKalshiAccountEquity`.
3. It saves the encrypted credentials with `saveKalshiCredentials(userId, ...)`.
4. It updates local capital and writes an audit event.

## Observed blockers

The auth context is intermittently failing before or during protected procedure access with:

- `DrizzleQueryError` on the `users` query
- `Can't add new command when connection is in closed state`

This points to the database client lifecycle rather than the user's Kalshi key entry alone.

## Kalshi docs confirmation

The official Kalshi docs currently show:

- demo base URL: `https://demo-api.kalshi.co`
- signed path example: `/trade-api/v2/portfolio/balance`
- signing format: `timestamp + METHOD + path_without_query`
- required headers: `KALSHI-ACCESS-KEY`, `KALSHI-ACCESS-TIMESTAMP`, `KALSHI-ACCESS-SIGNATURE`

## Code mismatch to verify

Current code uses:

- production base URL: `https://api.elections.kalshi.com/trade-api/v2`
- demo base URL: `https://demo-api.kalshi.co/trade-api/v2`

The signing logic appears aligned with the docs for stripping query parameters, but the production hostname still needs verification and the database client should likely be upgraded from a single connection to a resilient pool or reconnecting client.
