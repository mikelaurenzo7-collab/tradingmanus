import { describe, it, expect } from "vitest";
import {
  initializeExitStrategy,
  updateTrailingStop,
  checkExitConditions,
  calculateATR,
  applyTimeDecayToStops,
  type ExitStrategyConfig,
  type ExitStrategyState,
} from "./_core/exitStrategy";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ExitStrategyConfig> = {}): ExitStrategyConfig {
  return {
    entryPrice: 0.5,
    side: "yes",
    initialRisk: 10,
    volatility: 0.15, // normal vol (between 0.10 and 0.20)
    ...overrides,
  };
}

// ── initializeExitStrategy ───────────────────────────────────────────────────

describe("initializeExitStrategy", () => {
  it("uses INITIAL_STOP_PCT (15%) for normal volatility", () => {
    const config = makeConfig({ entryPrice: 0.5, volatility: 0.15 });
    const state = initializeExitStrategy(config);
    // stop should be entryPrice * (1 - 0.15) = 0.425
    expect(state.stopLevel).toBeCloseTo(0.425, 5);
  });

  it("uses HIGH_VOL_STOP_PCT (20%) when volatility > 0.20", () => {
    const config = makeConfig({ entryPrice: 0.5, volatility: 0.25 });
    const state = initializeExitStrategy(config);
    // stop: 0.5 * (1 - 0.20) = 0.40
    expect(state.stopLevel).toBeCloseTo(0.40, 5);
  });

  it("uses LOW_VOL_STOP_PCT (10%) when volatility < 0.10", () => {
    const config = makeConfig({ entryPrice: 0.5, volatility: 0.05 });
    const state = initializeExitStrategy(config);
    // stop: 0.5 * (1 - 0.10) = 0.45
    expect(state.stopLevel).toBeCloseTo(0.45, 5);
  });

  it("places stop BELOW entry for 'yes' positions", () => {
    const config = makeConfig({ side: "yes", entryPrice: 0.6, volatility: 0.15 });
    const state = initializeExitStrategy(config);
    expect(state.stopLevel).toBeLessThan(config.entryPrice);
  });

  it("places stop ABOVE entry for 'no' positions", () => {
    const config = makeConfig({ side: "no", entryPrice: 0.4, volatility: 0.15 });
    const state = initializeExitStrategy(config);
    expect(state.stopLevel).toBeGreaterThan(config.entryPrice);
  });

  it("sets profit targets at 1x, 2x, 3x risk for 'yes'", () => {
    const config = makeConfig({ entryPrice: 0.5, volatility: 0.15 }); // stopPct = 0.15
    const state = initializeExitStrategy(config);
    expect(state.profitTargets[0]).toBeCloseTo(0.5 * (1 + 1 * 0.15), 5); // 0.575
    expect(state.profitTargets[1]).toBeCloseTo(0.5 * (1 + 2 * 0.15), 5); // 0.65
    expect(state.profitTargets[2]).toBeCloseTo(0.5 * (1 + 3 * 0.15), 5); // 0.725
  });

  it("sets profit targets BELOW entry for 'no'", () => {
    const config = makeConfig({ side: "no", entryPrice: 0.5, volatility: 0.15 });
    const state = initializeExitStrategy(config);
    for (const target of state.profitTargets) {
      expect(target).toBeLessThan(config.entryPrice);
    }
  });

  it("initializes highWaterMark to entry price", () => {
    const config = makeConfig({ entryPrice: 0.55 });
    const state = initializeExitStrategy(config);
    expect(state.highWaterMark).toBe(0.55);
  });

  it("initializes hitTargets to empty array", () => {
    const state = initializeExitStrategy(makeConfig());
    expect(state.hitTargets).toEqual([]);
  });

  it("clamps extreme entry prices to [0.02, 0.98]", () => {
    const high = initializeExitStrategy(makeConfig({ entryPrice: 0.98, side: "yes", volatility: 0.25 }));
    expect(high.profitTargets[0]).toBeLessThanOrEqual(0.98);
    const low = initializeExitStrategy(makeConfig({ entryPrice: 0.02, side: "no", volatility: 0.25 }));
    expect(low.stopLevel).toBeGreaterThanOrEqual(0.02);
  });
});

// ── updateTrailingStop ───────────────────────────────────────────────────────

