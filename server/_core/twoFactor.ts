import { generateSecret, generateURI, verifySync } from "otplib";
import qrcode from "qrcode";
import crypto from "crypto";
import { logger } from "./logger";

// Allow ±30s of clock drift, matching the previous speakeasy `window: 1`
// semantics (which accepted the prior and next 30-second TOTP step).  Larger
// tolerances weaken brute-force protection.
const EPOCH_TOLERANCE_SECONDS = 30;

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
    // 32 bytes = 256 bits of entropy, matching the previous speakeasy call.
    const secret = generateSecret({ length: 32 });
    const otpauthUrl = generateURI({ issuer, label: email, secret });
    const qrCodeDataUrl = await qrcode.toDataURL(otpauthUrl);

    return {
      secret,
      otpauthUrl,
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
    // Strip user-friendly separators before validating.
    const cleanToken = token.replace(/[\s-]/g, "");
    const result = verifySync({
      token: cleanToken,
      secret,
      epochTolerance: EPOCH_TOLERANCE_SECONDS,
    });
    return result.valid;
  } catch (error) {
    logger.error({ error }, "Failed to verify 2FA token");
    return false;
  }
}

/**
 * Generate backup codes for account recovery.
 * Uses crypto.randomBytes — backup codes guard the account if the TOTP
 * device is lost, so they must be unguessable.  The previous Math.random()
 * implementation was not cryptographically secure.
 */
export function generateBackupCodes(count: number = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const code = crypto
      .randomBytes(5)
      .toString("hex")
      .substring(0, 8)
      .toUpperCase();
    codes.push(code);
  }
  return codes;
}

/**
 * Hash a backup code for storage
 */
export function hashBackupCode(code: string): string {
  return crypto.createHash("sha256").update(code).digest("hex");
}

/**
 * Verify a backup code against stored hash
 */
export function verifyBackupCode(code: string, hash: string): boolean {
  try {
    const codeHash = hashBackupCode(code);
    const a = Buffer.from(codeHash);
    const b = Buffer.from(hash);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (error) {
    logger.error({ error }, "Failed to verify backup code");
    return false;
  }
}
