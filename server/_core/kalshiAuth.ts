import crypto from "crypto";
import { URL } from "url";
import { getCredentialEncryptionSecret } from "./env";

const ALGORITHM = "aes-256-cbc";
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

function getEncryptionKey() {
  return crypto
    .createHash("sha256")
    .update(getCredentialEncryptionSecret())
    .digest();
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
export function encryptCredential(plaintext: string): string {
  try {
    const key = getEncryptionKey();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");

    return iv.toString("hex") + ":" + encrypted;
  } catch (error) {
    console.error("[Kalshi Auth] Encryption failed:", error);
    throw new Error("Failed to encrypt credential");
  }
}

/**
 * Decrypt sensitive data
 */
export function decryptCredential(encrypted: string): string {
  try {
    const [ivHex, encryptedHex] = encrypted.split(":");
    if (!ivHex || !encryptedHex) {
      throw new Error("Invalid encrypted credential format");
    }
    const key = getEncryptionKey();
    const iv = Buffer.from(ivHex, "hex");
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);

    let decrypted = decipher.update(encryptedHex, "hex", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    console.error("[Kalshi Auth] Decryption failed:", error);
    throw new Error("Failed to decrypt credential");
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
    console.error("[Kalshi Auth] Validation failed:", error);
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
    console.error("[Kalshi Auth] Equity fetch failed:", error);
    return {
      equity: 0,
      error: error instanceof Error ? error.message : "Failed to fetch account equity",
    };
  }
}
