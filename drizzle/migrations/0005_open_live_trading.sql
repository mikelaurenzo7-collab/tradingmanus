-- 0005 — Open live trading to all authenticated users.
--
-- Removes the closed-beta lock (was enforced in routers.ts on
-- kalshi.setTradingActivation; that throw is also deleted in the same
-- commit).  Adds a per-user paperTradeMode toggle to tradingPreferences
-- so any user can choose paper mode without depending on the env-level
-- PAPER_TRADE_MODE override (which only the operator can set).
--
-- The new resolver order in effectivePaperMode.ts becomes:
--   1. env PAPER_TRADE_MODE=true               → all paper (operator kill switch)
--   2. tradingPreferences.paperTradeMode=true  → this user paper (per-user opt-in)
--   3. otherwise                               → live
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE "tradingPreferences"
  ADD COLUMN IF NOT EXISTS "paperTradeMode" integer NOT NULL DEFAULT 0;
