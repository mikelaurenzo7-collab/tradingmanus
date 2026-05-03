import { describe, it, expect } from "vitest";
import { simulatePaperFill } from "./_core/paperSimulator";

describe("simulatePaperFill", () => {
  it("fills a buy order at ask price", () => {
    const fill = simulatePaperFill({ side: "yes", action: "buy", askPrice: 0.55, bidPrice: 0.53, quantity: 5 });
    expect(fill.fillPrice).toBe(0.55);
    expect(fill.fillQuantity).toBe(5);
    expect(fill.executionMode).toBe("paper");
  });

  it("fills a sell order at bid price", () => {
    const fill = simulatePaperFill({ side: "yes", action: "sell", askPrice: 0.55, bidPrice: 0.53, quantity: 3 });
    expect(fill.fillPrice).toBe(0.53);
    expect(fill.fillQuantity).toBe(3);
  });

  it("falls back to midprice when ask/bid unavailable", () => {
    const fill = simulatePaperFill({ side: "yes", action: "buy", askPrice: 0, bidPrice: 0, quantity: 2, fallbackMidPrice: 0.50 });
    expect(fill.fillPrice).toBe(0.50);
  });

  it("falls back to limitPrice when no prices available", () => {
    const fill = simulatePaperFill({ side: "yes", action: "buy", askPrice: 0, bidPrice: 0, quantity: 2, limitPrice: 0.48 });
    expect(fill.fillPrice).toBe(0.48);
  });
});
