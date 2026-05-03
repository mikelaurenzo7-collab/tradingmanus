import { describe, expect, it } from "vitest";
import { CircuitBreaker, CircuitOpenError } from "./_core/circuitBreaker";

describe("CircuitBreaker", () => {
  function createClock(initial = 0) {
    let t = initial;
    return {
      now: () => t,
      advance: (ms: number) => {
        t += ms;
      },
    };
  }

  it("passes successful calls straight through and stays CLOSED", async () => {
    const clock = createClock();
    const breaker = new CircuitBreaker({ name: "test", now: clock.now });

    await expect(breaker.exec(async () => "ok")).resolves.toBe("ok");
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("opens after the failure threshold inside the rolling window", async () => {
    const clock = createClock();
    const breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 3,
      windowMs: 1000,
      cooldownMs: 5000,
      now: clock.now,
    });

    for (let i = 0; i < 3; i++) {
      await expect(breaker.exec(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    }

    expect(breaker.getState()).toBe("OPEN");
  });

  it("fails fast with CircuitOpenError while OPEN", async () => {
    const clock = createClock();
    const breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 1,
      windowMs: 1000,
      cooldownMs: 5000,
      now: clock.now,
    });

    await expect(breaker.exec(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(breaker.getState()).toBe("OPEN");

    await expect(breaker.exec(async () => "should not run")).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it("transitions to HALF_OPEN after cooldown and closes on a successful probe", async () => {
    const clock = createClock();
    const breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 1,
      windowMs: 1000,
      cooldownMs: 1000,
      now: clock.now,
    });

    await expect(breaker.exec(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(breaker.getState()).toBe("OPEN");

    clock.advance(1500);
    expect(breaker.getState()).toBe("HALF_OPEN");

    await expect(breaker.exec(async () => "recovered")).resolves.toBe("recovered");
    expect(breaker.getState()).toBe("CLOSED");
  });

  it("re-opens immediately if the half-open probe fails", async () => {
    const clock = createClock();
    const breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 1,
      windowMs: 1000,
      cooldownMs: 1000,
      now: clock.now,
    });

    await expect(breaker.exec(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    clock.advance(1500);
    expect(breaker.getState()).toBe("HALF_OPEN");

    await expect(breaker.exec(async () => { throw new Error("still bad"); })).rejects.toThrow("still bad");
    expect(breaker.getState()).toBe("OPEN");
  });

  it("ignores failures that fall outside the rolling window", async () => {
    const clock = createClock();
    const breaker = new CircuitBreaker({
      name: "test",
      failureThreshold: 3,
      windowMs: 1000,
      cooldownMs: 5000,
      now: clock.now,
    });

    await expect(breaker.exec(async () => { throw new Error("boom"); })).rejects.toThrow();
    await expect(breaker.exec(async () => { throw new Error("boom"); })).rejects.toThrow();

    // Slide past the window, so old failures should not count.
    clock.advance(1100);

    await expect(breaker.exec(async () => { throw new Error("boom"); })).rejects.toThrow();
    await expect(breaker.exec(async () => { throw new Error("boom"); })).rejects.toThrow();

    // Only 2 failures inside the current window, breaker still CLOSED.
    expect(breaker.getState()).toBe("CLOSED");
  });
});
