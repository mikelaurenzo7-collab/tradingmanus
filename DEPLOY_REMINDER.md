# 🛎️ Reminder — Database changes to apply (set 2026-05-02)

> Read me first when you open the repo on **2026-05-03** or whenever next you deploy.

The Claude-primary reviewer + per-desk memory landing on `main` introduced **one new Postgres table**: `deskMemory`. The reviewer fails gracefully (skips memory injection) when the table is missing, but you'll want to provision it before the bots start trading so the desks can actually accumulate a learning tape.

## What you need to do

1. Make sure your local `.env` has the production `DATABASE_URL` exported (or temporarily set it inline):
   ```bash
   export DATABASE_URL="postgresql://USER:PASSWORD@HOST/DB?sslmode=require"
   ```
2. Push the schema:
   ```bash
   corepack pnpm db:push
   ```
3. Confirm the new table exists:
   ```sql
   \d "deskMemory"
   ```
   You should see columns: `id, userId, platform, deskId, notes, tradeCount, winCount, lossCount, createdAt, updatedAt`.

## What changed in the schema

`drizzle/schema.ts` adds:
- enum `desk_platform` = `("kalshi", "polymarket")`
- enum `desk_outcome` = `("win", "loss", "scratch")`
- table `deskMemory` keyed effectively by `(userId, platform, deskId)`

No existing tables were touched. The change is strictly additive.

## What new env vars to consider

All default to safe values; you only need to override if you want to change behavior:

| Env var | Default | Purpose |
|---|---|---|
| `ENABLE_AI_DESK_MEMORY` | `true` | Inject the desk's learning tape into the cached system prompt |
| `ENABLE_AI_TRIAGE` | `true` | Cheap Haiku pre-filter when batch > threshold |
| `AI_TRIAGE_THRESHOLD` | `12` | Batch size at which Haiku triage kicks in |
| `ENABLE_AI_CITATIONS` | `true` | Append `[cites: espn.com, ...]` to reasoning when web_search ran |
| `ANTHROPIC_TRIAGE_MODEL` | `claude-haiku-4-5` | Model used for triage |
| `ANTHROPIC_DEEP_MODEL` | (unset → falls back to `ANTHROPIC_MODEL`) | Model used for high-stakes trades when extended thinking is on |

## After you're done

You can delete this file:
```bash
rm DEPLOY_REMINDER.md && git add DEPLOY_REMINDER.md && git commit -m "chore: remove DEPLOY_REMINDER after schema push"
```
