-- 0006 — Add stateful exit-strategy bookkeeping + create polymarketPositions.
--
-- Two missing pieces of the exit-monitor data model that drifted out of
-- production because their schema changes never had migration files
-- generated:
--   1. kalshiPositions.exitState (jsonb) — trailing stop state, persisted
--      across ticks so trailing stops ratchet correctly.
--   2. polymarketPositions table — entire table never created in production;
--      every 30 s order-sync tick was throwing
--      "relation polymarketPositions does not exist".
--
-- Idempotent: CREATE TYPE / TABLE / COLUMN with IF NOT EXISTS / DO blocks.

-- (1) kalshiPositions.exitState
ALTER TABLE "kalshiPositions"
  ADD COLUMN IF NOT EXISTS "exitState" jsonb;

-- (2a) polymarket_side enum (only if not already created)
DO $$ BEGIN
  CREATE TYPE "polymarket_side" AS ENUM ('yes', 'no');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- (2b) polymarket_position_status enum
DO $$ BEGIN
  CREATE TYPE "polymarket_position_status" AS ENUM ('open', 'closing', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- (2c) polymarketPositions table
CREATE TABLE IF NOT EXISTS "polymarketPositions" (
  "id"             serial PRIMARY KEY,
  "userId"         integer NOT NULL,
  "marketId"       varchar(256) NOT NULL,
  "tokenId"        varchar(256) NOT NULL,
  "side"           "polymarket_side" NOT NULL,
  "sizeUsdc"       double precision NOT NULL,
  "entryPrice"     double precision NOT NULL,
  "currentPrice"   double precision NOT NULL,
  "unrealizedPnl"  double precision NOT NULL DEFAULT 0,
  "realizedPnl"    double precision NOT NULL DEFAULT 0,
  "positionStatus" "polymarket_position_status" NOT NULL DEFAULT 'open',
  "exitState"      jsonb,
  "createdAt"      timestamptz NOT NULL DEFAULT now(),
  "closedAt"       timestamptz
);

-- Defensive: if the table already existed but without exitState (e.g. someone
-- pushed the schema partially via db:push at some point), add it.
ALTER TABLE "polymarketPositions"
  ADD COLUMN IF NOT EXISTS "exitState" jsonb;

CREATE INDEX IF NOT EXISTS "polymarketPositions_userId_idx"
  ON "polymarketPositions" ("userId");

CREATE INDEX IF NOT EXISTS "polymarketPositions_userId_status_idx"
  ON "polymarketPositions" ("userId", "positionStatus");
