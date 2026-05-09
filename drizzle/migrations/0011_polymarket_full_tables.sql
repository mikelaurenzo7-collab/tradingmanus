-- 0011 — Restore full Polymarket schema after the Kalshi-only pivot.
--
-- Migration 0006 already created polymarketPositions + the side / status
-- enums.  This migration adds everything else the restored Polymarket
-- modules need:
--   • polymarket_order_status / polymarket_account_status / platform_subscription enums
--   • polymarketOrders, polymarketFills, polymarketCredentials, userPlatformSubscriptions tables
--   • Widen desk_platform enum to ('kalshi','polymarket') so deskMemory rows
--     can be written from the polymarket pipeline.
--
-- All operations are idempotent (CREATE TYPE / TABLE / COLUMN IF NOT EXISTS,
-- DO blocks for enums) so this can be re-applied safely.

-- (1) Enums

DO $$ BEGIN
  CREATE TYPE "polymarket_order_status" AS ENUM ('pending', 'filled', 'cancelled', 'rejected');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "polymarket_account_status" AS ENUM ('connected', 'disconnected', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "platform_subscription" AS ENUM ('kalshi', 'polymarket', 'both');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- desk_platform existed as ['kalshi'] only after the Kalshi-only pivot.
-- Widen to include 'polymarket' so polymarketLearning can write to the
-- shared deskMemory tape.  ADD VALUE IF NOT EXISTS is idempotent at the
-- enum level.
DO $$ BEGIN
  ALTER TYPE "desk_platform" ADD VALUE IF NOT EXISTS 'polymarket';
EXCEPTION WHEN undefined_object THEN
  -- Brand-new database where desk_platform doesn't exist yet — create it
  -- with both values.
  CREATE TYPE "desk_platform" AS ENUM ('kalshi', 'polymarket');
END $$;

-- (2) Tables

CREATE TABLE IF NOT EXISTS "polymarketOrders" (
  "id"               serial PRIMARY KEY,
  "userId"           integer NOT NULL,
  "orderId"          varchar(128) NOT NULL UNIQUE,
  "marketId"         varchar(256) NOT NULL,
  "tokenId"          varchar(256) NOT NULL,
  "side"             "polymarket_side" NOT NULL,
  "sizeUsdc"         double precision NOT NULL,
  "limitPrice"       double precision NOT NULL,
  "status"           "polymarket_order_status" NOT NULL DEFAULT 'pending',
  "filledSizeUsdc"   double precision NOT NULL DEFAULT 0,
  "averagePrice"     double precision NOT NULL DEFAULT 0,
  "createdAt"        timestamptz NOT NULL DEFAULT now(),
  "filledAt"         timestamptz,
  "cancelledAt"      timestamptz
);
CREATE INDEX IF NOT EXISTS "polymarketOrders_userId_idx"
  ON "polymarketOrders" ("userId");
CREATE INDEX IF NOT EXISTS "polymarketOrders_userId_status_idx"
  ON "polymarketOrders" ("userId", "status");

CREATE TABLE IF NOT EXISTS "polymarketFills" (
  "id"             serial PRIMARY KEY,
  "userId"         integer NOT NULL,
  "orderId"        varchar(128) NOT NULL,
  "marketId"       varchar(256) NOT NULL,
  "tokenId"        varchar(256) NOT NULL,
  "fillPrice"      double precision NOT NULL,
  "fillSizeUsdc"   double precision NOT NULL,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "polymarketFills_userId_idx"
  ON "polymarketFills" ("userId");
CREATE INDEX IF NOT EXISTS "polymarketFills_orderId_idx"
  ON "polymarketFills" ("orderId");

CREATE TABLE IF NOT EXISTS "polymarketCredentials" (
  "id"                       serial PRIMARY KEY,
  "userId"                   integer NOT NULL UNIQUE,
  "apiKeyEncrypted"          text NOT NULL,
  "apiSecretEncrypted"       text NOT NULL,
  "apiPassphraseEncrypted"   text NOT NULL,
  "accountStatus"            "polymarket_account_status" NOT NULL DEFAULT 'disconnected',
  "lastSyncedAt"             timestamptz,
  "createdAt"                timestamptz NOT NULL DEFAULT now(),
  "updatedAt"                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "userPlatformSubscriptions" (
  "id"                     serial PRIMARY KEY,
  "userId"                 integer NOT NULL UNIQUE,
  "subscribedPlatforms"    "platform_subscription" NOT NULL DEFAULT 'kalshi',
  "createdAt"              timestamptz NOT NULL DEFAULT now(),
  "updatedAt"              timestamptz NOT NULL DEFAULT now()
);
