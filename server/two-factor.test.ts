import { describe, expect, it } from "vitest";
import { generate } from "otplib";
import {
  generateBackupCodes,
  generateTwoFactorSecret,
  hashBackupCode,
  verifyBackupCode,
  verifyTwoFactorToken,
} from "./_core/twoFactor";

describe("twoFactor (otplib backend)", () => {
  it("generates a base32 secret and a Google Authenticator-compatible otpauth URL", async () => {
    const result = await generateTwoFactorSecret("user@example.com", "Laurenzo");
    expect(result.secret).toMatch(/^[A-Z2-7]+$/);
    expect(result.secret.length).toBeGreaterThanOrEqual(32);
    expect(result.otpauthUrl).toMatch(/^otpauth:\/\/totp\/Laurenzo:user%40example.com\?secret=/);
    expect(result.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
  });

  it("verifies a freshly generated token", async () => {
    const { secret } = await generateTwoFactorSecret("user@example.com");
    const token = await generate({ secret });
    expect(verifyTwoFactorToken(token, secret)).toBe(true);
  });

  it("strips spaces and dashes from user-entered tokens before verifying", async () => {
    const { secret } = await generateTwoFactorSecret("user@example.com");
    const token = await generate({ secret });
    const formatted = `${token.slice(0, 3)} ${token.slice(3)}`;
    expect(verifyTwoFactorToken(formatted, secret)).toBe(true);
  });

  it("rejects an obviously wrong token", async () => {
    const { secret } = await generateTwoFactorSecret("user@example.com");
    expect(verifyTwoFactorToken("000000", secret)).toBe(false);
    expect(verifyTwoFactorToken("not-a-token", secret)).toBe(false);
  });

  it("returns false on verify when the secret is malformed (does not throw)", () => {
    expect(verifyTwoFactorToken("123456", "not-a-base32-secret!!!")).toBe(false);
  });

  describe("backup codes", () => {
    it("generates the requested number of unique 8-char alphanumeric codes", () => {
      const codes = generateBackupCodes(10);
      expect(codes).toHaveLength(10);
      expect(new Set(codes).size).toBe(10); // all unique with overwhelming probability
      for (const code of codes) {
        expect(code).toMatch(/^[A-F0-9]{8}$/);
      }
    });

    it("hashes deterministically and verifies against the stored hash", () => {
      const code = "ABCD1234";
      const hash = hashBackupCode(code);
      expect(hashBackupCode(code)).toBe(hash); // deterministic
      expect(verifyBackupCode(code, hash)).toBe(true);
      expect(verifyBackupCode("WRONG123", hash)).toBe(false);
    });

    it("returns false (does not throw) when the stored hash has a different length", () => {
      expect(verifyBackupCode("ABCD1234", "deadbeef")).toBe(false);
    });
  });
});
