# Security Features Documentation

This document provides comprehensive documentation for all security improvements implemented in the TradingManus application.

## Table of Contents

1. [Overview](#overview)
2. [Dependency Security](#dependency-security)
3. [Rate Limiting](#rate-limiting)
4. [Strong Secret Requirements](#strong-secret-requirements)
5. [Credential Encryption with PBKDF2](#credential-encryption-with-pbkdf2)
6. [JWT Token Management](#jwt-token-management)
7. [CSRF Protection](#csrf-protection)
8. [Two-Factor Authentication (2FA/MFA)](#two-factor-authentication-2famfa)
9. [Structured Logging](#structured-logging)
10. [Request Correlation IDs](#request-correlation-ids)
11. [Distributed Locking](#distributed-locking)
12. [Additional Security Headers](#additional-security-headers)

---

## Overview

The TradingManus application now includes comprehensive security improvements to protect against common vulnerabilities and attacks. These improvements cover authentication, authorization, data encryption, rate limiting, logging, and distributed system coordination.

## Dependency Security

### Implementation
- **Package Audit**: All dependencies are regularly audited using `pnpm audit`
- **Automated Fixes**: Vulnerabilities are automatically patched when possible
- **Version Management**: Dependencies are kept up-to-date with security patches

### Usage
```bash
# Check for vulnerabilities
corepack pnpm audit

# Automatically fix vulnerabilities
corepack pnpm audit --fix
```

### Protected Against
- Known vulnerabilities in lodash, tar, vite, and other dependencies
- Supply chain attacks through dependency compromise

---

## Rate Limiting

### Implementation
Rate limiting is implemented using `express-rate-limit` with different limits for different endpoint types.

### Rate Limit Tiers

#### 1. API Endpoints (General)
- **Limit**: 100 requests per 15 minutes per IP
- **Applies to**: `/api/trpc/*`
- **Location**: `server/_core/rateLimiter.ts` - `apiLimiter`

#### 2. Authentication Endpoints
- **Limit**: 5 requests per 15 minutes per IP
- **Applies to**: Login and authentication operations
- **Special**: Skips counting successful requests
- **Location**: `server/_core/rateLimiter.ts` - `authLimiter`

#### 3. Scheduled/Cron Endpoints
- **Limit**: 20 requests per minute
- **Applies to**: `/api/scheduled/*`
- **Location**: `server/_core/rateLimiter.ts` - `scheduledLimiter`

#### 4. Trading Endpoints
- **Limit**: 30 requests per minute per user
- **Applies to**: Order placement and trading operations
- **Location**: `server/_core/rateLimiter.ts` - `tradingLimiter`

### Protected Against
- Brute force attacks on authentication
- DDoS attacks
- API abuse
- Resource exhaustion

---

## Strong Secret Requirements

### Production Requirements

| Secret | Minimum Length | Algorithm |
|--------|----------------|-----------|
| `JWT_SECRET` | 32 characters | HS256 JWT signing |
| `CREDENTIAL_ENCRYPTION_SECRET` | 32 characters | PBKDF2 key derivation |
| `OWNER_PASSWORD` | 12 characters | Owner authentication |
| `CRON_SECRET` | 32 characters | Cron job authentication |

### Implementation
Validation is enforced in `server/_core/env.ts` during application startup. The application will fail to start in production if secrets don't meet requirements.

### Protected Against
- Weak password attacks
- Secret enumeration
- Brute force attacks on secrets

---

## Credential Encryption with PBKDF2

### Implementation
Kalshi API credentials are encrypted at rest using PBKDF2 key derivation.

**Algorithm Details:**
- **Function**: PBKDF2 (Password-Based Key Derivation Function 2)
- **Iterations**: 100,000 (NIST recommended)
- **Hash Algorithm**: SHA-256
- **Salt**: Per-user + credential-specific salt (16 bytes)
- **Key Length**: 32 bytes (256 bits)
- **Cipher**: AES-256-GCM (for encryption)
- **Authentication**: AAD (Additional Authenticated Data) with user ID

### Code Location
- `server/_core/kalshiAuth.ts` - `getCredentialEncryptionKey()`, `encryptCredential()`, `decryptCredential()`

### Upgrade from Scrypt
Previously used `scryptSync`, now uses `pbkdf2Sync` for better compatibility and industry-standard compliance.

### Protected Against
- Credential theft from database breach
- Offline brute force attacks on encrypted credentials
- Rainbow table attacks (via unique salts)

---

## JWT Token Management

### Access Tokens
- **Expiry**: 24 hours (previously 1 year)
- **Type**: HS256 signed JWT
- **Cookie**: `app_session_id` (httpOnly, secure in production, sameSite: lax)
- **Payload**: `{ openId, email, name, type: "access" }`

### Refresh Tokens
- **Expiry**: 7 days
- **Type**: HS256 signed JWT
- **Cookie**: `app_refresh_token` (httpOnly, secure in production, sameSite: lax)
- **Payload**: `{ openId, email, name, type: "refresh" }`

### Token Refresh Flow
1. Client detects expired access token
2. Client calls `/api/trpc/auth.refreshToken`
3. Server validates refresh token
4. Server issues new access token
5. Client continues with new access token

### Code Location
- `server/_core/auth.ts` - Token creation and verification
- `server/routers.ts` - Refresh token endpoint
- `shared/const.ts` - Token expiry constants

### Protected Against
- Long-lived session hijacking
- Token replay attacks
- Reduced attack window (24 hours vs 1 year)

---

## CSRF Protection

### Implementation
Double-submit cookie pattern for CSRF protection.

### How It Works
1. Server generates CSRF token on GET requests
2. Token stored in cookie (readable by JavaScript)
3. Client includes token in `X-CSRF-Token` header for mutations
4. Server validates token matches cookie using timing-safe comparison

### Code Location
- `server/_core/csrf.ts` - CSRF middleware
- Cookie: `csrf_token` (NOT httpOnly, secure in production, sameSite: strict)

### Exempted Methods
- GET (safe method)
- HEAD (safe method)
- OPTIONS (safe method)

### Protected Against
- Cross-Site Request Forgery attacks
- Unauthorized state-changing operations
- Session riding attacks

---

## Two-Factor Authentication (2FA/MFA)

### Implementation
Time-based One-Time Password (TOTP) using industry-standard RFC 6238.

### Features
- **TOTP**: 6-digit codes that rotate every 30 seconds
- **QR Code**: Easy setup with authenticator apps (Google Authenticator, Authy, etc.)
- **Backup Codes**: 10 single-use codes for account recovery
- **Hashed Storage**: Backup codes stored as SHA-256 hashes

### API Endpoints

#### Setup 2FA
```typescript
POST /api/trpc/auth.setup2FA
Response: {
  secret: string,
  qrCodeDataUrl: string,
  otpauthUrl: string
}
```

#### Verify & Enable 2FA
```typescript
POST /api/trpc/auth.verify2FA
Body: { token: string }
Response: {
  success: true,
  backupCodes: string[] // Only returned once!
}
```

#### Disable 2FA
```typescript
POST /api/trpc/auth.disable2FA
Body: { token: string }
Response: { success: true }
```

#### Check 2FA Status
```typescript
GET /api/trpc/auth.get2FAStatus
Response: {
  enabled: boolean,
  hasBackupCodes: boolean
}
```

### Login Flow with 2FA
1. User submits email + password
2. If credentials valid + 2FA enabled → Server returns `{ requiresTwoFactor: true }`
3. Client prompts for 2FA token
4. User submits email + password + 2FA token
5. Server verifies TOTP or backup code
6. Server issues access + refresh tokens

### Database Schema
```sql
ALTER TABLE users ADD COLUMN twoFactorSecret TEXT;
ALTER TABLE users ADD COLUMN twoFactorEnabled INTEGER DEFAULT 0;
ALTER TABLE users ADD COLUMN backupCodesHash TEXT;
ALTER TABLE users ADD COLUMN lastSignedIn TIMESTAMP WITH TIME ZONE;
```

### Code Location
- `server/_core/twoFactor.ts` - 2FA logic
- `server/routers.ts` - 2FA endpoints
- `drizzle/schema.ts` - Database schema
- `drizzle/MIGRATION_2FA.md` - Migration instructions

### Protected Against
- Credential stuffing attacks
- Password compromise
- Phishing attacks (time-limited tokens)
- Account takeover

---

## Structured Logging

### Implementation
Pino-based structured logging with automatic redaction of sensitive data.

### Features
- **Structured JSON**: Machine-readable log format
- **Automatic Redaction**: Removes passwords, tokens, API keys from logs
- **Log Levels**: debug, info, warn, error
- **Context Logging**: Child loggers with request context
- **Audit Logging**: Security-sensitive operations tracked

### Configuration
```typescript
LOG_LEVEL=info  # debug | info | warn | error
```

### Redacted Fields
- `password`, `apiKey`, `privateKey`, `secret`, `token`
- `req.headers.authorization`
- `req.headers.cookie`
- Nested fields: `*.password`, `*.apiKey`, etc.

### Audit Events
```typescript
logAudit({
  action: "login_success",
  userId: 1,
  openId: "owner:primary",
  resource: "auth",
  success: true,
});
```

### Code Location
- `server/_core/logger.ts` - Logger configuration
- Used throughout application for all logging

### Protected Against
- Credential leakage in logs
- Debugging without exposing sensitive data
- Compliance with data protection regulations

---

## Request Correlation IDs

### Implementation
Unique IDs assigned to each request for distributed tracing.

### Features
- **Auto-generated**: Using nanoid for short, URL-safe IDs
- **Propagated**: Included in response headers
- **Logged**: Automatically included in all log entries for the request
- **Traceable**: Follow requests across services

### Headers
- **Request**: `X-Correlation-ID` or `X-Request-ID`
- **Response**: `X-Correlation-ID`

### Code Location
- `server/_core/correlationId.ts` - Middleware
- Applied to all requests in `server/_core/app.ts`

### Usage in Logs
```json
{
  "correlationId": "V1StGXR8_Z5jdHi6B-myT",
  "method": "POST",
  "path": "/api/trpc/auth.login",
  "statusCode": 200,
  "duration": 150
}
```

### Protected Against
- Difficult debugging in distributed systems
- Request tracking across microservices
- Correlation of log entries

---

## Distributed Locking

### Implementation
PostgreSQL advisory locks for distributed coordination of autonomous trading.

### Features
- **Advisory Locks**: Built-in PostgreSQL feature
- **Non-blocking**: Try-lock pattern with retries
- **Auto-release**: TTL-based automatic release
- **Safe**: Multiple instances can't process same user simultaneously

### Lock Types

#### 1. Autonomous Trading Lock
```typescript
const lock = createAutonomousTradingLock(userId);
await lock.withLock(async () => {
  // Autonomous trading logic
  // Only one instance can execute this at a time
});
```

#### 2. Order Sync Lock
```typescript
const lock = createOrderSyncLock(userId);
await lock.withLock(async () => {
  // Order synchronization logic
});
```

#### 3. Market Data Lock
```typescript
const lock = createMarketDataLock(marketId);
await lock.withLock(async () => {
  // Market data update logic
});
```

### Configuration
```typescript
{
  ttlMs: 60000,         // Auto-release after 60 seconds
  retryCount: 3,        // Retry 3 times
  retryDelayMs: 100,    // Wait 100ms between retries
}
```

### Code Location
- `server/_core/distributedLock.ts` - Lock implementation
- `server/_core/app.ts` - Used in scheduled handlers

### Protected Against
- Concurrent processing of autonomous trading
- Race conditions in order synchronization
- Double-execution of scheduled jobs
- Data corruption from concurrent writes

---

## Additional Security Headers

### Implementation
Helmet middleware for security headers.

### Headers Set
- **Content-Security-Policy**: Prevents XSS attacks (disabled in dev for HMR)
- **X-Content-Type-Options**: nosniff (prevents MIME sniffing)
- **X-Frame-Options**: DENY (prevents clickjacking)
- **X-XSS-Protection**: 1; mode=block
- **Strict-Transport-Security**: HSTS for HTTPS enforcement
- **Referrer-Policy**: no-referrer

### CORS Configuration
```typescript
{
  origin: [/\.vercel\.app$/, /tradingmanus\.com$/],
  credentials: true,
}
```

### Code Location
- `server/_core/app.ts` - Helmet and CORS configuration

### Protected Against
- XSS (Cross-Site Scripting)
- Clickjacking
- MIME sniffing attacks
- CORS attacks
- Man-in-the-middle attacks (via HSTS)

---

## Security Checklist

### Pre-Deployment

- [ ] Update `.env` with strong secrets (32+ chars)
- [ ] Run `corepack pnpm audit` and fix vulnerabilities
- [ ] Run `corepack pnpm db:push` to apply 2FA schema changes
- [ ] Test 2FA setup and login flow
- [ ] Verify rate limiting is working
- [ ] Check logs for sensitive data leakage
- [ ] Test CSRF protection on mutation endpoints
- [ ] Verify distributed locks in scheduled jobs
- [ ] Test JWT refresh token flow

### Post-Deployment

- [ ] Monitor rate limit violations
- [ ] Monitor failed authentication attempts
- [ ] Rotate secrets regularly (every 90 days)
- [ ] Review audit logs weekly
- [ ] Monitor distributed lock timeouts
- [ ] Check for unauthorized CORS requests
- [ ] Verify HTTPS is enforced

---

## Troubleshooting

### Issue: Rate limit blocking legitimate traffic
**Solution**: Adjust limits in `server/_core/rateLimiter.ts`

### Issue: 2FA locked out
**Solution**: Use backup codes or manually reset in database:
```sql
UPDATE users SET twoFactorEnabled = 0 WHERE email = 'owner@example.com';
```

### Issue: Distributed lock timeout
**Solution**: Increase TTL in lock configuration or check for long-running operations

### Issue: CSRF token missing
**Solution**: Ensure client sends `X-CSRF-Token` header for mutations

### Issue: JWT expired
**Solution**: Use refresh token endpoint: `/api/trpc/auth.refreshToken`

---

## References

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [NIST Password Guidelines](https://pages.nist.gov/800-63-3/sp800-63b.html)
- [RFC 6238 (TOTP)](https://tools.ietf.org/html/rfc6238)
- [Express Rate Limit](https://github.com/express-rate-limit/express-rate-limit)
- [Helmet.js](https://helmetjs.github.io/)
- [Pino Logger](https://getpino.io/)
