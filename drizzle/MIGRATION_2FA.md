# Database Migration: Add 2FA Support

This file documents the database schema changes needed to support 2FA/MFA authentication.

## Changes to users table

```sql
-- Add 2FA columns to users table
ALTER TABLE users 
ADD COLUMN "twoFactorSecret" TEXT,
ADD COLUMN "twoFactorEnabled" INTEGER DEFAULT 0 NOT NULL,
ADD COLUMN "backupCodesHash" TEXT,
ADD COLUMN "lastSignedIn" TIMESTAMP WITH TIME ZONE;
```

## How to apply

Run the following command to generate and push the schema changes:

```bash
corepack pnpm db:generate
corepack pnpm db:push
```

Or manually apply the SQL above to your database.

## Notes

- `twoFactorSecret` stores the encrypted base32 2FA secret
- `twoFactorEnabled` is 0 (disabled) or 1 (enabled)
- `backupCodesHash` stores a JSON array of hashed backup codes
- `lastSignedIn` tracks the last successful sign-in timestamp
