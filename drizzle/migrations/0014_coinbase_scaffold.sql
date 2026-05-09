-- 0014 — Coinbase scaffolding (architectural ONLY — no trading logic).
--
-- Mirrors the Polymarket schema shape so a future Coinbase impl can drop
-- in without re-doing the bones.  Live trading remains gated behind
-- `ENABLE_COINBASE_LIVE=false` in env.ts; placement attempts throw until
-- the operator explicitly opts in.
--
-- All operations idempotent.

DO $$ BEGIN
  CREATE TYPE "coinbase_account_status" AS ENUM ('connected', 'disconnected', 'error');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "coinbase_order_side" AS ENUM ('buy', 'sell');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "coinbase_order_status" AS ENUM (
    'pending', 'filled', 'partially_filled', 'cancelled', 'rejected'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "coinbase_position_status" AS ENUM ('open', 'closing', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "coinbaseCredentials" (
  "id"                       serial PRIMARY KEY,
  "userId"                   integer NOT NULL UNIQUE,
  "apiKeyEncrypted"          text NOT NULL,
  "apiSecretEncrypted"       text NOT NULL,
  "apiPassphraseEncrypted"   text,
  "sandboxMode"              boolean NOT NULL DEFAULT true,
  "accountStatus"            "coinbase_account_status" NOT NULL DEFAULT 'disconnected',
  "lastSyncedAt"             timestamptz,
  "createdAt"                timestamptz NOT NULL DEFAULT now(),
  "updatedAt"                timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "coinbaseOrders" (
  "id"             serial PRIMARY KEY,
  "userId"         integer NOT NULL,
  "clientOrderId"  varchar(128) NOT NULL,
  "orderId"        varchar(128),
  "productId"      varchar(64) NOT NULL,
  "side"           "coinbase_order_side" NOT NULL,
  "size"           double precision NOT NULL,
  "limitPrice"     double precision,
  "averagePrice"   double precision,
  "filledSize"     double precision NOT NULL DEFAULT 0,
  "status"         "coinbase_order_status" NOT NULL DEFAULT 'pending',
  "filledAt"       timestamptz,
  "createdAt"      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "coinbaseOrders_userId_status_idx"
  ON "coinbaseOrders" ("userId", "status");

CREATE TABLE IF NOT EXISTS "coinbasePositions" (
  "id"             serial PRIMARY KEY,
  "userId"         integer NOT NULL,
  "productId"      varchar(64) NOT NULL,
  "side"           "coinbase_order_side" NOT NULL,
  "sizeUsdc"       double precision NOT NULL,
  "entryPrice"     double precision NOT NULL,
  "currentPrice"   double precision NOT NULL,
  "unrealizedPnl"  double precision NOT NULL DEFAULT 0,
  "realizedPnl"    double precision NOT NULL DEFAULT 0,
  "positionStatus" "coinbase_position_status" NOT NULL DEFAULT 'open',
  "openedAt"       timestamptz NOT NULL DEFAULT now(),
  "closedAt"       timestamptz
);

CREATE INDEX IF NOT EXISTS "coinbasePositions_userId_status_idx"
  ON "coinbasePositions" ("userId", "positionStatus");

CREATE TABLE IF NOT EXISTS "coinbaseCapital" (
  "userId"           integer PRIMARY KEY,
  "currentBalance"   double precision NOT NULL DEFAULT 0,
  "startingBalance"  double precision NOT NULL DEFAULT 0,
  "drawdownHwm"      double precision NOT NULL DEFAULT 0,
  "updatedAt"        timestamptz NOT NULL DEFAULT now()
);
