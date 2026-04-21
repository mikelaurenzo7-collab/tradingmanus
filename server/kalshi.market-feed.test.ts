import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  subscribeToMarketFeed,
  unsubscribeFromMarketFeed,
  getMarketFeed,
  getAllMarketFeeds,
  calculatePriceMomentum,
  calculateVolumeMomentum,
  detectVolatility,
  isMarketDataStale,
  MarketFeed,
} from "../server/_core/kalshiMarketFeed";
import * as db from "../server/db";
import * as kalshiMarketData from "../server/_core/kalshiMarketData";

// Mock dependencies
vi.mock("../server/db");
vi.mock("../server/_core/kalshiMarketData");

describe("Kalshi Market Feed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Clean up all subscriptions
    const feeds = getAllMarketFeeds();
    feeds.forEach((feed) => {
      unsubscribeFromMarketFeed(feed.marketId);
    });
  });

  describe("subscribeToMarketFeed", () => {
    it("should subscribe to a market and return initial feed", async () => {
      const mockMarket = {
        id: "market-123",
        title: "Will Bitcoin exceed $100k?",
        category: "crypto",
        description: "Bitcoin price prediction",
        resolutionDate: "2025-12-31",
        status: "open" as const,
        yesPrice: 0.65,
        noPrice: 0.35,
        yesVolume: 1000,
        noVolume: 800,
        impliedProbability: 0.65,
      };

      vi.mocked(kalshiMarketData.fetchKalshiMarketDetails).mockResolvedValue(mockMarket);
      vi.mocked(db.upsertKalshiMarket).mockResolvedValue(undefined);

      const feed = await subscribeToMarketFeed("market-123", 1000);

      expect(feed).toBeDefined();
      expect(feed?.marketId).toBe("market-123");
      expect(feed?.title).toBe("Will Bitcoin exceed $100k?");
      expect(feed?.currentSnapshot.yesPrice).toBe(0.65);
      expect(feed?.dataQualityScore).toBe(1.0);
      expect(feed?.priceHistory.length).toBe(1);
    });

    it("should return null if market fetch fails", async () => {
      vi.mocked(kalshiMarketData.fetchKalshiMarketDetails).mockResolvedValue(null);

      const feed = await subscribeToMarketFeed("invalid-market");

      expect(feed).toBeNull();
    });

    it("should return existing feed if already subscribed", async () => {
      const mockMarket = {
        id: "market-456",
        title: "Test Market",
        category: "test",
        description: "Test",
        resolutionDate: "2025-12-31",
        status: "open" as const,
        yesPrice: 0.5,
        noPrice: 0.5,
        yesVolume: 100,
        noVolume: 100,
        impliedProbability: 0.5,
      };

      vi.mocked(kalshiMarketData.fetchKalshiMarketDetails).mockResolvedValue(mockMarket);
      vi.mocked(db.upsertKalshiMarket).mockResolvedValue(undefined);

      const feed1 = await subscribeToMarketFeed("market-456", 1000);
      const feed2 = await subscribeToMarketFeed("market-456", 1000);

      expect(feed1).toBe(feed2);
      expect(vi.mocked(kalshiMarketData.fetchKalshiMarketDetails).mock.calls).toHaveLength(1);
    });
  });

  describe("unsubscribeFromMarketFeed", () => {
    it("should unsubscribe from a market feed", async () => {
      const mockMarket = {
        id: "market-789",
        title: "Test Market",
        category: "test",
        description: "Test",
        resolutionDate: "2025-12-31",
        status: "open" as const,
        yesPrice: 0.5,
        noPrice: 0.5,
        yesVolume: 100,
        noVolume: 100,
        impliedProbability: 0.5,
      };

      vi.mocked(kalshiMarketData.fetchKalshiMarketDetails).mockResolvedValue(mockMarket);
      vi.mocked(db.upsertKalshiMarket).mockResolvedValue(undefined);

      await subscribeToMarketFeed("market-789", 1000);
      expect(getMarketFeed("market-789")).toBeDefined();

      unsubscribeFromMarketFeed("market-789");
      expect(getMarketFeed("market-789")).toBeNull();
    });
  });

  describe("getMarketFeed", () => {
    it("should return null for non-existent market", () => {
      const feed = getMarketFeed("non-existent");
      expect(feed).toBeNull();
    });

    it("should return feed for subscribed market", async () => {
      const mockMarket = {
        id: "market-101",
        title: "Test Market",
        category: "test",
        description: "Test",
        resolutionDate: "2025-12-31",
        status: "open" as const,
        yesPrice: 0.6,
        noPrice: 0.4,
        yesVolume: 500,
        noVolume: 300,
        impliedProbability: 0.6,
      };

      vi.mocked(kalshiMarketData.fetchKalshiMarketDetails).mockResolvedValue(mockMarket);
      vi.mocked(db.upsertKalshiMarket).mockResolvedValue(undefined);

      await subscribeToMarketFeed("market-101", 1000);
      const feed = getMarketFeed("market-101");

      expect(feed).toBeDefined();
      expect(feed?.marketId).toBe("market-101");
    });
  });

  describe("getAllMarketFeeds", () => {
    it("should return all active feeds", async () => {
      const mockMarket1 = {
        id: "market-1",
        title: "Market 1",
        category: "test",
        description: "Test",
        resolutionDate: "2025-12-31",
        status: "open" as const,
        yesPrice: 0.5,
        noPrice: 0.5,
        yesVolume: 100,
        noVolume: 100,
        impliedProbability: 0.5,
      };

      const mockMarket2 = {
        id: "market-2",
        title: "Market 2",
        category: "test",
        description: "Test",
        resolutionDate: "2025-12-31",
        status: "open" as const,
        yesPrice: 0.6,
        noPrice: 0.4,
        yesVolume: 200,
        noVolume: 150,
        impliedProbability: 0.6,
      };

      vi.mocked(kalshiMarketData.fetchKalshiMarketDetails)
        .mockResolvedValueOnce(mockMarket1)
        .mockResolvedValueOnce(mockMarket2);
      vi.mocked(db.upsertKalshiMarket).mockResolvedValue(undefined);

      await subscribeToMarketFeed("market-1", 1000);
      await subscribeToMarketFeed("market-2", 1000);

      const feeds = getAllMarketFeeds();
      expect(feeds).toHaveLength(2);
      expect(feeds.map((f) => f.marketId)).toContain("market-1");
      expect(feeds.map((f) => f.marketId)).toContain("market-2");
    });
  });

  describe("calculatePriceMomentum", () => {
    it("should calculate price momentum correctly", () => {
      const feed: MarketFeed = {
        marketId: "test",
        title: "Test",
        category: "test",
        status: "open",
        currentSnapshot: {
          marketId: "test",
          timestamp: Date.now(),
          yesPrice: 0.6,
          noPrice: 0.4,
          yesVolume: 100,
          noVolume: 100,
          impliedProbability: 0.6,
        },
        priceHistory: [
          {
            marketId: "test",
            timestamp: Date.now() - 60000,
            yesPrice: 0.5,
            noPrice: 0.5,
            yesVolume: 100,
            noVolume: 100,
            impliedProbability: 0.5,
          },
          {
            marketId: "test",
            timestamp: Date.now(),
            yesPrice: 0.6,
            noPrice: 0.4,
            yesVolume: 100,
            noVolume: 100,
            impliedProbability: 0.6,
          },
        ],
        volumeHistory: [],
        dataQualityScore: 1.0,
        lastUpdateTime: Date.now(),
      };

      const { yesMomentum, noMomentum } = calculatePriceMomentum(feed, 60000);

      expect(yesMomentum).toBeCloseTo(0.2, 2); // (0.6 - 0.5) / 0.5 = 0.2
      expect(noMomentum).toBeCloseTo(-0.2, 2); // (0.4 - 0.5) / 0.5 = -0.2
    });

    it("should return zero momentum for insufficient history", () => {
      const feed: MarketFeed = {
        marketId: "test",
        title: "Test",
        category: "test",
        status: "open",
        currentSnapshot: {
          marketId: "test",
          timestamp: Date.now(),
          yesPrice: 0.5,
          noPrice: 0.5,
          yesVolume: 100,
          noVolume: 100,
          impliedProbability: 0.5,
        },
        priceHistory: [
          {
            marketId: "test",
            timestamp: Date.now(),
            yesPrice: 0.5,
            noPrice: 0.5,
            yesVolume: 100,
            noVolume: 100,
            impliedProbability: 0.5,
          },
        ],
        volumeHistory: [],
        dataQualityScore: 1.0,
        lastUpdateTime: Date.now(),
      };

      const { yesMomentum, noMomentum } = calculatePriceMomentum(feed, 60000);

      expect(yesMomentum).toBe(0);
      expect(noMomentum).toBe(0);
    });
  });

  describe("calculateVolumeMomentum", () => {
    it("should calculate volume momentum correctly", () => {
      const feed: MarketFeed = {
        marketId: "test",
        title: "Test",
        category: "test",
        status: "open",
        currentSnapshot: {
          marketId: "test",
          timestamp: Date.now(),
          yesPrice: 0.5,
          noPrice: 0.5,
          yesVolume: 200,
          noVolume: 100,
          impliedProbability: 0.5,
        },
        priceHistory: [],
        volumeHistory: [
          { timestamp: Date.now() - 60000, yesVolume: 100, noVolume: 100 },
          { timestamp: Date.now(), yesVolume: 200, noVolume: 100 },
        ],
        dataQualityScore: 1.0,
        lastUpdateTime: Date.now(),
      };

      const { yesVolumeMomentum, noVolumeMomentum } = calculateVolumeMomentum(feed, 60000);

      expect(yesVolumeMomentum).toBeCloseTo(1.0, 2); // (200 - 100) / 100 = 1.0
      expect(noVolumeMomentum).toBe(0); // (100 - 100) / 100 = 0
    });
  });

  describe("detectVolatility", () => {
    it("should calculate volatility from price history", () => {
      const baseTime = Date.now();
      const feed: MarketFeed = {
        marketId: "test",
        title: "Test",
        category: "test",
        status: "open",
        currentSnapshot: {
          marketId: "test",
          timestamp: baseTime,
          yesPrice: 0.5,
          noPrice: 0.5,
          yesVolume: 100,
          noVolume: 100,
          impliedProbability: 0.5,
        },
        priceHistory: [
          { marketId: "test", timestamp: baseTime - 300000, yesPrice: 0.4, noPrice: 0.6, yesVolume: 100, noVolume: 100, impliedProbability: 0.4 },
          { marketId: "test", timestamp: baseTime - 200000, yesPrice: 0.5, noPrice: 0.5, yesVolume: 100, noVolume: 100, impliedProbability: 0.5 },
          { marketId: "test", timestamp: baseTime - 100000, yesPrice: 0.6, noPrice: 0.4, yesVolume: 100, noVolume: 100, impliedProbability: 0.6 },
          { marketId: "test", timestamp: baseTime, yesPrice: 0.5, noPrice: 0.5, yesVolume: 100, noVolume: 100, impliedProbability: 0.5 },
        ],
        volumeHistory: [],
        dataQualityScore: 1.0,
        lastUpdateTime: baseTime,
      };

      const volatility = detectVolatility(feed, 300000);

      expect(volatility).toBeGreaterThan(0);
      expect(volatility).toBeLessThan(1);
    });

    it("should return zero volatility for insufficient history", () => {
      const feed: MarketFeed = {
        marketId: "test",
        title: "Test",
        category: "test",
        status: "open",
        currentSnapshot: {
          marketId: "test",
          timestamp: Date.now(),
          yesPrice: 0.5,
          noPrice: 0.5,
          yesVolume: 100,
          noVolume: 100,
          impliedProbability: 0.5,
        },
        priceHistory: [
          {
            marketId: "test",
            timestamp: Date.now(),
            yesPrice: 0.5,
            noPrice: 0.5,
            yesVolume: 100,
            noVolume: 100,
            impliedProbability: 0.5,
          },
        ],
        volumeHistory: [],
        dataQualityScore: 1.0,
        lastUpdateTime: Date.now(),
      };

      const volatility = detectVolatility(feed, 300000);

      expect(volatility).toBe(0);
    });
  });

  describe("isMarketDataStale", () => {
    it("should detect stale market data", () => {
      const feed: MarketFeed = {
        marketId: "test",
        title: "Test",
        category: "test",
        status: "open",
        currentSnapshot: {
          marketId: "test",
          timestamp: Date.now(),
          yesPrice: 0.5,
          noPrice: 0.5,
          yesVolume: 100,
          noVolume: 100,
          impliedProbability: 0.5,
        },
        priceHistory: [],
        volumeHistory: [],
        dataQualityScore: 1.0,
        lastUpdateTime: Date.now() - 60000, // 60 seconds ago
      };

      expect(isMarketDataStale(feed, 30000)).toBe(true); // 30 second threshold
      expect(isMarketDataStale(feed, 120000)).toBe(false); // 120 second threshold
    });
  });
});
