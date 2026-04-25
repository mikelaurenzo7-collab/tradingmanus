const normalize = (value: string | undefined) => value?.trim() ?? "";

export const ENV = {
  appId: normalize(process.env.VITE_APP_ID),
  cookieSecret: normalize(process.env.JWT_SECRET),
  credentialEncryptionSecret: normalize(process.env.CREDENTIAL_ENCRYPTION_SECRET),
  databaseUrl: normalize(process.env.DATABASE_URL),
  oAuthServerUrl: normalize(process.env.OAUTH_SERVER_URL),
  ownerOpenId: normalize(process.env.OWNER_OPEN_ID),
  kalshiApiKey: normalize(process.env.KALSHI_API_KEY),
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: normalize(process.env.BUILT_IN_FORGE_API_URL),
  forgeApiKey: normalize(process.env.BUILT_IN_FORGE_API_KEY),
  gnewsApiKey: normalize(process.env.GNEWS_API_KEY),
};

const REQUIRED_SERVER_ENV = [
  ["VITE_APP_ID", ENV.appId],
  ["JWT_SECRET", ENV.cookieSecret],
  ["DATABASE_URL", ENV.databaseUrl],
  ["OAUTH_SERVER_URL", ENV.oAuthServerUrl],
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

  if (ENV.isProduction && getCredentialEncryptionSecret().length < 32) {
    throw new Error("CREDENTIAL_ENCRYPTION_SECRET must be at least 32 characters in production");
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
