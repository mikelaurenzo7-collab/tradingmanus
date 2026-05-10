/**
 * Time-of-day autonomy cadence helper.
 *
 * Kalshi liquidity is heavily US-skewed — most volume + price discovery
 * happens 9am–midnight ET.  Running the autonomy tick at the same rate
 * overnight wastes AI cost on stale order books and rare fills.
 *
 * This helper buckets the current UTC hour into two tiers:
 *   - prime:     US daytime + evening (default 13:00–05:00 UTC = 9am–1am ET)
 *   - overnight: quiet hours          (default 05:00–13:00 UTC = 1am–9am ET)
 *
 * The base interval (AUTONOMY_INTERVAL_MS) defines the prime cadence.
 * Overnight ticks are slowed by AUTONOMY_OVERNIGHT_MULTIPLIER (default 4×).
 *
 * The exit monitor + order sync run on their own (faster) intervals and
 * are NOT slowed by this helper — open positions still need overnight
 * stop-loss / profit-target monitoring.
 *
 * All bounds are ENV-tunable.  Pure function, deterministic, unit-tested.
 */

export type AutonomyCadenceTier = "prime" | "overnight";

export interface AutonomyCadenceDecision {
  tier: AutonomyCadenceTier;
  intervalMs: number;
  hourUtc: number;
}

export interface AutonomyCadenceConfig {
  /** Base interval in ms (prime-tier cadence). */
  baseIntervalMs: number;
  /** Multiplier applied during overnight tier (>= 1). 4 = 4× slower. */
  overnightMultiplier: number;
  /** UTC hour (0-23, inclusive) at which prime tier starts. */
  primeStartUtcHour: number;
  /** UTC hour (0-23, exclusive) at which prime tier ends. */
  primeEndUtcHour: number;
}

const DEFAULT_PRIME_START_UTC = 13; // 9am ET (during DST) / 8am ET (standard)
const DEFAULT_PRIME_END_UTC = 5; // 1am ET (during DST) / midnight ET (standard)
const DEFAULT_OVERNIGHT_MULTIPLIER = 4;

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const rounded = Math.trunc(value);
  if (rounded < min || rounded > max) return fallback;
  return rounded;
}

function clampNumber(value: number, min: number, fallback: number): number {
  if (!Number.isFinite(value) || value < min) return fallback;
  return value;
}

/**
 * Read cadence config from process.env, falling back to defaults.
 * `baseIntervalMs` must be supplied by the caller (already-validated value).
 */
export function loadAutonomyCadenceConfig(
  baseIntervalMs: number,
  env: NodeJS.ProcessEnv = process.env,
): AutonomyCadenceConfig {
  return {
    baseIntervalMs,
    overnightMultiplier: clampNumber(
      Number(env.AUTONOMY_OVERNIGHT_MULTIPLIER),
      1,
      DEFAULT_OVERNIGHT_MULTIPLIER,
    ),
    primeStartUtcHour: clampInt(
      Number(env.AUTONOMY_PRIME_START_UTC_HOUR),
      0,
      23,
      DEFAULT_PRIME_START_UTC,
    ),
    primeEndUtcHour: clampInt(
      Number(env.AUTONOMY_PRIME_END_UTC_HOUR),
      0,
      23,
      DEFAULT_PRIME_END_UTC,
    ),
  };
}

/**
 * Return true when the given UTC hour falls inside the prime window.
 * Handles wrap-around (e.g. start=13, end=5 means 13..23 ∪ 0..4).
 */
export function isPrimeHour(
  hourUtc: number,
  primeStart: number,
  primeEnd: number,
): boolean {
  if (primeStart === primeEnd) {
    // Degenerate config — treat as always-prime.
    return true;
  }
  if (primeStart < primeEnd) {
    return hourUtc >= primeStart && hourUtc < primeEnd;
  }
  // Wrap-around: prime spans midnight UTC.
  return hourUtc >= primeStart || hourUtc < primeEnd;
}

/**
 * Compute the next autonomy interval based on the current clock.
 */
export function decideAutonomyCadence(
  now: Date,
  config: AutonomyCadenceConfig,
): AutonomyCadenceDecision {
  const hourUtc = now.getUTCHours();
  const prime = isPrimeHour(hourUtc, config.primeStartUtcHour, config.primeEndUtcHour);
  if (prime) {
    return {
      tier: "prime",
      intervalMs: Math.max(1000, Math.round(config.baseIntervalMs)),
      hourUtc,
    };
  }
  const slowed = Math.round(config.baseIntervalMs * config.overnightMultiplier);
  return {
    tier: "overnight",
    intervalMs: Math.max(1000, slowed),
    hourUtc,
  };
}
