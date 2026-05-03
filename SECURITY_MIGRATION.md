# Security Migration Guide

This guide helps you migrate your existing Laurenzo Dashboard deployment to use the new security features.

## Quick Start

### 1. Update Dependencies

```bash
cd /path/to/tradingmanus
corepack pnpm install
```

### 2. Update Environment Variables

Add or update these in your `.env` file:

```bash
# Update to 32+ characters in production
CRON_SECRET=<generate-a-new-32-char-secret>

# Optional: Set log level
LOG_LEVEL=info
```

### 3. Apply Database Schema Changes

```bash
corepack pnpm db:generate
corepack pnpm db:push
```

Or manually run the SQL:

```sql
ALTER TABLE users 
ADD COLUMN "twoFactorSecret" TEXT,
ADD COLUMN "twoFactorEnabled" INTEGER DEFAULT 0 NOT NULL,
ADD COLUMN "backupCodesHash" TEXT,
ADD COLUMN "lastSignedIn" TIMESTAMP WITH TIME ZONE;
```

### 4. Verify Build

```bash
corepack pnpm check
corepack pnpm test
corepack pnpm build
```

### 5. Deploy

Deploy as usual to Vercel or your hosting platform.

---

## Breaking Changes

### 1. JWT Token Expiry

**Before**: JWT tokens expired after 1 year
**After**: JWT access tokens expire after 24 hours, refresh tokens after 7 days

**Impact**: 
- Users will need to re-authenticate more frequently
- Long-running sessions will be interrupted
- Refresh token flow is now available

**Migration**: 
- No action needed for new logins
- Existing sessions will expire naturally
- Users will be prompted to log in again after 24 hours

### 2. CRON_SECRET Length Requirement

**Before**: CRON_SECRET could be any length (16+ chars recommended)
**After**: CRON_SECRET must be 32+ characters in production

**Impact**: 
- Application will fail to start if CRON_SECRET is too short in production

**Migration**:
```bash
# Generate a new 32+ character secret
CRON_SECRET=$(openssl rand -base64 32)
echo "New CRON_SECRET: $CRON_SECRET"

# Update in Vercel environment variables or .env file
```

### 3. Credential Encryption Algorithm

**Before**: Used scrypt for key derivation
**After**: Uses PBKDF2 with 100,000 iterations

**Impact**: 
- Legacy credentials encrypted with scrypt are still supported (backward compatible)
- New credentials use PBKDF2
- Re-encrypting existing credentials is recommended but not required

**Migration**: 
- No immediate action needed (backward compatible)
- Users can disconnect and reconnect their Kalshi accounts to re-encrypt with PBKDF2

---

## New Features

### 1. Two-Factor Authentication (2FA)

**Setup Instructions**:

1. Log in to the dashboard
2. Navigate to Settings → Security
3. Click "Enable 2FA"
4. Scan QR code with authenticator app
5. Enter 6-digit code to verify
6. Save backup codes in a secure location

**Recommendation**: Enable 2FA for the owner account immediately after migration.

### 2. Rate Limiting

Rate limiting is automatically enabled for all endpoints:
- General API: 100 req/15min
- Authentication: 5 req/15min
- Scheduled jobs: 20 req/min
- Trading: 30 req/min

**Configuration**: Adjust limits in `server/_core/rateLimiter.ts` if needed.

### 3. CSRF Protection

CSRF protection is automatically enabled for all state-changing operations.

**Client Integration**:
- GET requests receive CSRF token in cookie
- Mutation requests must include `X-CSRF-Token` header
- tRPC client handles this automatically

### 4. Structured Logging

Logs are now structured JSON with automatic redaction of sensitive data.

**Configuration**:
```bash
LOG_LEVEL=info  # Options: debug, info, warn, error
```

### 5. Request Correlation IDs

Every request now has a unique correlation ID for tracing.

**Usage**: Look for `correlationId` in logs to trace requests.

### 6. Distributed Locking

Autonomous trading and order sync now use distributed locks to prevent concurrent execution.

