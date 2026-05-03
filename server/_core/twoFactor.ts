import speakeasy from "speakeasy";
import qrcode from "qrcode";
import { logger } from "./logger";

export interface TwoFactorSecret {
  secret: string;
  otpauthUrl: string;
  qrCodeDataUrl: string;
}

/**
 * Generate a new 2FA secret for a user
 */
export async function generateTwoFactorSecret(
  email: string,
  issuer: string = "Laurenzo"
): Promise<TwoFactorSecret> {
  try {
    const secret = speakeasy.generateSecret({
      name: `${issuer} (${email})`,
      issuer,
      length: 32,
    });

    if (!secret.otpauth_url) {
      throw new Error("Failed to generate OTP auth URL");
    }

    const qrCodeDataUrl = await qrcode.toDataURL(secret.otpauth_url);

    return {
      secret: secret.base32,
      otpauthUrl: secret.otpauth_url,
      qrCodeDataUrl,
    };
  } catch (error) {
    logger.error({ error }, "Failed to generate 2FA secret");
    throw new Error("Failed to generate 2FA secret");
  }
}

/**
 * Verify a 2FA token against a secret
 */
export function verifyTwoFactorToken(token: string, secret: string): boolean {
  try {
    // Remove any spaces or dashes from token
    const cleanToken = token.replace(/[\s-]/g, "");

    // Verify the token with a window of 1 (allows for slight time drift)
    const verified = speakeasy.totp.verify({
      secret,
      encoding: "base32",
      token: cleanToken,
      window: 1,
    });

    return verified;
  } catch (error) {
    logger.error({ error }, "Failed to verify 2FA token");
    return false;
  }
}

/**
 * Generate backup codes for account recovery
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    // Generate 8-character alphanumeric codes
    const code = Math.random()
      .toString(36)
      .substring(2, 10)
      .toUpperCase();
    codes.push(code);
  }
  return codes;
}

/**
 * Hash a backup code for storage
 */
export function hashBackupCode(code: string): string {
  const crypto = require("crypto");
  return crypto
    .createHash("sha256")
    .update(code)
    .digest("hex");
}

/**
 * Verify a backup code against stored hash
 */
export function verifyBackupCode(code: string, hash: string): boolean {
  try {
    const codeHash = hashBackupCode(code);
    const crypto = require("crypto");
    return crypto.timingSafeEqual(
      Buffer.from(codeHash),
      Buffer.from(hash)
    );
  } catch (error) {
    logger.error({ error }, "Failed to verify backup code");
    return false;
  }
}
