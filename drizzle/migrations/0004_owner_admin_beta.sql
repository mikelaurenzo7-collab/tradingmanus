-- 0004 — Promote the configured owner row to admin + internal beta access.
--
-- Why: 0003 added the betaAccessLevel column with default 'none'.  The
-- owner's existing row was created with that default, and the beta gate
-- in routers.ts blocks arming live trading for anyone with 'none'.
-- ensureOwnerUser() now sets these on every login, but operators don't
-- always log out + back in after a deploy, so this migration applies
-- the same correction directly at the row level on the next deploy.
--
-- Idempotent: the WHERE clause keys on the owner's stable openId; the
-- values are the desired final state; safe to re-run.

UPDATE "users"
   SET "role" = 'admin',
       "betaAccessLevel" = 'internal'
 WHERE "openId" = 'owner:primary';
