-- 0003 — Retry of users-table alignment, this time with a multi-statement-
-- capable migration runner.
--
-- Why a retry: 0002 was logged as applied by the previous runner (neon-http),
-- but only its first SQL statement (the DO block creating the
-- beta_access_level enum) actually executed.  The neon-http transport
-- silently truncates multi-statement queries to the first statement, so
-- every subsequent ALTER TABLE was discarded and the schema was never
-- updated.  The runner now uses node-postgres (pg) which natively
-- supports multi-statement batches via the simple-query protocol.
--
-- This file re-runs the same DDL as 0002 (idempotent throughout) so the
-- columns get added on this deploy regardless of what 0002 did or didn't do.

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
