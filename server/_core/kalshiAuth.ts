import crypto from "crypto";
import { URL } from "url";
import { getCredentialEncryptionSecret } from "./env";
import { assertPositiveIntegerUserId } from "./userScope";
import { logger } from "./logger";

const LEGACY_ALGORITHM = "aes-256-cbc";
const CREDENTIAL_CIPHER_VERSION = "v2";
const KALSHI_ENVIRONMENTS = [
  {
    mode: "production" as const,
    baseUrl: "https://api.elections.kalshi.com/trade-api/v2",
  },
  {
    mode: "demo" as const,
    baseUrl: "https://demo-api.kalshi.co/trade-api/v2",
  },
];

function getLegacyEncryptionKey() {
  return crypto
    .createHash("sha256")
    .update(getCredentialEncryptionSecret())
    .digest();
}

function getCredentialEncryptionKey(salt: Buffer, userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "credential encryption userId");
  // Use PBKDF2 with 100,000 iterations for key derivation (NIST recommended)
  return crypto.pbkdf2Sync(
    getCredentialEncryptionSecret(),
    `kalshi-credential:${scopedUserId}:${salt.toString("hex")}`,
    100000, // iterations
    32, // key length
    "sha256" // digest algorithm
  );
}

function getCredentialAad(userId: number) {
  const scopedUserId = assertPositiveIntegerUserId(userId, "credential AAD userId");
  return Buffer.from(`kalshi-credential:${scopedUserId}`, "utf8");
}

function normalizePrivateKey(privateKey: string) {
  const trimmed = privateKey.trim();

  if (trimmed.includes("BEGIN") && trimmed.includes("PRIVATE KEY")) {
    return trimmed;
  }

  const normalizedBody = trimmed
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");

  const wrapped = normalizedBody.match(/.{1,64}/g)?.join("\n") ?? normalizedBody;
  return `-----BEGIN PRIVATE KEY-----\n${wrapped}\n-----END PRIVATE KEY-----`;
}

function buildKalshiHeaders(
  apiKey: string,
  privateKey: string,
  method: string,
  requestUrl: string,
) {
  const timestamp = Date.now().toString();
  const signPath = new URL(requestUrl).pathname;
  const keyObject = crypto.createPrivateKey({
    key: normalizePrivateKey(privateKey),
    format: "pem",
  });
  const message = `${timestamp}${method.toUpperCase()}${signPath}`;
  const signature = crypto.sign("sha256", Buffer.from(message, "utf8"), {
    key: keyObject,
    padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
    saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
  });

  return {
    Accept: "application/json",
    "KALSHI-ACCESS-KEY": apiKey.trim(),
    "KALSHI-ACCESS-SIGNATURE": signature.toString("base64"),
    "KALSHI-ACCESS-TIMESTAMP": timestamp,
  };
}

async function fetchKalshiBalance(
  apiKey: string,
  privateKey: string,
  baseUrl: string,
): Promise<{ balance: number; raw: unknown }> {
  const path = "/portfolio/balance";
  const requestUrl = `${baseUrl}${path}`;
  const response = await fetch(requestUrl, {
    method: "GET",
    headers: buildKalshiHeaders(apiKey, privateKey, "GET", requestUrl),
  });

  const text = await response.text();
  let payload: Record<string, unknown> = {};
  try {
    payload = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const message =
      (typeof payload.error === "string" && payload.error) ||
      (typeof payload.message === "string" && payload.message) ||
      `HTTP ${response.status}`;
    throw new Error(message);
  }

  const balanceCents =
    typeof payload.balance === "number"
      ? payload.balance
      : typeof payload.available_balance === "number"
        ? payload.available_balance
        : null;

  if (balanceCents === null) {
    throw new Error("Balance field missing from Kalshi response");
  }

  return {
    balance: balanceCents / 100,
    raw: payload,
  };
}

