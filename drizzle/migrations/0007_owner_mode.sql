-- 0007 — Owner Mode toggle.
--
-- One-flip switch that bypasses the policy gates an owner who accepts the
-- risk would otherwise have to fight: the 5-min recent-manual-order
-- cooldown, the per-category open-position concentration cap, and the
-- posture-driven confidence-floor boost.  Hard safety gates (credentials,
-- capital, price drift, exchange rejection) remain unchanged.
--
-- Default 0 = owner mode off (current behaviour).  When the toggle is
-- flipped on via the dashboard, the routers.ts mutation also slams the
-- other tunable prefs to their permissive values (autonomyMode=
-- fully_autonomous, cadence=continuous_watch, liveTradingEnabled=1,
-- requireApprovalAbove=250, minSignalConfidence=0.55, maxOrderNotional=
-- 250, maxDailyOrders=48) in the same transaction so the owner only
-- has to click once.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS.

ALTER TABLE "tradingPreferences"
  ADD COLUMN IF NOT EXISTS "ownerMode" integer NOT NULL DEFAULT 0;
