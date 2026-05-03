/**
 * fetchWithRetry — minimal retry wrapper for transient HTTP failures.
 *
 * Retries on:
 *   - Network errors (fetch throws)
 *   - HTTP 5xx responses
 *   - HTTP 408 / 429 (timeout / rate limit)
 *
 * Does NOT retry on other 4xx (permanent client errors) so we don't
 * mask bad requests.
 *
 * Backoff is exponential with jitter to avoid thundering herds when
 * an upstream recovers.
 */

export interface RetryOptions {
  /** Maximum total attempts including the first call. Default 3. */
  maxAttempts?: number;
  /** Base backoff in ms before the first retry. Default 250. */
  baseDelayMs?: number;
  /** Cap on backoff between retries. Default 4000. */
  maxDelayMs?: number;
  /** Optional label used in retry log lines. */
  label?: string;
}

const TRANSIENT_STATUSES = new Set([408, 425, 429]);

function isTransientStatus(status: number): boolean {
  return status >= 500 || TRANSIENT_STATUSES.has(status);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoff(attempt: number, base: number, cap: number): number {
  const exp = Math.min(cap, base * 2 ** (attempt - 1));
  // Decorrelated jitter: pick a random value in [base, exp * 1.5] capped at `cap`.
  const upper = Math.min(cap, Math.floor(exp * 1.5));
  return Math.floor(base + Math.random() * Math.max(0, upper - base));
}

export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit = {},
  options: RetryOptions = {}
): Promise<Response> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const baseDelayMs = Math.max(1, options.baseDelayMs ?? 250);
  const maxDelayMs = Math.max(baseDelayMs, options.maxDelayMs ?? 4000);
  const label = options.label ?? "fetchWithRetry";

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const response = await fetch(input, init);
      if (response.ok || !isTransientStatus(response.status)) {
        return response;
      }
      lastError = new Error(`HTTP ${response.status}`);
      // Drain body so the connection can be reused before we retry.
      try {
        await response.arrayBuffer();
      } catch {
        // Ignore drain errors; the response is already discarded.
      }
      if (attempt < maxAttempts) {
        const wait = computeBackoff(attempt, baseDelayMs, maxDelayMs);
        console.warn(`[${label}] attempt ${attempt}/${maxAttempts} got ${response.status}; retrying in ${wait}ms`);
        await delay(wait);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt >= maxAttempts) break;
      const wait = computeBackoff(attempt, baseDelayMs, maxDelayMs);
      console.warn(`[${label}] attempt ${attempt}/${maxAttempts} threw ${(error as Error)?.message ?? error}; retrying in ${wait}ms`);
      await delay(wait);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
