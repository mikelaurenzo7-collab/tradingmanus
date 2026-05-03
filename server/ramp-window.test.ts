import { describe, it, expect } from "vitest";
import { applyRampWindowCap, isInRampWindow } from "./_core/rampWindow";

const hoursAgo = (h: number) => new Date(Date.now() - h * 60 * 60 * 1000);

describe("isInRampWindow", () => {
  it("returns true when liveStartedAt is recent", () => {
    expect(isInRampWindow(hoursAgo(1), 72)).toBe(true);
  });

  it("returns false when liveStartedAt is past window", () => {
    expect(isInRampWindow(hoursAgo(73), 72)).toBe(false);
  });

  it("returns false when liveStartedAt is null", () => {
    expect(isInRampWindow(null, 72)).toBe(false);
  });
});

describe("applyRampWindowCap", () => {
  it("clamps size during ramp window", () => {
    const result = applyRampWindowCap({
      intendedSize: 20,
      intendedMaxDayLoss: 10,
      liveStartedAt: hoursAgo(1),
      rampWindowHours: 72,
      rampSizeMultiplier: 0.25,
    });
    expect(result.cappedSize).toBe(5);       // floor(20 * 0.25)
    expect(result.cappedMaxDayLoss).toBe(2); // floor(10 * 0.25)
    expect(result.rampActive).toBe(true);
  });

  it("does not clamp after ramp window expires", () => {
    const result = applyRampWindowCap({
      intendedSize: 20,
      intendedMaxDayLoss: 10,
      liveStartedAt: hoursAgo(73),
      rampWindowHours: 72,
      rampSizeMultiplier: 0.25,
    });
    expect(result.cappedSize).toBe(20);
    expect(result.rampActive).toBe(false);
  });

  it("does not clamp when liveStartedAt is null", () => {
    const result = applyRampWindowCap({
      intendedSize: 20,
      intendedMaxDayLoss: 10,
      liveStartedAt: null,
      rampWindowHours: 72,
      rampSizeMultiplier: 0.25,
    });
    expect(result.cappedSize).toBe(20);
    expect(result.rampActive).toBe(false);
  });
});
