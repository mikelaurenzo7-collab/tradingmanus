/**
 * Shared cryptographic key utilities.
 *
 * Centralises PEM normalisation so that `kalshiAuth.ts` and
 * `kalshiExecution.ts` share one source of truth instead of duplicating the
 * same function.
 */

/**
 * Ensures a private key string is wrapped in a valid PEM envelope with
 * 64-character base64 lines.
 *
 * Accepts both:
 *  - Raw base64 (no headers)          → adds headers + wraps at 64 chars
 *  - Already-wrapped PEM (has headers) → returned as-is (trimmed)
 */
export function normalizePrivateKey(privateKey: string): string {
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
