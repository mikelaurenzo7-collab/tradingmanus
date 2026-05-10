import { describe, expect, it } from "vitest";
import {
  decideAutonomyCadence,
  isPrimeHour,
  loadAutonomyCadenceConfig,
} from "./_core/autonomyCadence";

describe("autonomyCadence", () => {
  describe("isPrimeHour", () => {
    it("treats prime as inclusive of start, exclusive of end (no wrap)", () => {
      expect(isPrimeHour(9, 9, 17)).toBe(true);
      expect(isPrimeHour(16, 9, 17)).toBe(true);
      expect(isPrimeHour(17, 9, 17)).toBe(false);
      expect(isPrimeHour(8, 9, 17)).toBe(false);
    });

    it("handles wrap-around (start > end means crosses UTC midnight)", () => {
      // Prime 13..04 UTC means 13..23 OR 0..3
      expect(isPrimeHour(13, 13, 4)).toBe(true);
      expect(isPrimeHour(23, 13, 4)).toBe(true);
      expect(isPrimeHour(0, 13, 4)).toBe(true);
      expect(isPrimeHour(3, 13, 4)).toBe(true);
      expect(isPrimeHour(4, 13, 4)).toBe(false);
      expect(isPrimeHour(8, 13, 4)).toBe(false);
      expect(isPrimeHour(12, 13, 4)).toBe(false);
    });

    it("treats start==end as always-prime (degenerate config)", () => {
      expect(isPrimeHour(0, 5, 5)).toBe(true);
      expect(isPrimeHour(23, 5, 5)).toBe(true);
    });
  });

  describe("decideAutonomyCadence", () => {
    const baseConfig = {
      baseIntervalMs: 10 * 60 * 1000,
      overnightMultiplier: 4,
      primeStartUtcHour: 13,
      primeEndUtcHour: 5,
    };

    it("returns base interval during prime hours", () => {
      // 18:00 UTC = 2pm ET (peak US trading window)
      const result = decideAutonomyCadence(new Date("2026-05-10T18:00:00Z"), baseConfig);
      expect(result.tier).toBe("prime");
      expect(result.intervalMs).toBe(10 * 60 * 1000);
    });

    it("slows by multiplier during overnight hours", () => {
      // 09:00 UTC = 5am ET (deep overnight, almost-empty order books)
      const result = decideAutonomyCadence(new Date("2026-05-10T09:00:00Z"), baseConfig);
      expect(result.tier).toBe("overnight");
      expect(result.intervalMs).toBe(40 * 60 * 1000);
    });

    it("treats post-midnight ET as still-prime when within wrap window", () => {
      // 03:00 UTC = 11pm ET (late night but still active)
      const result = decideAutonomyCadence(new Date("2026-05-10T03:00:00Z"), baseConfig);
      expect(result.tier).toBe("prime");
    });

    it("never returns interval below 1 second", () => {
      const result = decideAutonomyCadence(new Date("2026-05-10T18:00:00Z"), {
        ...baseConfig,
        baseIntervalMs: 100,
      });
      expect(result.intervalMs).toBeGreaterThanOrEqual(1000);
    });

    it("includes hour for telemetry", () => {
      const result = decideAutonomyCadence(new Date("2026-05-10T18:30:00Z"), baseConfig);
      expect(result.hourUtc).toBe(18);
    });
  });

  describe("loadAutonomyCadenceConfig", () => {
    it("falls back to defaults when env unset", () => {
      const cfg = loadAutonomyCadenceConfig(60_000, {});
      expect(cfg.baseIntervalMs).toBe(60_000);
      expect(cfg.overnightMultiplier).toBe(4);
      expect(cfg.primeStartUtcHour).toBe(13);
      expect(cfg.primeEndUtcHour).toBe(5);
    });

    it("reads valid env overrides", () => {
      const cfg = loadAutonomyCadenceConfig(60_000, {
        AUTONOMY_OVERNIGHT_MULTIPLIER: "6",
        AUTONOMY_PRIME_START_UTC_HOUR: "14",
        AUTONOMY_PRIME_END_UTC_HOUR: "4",
      });
      expect(cfg.overnightMultiplier).toBe(6);
      expect(cfg.primeStartUtcHour).toBe(14);
      expect(cfg.primeEndUtcHour).toBe(4);
    });

    it("rejects multiplier < 1 (would speed up overnight, defeating the purpose)", () => {
      const cfg = loadAutonomyCadenceConfig(60_000, {
        AUTONOMY_OVERNIGHT_MULTIPLIER: "0.5",
      });
      expect(cfg.overnightMultiplier).toBe(4);
    });

    it("rejects out-of-range hours", () => {
      const cfg = loadAutonomyCadenceConfig(60_000, {
        AUTONOMY_PRIME_START_UTC_HOUR: "99",
        AUTONOMY_PRIME_END_UTC_HOUR: "-3",
      });
      expect(cfg.primeStartUtcHour).toBe(13);
      expect(cfg.primeEndUtcHour).toBe(5);
    });

    it("ignores non-numeric env values", () => {
      const cfg = loadAutonomyCadenceConfig(60_000, {
        AUTONOMY_OVERNIGHT_MULTIPLIER: "abc",
      });
      expect(cfg.overnightMultiplier).toBe(4);
    });
  });
});
