import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchWithRetry } from "./_core/fetchWithRetry";
import { CircuitBreaker, CircuitOpenError } from "./_core/circuitBreaker";

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function makeResponse(status: number): Response {
    return new Response(JSON.stringify({ ok: status < 400 }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }

  it("returns the first successful response without retrying", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(makeResponse(200));

    const promise = fetchWithRetry("https://example.test", undefined, {
      maxAttempts: 3,
      baseDelayMs: 1,
    });
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
  });

  it("retries on 503 and succeeds on a later attempt", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(503))
      .mockResolvedValueOnce(makeResponse(200));

    const promise = fetchWithRetry("https://example.test", undefined, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 2,
    });
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(3);
    expect(response.status).toBe(200);
  });

  it("does not retry on 404", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(makeResponse(404));

    const promise = fetchWithRetry("https://example.test", undefined, {
      maxAttempts: 3,
      baseDelayMs: 1,
    });
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(404);
  });

  it("retries network errors and rethrows after exhausting attempts", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("ECONNRESET"));

    const promise = fetchWithRetry("https://example.test", undefined, {
      maxAttempts: 3,
      baseDelayMs: 1,
      maxDelayMs: 2,
    });
    const caught = expect(promise).rejects.toThrow("ECONNRESET");
    await vi.runAllTimersAsync();
    await caught;

    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("retries on 429 rate-limit responses", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(makeResponse(429))
      .mockResolvedValueOnce(makeResponse(200));

    const promise = fetchWithRetry("https://example.test", undefined, {
      maxAttempts: 2,
      baseDelayMs: 1,
      maxDelayMs: 2,
    });
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(response.status).toBe(200);
  });

  it("trips the circuit breaker after sustained failures and short-circuits new calls", async () => {
    let now = 0;
    const breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 2,
      windowMs: 10_000,
      cooldownMs: 60_000,
      now: () => now,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(makeResponse(503));

    // Two exhausted retry budgets => two breaker failures => OPEN.
    for (let i = 0; i < 2; i++) {
      const p = fetchWithRetry("https://example.test", undefined, {
        maxAttempts: 1,
        baseDelayMs: 1,
        maxDelayMs: 2,
        breaker,
      });
      const assertion = expect(p).rejects.toThrow();
      await vi.runAllTimersAsync();
      await assertion;
    }

    expect(breaker.getState()).toBe("OPEN");

    // Next call should fail fast with CircuitOpenError, no fetch invoked.
    fetchSpy.mockClear();
    await expect(
      fetchWithRetry("https://example.test", undefined, {
        maxAttempts: 1,
        baseDelayMs: 1,
        maxDelayMs: 2,
        breaker,
      }),
    ).rejects.toBeInstanceOf(CircuitOpenError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
