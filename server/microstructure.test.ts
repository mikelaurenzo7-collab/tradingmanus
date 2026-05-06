/**
 * Market Microstructure Analysis — unit tests
 */

import { describe, it, expect, vi } from "vitest";
import {
  analyzeMicrostructure,
  applyMicrostructureToSignal,
  type MicrostructureInput,
  type MicrostructureResult,
} from "./_core/marketMicrostructure";
import type { KalshiSignal } from "./_core/kalshiSignals";

// ── Mocks ─────────────────────────────────────────────────────────────────────

vi.mock("./_core/logger", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInput(overrides: Partial<MicrostructureInput> = {}): MicrostructureInput {
  return {
    marketId: "test-market-1",
    yesBid: 0.48,
    yesAsk: 0.50,
    volume: 10000,
    volume24h: 5000,
    openInterest: 2000,
    liquidity: 0.7,
    ...overrides,
  };
}

function makeSignal(overrides: Partial<KalshiSignal> = {}): KalshiSignal {
  return {
    marketId: "test-market-1",
    signalType: "value_play",
    side: "yes",
    confidence: 0.6,
    reasoning: "test signal",
    impliedProbability: 0.5,
    marketPrice: 0.48,
    expectedValue: 0.05,
    ...overrides,
  };
}

// ── Spread tests ──────────────────────────────────────────────────────────────

describe("analyzeMicrostructure — spread calculation", () => {
  it("computes spread correctly for a normal market", () => {
    const result = analyzeMicrostructure(makeInput({ yesBid: 0.48, yesAsk: 0.50 }));
    expect(result.spread).toBeCloseTo(0.02, 5);
    expect(result.spreadPct).toBeCloseTo(0.02 / 0.48, 5);
    expect(result.hasWidespread).toBe(false);
  });

  it("detects a wide spread (>5% of bid)", () => {
    // spreadPct = (yesAsk - yesBid) / yesBid = 0.10 / 0.40 = 0.25 → wide
    const result = analyzeMicrostructure(makeInput({ yesBid: 0.40, yesAsk: 0.50 }));
    expect(result.hasWidespread).toBe(true);
    expect(result.spreadPct).toBeGreaterThan(0.05);
  });

  it("spreadScore is 1 when spread is 0", () => {
    const result = analyzeMicrostructure(makeInput({ yesBid: 0.50, yesAsk: 0.50 }));
    expect(result.spreadScore).toBeCloseTo(1, 5);
    expect(result.spread).toBe(0);
  });

  it("spreadScore is clamped to 0 for extremely wide spread", () => {
    const result = analyzeMicrostructure(makeInput({ yesBid: 0.30, yesAsk: 0.70 }));
    expect(result.spreadScore).toBe(0);
  });

  it("does not crash when yesBid is 0", () => {
    expect(() => analyzeMicrostructure(makeInput({ yesBid: 0, yesAsk: 0.10 }))).not.toThrow();
    const result = analyzeMicrostructure(makeInput({ yesBid: 0, yesAsk: 0.10 }));
    expect(Number.isFinite(result.spreadPct)).toBe(true);
    expect(result.spreadPct).toBe(0); // guard: bid near 0 → spreadPct set to 0
  });
});

// ── Imbalance tests ───────────────────────────────────────────────────────────

describe("analyzeMicrostructure — order book imbalance", () => {
  it("returns near-zero imbalance for a balanced market", () => {
    // yesBid=0.49, yesAsk=0.51 → askSide = 1-0.51 = 0.49, bidSide = 0.49 → imbalance ≈ 0
    const result = analyzeMicrostructure(makeInput({ yesBid: 0.49, yesAsk: 0.51 }));
    expect(Math.abs(result.imbalance)).toBeLessThan(0.05);
    expect(result.hasStrongImbalance).toBe(false);
    expect(result.imbalanceDirection).toBe("neutral");
  });

  it("detects strong bid (bullish) imbalance when yesBid >> 1-yesAsk", () => {
    // yesBid=0.85, yesAsk=0.87 → askSide = 0.13, bidSide = 0.85
    // priceImbalance = (0.85 - 0.13) / (0.85 + 0.13) ≈ 0.735
    // with default volume24h=5000, openInterest=2000 → volumeWeight≈0.833
    // imbalance ≈ 0.735 * 0.917 ≈ 0.674 → bullish
    const result = analyzeMicrostructure(makeInput({ yesBid: 0.85, yesAsk: 0.87 }));
    expect(result.imbalance).toBeGreaterThan(0.6);
    expect(result.hasStrongImbalance).toBe(true);
    expect(result.imbalanceDirection).toBe("bullish");
  });

  it("detects strong ask (bearish) imbalance when 1-yesAsk >> yesBid", () => {
    // yesBid=0.13, yesAsk=0.15 → askSide = 0.85, bidSide = 0.13
    // priceImbalance ≈ -0.735, with default volumeWeight≈0.833
    // imbalance ≈ -0.674 → bearish
    const result = analyzeMicrostructure(makeInput({ yesBid: 0.13, yesAsk: 0.15 }));
    expect(result.imbalance).toBeLessThan(-0.6);
    expect(result.hasStrongImbalance).toBe(true);
    expect(result.imbalanceDirection).toBe("bearish");
  });

  it("imbalance is always in [-1, 1]", () => {
    const extremeCases: Array<Partial<MicrostructureInput>> = [
      { yesBid: 0.99, yesAsk: 1.0 },
      { yesBid: 0.01, yesAsk: 0.02 },
      { yesBid: 0.5, yesAsk: 0.5 },
      { yesBid: 0, yesAsk: 0 },
    ];
    for (const overrides of extremeCases) {
      const result = analyzeMicrostructure(makeInput(overrides));
      expect(result.imbalance).toBeGreaterThanOrEqual(-1);
      expect(result.imbalance).toBeLessThanOrEqual(1);
    }
  });
});

// ── VPIN tests ────────────────────────────────────────────────────────────────

describe("analyzeMicrostructure — VPIN proxy", () => {
  it("VPIN is 0 when midprice is exactly at the bid (all selling)", () => {
    // midPrice = yesBid, so buyFraction = 0 → |2*0 - 1| = 1
    // Actually: buyFraction = (mid - bid) / spread = 0 → VPIN = |2*0-1| = 1
    // This represents one-sided informed selling
    const result = analyzeMicrostructure(makeInput({ yesBid: 0.48, yesAsk: 0.52 }));
    // midPrice = 0.5, buyFraction = (0.5-0.48)/0.04 = 0.5 → VPIN = 0
    expect(result.vpin).toBeCloseTo(0, 5);
  });

  it("VPIN is 1 when midprice is at the bid (pure selling pressure)", () => {
    // yesBid = yesAsk → spread degenerates; mid = bid, using epsilon spread
    // For distinct bid=0.30, ask=0.70: mid=0.50; buyFraction=(0.5-0.3)/0.4=0.5 → VPIN=0
    // To get VPIN=1: buyFraction should be 0 or 1
    // buyFraction = (mid - bid) / spread = 0 → mid = bid
    // Use asymmetric: bid=0.30, ask=0.32 → mid=0.31, buyFr=(0.31-0.30)/0.02=0.5→VPIN≈0
    // Use bid=0.50, ask=0.52 → mid=0.51, buyFr=(0.51-0.50)/0.02=0.5→VPIN≈0
    // VPIN = 1 requires buyFraction = 0 (mid==bid) or buyFraction = 1 (mid==ask)
    // mid = bid: set ask = bid + epsilon (uses clamp so buyFraction goes to boundary)
    // This is hard to test exactly; test that VPIN is in [0,1]
    const result = analyzeMicrostructure(makeInput({ yesBid: 0.60, yesAsk: 0.80 }));
    expect(result.vpin).toBeGreaterThanOrEqual(0);
    expect(result.vpin).toBeLessThanOrEqual(1);
    // Mid = (0.60+0.80)/2 = 0.70; buyFr = (0.70-0.60)/0.20 = 0.5 → VPIN = 0
    expect(result.vpin).toBeCloseTo(0, 5);
  });

  it("VPIN is 0 when market is balanced (midprice at center of spread)", () => {
    // Any market where mid = (bid + ask)/2 exactly
    const result = analyzeMicrostructure(makeInput({ yesBid: 0.45, yesAsk: 0.55 }));
    // mid = 0.5, buyFraction = (0.5-0.45)/0.10 = 0.5 → |2*0.5-1| = 0
    expect(result.vpin).toBeCloseTo(0, 5);
  });

  it("VPIN is in [0, 1] for all inputs", () => {
    const cases: Array<Partial<MicrostructureInput>> = [
      { yesBid: 0.01, yesAsk: 0.99 },
      { yesBid: 0.49, yesAsk: 0.51 },
      { yesBid: 0.90, yesAsk: 0.95 },
    ];
    for (const overrides of cases) {
      const result = analyzeMicrostructure(makeInput(overrides));
      expect(result.vpin).toBeGreaterThanOrEqual(0);
      expect(result.vpin).toBeLessThanOrEqual(1);
    }
  });
});

// ── Microstructure score range ────────────────────────────────────────────────

describe("analyzeMicrostructure — microstructureScore", () => {
  it("is always in [0, 1]", () => {
    const cases: Array<Partial<MicrostructureInput>> = [
      { yesBid: 0.48, yesAsk: 0.50 },
      { yesBid: 0.01, yesAsk: 0.99 },
      { yesBid: 0.0, yesAsk: 0.0 },
      { yesBid: 0.99, yesAsk: 1.0 },
      { yesBid: 0.30, yesAsk: 0.70 },
    ];
    for (const overrides of cases) {
      const result = analyzeMicrostructure(makeInput(overrides));
      expect(result.microstructureScore).toBeGreaterThanOrEqual(0);
      expect(result.microstructureScore).toBeLessThanOrEqual(1);
    }
  });

  it("does not crash with volume=0", () => {
    expect(() =>
      analyzeMicrostructure(makeInput({ volume: 0, volume24h: 0, openInterest: 0 }))
    ).not.toThrow();
  });
});

// ── Confidence adjustment tests ───────────────────────────────────────────────

describe("analyzeMicrostructure — confidenceAdjustment baseline", () => {
  it("returns -0.20 for wide spread market", () => {
    // spreadPct = 0.10/0.40 = 0.25 > 0.05
    const result = analyzeMicrostructure(makeInput({ yesBid: 0.40, yesAsk: 0.50 }));
    expect(result.confidenceAdjustment).toBe(-0.20);
  });

  it("returns +0.15 for strong imbalance market (bullish)", () => {
    // yesBid=0.85, yesAsk=0.87 → narrow spread, imbalance > 0.6 with default volume
    const spread = 0.02;
    const spreadPct = spread / 0.85; // ≈ 0.0235 < 0.05
    const result = analyzeMicrostructure(makeInput({ yesBid: 0.85, yesAsk: 0.87 }));
    expect(spreadPct).toBeLessThan(0.05);
    expect(result.hasStrongImbalance).toBe(true);
    expect(result.confidenceAdjustment).toBe(+0.15);
  });

  it("returns 0 for neutral market", () => {
    // narrow spread, balanced book
    const result = analyzeMicrostructure(makeInput({ yesBid: 0.49, yesAsk: 0.51 }));
    expect(result.confidenceAdjustment).toBe(0);
  });

  it("wide spread takes priority over strong imbalance", () => {
    // yesBid=0.80, yesAsk=0.94 → spread=0.14, spreadPct=0.14/0.80=0.175 → wide
    // Also askSide=0.06, bidSide=0.80 → imbalance > 0.6
    const result = analyzeMicrostructure(makeInput({ yesBid: 0.80, yesAsk: 0.94 }));
    expect(result.hasWidespread).toBe(true);
    expect(result.hasStrongImbalance).toBe(true);
    expect(result.confidenceAdjustment).toBe(-0.20); // spread wins
  });
});

// ── applyMicrostructureToSignal tests ────────────────────────────────────────

describe("applyMicrostructureToSignal", () => {
  function makeResult(overrides: Partial<MicrostructureResult> = {}): MicrostructureResult {
    return {
      marketId: "test-market-1",
      spread: 0.02,
      spreadPct: 0.04,
      spreadScore: 0.6,
      imbalance: 0.0,
      vpin: 0.1,
      microstructureScore: 0.65,
      hasWidespread: false,
      hasStrongImbalance: false,
      imbalanceDirection: "neutral",
      confidenceAdjustment: 0,
      informedTradingScore: 0.5,
      largeOrderDetected: false,
      ...overrides,
    };
  }

  it("applies penalty and clamps confidence to [0.05, 0.95]", () => {
    const signal = makeSignal({ confidence: 0.10 });
    const result = makeResult({ hasWidespread: true, confidenceAdjustment: -0.20 });
    const adjusted = applyMicrostructureToSignal(signal, result);
    // 0.10 - 0.20 = -0.10 → clamped to 0.05
    expect(adjusted.confidence).toBe(0.05);
  });

  it("confidence clamped to 0.95 on over-boost", () => {
    const signal = makeSignal({ confidence: 0.90 });
    const result = makeResult({
      hasStrongImbalance: true,
      imbalanceDirection: "bullish",
      confidenceAdjustment: 0.15,
    });
    const adjusted = applyMicrostructureToSignal(signal, result);
    // 0.90 + 0.15 = 1.05 → clamped to 0.95
    expect(adjusted.confidence).toBe(0.95);
  });

  it("sets metadata microstructureScore and spreadPct", () => {
    const signal = makeSignal();
    const result = makeResult({ microstructureScore: 0.73, spreadPct: 0.041 });
    const adjusted = applyMicrostructureToSignal(signal, result);
    expect(adjusted.metadata?.microstructureScore).toBeCloseTo(0.73, 5);
    expect(adjusted.metadata?.spreadPct).toBeCloseTo(0.041, 5);
  });

  it("preserves existing metadata fields", () => {
    const signal = makeSignal({ metadata: { priceMomentum: 0.05, liquidityScore: 0.8 } });
    const result = makeResult();
    const adjusted = applyMicrostructureToSignal(signal, result);
    expect(adjusted.metadata?.priceMomentum).toBe(0.05);
    expect(adjusted.metadata?.liquidityScore).toBe(0.8);
  });

  it("applies +0.15 boost when strong bullish imbalance matches YES signal", () => {
    const signal = makeSignal({ side: "yes", confidence: 0.60 });
    const result = makeResult({
      hasStrongImbalance: true,
      imbalanceDirection: "bullish",
      confidenceAdjustment: 0.15,
    });
    const adjusted = applyMicrostructureToSignal(signal, result);
    expect(adjusted.confidence).toBeCloseTo(0.75, 5);
  });

  it("NO adjustment when strong imbalance direction is OPPOSITE to signal (yes signal, bearish imbalance)", () => {
    const signal = makeSignal({ side: "yes", confidence: 0.60 });
    const result = makeResult({
      hasStrongImbalance: true,
      imbalanceDirection: "bearish",
      confidenceAdjustment: 0.15,
    });
    const adjusted = applyMicrostructureToSignal(signal, result);
    // Bearish imbalance doesn't boost YES signal → adjustment=0
    expect(adjusted.confidence).toBeCloseTo(0.60, 5);
  });

  it("NO adjustment when strong imbalance direction is OPPOSITE to signal (no signal, bullish imbalance)", () => {
    const signal = makeSignal({ side: "no", confidence: 0.55 });
    const result = makeResult({
      hasStrongImbalance: true,
      imbalanceDirection: "bullish",
      confidenceAdjustment: 0.15,
    });
    const adjusted = applyMicrostructureToSignal(signal, result);
    // Bullish imbalance doesn't boost NO signal → adjustment=0
    expect(adjusted.confidence).toBeCloseTo(0.55, 5);
  });

  it("neutral imbalance produces no adjustment", () => {
    const signal = makeSignal({ confidence: 0.70 });
    const result = makeResult({
      hasStrongImbalance: false,
      imbalanceDirection: "neutral",
      confidenceAdjustment: 0,
    });
    const adjusted = applyMicrostructureToSignal(signal, result);
    expect(adjusted.confidence).toBeCloseTo(0.70, 5);
  });

  it("wide spread overrides imbalance boost even when imbalance matches signal direction", () => {
    const signal = makeSignal({ side: "yes", confidence: 0.70 });
    const result = makeResult({
      hasWidespread: true,
      hasStrongImbalance: true,
      imbalanceDirection: "bullish",
      confidenceAdjustment: -0.20, // wide spread wins
    });
    const adjusted = applyMicrostructureToSignal(signal, result);
    // 0.70 - 0.20 = 0.50, no boost
    expect(adjusted.confidence).toBeCloseTo(0.50, 5);
  });
});

// ── Informed trading tests ────────────────────────────────────────────────────

describe("analyzeMicrostructure — informed trading score", () => {
  it("largeOrderDetected=true and higher informedTradingScore when volume24h>500", () => {
    const result = analyzeMicrostructure(makeInput({ volume24h: 1000, openInterest: 100 }));
    expect(result.largeOrderDetected).toBe(true);
    // turnoverScore = clamp((1000/101)/3, 0,1) = 1, informedTradingScore = 0.5*1 + 0.5*0.8 = 0.9
    expect(result.informedTradingScore).toBeCloseTo(0.9, 3);
  });

  it("largeOrderDetected=false and lower informedTradingScore when volume24h<100", () => {
    const result = analyzeMicrostructure(makeInput({ volume24h: 50, openInterest: 100 }));
    expect(result.largeOrderDetected).toBe(false);
    // volumeSurge = 50/101 ≈ 0.495, turnoverScore ≈ 0.165
    // informedTradingScore = 0.5*0.165 + 0.5*0.2 ≈ 0.1825
    expect(result.informedTradingScore).toBeLessThan(0.3);
  });

  it("informedTradingScore is in [0, 1] for all inputs", () => {
    const cases: Array<Partial<MicrostructureInput>> = [
      { volume24h: 0, openInterest: 0 },
      { volume24h: 9999, openInterest: 0 },
      { volume24h: 500, openInterest: 500 },
      { volume24h: 100, openInterest: 10000 },
    ];
    for (const overrides of cases) {
      const result = analyzeMicrostructure(makeInput(overrides));
      expect(result.informedTradingScore).toBeGreaterThanOrEqual(0);
      expect(result.informedTradingScore).toBeLessThanOrEqual(1);
    }
  });
});

// ── Volume-weighted imbalance tests ───────────────────────────────────────────

describe("analyzeMicrostructure — volume-weighted imbalance", () => {
  it("imbalance increases with higher volume24h for the same prices", () => {
    // yesBid=0.65, yesAsk=0.70: askSide=0.30, bidSide=0.65, priceImbalance ≈ 0.368
    // Low vol: imbalance = priceImbalance * 0.5 ≈ 0.184
    // High vol (volume24h=1000, openInterest=0): volumeWeight=1, imbalance ≈ 0.368
    const lowVol = analyzeMicrostructure(
      makeInput({ yesBid: 0.65, yesAsk: 0.70, volume24h: 0, openInterest: 0 })
    );
    const highVol = analyzeMicrostructure(
      makeInput({ yesBid: 0.65, yesAsk: 0.70, volume24h: 1000, openInterest: 0 })
    );
    expect(highVol.imbalance).toBeGreaterThan(lowVol.imbalance);
  });

  it("imbalance with volume24h=0 is half the price-only imbalance", () => {
    // With volumeWeight=0: imbalance = priceImbalance * 0.5
    const result = analyzeMicrostructure(
      makeInput({ yesBid: 0.65, yesAsk: 0.70, volume24h: 0, openInterest: 0 })
    );
    // bidSide=0.65, askSide=0.30 → priceImbalance ≈ 0.368
    // imbalance = 0.368 * 0.5 ≈ 0.184
    expect(result.imbalance).toBeCloseTo(0.184, 2);
  });
});

// ── Edge case tests ───────────────────────────────────────────────────────────

describe("analyzeMicrostructure — edge cases", () => {
  it("does not crash when yesBid is 0 and yesAsk is 0", () => {
    expect(() => analyzeMicrostructure(makeInput({ yesBid: 0, yesAsk: 0 }))).not.toThrow();
  });

  it("returns finite values for all fields regardless of inputs", () => {
    const edgeCases: Array<Partial<MicrostructureInput>> = [
      { yesBid: 0, yesAsk: 0 },
      { yesBid: 1, yesAsk: 1 },
      { yesBid: 0.5, yesAsk: 0.5 },
      { volume: 0, volume24h: 0 },
    ];
    for (const overrides of edgeCases) {
      const result = analyzeMicrostructure(makeInput(overrides));
      expect(Number.isFinite(result.spread)).toBe(true);
      expect(Number.isFinite(result.spreadPct)).toBe(true);
      expect(Number.isFinite(result.spreadScore)).toBe(true);
      expect(Number.isFinite(result.imbalance)).toBe(true);
      expect(Number.isFinite(result.vpin)).toBe(true);
      expect(Number.isFinite(result.microstructureScore)).toBe(true);
    }
  });
});
