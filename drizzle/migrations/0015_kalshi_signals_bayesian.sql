-- Add bayesianProbability column to kalshiSignals (defined in schema but missing from DB).
ALTER TABLE "kalshiSignals"
  ADD COLUMN IF NOT EXISTS "bayesianProbability" double precision;