describe("updateTrailingStop", () => {
  function makeYesState(entry = 0.5): ExitStrategyState {
    return initializeExitStrategy(makeConfig({ entryPrice: entry, side: "yes", volatility: 0.15 }));
  }

  it("updates HWM when price rises for 'yes'", () => {
    const state = makeYesState(0.5);
    const updated = updateTrailingStop(state, 0.65, 0.02, "yes");
    expect(updated.highWaterMark).toBeCloseTo(0.65, 5);
  });

  it("tightens trailing stop as price rises for 'yes'", () => {
    const state = makeYesState(0.5);
    const atr = 0.02;
    const updated = updateTrailingStop(state, 0.65, atr, "yes");
    // new trailing = 0.65 - 3 * 0.02 = 0.59
    expect(updated.trailingStop).toBeCloseTo(0.59, 5);
    expect(updated.trailingStop).toBeGreaterThan(state.trailingStop);
  });

  it("does not lower HWM when price falls for 'yes'", () => {
    const state = makeYesState(0.5);
    const updated = updateTrailingStop(state, 0.45, 0.02, "yes");
    expect(updated.highWaterMark).toBe(0.5); // unchanged
  });

  it("trailing stop never moves down for 'yes' when price drops", () => {
    const state = makeYesState(0.5);
    const updated = updateTrailingStop(state, 0.45, 0.02, "yes");
    expect(updated.trailingStop).toBe(state.trailingStop); // never worsens
  });

  it("updates HWM when price falls for 'no'", () => {
    const config = makeConfig({ side: "no", entryPrice: 0.5, volatility: 0.15 });
    const state = initializeExitStrategy(config);
    const updated = updateTrailingStop(state, 0.35, 0.02, "no");
    expect(updated.highWaterMark).toBeCloseTo(0.35, 5);
  });

  it("ratchets trailing stop correctly even after HWM moves past first profit target (yes)", () => {
    // Regression test: previously updateTrailingStop inferred side from
    // profitTargets[0] vs highWaterMark, which flips once HWM > target.
    const state = makeYesState(0.5);
    // Step 1: price rises to 0.65 → HWM=0.65, well above target_1 (0.575)
    const afterRise = updateTrailingStop(state, 0.65, 0.02, "yes");
    // Step 2: price retraces to 0.55 → HWM must NOT regress
    const afterRetrace = updateTrailingStop(afterRise, 0.55, 0.02, "yes");
    expect(afterRetrace.highWaterMark).toBeCloseTo(0.65, 5);
    expect(afterRetrace.trailingStop).toBe(afterRise.trailingStop); // never worsens
  });
});

// ── calculateATR ─────────────────────────────────────────────────────────────

describe("calculateATR", () => {
  it("returns 0.01 for empty array", () => {
    expect(calculateATR([])).toBe(0.01);
  });

  it("returns 0.01 for single price", () => {
    expect(calculateATR([0.5])).toBe(0.01);
  });

  it("computes mean of consecutive ranges", () => {
    // ranges: |0.55-0.5|=0.05, |0.6-0.55|=0.05 → mean = 0.05
    expect(calculateATR([0.5, 0.55, 0.6])).toBeCloseTo(0.05, 5);
  });

  it("handles non-monotonic sequences", () => {
    // ranges: |0.4-0.5|=0.10, |0.6-0.4|=0.20 → mean = 0.15
    expect(calculateATR([0.5, 0.4, 0.6])).toBeCloseTo(0.15, 5);
  });
});

// ── checkExitConditions ──────────────────────────────────────────────────────

