import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  calculateImpliedProbability,
  fetchKalshiMarketDetails,
  fetchKalshiMarkets,
  getKalshiMarketDetails,
} from "./_core/kalshiMarketData";

describe("kalshi market data helpers", () => {
  it("calculates implied probability from yes/no prices", () => {
    expect(calculateImpliedProbability(60, 40)).toBeCloseTo(0.6, 5);
    expect(calculateImpliedProbability(0, 0)).toBe(0.5);
  });

  it("exports getKalshiMarketDetails as the dedicated details helper", () => {
    expect(getKalshiMarketDetails).toBe(fetchKalshiMarketDetails);
  });
});

describe("kalshi market data validation", () => {
  const originalFetch = globalThis.fetch;

  function mockMarketsResponse(markets: unknown[]) {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ markets }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    ) as unknown as typeof globalThis.fetch;
  }

  function validRawMarket(overrides: Record<string, unknown> = {}) {
    return {
      id: "PRES-2028-DEM",
      title: "Will the Democratic nominee win the 2028 US Presidential election?",
      category: "politics",
      status: "open",
      last_price_dollars: 0.42,
      no_ask_dollars: 0.6,
      yes_volume: 1234,
      no_volume: 987,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("accepts well-formed markets in dollar scale", async () => {
    mockMarketsResponse([validRawMarket()]);
    const markets = await fetchKalshiMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0].id).toBe("PRES-2028-DEM");
    expect(markets[0].yesPrice).toBeCloseTo(0.42, 5);
    expect(markets[0].noPrice).toBeCloseTo(0.6, 5);
  });

  it("converts raw cent-scale Kalshi prices to dollars", async () => {
    mockMarketsResponse([
      validRawMarket({
        last_price_dollars: undefined,
        no_ask_dollars: undefined,
        yes_price: 42,
        no_price: 60,
      }),
    ]);
    const markets = await fetchKalshiMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0].yesPrice).toBeCloseTo(0.42, 5);
    expect(markets[0].noPrice).toBeCloseTo(0.6, 5);
  });

  it("drops markets without an identifier", async () => {
    mockMarketsResponse([validRawMarket({ id: undefined, ticker: undefined, marketId: undefined })]);
    const markets = await fetchKalshiMarkets();
    expect(markets).toEqual([]);
  });

  it("drops markets where every price candidate is out of [0,1]", async () => {
    mockMarketsResponse([
      validRawMarket({
        last_price_dollars: 1.5,
        no_ask_dollars: -0.2,
        yes_price: 250,
        no_price: -50,
      }),
    ]);
    const markets = await fetchKalshiMarkets();
    expect(markets).toEqual([]);
  });

  it("drops markets with non-finite prices", async () => {
    mockMarketsResponse([
      validRawMarket({
        last_price_dollars: Number.NaN,
        no_ask_dollars: Number.POSITIVE_INFINITY,
        yes_price: undefined,
        no_price: undefined,
      }),
    ]);
    const markets = await fetchKalshiMarkets();
    expect(markets).toEqual([]);
  });

  it("drops markets with negative volumes", async () => {
    mockMarketsResponse([validRawMarket({ yes_volume: -10 })]);
    const markets = await fetchKalshiMarkets();
    expect(markets).toEqual([]);
  });

  it("drops null entries inside the markets array", async () => {
    mockMarketsResponse([null, validRawMarket(), undefined, "garbage"]);
    const markets = await fetchKalshiMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0].id).toBe("PRES-2028-DEM");
  });
});
