/**
 * Tests for the Polymarket position-sync reconciliation.
 *
 * The pure response-parser is exhaustively unit-tested (it shapes the
 * data-api response into the local DB schema).  The DB-bound flow is
 * covered with mocked drizzle queries + mocked fetch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  isUserSubscribedToPolymarket: vi.fn(),
  logAuditEvent: vi.fn(),
  fetchWithRetry: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: mocks.getDb,
  logAuditEvent: mocks.logAuditEvent,
}));

vi.mock("./db.polymarket-credentials", () => ({
  isUserSubscribedToPolymarket: mocks.isUserSubscribedToPolymarket,
}));

vi.mock("./_core/fetchWithRetry", () => ({
  fetchWithRetry: mocks.fetchWithRetry,
}));

vi.mock("./_core/polymarketAuth", () => ({
  polymarketBreaker: { record: vi.fn(), allow: () => true },
}));

const VALID_ADDRESS = "0xabcdef0123456789abcdef0123456789abcdef01";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    POLYMARKET_OWNER_ADDRESS: VALID_ADDRESS,
  };
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("parseRemotePositions", () => {
  it("returns [] for non-array input", async () => {
    const { parseRemotePositions } = await import("./_core/polymarketPositionSync");
    expect(parseRemotePositions(null)).toEqual([]);
    expect(parseRemotePositions({})).toEqual([]);
    expect(parseRemotePositions("nope")).toEqual([]);
  });

  it("parses a valid YES position", async () => {
    const { parseRemotePositions } = await import("./_core/polymarketPositionSync");
    const result = parseRemotePositions([
      {
        market: "0xmarket1",
        asset: "12345",
        outcome: "Yes",
        size: 50,
        avgPrice: 0.42,
        curPrice: 0.5,
        cashPnl: 4.0,
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].marketId).toBe("0xmarket1");
    expect(result[0].tokenId).toBe("12345");
    expect(result[0].side).toBe("yes");
    // sizeUsdc = size * avgPrice (50 * 0.42 = 21)
    expect(result[0].sizeUsdc).toBeCloseTo(21);
    expect(result[0].entryPrice).toBe(0.42);
    expect(result[0].currentPrice).toBe(0.5);
    expect(result[0].unrealizedPnl).toBe(4.0);
  });

  it("parses a NO position with conditionId fallback", async () => {
    const { parseRemotePositions } = await import("./_core/polymarketPositionSync");
    const result = parseRemotePositions([
      {
        conditionId: "0xcond1",
        tokenId: "67890",
        outcome: "No",
        size: 100,
        avgPrice: 0.6,
      },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].marketId).toBe("0xcond1");
    expect(result[0].side).toBe("no");
    // No curPrice provided → falls back to avgPrice
    expect(result[0].currentPrice).toBe(0.6);
    // No cashPnl provided → defaults to 0
    expect(result[0].unrealizedPnl).toBe(0);
  });

  it("skips entries with missing market/token ids", async () => {
    const { parseRemotePositions } = await import("./_core/polymarketPositionSync");
    const result = parseRemotePositions([
      { outcome: "Yes", size: 10, avgPrice: 0.5 }, // no market+token
      { market: "m1", outcome: "Yes", size: 10, avgPrice: 0.5 }, // no token
    ]);
    expect(result).toEqual([]);
  });

  it("skips entries with invalid prices (>=1)", async () => {
    const { parseRemotePositions } = await import("./_core/polymarketPositionSync");
    const result = parseRemotePositions([
      { market: "m1", asset: "t1", outcome: "Yes", size: 10, avgPrice: 1.0 }, // entry == 1
      { market: "m2", asset: "t2", outcome: "Yes", size: 10, avgPrice: 0.5, curPrice: 1.5 }, // mark > 1
    ]);
    expect(result).toEqual([]);
  });

  it("skips entries with invalid size or NaN fields", async () => {
    const { parseRemotePositions } = await import("./_core/polymarketPositionSync");
    const result = parseRemotePositions([
      { market: "m1", asset: "t1", outcome: "Yes", size: 0, avgPrice: 0.5 },
      { market: "m2", asset: "t2", outcome: "Yes", size: -10, avgPrice: 0.5 },
      { market: "m3", asset: "t3", outcome: "Yes", size: "abc", avgPrice: 0.5 },
    ]);
    expect(result).toEqual([]);
  });

  it("skips entries with unknown outcome", async () => {
    const { parseRemotePositions } = await import("./_core/polymarketPositionSync");
    const result = parseRemotePositions([
      { market: "m1", asset: "t1", outcome: "MAYBE", size: 10, avgPrice: 0.5 },
    ]);
    expect(result).toEqual([]);
  });
});

// ── DB-bound flow ──────────────────────────────────────────────────────────

interface FakeOpenRow {
  id: number;
  tokenId: string;
}

function fakeDb(opts: {
  existingMatchById?: number;
  openRows?: FakeOpenRow[];
  onUpdate?: (table: string, set: Record<string, unknown>) => void;
  onInsert?: (table: string, values: Record<string, unknown>) => void;
}) {
  const existing = opts.existingMatchById
    ? [{ id: opts.existingMatchById }]
    : [];

  let selectIdx = 0;
  return {
    select: vi.fn(() => {
      const idx = selectIdx++;
      const data = idx === 0 ? existing : opts.openRows ?? [];
      const limit = vi.fn(async () => data);
      const where = vi.fn(() => ({ limit, then: (resolve: (v: unknown) => unknown) => resolve(data) as unknown }));
      const from = vi.fn(() => ({ where }));
      return { from };
    }),
    update: vi.fn(() => ({
      set: vi.fn((values: Record<string, unknown>) => {
        if (opts.onUpdate) opts.onUpdate("update", values);
        return { where: vi.fn(async () => []) };
      }),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(async (values: Record<string, unknown>) => {
        if (opts.onInsert) opts.onInsert("insert", values);
        return [];
      }),
    })),
  };
}

function fetchOk(payload: unknown) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => payload,
  } as Response);
}

describe("syncPolymarketPositions", () => {
  it("no-ops with skippedReason when POLYMARKET_OWNER_ADDRESS unset", async () => {
    delete process.env.POLYMARKET_OWNER_ADDRESS;
    vi.resetModules();
    const { syncPolymarketPositions } = await import("./_core/polymarketPositionSync");
    const result = await syncPolymarketPositions(7);
    expect(result.walletAddress).toBe("");
    expect(result.skippedReason).toMatch(/not set/);
    expect(mocks.fetchWithRetry).not.toHaveBeenCalled();
  });

  it("no-ops with skippedReason when user not subscribed", async () => {
    mocks.isUserSubscribedToPolymarket.mockResolvedValue(false);
    const { syncPolymarketPositions } = await import("./_core/polymarketPositionSync");
    const result = await syncPolymarketPositions(7);
    expect(result.skippedReason).toMatch(/not subscribed/);
    expect(mocks.fetchWithRetry).not.toHaveBeenCalled();
  });

  it("returns skippedReason when data-api fetch fails", async () => {
    mocks.isUserSubscribedToPolymarket.mockResolvedValue(true);
    mocks.fetchWithRetry.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });
    const { syncPolymarketPositions } = await import("./_core/polymarketPositionSync");
    const result = await syncPolymarketPositions(7);
    expect(result.skippedReason).toMatch(/fetch failed/);
  });

  it("inserts a new position when data-api returns one we haven't seen", async () => {
    mocks.isUserSubscribedToPolymarket.mockResolvedValue(true);
    mocks.fetchWithRetry.mockReturnValue(
      fetchOk([
        { market: "m1", asset: "t1", outcome: "Yes", size: 10, avgPrice: 0.5 },
      ]),
    );
    const inserts: Array<Record<string, unknown>> = [];
    mocks.getDb.mockResolvedValue(
      fakeDb({
        openRows: [],
        onInsert: (_t, v) => inserts.push(v),
      }),
    );

    const { syncPolymarketPositions } = await import("./_core/polymarketPositionSync");
    const result = await syncPolymarketPositions(7);

    expect(result.remoteCount).toBe(1);
    expect(result.upsertedCount).toBe(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]).toMatchObject({
      userId: 7,
      marketId: "m1",
      tokenId: "t1",
      side: "yes",
      entryPrice: 0.5,
    });
  });

  it("updates an existing position with fresh price + size + pnl", async () => {
    mocks.isUserSubscribedToPolymarket.mockResolvedValue(true);
    mocks.fetchWithRetry.mockReturnValue(
      fetchOk([
        {
          market: "m1",
          asset: "t1",
          outcome: "Yes",
          size: 10,
          avgPrice: 0.5,
          curPrice: 0.6,
          cashPnl: 1.0,
        },
      ]),
    );
    const updates: Array<Record<string, unknown>> = [];
    mocks.getDb.mockResolvedValue(
      fakeDb({
        existingMatchById: 99,
        openRows: [{ id: 99, tokenId: "t1" }],
        onUpdate: (_t, v) => updates.push(v),
      }),
    );

    const { syncPolymarketPositions } = await import("./_core/polymarketPositionSync");
    const result = await syncPolymarketPositions(7);

    expect(result.upsertedCount).toBe(1);
    expect(updates[0]).toMatchObject({
      currentPrice: 0.6,
      unrealizedPnl: 1.0,
    });
  });

  it("marks local 'open' positions absent from remote as drift-closed", async () => {
    mocks.isUserSubscribedToPolymarket.mockResolvedValue(true);
    // Remote returns ONE position; local has TWO.  The other should be drift-closed.
    mocks.fetchWithRetry.mockReturnValue(
      fetchOk([
        { market: "m1", asset: "t1", outcome: "Yes", size: 10, avgPrice: 0.5 },
      ]),
    );
    const updates: Array<Record<string, unknown>> = [];
    mocks.getDb.mockResolvedValue(
      fakeDb({
        openRows: [
          { id: 100, tokenId: "t1" }, // matches remote
          { id: 101, tokenId: "t-vanished" }, // not in remote → drift
        ],
        onUpdate: (_t, v) => updates.push(v),
      }),
    );
    mocks.logAuditEvent.mockResolvedValue(true);

    const { syncPolymarketPositions } = await import("./_core/polymarketPositionSync");
    const result = await syncPolymarketPositions(7);

    expect(result.closedDriftCount).toBe(1);
    expect(result.closedDriftPositionIds).toContain(101);
    // The drift-closed update should set positionStatus 'closed' + closedAt.
    const driftUpdate = updates.find((u) => u.positionStatus === "closed");
    expect(driftUpdate).toBeDefined();
    expect(driftUpdate?.closedAt).toBeInstanceOf(Date);
  });

  it("does not flag drift when all local positions are present remotely", async () => {
    mocks.isUserSubscribedToPolymarket.mockResolvedValue(true);
    mocks.fetchWithRetry.mockReturnValue(
      fetchOk([
        { market: "m1", asset: "t1", outcome: "Yes", size: 10, avgPrice: 0.5 },
        { market: "m2", asset: "t2", outcome: "No", size: 5, avgPrice: 0.4 },
      ]),
    );
    mocks.getDb.mockResolvedValue(
      fakeDb({
        openRows: [
          { id: 200, tokenId: "t1" },
          { id: 201, tokenId: "t2" },
        ],
      }),
    );
    const { syncPolymarketPositions } = await import("./_core/polymarketPositionSync");
    const result = await syncPolymarketPositions(7);
    expect(result.closedDriftCount).toBe(0);
    expect(result.closedDriftPositionIds).toEqual([]);
  });
});
