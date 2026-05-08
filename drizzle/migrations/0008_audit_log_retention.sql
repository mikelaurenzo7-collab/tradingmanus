-- 0008 — Audit log retention.
--
-- The auditLog table is append-only and the autonomy schedulers write to
-- it on every tick (kalshi_signal_pipeline, kalshi_reviewer_telemetry,
-- scheduled_autonomy_run_*, kalshi_adaptive_cadence_skipped, plus per-
-- order events).  At a 60s tick rate that's 4-6 rows per minute — about
-- 6 000 / day, 2.2 M / year.  Without retention the audit endpoints slow
-- down quadratically and the table eventually outgrows the connection
-- pool's working memory.
--
-- We add an index on createdAt for fast range deletes, then the
-- application's cleanupOldAuditLogEntries() runs at startup and once a
-- day to delete rows older than AUDIT_LOG_RETENTION_DAYS (default 90).
--
-- Idempotent: CREATE INDEX IF NOT EXISTS.

CREATE INDEX IF NOT EXISTS "auditLog_createdAt_idx"
  ON "auditLog" ("createdAt");
