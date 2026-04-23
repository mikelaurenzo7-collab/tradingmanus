import crypto from "crypto";
import { ENV } from "./env";

const ENCRYPTION_KEY = ENV.cookieSecret || "default-key-change-in-production";
const ALGORITHM = "aes-256-cbc";

/**
 * Encrypt sensitive data (API keys, private keys)
 */
export function encryptCredential(plaintext: string): string {
  try {
    // Derive a 32-byte key from the JWT secret
    const key = crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(plaintext, "utf8", "hex");
    encrypted += cipher.final("hex");
    
    // Prepend IV to encrypted data (IV doesn't need to be secret)
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
    const key = crypto.createHash("sha256").update(ENCRYPTION_KEY).digest();
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
 * Validate Kalshi API credentials by making a test API call
 */
export async function validateKalshiCredentials(
  apiKey: string,
  privateKey: string
): Promise<{ valid: boolean; equity?: number; error?: string }> {
  try {
    // In production, this would make an authenticated call to Kalshi API
    // For now, we'll do a basic validation
    if (!apiKey || !privateKey || apiKey.length < 10 || privateKey.length < 10) {
      return { valid: false, error: "Invalid credential format" };
    }

    // TODO: Replace with actual Kalshi API call to fetch account equity
    // Example: GET https://api.kalshi.com/trade-api/v2/account
    // with Authorization header using apiKey and privateKey

    // Simulated equity fetch (replace with real API call)
    const equity = 100; // Default starting equity

    return { valid: true, equity };
  } catch (error) {
    console.error("[Kalshi Auth] Validation failed:", error);
    return { valid: false, error: "Failed to validate credentials" };
  }
}

/**
 * Fetch account equity from Kalshi API
 */
export async function fetchKalshiAccountEquity(
  apiKey: string,
  privateKey: string
): Promise<{ equity: number; error?: string }> {
  try {
    // TODO: Make authenticated call to Kalshi API
    // GET https://api.kalshi.com/trade-api/v2/account
    // Response should include account balance/equity

    // For now, return simulated data
    return { equity: 100 };
  } catch (error) {
    console.error("[Kalshi Auth] Equity fetch failed:", error);
    return { equity: 0, error: "Failed to fetch account equity" };
  }
}
