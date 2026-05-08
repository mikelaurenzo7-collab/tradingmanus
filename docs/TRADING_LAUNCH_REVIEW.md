# Trading Launch Review

This review is intentionally conservative: it lists what is present in the codebase, what still blocks confident personal-account trading, and what must be verified before live funds are exposed.

## What is already implemented

- Kalshi onboarding validates RSA API credentials live, encrypts them before storage, tracks synced equity, supports disconnect, and gates live arming behind connection/funding status.
- Polymarket onboarding validates L2 CLOB API key, secret, and passphrase, encrypts them before storage, supports disconnect, and now appears beside Kalshi in onboarding and dashboard readiness.
- Autonomous Kalshi execution has configurable mode, cadence, risk posture, confidence thresholds, maximum notional, daily-order caps, approval thresholds, kill-switch controls, order syncing, and reviewer gating.
- Polymarket execution infrastructure exists for CLOB signals, risk checks, order/fill/position tables, and autonomous strategy runs.
- Cross-platform arbitrage scanning exists for Kalshi/Polymarket market normalization, opportunity detection, and opportunity summaries.
- Account creation now exists for subscriber users with password hashing, 7-day trial status, tier selection, billing-link handoff, and subscription metadata in the user record.

## What is left before trading a personal live account confidently

1. **Run a fresh database migration in production.** The users table needs the new password/subscription columns before public signups will work.
2. **Configure billing URLs.** Set `STARTER_CHECKOUT_URL`, `PRO_CHECKOUT_URL`, `FUND_CHECKOUT_URL`, and optionally `BILLING_PORTAL_URL` to your payment processor links. The app can create accounts and hand users to billing; webhook-driven subscription activation is the next recommended hardening step.
3. **Keep paper mode on until one full dry run passes.** Use `PAPER_TRADE_MODE=true` until Kalshi and Polymarket connection, signal generation, risk vetoes, order sync, kill switch, and audit logs complete without errors.
4. **Verify production secrets.** Confirm `JWT_SECRET`, `CREDENTIAL_ENCRYPTION_SECRET`, `DATABASE_URL`, `OWNER_EMAIL`, `OWNER_PASSWORD`, `CRON_SECRET`, and `ANTHROPIC_API_KEY` are present in the deployed runtime. Optionally `XAI_API_KEY` for Grok dual-bot consensus.
5. **Start with minimum live limits.** First live session should use manual or approval-required mode, maximum order notional at the minimum practical size, low max daily orders, and one venue at a time.
6. **Confirm exchange balances independently.** Kalshi equity is surfaced in-app; Polymarket CLOB credential status is surfaced, but a dedicated Polymarket USDC balance tile/websocket reconciliation should be added before scaling live Polymarket order sizes.
7. **Add billing webhooks before selling at scale.** The current implementation supports signup/trial/checkout handoff; production subscription enforcement should add signed Stripe (or processor) webhooks to transition users between `trialing`, `active`, `past_due`, `cancelled`, and `unpaid` automatically.
8. **Perform an end-to-end kill-switch drill.** Before live autonomy, arm with tiny limits, trigger the kill switch, and confirm preferences disarm plus close/sync behavior is reflected in audit logs.

## Suggested go-live sequence

1. Deploy migrations and environment variables.
2. Create a fresh non-owner account through the signup flow.
3. Complete the configured checkout link for the selected tier.
4. Connect Kalshi and Polymarket from onboarding.
5. Leave paper trading enabled and run one scheduler cycle.
6. Review audit log, generated signals, vetoes, and order-sync output.
7. Disable paper mode only for the venue you intend to test first.
8. Trade one minimum-size order in approval-required mode.
9. Confirm exchange-side fill/position, in-app position, P&L, and kill-switch behavior.
10. Increase limits only after repeated clean cycles.
