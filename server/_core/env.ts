const normalize = (value: string | undefined) => value?.trim() ?? "";

export const ENV = {
  cookieSecret: normalize(process.env.JWT_SECRET),
  credentialEncryptionSecret: normalize(process.env.CREDENTIAL_ENCRYPTION_SECRET),
  databaseUrl: normalize(process.env.DATABASE_URL),
  ownerEmail: normalize(process.env.OWNER_EMAIL),
  ownerPassword: normalize(process.env.OWNER_PASSWORD),
  cronSecret: normalize(process.env.CRON_SECRET),
  anthropicApiKey: normalize(process.env.ANTHROPIC_API_KEY),
  anthropicModel: normalize(process.env.ANTHROPIC_MODEL) || "claude-sonnet-4-5",
  kalshiApiKey: normalize(process.env.KALSHI_API_KEY),
  isProduction: process.env.NODE_ENV === "production",
  gnewsApiKey: normalize(process.env.GNEWS_API_KEY),
};

const REQUIRED_SERVER_ENV = [
  ["JWT_SECRET", ENV.cookieSecret],
  ["CREDENTIAL_ENCRYPTION_SECRET", ENV.credentialEncryptionSecret],
  ["DATABASE_URL", ENV.databaseUrl],
  ["OWNER_EMAIL", ENV.ownerEmail],
  ["OWNER_PASSWORD", ENV.ownerPassword],
] as const;

export function validateServerEnv() {
  const missing = REQUIRED_SERVER_ENV.filter(([, value]) => value.length === 0).map(
    ([name]) => name
  );

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  if (ENV.isProduction && ENV.cookieSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters in production");
  }

  if (ENV.isProduction && ENV.credentialEncryptionSecret.length < 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_SECRET must be at least 32 characters in production");
  }

  if (ENV.isProduction && ENV.ownerPassword.length < 12) {
    throw new Error("OWNER_PASSWORD must be at least 12 characters in production");
  }

  // Vercel cron jobs authenticate via `Authorization: Bearer ${CRON_SECRET}`.
  // Without this secret the cron handler falls through to JWT auth and silently
  // 401s on every scheduled tick — autonomous trading would never run.
  if (ENV.isProduction && ENV.cronSecret.length < 16) {
    throw new Error("CRON_SECRET must be set (16+ chars) in production for Vercel cron auth");
  }
}

export function getCredentialEncryptionSecret() {
  const secret = ENV.credentialEncryptionSecret || ENV.cookieSecret;

  if (!secret) {
    throw new Error("CREDENTIAL_ENCRYPTION_SECRET or JWT_SECRET is required for credential encryption");
  }

  return secret;
}

export function getKalshiApiKey() {
  if (!ENV.kalshiApiKey) {
    if (process.env.NODE_ENV === "test") {
      return "test-kalshi-api-key";
    }
    throw new Error("KALSHI_API_KEY is required for Kalshi trading actions");
  }

  return ENV.kalshiApiKey;
}
