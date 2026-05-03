import { describe, expect, it, vi } from "vitest";

vi.mock("./_core/env", () => ({
  getCredentialEncryptionSecret: () => "test-credential-encryption-secret-at-least-32-chars",
}));

import { decryptCredential, encryptCredential } from "./_core/kalshiAuth";

describe("Kalshi credential encryption", () => {
  it("round-trips credentials with an authenticated per-user envelope", () => {
    const encrypted = encryptCredential("super-secret-private-key", 7);

    expect(encrypted.startsWith("v2:")).toBe(true);
    expect(decryptCredential(encrypted, 7)).toBe("super-secret-private-key");
  });

  it("does not decrypt a user-bound credential with another user context", () => {
    const encrypted = encryptCredential("api-key", 7);

    expect(() => decryptCredential(encrypted, 8)).toThrow("Stored credential cannot be decrypted");
  });

  it("uses a fresh random envelope for each encryption", () => {
    const first = encryptCredential("same-secret", 7);
    const second = encryptCredential("same-secret", 7);

    expect(first).not.toBe(second);
    expect(decryptCredential(first, 7)).toBe("same-secret");
    expect(decryptCredential(second, 7)).toBe("same-secret");
  });
});