**Benefits**:
- Prevents race conditions
- Safe to run multiple instances
- Auto-releases after timeout

---

## Rollback Plan

If you need to rollback to the previous version:

### 1. Restore Previous Code

```bash
git checkout <previous-commit-hash>
corepack pnpm install
```

### 2. Database Rollback (Optional)

If you applied the 2FA schema changes:

```sql
ALTER TABLE users 
DROP COLUMN "twoFactorSecret",
DROP COLUMN "twoFactorEnabled",
DROP COLUMN "backupCodesHash",
DROP COLUMN "lastSignedIn";
```

### 3. Environment Variables

Restore previous environment variables:
- CRON_SECRET can be shorter than 32 chars
- Remove LOG_LEVEL if set

### 4. Redeploy

Deploy the previous version.

---

## Testing Checklist

After migration, test the following:

- [ ] Login with email/password works
- [ ] JWT tokens expire after 24 hours
- [ ] Refresh token flow works
- [ ] Rate limiting blocks excessive requests
- [ ] 2FA setup and login works
- [ ] Backup codes work for 2FA
- [ ] CSRF protection blocks invalid mutations
- [ ] Logs are structured and sensitive data is redacted
- [ ] Correlation IDs appear in logs
- [ ] Autonomous trading runs without race conditions
- [ ] Scheduled jobs authenticate with CRON_SECRET
- [ ] Security headers are present in responses

---

## Support

If you encounter issues during migration:

1. Check logs for error messages
2. Review [SECURITY.md](./SECURITY.md) for detailed documentation
3. Check [Troubleshooting](#troubleshooting) section below
4. Open an issue on GitHub

---

## Troubleshooting

### Error: "CRON_SECRET must be at least 32 characters"

**Solution**:
```bash
# Generate new secret
export CRON_SECRET=$(openssl rand -base64 32)

# Update in Vercel
vercel env add CRON_SECRET production
```

### Error: "Failed to verify 2FA token"

**Solution**:
- Ensure device time is synchronized
- Try using a backup code
- Reset 2FA in database if needed

### Error: "Rate limit exceeded"

**Solution**:
- Wait for rate limit window to reset
- Adjust rate limits in `server/_core/rateLimiter.ts`
- Check for infinite loops or excessive requests

### Error: "CSRF token missing"

**Solution**:
- Ensure client includes `X-CSRF-Token` header
- Check CORS configuration allows credentials
- Verify cookie is being set and sent

### Error: "Database connection failed"

**Solution**:
- Verify DATABASE_URL is correct
- Check Neon Postgres is accessible
- Ensure schema is up to date

---

## Security Best Practices

After migration, follow these best practices:

1. **Enable 2FA** for owner account immediately
2. **Rotate secrets** every 90 days
3. **Monitor logs** for suspicious activity
4. **Review rate limit** violations weekly
5. **Keep dependencies** updated with `pnpm audit --fix`
6. **Use strong passwords** (12+ chars with mixed case, numbers, symbols)
7. **Review audit logs** monthly for security events
8. **Test disaster recovery** including 2FA backup codes

---

## Timeline Recommendations

### Immediate (Day 1)
- [ ] Deploy new version
- [ ] Apply database migrations
- [ ] Update CRON_SECRET to 32+ chars
- [ ] Enable 2FA for owner account
- [ ] Test login and 2FA flow

### Week 1
- [ ] Monitor logs for errors
- [ ] Check rate limiting is working
- [ ] Verify scheduled jobs still work
- [ ] Test autonomous trading
- [ ] Review audit logs

### Month 1
- [ ] Review security logs
- [ ] Check for rate limit violations
- [ ] Audit dependency vulnerabilities
- [ ] Test disaster recovery with backup codes
- [ ] Document any custom security configurations

---

## Questions?

For questions or issues:
- Review [SECURITY.md](./SECURITY.md) for detailed documentation
- Check application logs for error details
- Open an issue on GitHub with reproduction steps
