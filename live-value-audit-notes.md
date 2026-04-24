## 2026-04-24 Kalshi markets API identifier finding

The public `GET /trade-api/v2/markets` documentation shows that market objects return `ticker` as the market identifier, not `id`. The payload also exposes `liquidity_dollars`, `volume_fp`, and status values such as `unopened`, `open`, `paused`, `closed`, and `settled`. The market sync layer must therefore normalize `ticker` into the app's internal `marketId` field and derive prices and liquidity from the documented dollar-denominated fields when the older `yes_price` and `no_price` fields are absent.

## Preview verification findings

The Risk Controls page now renders `Starting Capital`, `Current Capital`, and `Max capital` as `$73.59`, confirming that the legacy seeded capital row has been repaired and that live risk reporting is anchored to the connected Kalshi account. The page still shows static guardrails for `$5` max loss per trade and `$10` max loss per day, which is expected because those are policy limits rather than placeholder balance displays.

The Portfolio Optimization page now shows `Account Equity` as a live Kalshi equity snapshot instead of the former editable fake default. In preview it renders approximately `$74`, reflecting the connected account value with rounded display formatting and live-derived sizing outputs.

The Performance page preview no longer shows a seeded `$100` baseline. It surfaces zeroed realized and unrealized P&L with live-activity framing, which is appropriate given there are no closed trades yet. A direct navigation to `/funding` currently resolves to the app's 404 screen, indicating that the Funding page component is not presently routed into the active shell even though the file still exists in the codebase. That means the funding-copy cleanup remains useful for future re-enablement, but the page is not part of the current reachable surface area.