describe("checkExitConditions", () => {
  it("triggers stop_loss when price falls to stop level for 'yes'", () => {
    const config = makeConfig({ entryPrice: 0.5, volatility: 0.15 });
    const state = initializeExitStrategy(config); // stop = 0.425
    const decision = checkExitConditions(state, 0.42, config);
    expect(decision.shouldExit).toBe(true);
    expect(decision.reason).toBe("stop_loss");
  });

  it("triggers trailing_stop when price falls to trailing stop (above hard stop)", () => {
    const config = makeConfig({ entryPrice: 0.5, volatility: 0.15 });
    const state = initializeExitStrategy(config);
    // Push trailing stop up: price rose to 0.65 with atr=0.02 → trailing = 0.59
    const updated = updateTrailingStop(state, 0.65, 0.02, "yes");
    // Price drops to 0.58 (below trailing 0.59, above hard stop 0.425)
    const decision = checkExitConditions(updated, 0.58, config);
    expect(decision.shouldExit).toBe(true);
    expect(decision.reason).toBe("trailing_stop");
  });

  it("triggers profit_target_1 when first target is reached", () => {
    const config = makeConfig({ entryPrice: 0.5, volatility: 0.15 });
    const state = initializeExitStrategy(config);
    // target 1 = 0.575
    const decision = checkExitConditions(state, 0.58, config);
    expect(decision.shouldExit).toBe(true);
    expect(decision.reason).toBe("profit_target_1");
    expect(decision.targetIndex).toBe(1);
  });

  it("triggers profit_target_2 on next check after target_1 already hit", () => {
    const config = makeConfig({ entryPrice: 0.5, volatility: 0.15 });
    const state = initializeExitStrategy(config);
    const stateAfterT1: ExitStrategyState = { ...state, hitTargets: [0] }; // target 0 already hit
    // target 2 = 0.65
    const decision = checkExitConditions(stateAfterT1, 0.66, config);
    expect(decision.shouldExit).toBe(true);
    expect(decision.reason).toBe("profit_target_2");
    expect(decision.targetIndex).toBe(2);
  });

  it("returns no exit when price is in normal range", () => {
    const config = makeConfig({ entryPrice: 0.5, volatility: 0.15 });
    const state = initializeExitStrategy(config); // stop ~0.425, t1 ~0.575
    const decision = checkExitConditions(state, 0.52, config);
    expect(decision.shouldExit).toBe(false);
    expect(decision.reason).toBeUndefined();
  });

  it("stop_loss takes priority over trailing_stop", () => {
    const config = makeConfig({ entryPrice: 0.5, volatility: 0.15 });
    // Set trailing stop higher than hard stop, price hits both
    const state: ExitStrategyState = {
      ...initializeExitStrategy(config),
      trailingStop: 0.44, // above hard stop 0.425
    };
    // Price at 0.42 — hits both hard stop (0.425) and trailing (0.44)
    const decision = checkExitConditions(state, 0.42, config);
    expect(decision.reason).toBe("stop_loss");
  });

  it("triggers stop_loss for 'no' when price rises to stop level", () => {
    const config = makeConfig({ side: "no", entryPrice: 0.5, volatility: 0.15 });
    const state = initializeExitStrategy(config); // stop = 0.575
    const decision = checkExitConditions(state, 0.58, config);
    expect(decision.shouldExit).toBe(true);
    expect(decision.reason).toBe("stop_loss");
  });
});

// ── applyTimeDecayToStops ────────────────────────────────────────────────────

describe("applyTimeDecayToStops", () => {
  it("returns state unchanged when no resolutionDate provided", () => {
    const config = makeConfig({ resolutionDate: undefined });
    const state = initializeExitStrategy(config);
    const updated = applyTimeDecayToStops(state, config, new Date());
    expect(updated.stopLevel).toBe(state.stopLevel);
  });

  it("returns state unchanged when >24h remain", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const resolution = new Date("2026-01-03T00:00:00Z"); // 48h ahead
    const config = makeConfig({ resolutionDate: resolution });
    const state = initializeExitStrategy(config);
    const updated = applyTimeDecayToStops(state, config, now);
    expect(updated.stopLevel).toBe(state.stopLevel);
  });

  it("tightens stop when <24h remain for 'yes'", () => {
    // 12h before resolution → tightenPct = (1 - 12/24) * 0.5 = 0.25
    const now = new Date("2026-01-01T00:00:00Z");
    const resolution = new Date("2026-01-01T12:00:00Z"); // 12h ahead
    const config = makeConfig({ entryPrice: 0.5, side: "yes", volatility: 0.15, resolutionDate: resolution });
    const state = initializeExitStrategy(config); // stop ~ 0.425
    const updated = applyTimeDecayToStops(state, config, now);
    expect(updated.stopLevel).toBeGreaterThan(state.stopLevel); // tighter (higher) for yes
    expect(updated.stopLevel).toBeLessThan(config.entryPrice);  // still below entry
  });

  it("tightens stop when <24h remain for 'no'", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const resolution = new Date("2026-01-01T12:00:00Z");
    const config = makeConfig({ entryPrice: 0.5, side: "no", volatility: 0.15, resolutionDate: resolution });
    const state = initializeExitStrategy(config); // stop ~ 0.575
    const updated = applyTimeDecayToStops(state, config, now);
    expect(updated.stopLevel).toBeLessThan(state.stopLevel);    // tighter (lower) for no
    expect(updated.stopLevel).toBeGreaterThan(config.entryPrice); // still above entry
  });

  it("stop is clamped to [0.02, 0.98]", () => {
    const now = new Date("2026-01-01T00:00:00Z");
    const resolution = new Date("2026-01-01T00:01:00Z"); // nearly expired
    const config = makeConfig({ entryPrice: 0.98, side: "yes", volatility: 0.15, resolutionDate: resolution });
    const state = initializeExitStrategy(config);
    const updated = applyTimeDecayToStops(state, config, now);
    expect(updated.stopLevel).toBeLessThanOrEqual(0.98);
    expect(updated.stopLevel).toBeGreaterThanOrEqual(0.02);
  });
});
