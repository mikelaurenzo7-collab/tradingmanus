import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./_core/fetchWithRetry", () => ({
  fetchWithRetry: vi.fn(),
}));

vi.mock("./_core/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { fetchWithRetry } from "./_core/fetchWithRetry";
import {
  pollWikipediaWatchlist,
  matchSignalsToMarkets,
  resetWatcherState,
  type WatchedPage,
} from "./_core/wikipediaEditWatcher";

const mockFetchWithRetry = fetchWithRetry as unknown as ReturnType<typeof vi.fn>;

function buildResponse(
  revisions: Array<{
    timestamp: string;
    comment: string;
    size: number;
    user?: string;
  }>,
) {
  return {
    ok: true,
    json: async () => ({
      query: {
        pages: [
          {
            revisions,
          },
        ],
      },
    }),
    text: async () => "",
  };
}

describe("pollWikipediaWatchlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetWatcherState();
  });

  it("returns no signals when no revisions match alarm patterns or size threshold", async () => {
    mockFetchWithRetry.mockResolvedValue(
      buildResponse([
        { timestamp: "2026-05-09T12:00:00Z", comment: "fix typo", size: 1000 },
        { timestamp: "2026-05-09T11:00:00Z", comment: "previous", size: 990 },
      ]),
    );
    const list: WatchedPage[] = [
      { title: "Test_Page", marketKeyword: "test", marketCategories: ["politics"] },
    ];
    const signals = await pollWikipediaWatchlist(list);
    expect(signals).toEqual([]);
  });

  it("flags revisions with alarm-keyword comments", async () => {
    mockFetchWithRetry.mockResolvedValue(
      buildResponse([
        {
          timestamp: "2026-05-09T12:00:00Z",
          comment: "Added section on indictment",
          size: 1500,
        },
        { timestamp: "2026-05-09T11:00:00Z", comment: "previous", size: 1400 },
      ]),
    );
    const list: WatchedPage[] = [
      { title: "Politician", marketKeyword: "politician", marketCategories: ["politics"] },
    ];
    const signals = await pollWikipediaWatchlist(list);
    expect(signals).toHaveLength(1);
    expect(signals[0].revision.matchedKeywords).toContain("indict");
    expect(signals[0].confidence).toBeGreaterThan(0.5);
  });

  it("flags large size deltas even without alarm keywords", async () => {
    mockFetchWithRetry.mockResolvedValue(
      buildResponse([
        {
          timestamp: "2026-05-09T12:00:00Z",
          comment: "expanded biography",
          size: 5000,
        },
        { timestamp: "2026-05-09T11:00:00Z", comment: "older", size: 1000 },
      ]),
    );
    const list: WatchedPage[] = [
      { title: "Tech_CEO", marketKeyword: "ceo", marketCategories: ["tech"] },
    ];
    const signals = await pollWikipediaWatchlist(list);
    expect(signals).toHaveLength(1);
    expect(signals[0].revision.sizeDelta).toBe(4000);
  });

  it("does not double-emit signals across consecutive polls (cursor advances)", async () => {
    mockFetchWithRetry.mockResolvedValue(
      buildResponse([
        {
          timestamp: "2026-05-09T12:00:00Z",
          comment: "lawsuit filed",
          size: 1500,
        },
        { timestamp: "2026-05-09T11:00:00Z", comment: "older", size: 1400 },
      ]),
    );
    const list: WatchedPage[] = [
      { title: "Page", marketKeyword: "kw", marketCategories: ["other"] },
    ];

    const first = await pollWikipediaWatchlist(list);
    expect(first).toHaveLength(1);

    // Same response; cursor should suppress re-emission.
    const second = await pollWikipediaWatchlist(list);
    expect(second).toEqual([]);
  });

  it("survives an HTTP error gracefully", async () => {
    mockFetchWithRetry.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
      text: async () => "",
    });
    const list: WatchedPage[] = [
      { title: "Page", marketKeyword: "kw", marketCategories: ["other"] },
    ];
    const signals = await pollWikipediaWatchlist(list);
    expect(signals).toEqual([]);
  });
});

describe("matchSignalsToMarkets", () => {
  it("matches by marketKeyword substring (case-insensitive)", () => {
    const sig = {
      pageTitle: "Donald_Trump",
      marketKeyword: "trump",
      marketCategories: ["politics" as const],
      revision: {
        title: "Donald_Trump",
        comment: "indicted",
        sizeDelta: 1000,
        timestamp: "2026-05-09T12:00:00Z",
        user: "Editor",
        isSignificant: true,
        matchedKeywords: ["indict"],
      },
      confidence: 0.85,
      detectedAt: "2026-05-09T12:00:00Z",
    };
    const markets = [
      { id: "m1", title: "Will Trump win the 2028 nomination?", category: "politics" },
      { id: "m2", title: "Bitcoin to $200k?", category: "crypto" },
    ];
    const matches = matchSignalsToMarkets([sig], markets);
    expect(matches).toHaveLength(1);
    expect(matches[0].market.id).toBe("m1");
  });

  it("returns empty when no markets match the keyword", () => {
    const sig = {
      pageTitle: "Page",
      marketKeyword: "rarekeyword",
      marketCategories: ["other" as const],
      revision: {
        title: "Page",
        comment: "edit",
        sizeDelta: 500,
        timestamp: "2026-05-09T12:00:00Z",
        user: "Editor",
        isSignificant: true,
        matchedKeywords: [],
      },
      confidence: 0.3,
      detectedAt: "2026-05-09T12:00:00Z",
    };
    const markets = [
      { id: "m1", title: "Trump 2028?", category: "politics" },
    ];
    expect(matchSignalsToMarkets([sig], markets)).toEqual([]);
  });
});
