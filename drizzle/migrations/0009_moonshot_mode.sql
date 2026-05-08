-- 0009 — Moonshot Mode toggle.
--
-- An advanced risk preference (Owner Mode required) that lets the bot
-- hunt low-probability asymmetric plays — markets at 2-20¢ where the
-- AI reviewer thinks the true probability is materially higher than
-- the market.  Each moonshot is capped at MOONSHOT_MAX_NOTIONAL ($5
-- default) and total open moonshot exposure is capped at
-- MOONSHOT_MAX_TOTAL_USD ($25 default), so a string of bad moonshots
-- can lose at most that bucket — independent of the main bankroll.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE "tradingPreferences"
  ADD COLUMN IF NOT EXISTS "moonshotMode" integer NOT NULL DEFAULT 0;
