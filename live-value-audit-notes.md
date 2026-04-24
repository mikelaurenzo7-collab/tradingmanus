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

## Signals verification after composite-market exclusion hardening — 2026-04-24

After tightening composite-market rejection and text bounding in `server/_core/kalshiMarketData.ts`, the live `/signals` page no longer showed malformed zero-price cards in the initial viewport. The visible state now remains `Analyzing markets...`, so the next debugging step is to determine whether the page is waiting on a legitimate request, stuck in a client-side loading loop, or blocked by a backend signal-generation path that still returns no usable standard markets.

A direct browser-console check on the same page produced no client-side errors or warnings. That shifts the suspicion toward a silent loading-state bug, an unresolved query promise, or a backend request path that is not surfacing a failure into the UI.

Follow-up browser verification showed that the page does settle after the initial load: the header and **Generate Signals** button render, and the steady-state view is the safe empty state **No signals generated yet** rather than a permanent loading loop. The earlier `Analyzing markets...` view was therefore a transient initial query state, not the primary blocker.

A live five-page Kalshi API scan with `mve_filter=exclude` found that the current normalization and display-safety filters are *not* the main reason for zero candidates. Across 1,000 raw open markets, 1,000 normalized cleanly, 996 passed the display-safe check, and 63 passed both display-safe and client-actionable pricing-plus-volume checks. The dominant exclusion reasons were bounded pricing and volume, not composite filtering.

The next diagnosed blocker is inside signal generation itself: when no explicit `fundamentalProbability` is passed, the value-play detector uses the neutral `0.5` fallback for opportunity detection but still computes confidence and reasoning from `fundamentalProbability!`, which becomes `undefined`. That produces `NaN` confidence, prevents otherwise valid value-play signals from being pushed, and helps explain why trustworthy first-page markets can still collapse to zero generated candidates.

After fixing that fallback bug and rerunning focused tests, the live Signals page successfully generated non-placeholder candidates. The registry now shows real Kalshi tickers, bounded prices, non-zero implied probabilities, and positive expected values. The top visible examples are baseball prop markets such as `KXMLBHR-26APR241940LAAKC-KCSMARTE0-1` at **$0.09** with **8.8%** implied probability and **$0.4100** expected value, plus `KXMLBHR-26APR241940LAAKC-KCSPEREZ13-1` at **$0.14** with **13.5%** implied probability and **$0.3600** expected value.

This moves the system past the prior zero-candidate blocker. The remaining questions are now qualitative and execution-focused: whether the neutral `50%` fallback is trustworthy enough to justify autonomous dogfood trading, whether these sports-prop candidates are appropriate for the Founders account, and whether candidate-order preparation and live-order safeguards should further constrain which generated signals are eligible for autonomous execution.

After tightening execution-ready ranking to exclude neutral-baseline heuristic value plays, a fresh page reload still showed the older pre-change records in both the **Top Execution Signals** and **All Recent Signals** sections. Those cards were generated before the new gating logic and therefore reflect stale saved data rather than the updated selection policy. The next verification step is to trigger a new signal-generation run and confirm that newly created records either carry the heuristic-baseline label only in recent history or disappear from the execution-ready section entirely.

A fresh generation run did create new records with the expected reasoning label, such as **`Market mispriced (heuristic baseline)`** and **`vs neutral baseline 50.0%`**, confirming that the new write path is active for recent signals. However, the **Top Execution Signals** section still displayed the older 9:42 PM records. That means the execution-ready query is still selecting stale rows from storage rather than only the newly generated post-gating entries, or the top-signal selection path is not filtering older neutral-baseline rows consistently after retrieval. The next debugging step is to inspect the recent-signal/top-signal database retrieval path rather than the generation logic itself.

After broadening the stale-row heuristic detector to also treat legacy `vs fundamental 50.0%` value-play records as heuristic, the live Signals page reloaded without any **Top Execution Signals** section. The page now shows only **All Recent Signals**, where the newly generated cards clearly carry the heuristic-baseline wording. This is the safer expected state: the system can still surface heuristic ideas for review, but it no longer presents neutral-baseline value plays as execution-ready autonomous candidates.
