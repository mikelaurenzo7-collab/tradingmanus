-- Phase 2 — fee + spread aware EV gate.
--
-- Persists the round-trip cost breakdown the gate uses for each signal,
-- so the operator can audit "why was this rejected" cleanly. Existing
-- rows: NULL (no backfill — historical signals didn't compute this).
--
-- Polymarket has no `polymarketSignals` table yet (signals live only in
-- memory and on the audit-log payload), so only kalshiSignals gets the
-- new column. When a polymarketSignals table lands, this migration's
-- pattern can be replicated then.

ALTER TABLE "kalshiSignals"
  ADD COLUMN IF NOT EXISTS "feeBreakdownJson" jsonb;
