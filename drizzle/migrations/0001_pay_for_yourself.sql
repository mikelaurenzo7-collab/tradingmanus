-- 0001 — Pay-for-yourself foundation: persist exit-strategy state across ticks.
--
-- Adds a nullable jsonb `exitState` column to both kalshiPositions and
-- polymarketPositions.  The exit monitor uses this to ratchet trailing
-- stops (high-water mark, trailing stop level, hit profit targets) across
-- order-sync ticks instead of re-initialising every cycle.  Pre-migration
-- rows are treated as fresh state by exitMonitor.ts.
--
-- IDEMPOTENT: ADD COLUMN IF NOT EXISTS makes this safe to apply against a
-- DB that already has the column (e.g. operators who hand-applied this
-- migration via Neon's SQL editor before the migration runner shipped).

ALTER TABLE "kalshiPositions"     ADD COLUMN IF NOT EXISTS "exitState" jsonb;
ALTER TABLE "polymarketPositions" ADD COLUMN IF NOT EXISTS "exitState" jsonb;
