-- 0002 — Backfill: align users table with current drizzle/schema.ts.
--
-- Production DB pre-dates several columns added to the users table over
-- time (betaAccessLevel, subscription fields, 2FA fields).  When the app
-- queries `select ... from users` it errors with "column does not exist"
-- if any are missing.  This migration brings prod into alignment with
-- the schema defined in drizzle/schema.ts.
--
-- Fully idempotent:
--   - CREATE TYPE wrapped in DO $$ ... EXCEPTION blocks so the migration
--     is safe if the enums already exist.
--   - ALTER TABLE ... ADD COLUMN IF NOT EXISTS so the migration is safe
--     if a column was already added by hand.
--
-- After this migration applies, login + session creation should work
-- without "column does not exist" errors.

-- ── Enums (create if not exists) ────────────────────────────────────────────

DO $$ BEGIN
  CREATE TYPE "beta_access_level" AS ENUM ('none', 'internal', 'invited', 'public');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "subscription_tier" AS ENUM ('starter', 'pro', 'fund');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "subscription_status" AS ENUM ('trialing', 'active', 'past_due', 'cancelled', 'unpaid');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ── users table column backfill ─────────────────────────────────────────────

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "betaAccessLevel"  "beta_access_level"   NOT NULL DEFAULT 'none';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordHash"     text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscriptionTier" "subscription_tier"   NOT NULL DEFAULT 'starter';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscriptionStatus" "subscription_status" NOT NULL DEFAULT 'trialing';
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "subscriptionCurrentPeriodEnd" timestamptz;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "stripeCustomerId" varchar(128);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "twoFactorSecret"  text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "twoFactorEnabled" integer NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "backupCodesHash"  text;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastSignedIn"     timestamptz;

-- Verify (these should each return one row).
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'users'
   AND column_name IN (
     'betaAccessLevel', 'passwordHash', 'subscriptionTier',
     'subscriptionStatus', 'subscriptionCurrentPeriodEnd',
     'stripeCustomerId', 'twoFactorSecret', 'twoFactorEnabled',
     'backupCodesHash', 'lastSignedIn'
   )
 ORDER BY column_name;
