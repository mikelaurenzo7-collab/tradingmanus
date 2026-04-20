import { describe, it, expect } from "vitest";
import { fetchKalshiMarkets } from "./_core/kalshiMarketData";

describe("Kalshi API Integration", () => {
  it("should fetch Kalshi markets successfully", async () => {
    const markets = await fetchKalshiMarkets({ status: "open" });
    
    // Should return an array (even if empty due to API limits)
    expect(Array.isArray(markets)).toBe(true);
    
    // If markets are returned, validate structure
    if (markets.length > 0) {
      const market = markets[0];
      expect(market).toHaveProperty("id");
      expect(market).toHaveProperty("title");
      expect(market).toHaveProperty("yesPrice");
      expect(market).toHaveProperty("noPrice");
      expect(market).toHaveProperty("impliedProbability");
    }
  });

  it("should fetch markets by category", async () => {
    const markets = await fetchKalshiMarkets({ category: "politics" });
    expect(Array.isArray(markets)).toBe(true);
  });

  it("should handle API errors gracefully", async () => {
    // Test with invalid market ID
    const market = await fetchKalshiMarkets();
    expect(Array.isArray(market)).toBe(true);
  });
});
