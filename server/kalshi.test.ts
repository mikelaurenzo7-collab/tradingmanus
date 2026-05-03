import { beforeEach, describe, expect, it, vi } from "vitest";
import type { KalshiMarket } from "./_core/kalshiMarketData";

vi.mock("./_core/kalshiMarketData", () => ({
  fetchKalshiMarkets: vi.fn(),
  fetchKalshiMarketDetails: vi.fn(),
  getKalshiMarketDetails: vi.fn(),
  calculateImpliedProbability: vi.fn((yes: number) => yes / 100),
}));

vi.mock("./_core/logger", () => ({
  logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
}));

import { fetchKalshiMarkets } from "./_core/kalshiMarketData";

const mockFetchKalshiMarkets = vi.mocked(fetchKalshiMarkets);

function makeMarket(overrides: Partial<KalshiMarket> = {}): KalshiMarket {
  return {
    id: "PRES-2028-DEM",
    title: "Will the Democratic nominee win the 2028 US Presidential election?",
    category: "politics",
    description: "Resolves YES if the Democratic nominee wins.",
    resolutionDate: "2028-11-05",
    status: "open",
    yesPrice: 0.42,
    noPrice: 0.58,
    yesVolume: 12345,
    noVolume: 9876,
    impliedProbability: 0.42,
    ...overrides,
  };
}

describe("Kalshi API Integration", () => {
  beforeEach(() => {
    mockFetchKalshiMarkets.mockReset();
  });

  it("returns an array with valid market structure on success", async () => {
    const market = makeMarket();
    mockFetchKalshiMarkets.mockResolvedValue([market]);

    const markets = await fetchKalshiMarkets({ status: "open" });

    expect(Array.isArray(markets)).toBe(true);
    expect(markets).toHaveLength(1);

    const m = markets[0];
    expect(m).toHaveProperty("id", "PRES-2028-DEM");
    expect(m).toHaveProperty("title");
    expect(m).toHaveProperty("yesPrice");
    expect(m).toHaveProperty("noPrice");
    expect(m).toHaveProperty("impliedProbability");
    expect(typeof m.yesPrice).toBe("number");
    expect(m.yesPrice).toBeGreaterThan(0);
    expect(m.yesPrice).toBeLessThan(1);
  });

  it("forwards the category filter to the underlying fetch", async () => {
    mockFetchKalshiMarkets.mockResolvedValue([makeMarket({ category: "politics" })]);

    const markets = await fetchKalshiMarkets({ category: "politics" });

    expect(mockFetchKalshiMarkets).toHaveBeenCalledWith({ category: "politics" });
    expect(Array.isArray(markets)).toBe(true);
    expect(markets[0].category).toBe("politics");
  });

  it("returns an empty array when the fetch resolves with no markets", async () => {
    mockFetchKalshiMarkets.mockResolvedValue([]);

    const markets = await fetchKalshiMarkets();

    expect(Array.isArray(markets)).toBe(true);
    expect(markets).toHaveLength(0);
  });

  it("propagates rejection so callers can handle API errors", async () => {
    mockFetchKalshiMarkets.mockRejectedValue(new Error("Kalshi API unavailable"));

    await expect(fetchKalshiMarkets()).rejects.toThrow("Kalshi API unavailable");
  });
});
