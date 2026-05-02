# 🛎️ Reminder — Pending Deploy Steps

> Read me first the next time you sit down to deploy.

Two things still need to happen before the latest commits are fully live:
1. Push the new Postgres schema (`deskMemory` table).
2. Set the new Vercel env vars to enable shadow trading + safety modules.

**You can do them in either order.**  Doing both in one sitting is safest —
that way the next deploy from main is fully wired.  See
`SHADOW_TRADING_RUNBOOK.md` for the full graduation plan once shadow data
starts accumulating.

---

## 1. Database push

The Claude-primary reviewer + per-desk memory work added **one new
Postgres table**: `deskMemory`.  The reviewer fails gracefully (skips
memory injection) when the table is missing, but provision it before
real trades start so the desks can actually accumulate a learning tape.

```bash
export DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
corepack pnpm db:push
```

Confirm:
```sql
\d "deskMemory"
```
You should see: `id, userId, platform, deskId, notes, tradeCount, winCount, lossCount, createdAt, updatedAt`.

Schema diff (strictly additive):
- enum `desk_platform` = `("kalshi", "polymarket")`
- enum `desk_outcome` = `("win", "loss", "scratch")`
- table `deskMemory` keyed effectively by `(userId, platform, deskId)`

No other tables were modified by the recent commits — everything else
runs off audit-log events (Polymarket open positions, daily loss,
cold-start trade counts).

## 2. Vercel env vars

These are the env vars that gate the shadow-mode + safety scaffolding
shipped on top of the reviewer.  Set them in **Vercel → Project →
Settings → Environment Variables**, then redeploy.

### Required to actually start shadow trading

| Env var | Set to | Why |
|---|---|---|
| `SHADOW_TRADING_MODE` | `true` | Master switch.  Order placement intercepted; would-have orders go to the audit log instead of the exchange. |
| `ENABLE_KELLY_SIZING` | `true` | Force the Kelly path so shadow PnL reflects production sizing. |
| `ALERTS_WEBHOOK_URL` | a Slack OR Discord webhook URL — see below | Get pinged on circuit breakers, kill switches, stop losses. |

### Should already be on by default — verify

| Env var | Default | Purpose |
|---|---|---|
| `ENABLE_AI_ARBITRAGE_REVIEW` | `true` | Cross-arb stays AI-gated even in shadow. |
| `ENABLE_COLD_START_SIZING` | `true` | New accounts ramp from 10% size → 100% over 30 days / 30 trades. |
| `ENABLE_CONCENTRATION_LIMITS` | `true` | Block correlated-event over-exposure. |
| `ENABLE_STOP_LOSS_SCANNER` | `true` | Cron closes positions hitting -30% PnL or 72h hold. |

### Optional tuning knobs

| Env var | Default | Purpose |
|---|---|---|
| `KELLY_FRACTION` | `0.25` | Quarter Kelly is the conservative starting point. |
| `KELLY_MAX_EQUITY_FRACTION` | `0.05` | Max single bet = 5% of equity. |
| `COLD_START_SIZE_FLOOR` | `0.10` | Minimum size for brand-new accounts. |
| `COLD_START_DAYS` | `30` | Days until cold-start ramp completes. |
| `COLD_START_TRADES` | `30` | Trades until cold-start ramp completes. |
| `CONCENTRATION_SIMILARITY_THRESHOLD` | `0.5` | Jaccard threshold for "same event" detection. |
| `CONCENTRATION_CATEGORY_CAP_FRACTION` | `0.2` | Max equity fraction per category. |
| `STOP_LOSS_LOSS_FRACTION` | `0.3` | Close at -30% of entry exposure. |
| `STOP_LOSS_MAX_HOLD_HOURS` | `72` | Or after 72 hours, whichever first. |
| `ENABLE_AI_DESK_MEMORY` | `true` | Reviewer reads/writes the learning tape. |
| `ENABLE_AI_TRIAGE` | `true` | Cheap Haiku pre-filter when batch > threshold. |
| `AI_TRIAGE_THRESHOLD` | `12` | Batch size at which Haiku triage kicks in. |
| `ENABLE_AI_CITATIONS` | `true` | `[cites: espn.com, ...]` tag on reasoning when web_search ran. |
| `ANTHROPIC_TRIAGE_MODEL` | `claude-haiku-4-5` | Model used for triage. |
| `ANTHROPIC_DEEP_MODEL` | (unset → falls back to `ANTHROPIC_MODEL`) | Model used for high-stakes trades. |
| `AI_ARBITRAGE_MIN_SIZE_FRACTION` | `0.10` | Soft veto floor for cross-arb sizeFraction. |

### Where to get the webhook URL

Pick one (or any other service that accepts a JSON POST).

**Slack:**
1. Slack workspace → desired channel → Settings → Integrations.
2. "Incoming Webhooks" → "Add to Slack".
3. Copy the URL it generates (starts with `https://hooks.slack.com/services/...`).
4. Paste into `ALERTS_WEBHOOK_URL` in Vercel.

**Discord:**
1. Server settings → Integrations → Webhooks → "New Webhook".
2. Copy URL (starts with `https://discord.com/api/webhooks/...`).
3. Paste into `ALERTS_WEBHOOK_URL` in Vercel.

Both services accept the `{ text, alert }` JSON the bot posts; you don't
need to configure anything else on the receiving side.

## 3. Verify after deploy

1. **DB**: query the audit log within an hour of a cron tick.  You
   should see `kalshi_reviewer_telemetry` events landing.
2. **Shadow**: trigger one autonomous run manually and grep the audit
   log for `kalshi_shadow_order_intent` / `polymarket_shadow_order_intent`.
   You should see those events but NOT `kalshi_order_placed` /
   `polymarket_autonomy_order_placed`.  If you see real-order events,
   shadow mode isn't actually on.
3. **Alerts**: in your Slack/Discord channel, look for messages on the
   first kill-switch / stop-loss / circuit-breaker event.
4. **Cron**: in Vercel → Cron Jobs, confirm three jobs are listed:
   `autonomous-trading` (15m), `order-sync` (5m), `stop-loss-scan` (10m).

## After you're done

You can delete this file once both items are applied:
```bash
rm DEPLOY_REMINDER.md && git add DEPLOY_REMINDER.md && \
  git commit -m "chore: remove DEPLOY_REMINDER after migration + env vars applied"
```
