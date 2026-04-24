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

## Signals preview check — 2026-04-24

Generated signals now appear on the Signals page, but the top entries surfaced as contrarian opportunities on markets labeled `1015` and `1055` with `0.0%` implied probability, `$0.00` market price, and `$0.0000` expected value. This does not yet look production-ready for preparing a real candidate order, because the identifiers and price fields appear placeholder-like or insufficiently normalized for operator review.

## Signals preview re-check — 2026-04-24

After normalizing stored market reads, the Signals page still renders recent entries with numeric-looking market IDs such as `1015` and `1055`, plus `0.0%` implied probability and `$0.00` market price. This indicates the old malformed signals are still present in stored signal history and/or fresh signal generation is still inheriting malformed market records elsewhere in the pipeline. Dogfood trading should remain blocked until new signal generation produces trustworthy tickers and prices.

## Signals hardening follow-up — 2026-04-24

After tightening actionable-market filtering in the signal pipeline and excluding malformed stored signal history, the Signals page no longer surfaces the prior zero-price contrarian entries. The current UI now falls back to a safe empty state when no actionable markets are found from the selected open-market set. This is materially safer for dogfood testing, but the next step is to improve market selection so fresh actionable candidates can still be produced instead of only returning an empty registry.

## 2026-04-24 Founders autonomy activation pre-check

The Trading Autonomy page shows the connected Founders account with live equity of $73.59. The currently saved policy is **Approval required · Balanced · Manual only**, and live trading is **disarmed**. The page exposes the **Fully autonomous** mode option, the **Continuous watch** cadence option, and the separate **Arm live trading** control required to permit live execution.
The browser-confirmed selection now shows **Fully autonomous** as the pending autonomy mode, but the policy has not yet been saved and the cadence remains **Manual only** until the next controls are updated.
The browser confirmed that the autonomy policy was saved after selecting **Fully autonomous** with **Continuous watch**. The page now reflects the updated saved policy, while live trading remains separately controlled by the master arm state.
After saving the policy and arming live trading, the Trading Autonomy page showed the Founders account in **Fully autonomous** mode with the live master arm enabled. The Signals page currently opens to a safe empty state with **No signals generated yet**, so a fresh generation run is required before any live candidate can be evaluated.
A direct click on **Generate Signals** from the live Signals page did not change the rendered state. The page remained on the empty-state view with the same button visible, so the next step is to inspect whether the click failed client-side or whether the generation request did not execute.
Direct backend checks from the browser confirmed that the Founders account now has persisted trading preferences of **fully_autonomous**, **continuous_watch**, **balanced**, and **liveTradingEnabled: true**. A direct fetch of open markets returned 200 items, but the initial sample remained dominated by composite or malformed-looking market records, including zero-priced entries. Additional filtering for plausible single-market candidates produced no trustworthy actionable subset, and a direct signal-generation attempt over the first 40 open-market IDs returned no usable candidates. At this point the autonomy switch is enabled, but there is still no trustworthy live trade candidate ready for execution.
