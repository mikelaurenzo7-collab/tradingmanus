## 2026-04-24 Kalshi markets API identifier finding

The public `GET /trade-api/v2/markets` documentation shows that market objects return `ticker` as the market identifier, not `id`. The payload also exposes `liquidity_dollars`, `volume_fp`, and status values such as `unopened`, `open`, `paused`, `closed`, and `settled`. The market sync layer must therefore normalize `ticker` into the app's internal `marketId` field and derive prices and liquidity from the documented dollar-denominated fields when the older `yes_price` and `no_price` fields are absent.

## Preview verification findings

The Risk Controls page now renders `Starting Capital`, `Current Capital`, and `Max capital` as `$73.59`, confirming that the legacy seeded capital row has been repaired and that live risk reporting is anchored to the connected Kalshi account. The page still shows static guardrails for `$5` max loss per trade and `$10` max loss per day, which is expected because those are policy limits rather than placeholder balance displays.

The Portfolio Optimization page now shows `Account Equity` as a live Kalshi equity snapshot instead of the former editable fake default. In preview it renders approximately `$74`, reflecting the connected account value with rounded display formatting and live-derived sizing outputs.

The Performance page preview no longer shows a seeded `$100` baseline. It surfaces zeroed realized and unrealized P&L with live-activity framing, which is appropriate given there are no closed trades yet. A direct navigation to `/funding` currently resolves to the app's 404 screen, indicating that the Funding page component is not presently routed into the active shell even though the file still exists in the codebase. That means the funding-copy cleanup remains useful for future re-enablement, but the page is not part of the current reachable surface area.

## Trading autonomy preview verification — 2026-04-24

The new `/autonomy` page now explicitly answers how to start live trading inside the app: connect Kalshi, choose an autonomy mode, save the policy, and arm live trading. The page visibly exposes four modes — Manual, Approval Required, Semi-autonomous, and Fully Autonomous — and the master-arm card separates policy saving from live-trading activation so the flow is harder to misunderstand.

Preview interaction confirmed that the Fully Autonomous card can be selected in the UI and that the save panel updates to reflect the selected mode. The dashboard home screen also now includes a dedicated Trading Autonomy status card and a sidebar navigation entry, making the control path discoverable without guesswork.

The main dashboard entry point now opens a three-step preparation dialog instead of an ambiguous start command. In preview, clicking **Arm Live Trading** opened a checklist that surfaced funded-account confirmation, the current autonomy policy, instruction status, and a clear warning that manual mode cannot arm live trading. This makes the operator handoff materially clearer before any live execution is enabled.
