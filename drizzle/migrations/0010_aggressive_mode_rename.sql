-- 0010 — Rename ownerMode → aggressiveMode and default new rows to ON.
--
-- "Owner Mode" never made sense in single-tenant: there's only one user,
-- and they're always the owner.  The toggle's actual job is "training
-- wheels off" — bypass the recent-manual-order cooldown, the per-category
-- concentration cap, and the posture confidence-floor boost; tighten the
-- adaptive cadence; arm the Owner-Mode-gated Moonshot Mode.  Renaming to
-- "aggressiveMode" makes that intent explicit and survives any future
-- multi-tenant migration unchanged.
--
-- Idempotent: the rename is wrapped in a DO block that only fires when
-- the old column exists and the new one doesn't, then ADD COLUMN IF NOT
-- EXISTS handles the case where the rename was a no-op (column already
-- renamed by a prior run).  ALTER COLUMN SET DEFAULT lifts the default
-- from 0 → 1 so new tradingPreferences rows arrive with aggressive mode
-- on by default.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
    AND table_name = 'tradingPreferences'
    AND column_name = 'ownerMode'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = current_schema()
    AND table_name = 'tradingPreferences'
    AND column_name = 'aggressiveMode'
  ) THEN
    ALTER TABLE "tradingPreferences" RENAME COLUMN "ownerMode" TO "aggressiveMode";
  END IF;
END $$;

ALTER TABLE "tradingPreferences"
  ADD COLUMN IF NOT EXISTS "aggressiveMode" integer NOT NULL DEFAULT 1;

ALTER TABLE "tradingPreferences"
  ALTER COLUMN "aggressiveMode" SET DEFAULT 1;