async function probeKalshiEnvironment(apiKey: string, privateKey: string) {
  const failures: string[] = [];

  for (const environment of KALSHI_ENVIRONMENTS) {
    try {
      const result = await fetchKalshiBalance(apiKey, privateKey, environment.baseUrl);
      return {
        valid: true as const,
        mode: environment.mode,
        baseUrl: environment.baseUrl,
        equity: result.balance,
      };
    } catch (error) {
      failures.push(`${environment.mode}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    valid: false as const,
    error: failures.join(" | ") || "Kalshi authentication failed",
  };
}

/**
 * Encrypt sensitive data (API keys, private keys)
 */
export function encryptCredential(plaintext: string, userId: number): string {
  try {
    const scopedUserId = assertPositiveIntegerUserId(userId, "encryptCredential userId");
    const salt = crypto.randomBytes(16);
    const iv = crypto.randomBytes(12);
    const key = getCredentialEncryptionKey(salt, scopedUserId);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    cipher.setAAD(getCredentialAad(scopedUserId));

    const encrypted = Buffer.concat([
      cipher.update(plaintext, "utf8"),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return [
      CREDENTIAL_CIPHER_VERSION,
      salt.toString("hex"),
      iv.toString("hex"),
      authTag.toString("hex"),
      encrypted.toString("hex"),
    ].join(":");
  } catch (error) {
    logger.error({ err: error }, "[Kalshi Auth] Encryption failed");
    throw new Error("Failed to encrypt credential");
  }
}

/**
 * Sentinel error class for credential decryption failures caused by a
 * mismatched CREDENTIAL_ENCRYPTION_SECRET.  Callers can `instanceof`-check
 * this to distinguish "wrong key" from other unexpected errors and surface a
 * re-authentication prompt instead of crashing.
 */
export class CredentialDecryptionError extends Error {
  constructor(message = "Credential cannot be decrypted — re-authentication required") {
    super(message);
    this.name = "CredentialDecryptionError";
  }
}

/**
 * Decrypt sensitive data
 */
export function decryptCredential(encrypted: string, userId: number): string {
  try {
    const scopedUserId = assertPositiveIntegerUserId(userId, "decryptCredential userId");
    const parts = encrypted.split(":");

    if (parts[0] === CREDENTIAL_CIPHER_VERSION) {
      const [, saltHex, ivHex, authTagHex, encryptedHex] = parts;
      if (!saltHex || !ivHex || !authTagHex || !encryptedHex) {
        throw new CredentialDecryptionError("Invalid encrypted credential format");
      }

      const salt = Buffer.from(saltHex, "hex");
      const iv = Buffer.from(ivHex, "hex");
      const authTag = Buffer.from(authTagHex, "hex");
      const key = getCredentialEncryptionKey(salt, scopedUserId);
      const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
      decipher.setAAD(getCredentialAad(scopedUserId));
      decipher.setAuthTag(authTag);

      const decrypted = Buffer.concat([
        decipher.update(Buffer.from(encryptedHex, "hex")),
        decipher.final(),
      ]);

      return decrypted.toString("utf8");
    }

    const [ivHex, encryptedHex] = parts;
    if (!ivHex || !encryptedHex) {
      throw new CredentialDecryptionError("Invalid encrypted credential format");
    }
    const key = getLegacyEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(LEGACY_ALGORITHM, key, iv);

    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    // Re-throw typed decryption errors as-is so callers can distinguish them.
    if (error instanceof CredentialDecryptionError) {
      throw error;
    }
    // Node's crypto module throws "Unsupported state or unable to authenticate
    // data" when the auth tag check fails (wrong key / corrupted ciphertext).
    // Wrap these as a CredentialDecryptionError so callers can prompt re-auth.
    logger.error({ err: error }, "[Kalshi Auth] Decryption failed");
    throw new CredentialDecryptionError(
      "Stored credential cannot be decrypted with the current encryption secret — please re-authenticate with Kalshi"
    );
  }
}

/**
 * Validate Kalshi API credentials by making a signed balance request.
 */
export async function validateKalshiCredentials(
  apiKey: string,
  privateKey: string,
): Promise<{ valid: boolean; equity?: number; mode?: "production" | "demo"; error?: string }> {
  try {
    if (!apiKey || !privateKey || apiKey.trim().length < 10 || privateKey.trim().length < 32) {
      return { valid: false, error: "Invalid credential format" };
    }

    const result = await probeKalshiEnvironment(apiKey, privateKey);
    if (!result.valid) {
      return { valid: false, error: result.error };
    }

    return {
      valid: true,
      equity: result.equity,
      mode: result.mode,
    };
  } catch (error) {
    logger.error({ err: error }, "[Kalshi Auth] Validation failed");
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Failed to validate credentials",
    };
  }
}

/**
 * Fetch account equity from Kalshi using the same signed request flow.
 */
export async function fetchKalshiAccountEquity(
  apiKey: string,
  privateKey: string,
): Promise<{ equity: number; mode?: "production" | "demo"; error?: string }> {
  try {
    const result = await probeKalshiEnvironment(apiKey, privateKey);
    if (!result.valid) {
      return { equity: 0, error: result.error };
    }

    return {
      equity: result.equity,
      mode: result.mode,
    };
  } catch (error) {
    logger.error({ err: error }, "[Kalshi Auth] Equity fetch failed");
    return {
      equity: 0,
      error: error instanceof Error ? error.message : "Failed to fetch account equity",
    };
  }
}
