/**
 * Tests for the Polymarket exit monitor.
 *
 * Mirror of server/exit-monitor.test.ts but for polymarketExitMonitor.ts.
 * Covers stop-loss / profit-target / trailing-stop detection, persisted-
 * state resume, paper vs. live close branching, and graceful skip when
 * the price-map fetch fails.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getOpenPolymarketPositions: vi.fn(),
  getPolymarketCredentials: vi.fn(),
  getDb: vi.fn(),
  logAuditEvent: vi.fn(),
  fetchPolymarketMarkets: vi.fn(),
  closePolymarketPosition: vi.fn(),
  simulatePolymarketPositionClose: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: mocks.getDb,
  logAuditEvent: mocks.logAuditEvent,
}));

vi.mock("./db.polymarket", () => ({
  getOpenPolymarketPositions: mocks.getOpenPolymarketPositions,
}));

vi.mock("./db.polymarket-credentials", () => ({
  getPolymarketCredentials: mocks.getPolymarketCredentials,
}));

vi.mock("./_core/polymarketAuth", () => ({
  fetchPolymarketMarkets: mocks.fetchPolymarketMarkets,
  closePolymarketPosition: mocks.closePolymarketPosition,
}));

vi.mock("./_core/paperTrading", () => ({
  simulatePolymarketPositionClose: mocks.simulatePolymarketPositionClose,
}));

// effectivePaperMode does an async getUserById lookup which we don't want
// to wire up.  Stub the resolver so the test controls paper vs live via
// PAPER_TRADE_MODE env (true/unset) — matching pre-per-user behaviour.
vi.mock("./_core/effectivePaperMode", () => ({
  getEffectivePaperTradeMode: vi.fn(async () => (process.env.PAPER_TRADE_MODE === "true")),
}));

function fakeDb(opts: { onUpdate?: (state: unknown) => void }) {
  const update = vi.fn(() => {
    let pendingState: unknown;
    const where = vi.fn(async () => {
      if (opts.onUpdate) opts.onUpdate(pendingState);
      return [];
    });
    const set = vi.fn((values: Record<string, unknown>) => {
      pendingState = values.exitState ?? values;
      return { where };
    });
    return { set };
  });
  return { update } as unknown as Record<string, unknown>;
}

function marketRowFor(tokenId: string, price: number) {
  return {
    marketId: "market-x",
    tokens: [{ token_id: tokenId, outcome: "yes", price }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.AUTO_CLOSE_ON_EXIT_SIGNAL;
  delete process.env.PAPER_TRADE_MODE;
  vi.resetModules();
});

describe("evaluatePolymarketExitsForOpenPositions — basic exit detection", () => {
  it("emits exit_signal audit when price hits stop-loss (yes side)", async () => {
    mocks.getOpenPolymarketPositions.mockResolvedValue([
      { id: 11, marketId: "m1", tokenId: "t1", side: "yes", entryPrice: 0.6, sizeUsdc: 10, exitState: null },
    ]);
    mocks.fetchPolymarketMarkets.mockResolvedValue([marketRowFor("t1", 0.5)]);
    mocks.getDb.mockResolvedValue(fakeDb({}));
    mocks.logAuditEvent.mockResolvedValue(true);

    const { evaluatePolymarketExitsForOpenPositions } = await import("./_core/polymarketExitMonitor");
    const results = await evaluatePolymarketExitsForOpenPositions(7);

    expect(results).toHaveLength(1);
    expect(results[0].decision.shouldExit).toBe(true);
    expect(results[0].decision.reason).toBe("stop_loss");
    expect(results[0].closed).toBe(false);
    expect(mocks.logAuditEvent).toHaveBeenCalledWith(
      "polymarket_position_exit_signal",
      expect.stringContaining('"reason":"stop_loss"'),
      "local_scheduler",
    );
  });

  it("does NOT trigger exit when price is between stop and target", async () => {
    mocks.getOpenPolymarketPositions.mockResolvedValue([
      { id: 12, marketId: "m1", tokenId: "t1", side: "yes", entryPrice: 0.5, sizeUsdc: 10, exitState: null },
    ]);
    mocks.fetchPolymarketMarkets.mockResolvedValue([marketRowFor("t1", 0.51)]);
    mocks.getDb.mockResolvedValue(fakeDb({}));

    const { evaluatePolymarketExitsForOpenPositions } = await import("./_core/polymarketExitMonitor");
    const results = await evaluatePolymarketExitsForOpenPositions(7);

    expect(results[0].decision.shouldExit).toBe(false);
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it("returns empty when no positions are open", async () => {
    mocks.getOpenPolymarketPositions.mockResolvedValue([]);

    const { evaluatePolymarketExitsForOpenPositions } = await import("./_core/polymarketExitMonitor");
    const results = await evaluatePolymarketExitsForOpenPositions(7);

    expect(results).toHaveLength(0);
    expect(mocks.fetchPolymarketMarkets).not.toHaveBeenCalled();
  });

  it("returns empty (gracefully) when the price-map fetch fails", async () => {
    mocks.getOpenPolymarketPositions.mockResolvedValue([
      { id: 13, marketId: "m1", tokenId: "t1", side: "yes", entryPrice: 0.6, sizeUsdc: 10, exitState: null },
    ]);
    mocks.fetchPolymarketMarkets.mockRejectedValue(new Error("polymarket down"));

    const { evaluatePolymarketExitsForOpenPositions } = await import("./_core/polymarketExitMonitor");
    const results = await evaluatePolymarketExitsForOpenPositions(7);

    expect(results).toHaveLength(0);
    // No audit emitted; we just skip this tick and try again next time.
    expect(mocks.logAuditEvent).not.toHaveBeenCalled();
  });

  it("skips a position whose token is not in the price map", async () => {
    mocks.getOpenPolymarketPositions.mockResolvedValue([
      { id: 14, marketId: "m1", tokenId: "t-missing", side: "yes", entryPrice: 0.6, sizeUsdc: 10, exitState: null },
    ]);
    mocks.fetchPolymarketMarkets.mockResolvedValue([marketRowFor("t-other", 0.5)]);
    mocks.getDb.mockResolvedValue(fakeDb({}));

    const { evaluatePolymarketExitsForOpenPositions } = await import("./_core/polymarketExitMonitor");
    const results = await evaluatePolymarketExitsForOpenPositions(7);

    expect(results).toHaveLength(0);
  });
});

describe("evaluatePolymarketExitsForOpenPositions — auto-close routing", () => {
  it("calls simulatePolymarketPositionClose when AUTO_CLOSE=true and PAPER=true", async () => {
    process.env.AUTO_CLOSE_ON_EXIT_SIGNAL = "true";
    process.env.PAPER_TRADE_MODE = "true";
    vi.resetModules();

    mocks.getOpenPolymarketPositions.mockResolvedValue([
      { id: 21, marketId: "m1", tokenId: "t1", side: "yes", entryPrice: 0.6, sizeUsdc: 10, exitState: null },
    ]);
    mocks.fetchPolymarketMarkets.mockResolvedValue([marketRowFor("t1", 0.5)]);
    mocks.getDb.mockResolvedValue(fakeDb({}));
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.simulatePolymarketPositionClose.mockResolvedValue({ success: true, orderId: "paper-close-1" });

    const { evaluatePolymarketExitsForOpenPositions } = await import("./_core/polymarketExitMonitor");
    const results = await evaluatePolymarketExitsForOpenPositions(7);

    expect(results[0].closed).toBe(true);
    expect(mocks.simulatePolymarketPositionClose).toHaveBeenCalledWith(
      7, // userId
      21, // positionId
      0.5, // mark price
      "local_scheduler",
    );
    expect(mocks.closePolymarketPosition).not.toHaveBeenCalled();
  });

  it("calls live closePolymarketPosition when AUTO_CLOSE=true and PAPER=false", async () => {
    process.env.AUTO_CLOSE_ON_EXIT_SIGNAL = "true";
    delete process.env.PAPER_TRADE_MODE;
    vi.resetModules();

    mocks.getOpenPolymarketPositions.mockResolvedValue([
      { id: 22, marketId: "m1", tokenId: "t1", side: "yes", entryPrice: 0.6, sizeUsdc: 10, exitState: null },
    ]);
    mocks.fetchPolymarketMarkets.mockResolvedValue([marketRowFor("t1", 0.5)]);
    mocks.getDb.mockResolvedValue(fakeDb({}));
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.getPolymarketCredentials.mockResolvedValue({
      userId: 7,
      accountStatus: "connected",
      apiKey: "k",
      apiSecret: "s",
      apiPassphrase: "p",
      walletPrivateKey: "0x" + "11".repeat(32),
      walletAddress: "0x0000000000000000000000000000000000000001",
      signatureType: 1,
    });
    mocks.closePolymarketPosition.mockResolvedValue({ success: true, orderId: "live-close-1" });

    const { evaluatePolymarketExitsForOpenPositions } = await import("./_core/polymarketExitMonitor");
    const results = await evaluatePolymarketExitsForOpenPositions(7);

    expect(results[0].closed).toBe(true);
    expect(mocks.closePolymarketPosition).toHaveBeenCalledWith(
      "k", "s", "p",
      expect.objectContaining({
        tokenId: "t1",
        sizeUsdc: 10,
        price: 0.5,
        walletPrivateKey: expect.any(String),
        walletAddress: expect.any(String),
      }),
    );
    expect(mocks.simulatePolymarketPositionClose).not.toHaveBeenCalled();
  });

  it("captures error when close fails (live) and sets closed=false", async () => {
    process.env.AUTO_CLOSE_ON_EXIT_SIGNAL = "true";
    delete process.env.PAPER_TRADE_MODE;
    vi.resetModules();

    mocks.getOpenPolymarketPositions.mockResolvedValue([
      { id: 23, marketId: "m1", tokenId: "t1", side: "yes", entryPrice: 0.6, sizeUsdc: 10, exitState: null },
    ]);
    mocks.fetchPolymarketMarkets.mockResolvedValue([marketRowFor("t1", 0.5)]);
    mocks.getDb.mockResolvedValue(fakeDb({}));
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.getPolymarketCredentials.mockResolvedValue({
      accountStatus: "connected", apiKey: "k", apiSecret: "s", apiPassphrase: "p",
      walletPrivateKey: "0x" + "11".repeat(32),
      walletAddress: "0x0000000000000000000000000000000000000001",
      signatureType: 1,
    });
    mocks.closePolymarketPosition.mockResolvedValue({ success: false, error: "insufficient bids" });

    const { evaluatePolymarketExitsForOpenPositions } = await import("./_core/polymarketExitMonitor");
    const results = await evaluatePolymarketExitsForOpenPositions(7);

    expect(results[0].closed).toBe(false);
    expect(results[0].closeError).toBe("insufficient bids");
  });

  it("does not call live close when credentials are missing", async () => {
    process.env.AUTO_CLOSE_ON_EXIT_SIGNAL = "true";
    delete process.env.PAPER_TRADE_MODE;
    vi.resetModules();

    mocks.getOpenPolymarketPositions.mockResolvedValue([
      { id: 24, marketId: "m1", tokenId: "t1", side: "yes", entryPrice: 0.6, sizeUsdc: 10, exitState: null },
    ]);
    mocks.fetchPolymarketMarkets.mockResolvedValue([marketRowFor("t1", 0.5)]);
    mocks.getDb.mockResolvedValue(fakeDb({}));
    mocks.logAuditEvent.mockResolvedValue(true);
    mocks.getPolymarketCredentials.mockResolvedValue(null);

    const { evaluatePolymarketExitsForOpenPositions } = await import("./_core/polymarketExitMonitor");
    const results = await evaluatePolymarketExitsForOpenPositions(7);

    expect(results[0].closed).toBe(false);
    expect(results[0].closeError).toContain("credentials");
    expect(mocks.closePolymarketPosition).not.toHaveBeenCalled();
  });
});

describe("evaluatePolymarketExitsForOpenPositions — stateful trailing stop", () => {
  it("triggers trailing_stop exit when price falls below the persisted trailing level", async () => {
    const persisted = {
      stopLevel: 0.425,
      trailingStop: 0.62,
      highWaterMark: 0.7,
      profitTargets: [0.575, 0.65, 0.725],
      hitTargets: [],
    };
    mocks.getOpenPolymarketPositions.mockResolvedValue([
      { id: 31, marketId: "m1", tokenId: "t1", side: "yes", entryPrice: 0.5, sizeUsdc: 10, exitState: persisted },
    ]);
    mocks.fetchPolymarketMarkets.mockResolvedValue([marketRowFor("t1", 0.61)]);
    mocks.getDb.mockResolvedValue(fakeDb({}));
    mocks.logAuditEvent.mockResolvedValue(true);

    const { evaluatePolymarketExitsForOpenPositions } = await import("./_core/polymarketExitMonitor");
    const results = await evaluatePolymarketExitsForOpenPositions(7);

    expect(results[0].decision.shouldExit).toBe(true);
    expect(results[0].decision.reason).toBe("trailing_stop");
  });

  it("ratchets trailing stop on a new high (yes side)", async () => {
    let captured: unknown;
    mocks.getOpenPolymarketPositions.mockResolvedValue([
      { id: 32, marketId: "m1", tokenId: "t1", side: "yes", entryPrice: 0.5, sizeUsdc: 10, exitState: null },
    ]);
    mocks.fetchPolymarketMarkets.mockResolvedValue([marketRowFor("t1", 0.7)]);
    mocks.getDb.mockResolvedValue(fakeDb({ onUpdate: (s) => { captured = s; } }));
    mocks.logAuditEvent.mockResolvedValue(true);

    const { evaluatePolymarketExitsForOpenPositions } = await import("./_core/polymarketExitMonitor");
    const results = await evaluatePolymarketExitsForOpenPositions(7);

    expect(results[0].trailingStopRaised).toBe(true);
    expect((captured as { highWaterMark: number }).highWaterMark).toBeCloseTo(0.7);
  });
});
