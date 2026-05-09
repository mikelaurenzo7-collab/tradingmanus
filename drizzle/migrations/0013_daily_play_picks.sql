-- 0013 — Daily-play pick lifecycle table.
--
-- Tracks every pick fired by the daily sports / moonshot plays across
-- BOTH Kalshi and Polymarket from execution through resolution.  Persists
-- the operator-visible win/loss tape independently of the audit log so a
-- single SQL query can answer "did the bot pay for itself today?" without
-- correlating audit-log payloads to position closes.
--
-- All operations idempotent (CREATE TYPE / TABLE / INDEX IF NOT EXISTS, DO
-- blocks for enums) so safe to re-apply.

DO $$ BEGIN
  CREATE TYPE "daily_play_platform" AS ENUM ('kalshi', 'polymarket');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "daily_play_type" AS ENUM ('sports', 'moonshot');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "daily_play_status" AS ENUM (
    'pending', 'won', 'lost', 'partial', 'closed_breakeven', 'voided'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "dailyPlayPicks" (
  "id"                serial PRIMARY KEY,
  "userId"            integer NOT NULL,
  "platform"          "daily_play_platform" NOT NULL,
  "playType"          "daily_play_type" NOT NULL,
  "playDate"          date NOT NULL,
  "marketId"          varchar(256) NOT NULL,
  "tokenId"           varchar(256),
  "signalId"          integer,
  "side"              varchar(8) NOT NULL,
  "stakeUsd"          double precision NOT NULL,
  "entryPrice"        double precision NOT NULL,
  "quantity"          double precision,
  "confidence"        double precision,
  "expectedValue"     double precision,
  "reasoning"         text,
  "status"            "daily_play_status" NOT NULL DEFAULT 'pending',
  "exitPrice"         double precision,
  "realizedPnl"       double precision,
  "closedAt"          timestamptz,
  "linkedPositionId"  integer,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now()
);

-- Hard idempotency at the DB level: one pick per (user, platform, type, day).
CREATE UNIQUE INDEX IF NOT EXISTS "dailyPlayPicks_user_platform_type_date_uq"
  ON "dailyPlayPicks" ("userId", "platform", "playType", "playDate");

CREATE INDEX IF NOT EXISTS "dailyPlayPicks_userId_status_idx"
  ON "dailyPlayPicks" ("userId", "status");
CREATE INDEX IF NOT EXISTS "dailyPlayPicks_userId_playDate_idx"
  ON "dailyPlayPicks" ("userId", "playDate");
CREATE INDEX IF NOT EXISTS "dailyPlayPicks_linkedPositionId_idx"
  ON "dailyPlayPicks" ("platform", "linkedPositionId");
