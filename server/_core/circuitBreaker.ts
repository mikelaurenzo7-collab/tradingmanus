/**
 * Circuit breaker for upstream HTTP dependencies.
 *
 * When a dependency fails repeatedly, repeating the same call piles
 * latency onto callers and can cascade into thread-pool / event-loop
 * starvation. The breaker short-circuits calls when failures cross a
 * threshold inside a rolling window, then probes for recovery after a
 * cooldown.
 *
 * States:
 *   CLOSED   — calls pass through; failures counted in the window.
 *   OPEN     — calls fail fast with `CircuitOpenError` until cooldown.
 *   HALF_OPEN — exactly one probe call is allowed; success closes the
 *               breaker, failure re-opens it for another cooldown.
 */

import { logger } from "./logger";

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Failures inside `windowMs` that flip the breaker open. Default 5. */
  failureThreshold?: number;
  /** Rolling failure window in ms. Default 30_000. */
  windowMs?: number;
  /** Cooldown before a half-open probe is allowed. Default 30_000. */
  cooldownMs?: number;
  /** Optional label used in logs and errors. */
  name?: string;
  /** Clock injection point for tests. */
  now?: () => number;
}

export class CircuitOpenError extends Error {
  readonly code = "CIRCUIT_OPEN" as const;
  constructor(name: string) {
    super(`Circuit "${name}" is open; failing fast.`);
    this.name = "CircuitOpenError";
  }
}

export class CircuitBreaker {
  private state: CircuitState = "CLOSED";
  private failures: number[] = [];
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly windowMs: number;
  private readonly cooldownMs: number;
  private readonly name: string;
  private readonly now: () => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = Math.max(1, options.failureThreshold ?? 5);
    this.windowMs = Math.max(1, options.windowMs ?? 30_000);
    this.cooldownMs = Math.max(1, options.cooldownMs ?? 30_000);
    this.name = options.name ?? "circuit";
    this.now = options.now ?? Date.now;
  }

  getState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    this.maybeTransitionToHalfOpen();

    if (this.state === "OPEN") {
      throw new CircuitOpenError(this.name);
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private maybeTransitionToHalfOpen(): void {
    if (this.state !== "OPEN") return;
    if (this.now() - this.openedAt >= this.cooldownMs) {
      this.state = "HALF_OPEN";
    }
  }

  private onSuccess(): void {
    if (this.state === "HALF_OPEN") {
      logger.info({ circuit: this.name }, "[circuit:%s] probe succeeded; closing.", this.name);
    }
    this.failures = [];
    this.state = "CLOSED";
  }

  private onFailure(): void {
    if (this.state === "HALF_OPEN") {
      logger.warn({ circuit: this.name }, "[circuit:%s] probe failed; re-opening.", this.name);
      this.state = "OPEN";
      this.openedAt = this.now();
      return;
    }

    const cutoff = this.now() - this.windowMs;
    this.failures = this.failures.filter((t) => t >= cutoff);
    this.failures.push(this.now());

    if (this.failures.length >= this.failureThreshold) {
      logger.warn(
        { circuit: this.name, failures: this.failures.length, windowMs: this.windowMs },
        `[circuit:${this.name}] tripped after ${this.failures.length} failures in ${this.windowMs}ms; opening.`,
      );
      this.state = "OPEN";
      this.openedAt = this.now();
      this.failures = [];
    }
  }
}
