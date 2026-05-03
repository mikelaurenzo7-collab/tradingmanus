/**
 * Tests for syncPendingOrders in kalshiOrderSync.ts
 *
 * syncPendingOrders:
 *   - returns early when no credentials are found for the user
 *   - returns early when credentials require re-authentication
 *   - no-ops on a second concurrent invocation for the same user (in-process guard)
 *   - does nothing when no pending orders exist in the ledger
 *   - creates a position record when a buy order is reported as filled
 *   - skips position creation when an open position already exists (idempotency guard)
 *   - calls closePositionFromFill when a sell order is reported as filled
 *   - continues processing remaining orders when one order throws
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- module-level mutable state shared between mock factories and tests ---
const mockState = {
  pendingOrders: [] as any[],
  existingPosition: undefined as any,
};

const mocks = vi.hoisted(() => ({
  getKalshiCredentials: vi.fn(),
  getKalshiOrderStatus: vi.fn(),
  createPositionFromFill: vi.fn(),
  closePositionFromFill: vi.fn(),
}));

// Mock the raw Drizzle db — every `.select().from().where()` call reads from
// mockState in the order the calls are made.  The first call returns the
// pending-orders array; subsequent calls each return [existingPosition] (or []).
let _selectCallCount = 0;

vi.mock("./db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => {
          const callIndex = _selectCallCount++;
          if (callIndex === 0) {
            // First call: fetch all pending orders for the user.
            return Promise.resolve(mockState.pendingOrders);
          }
          // Subsequent calls: idempotency check for existing open positions.
          const row = mockState.existingPosition;
          return Promise.resolve(row ? [row] : []);
        }),
      })),
    })),
  },
}));

vi.mock("./db.kalshi-credentials", () => ({
  getKalshiCredentials: mocks.getKalshiCredentials,
}));

vi.mock("./_core/kalshiExecution", () => ({
  getKalshiOrderStatus: mocks.getKalshiOrderStatus,
  createPositionFromFill: mocks.createPositionFromFill,
  closePositionFromFill: mocks.closePositionFromFill,
}));

vi.mock("./_core/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("./_core/userScope", () => ({
  assertPositiveIntegerUserId: vi.fn((id: number) => id),
}));

// Schema table refs are used as arguments to Drizzle chain calls but are
// otherwise ignored by our mock — import them so the module loads cleanly.
vi.mock("../drizzle/schema", () => ({
  kalshiOrders: {},
  kalshiPositions: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  inArray: vi.fn(),
}));

import { syncPendingOrders } from "./_core/kalshiOrderSync";

// -------------------------------------------------------------------------

const CONNECTED_CREDS = {
  userId: 7,
  accountStatus: "connected",
  apiKey: "test-key",
  privateKey: "test-pk",
  needsReauth: false,
};

const PENDING_BUY_ORDER = {
  orderId: "order-buy-1",
  userId: 7,
  marketId: "KXTEST-1",
  side: "yes",
  action: "buy",
  limitPrice: 0.43,
  quantity: 2,
  status: "pending",
};

const PENDING_SELL_ORDER = {
  orderId: "order-sell-1",
  userId: 7,
  marketId: "KXTEST-2",
  side: "yes",
  action: "sell",
  limitPrice: 0.60,
  quantity: 1,
  status: "pending",
};

describe("syncPendingOrders — credential / early-exit paths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _selectCallCount = 0;
    mockState.pendingOrders = [];
    mockState.existingPosition = undefined;
  });

  it("returns without syncing when no credentials are found for the user", async () => {
    mocks.getKalshiCredentials.mockResolvedValue(null);

    await syncPendingOrders(7);

    expect(mocks.getKalshiOrderStatus).not.toHaveBeenCalled();
    expect(mocks.createPositionFromFill).not.toHaveBeenCalled();
  });

  it("returns without syncing when credentials require re-authentication", async () => {
    mocks.getKalshiCredentials.mockResolvedValue({
      ...CONNECTED_CREDS,
      needsReauth: true,
    });

    await syncPendingOrders(7);

    expect(mocks.getKalshiOrderStatus).not.toHaveBeenCalled();
    expect(mocks.createPositionFromFill).not.toHaveBeenCalled();
  });
});

describe("syncPendingOrders — in-process concurrency guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _selectCallCount = 0;
    mockState.pendingOrders = [];
    mockState.existingPosition = undefined;
  });

  afterEach(() => {
    vi.clearAllMocks();
    _selectCallCount = 0;
    mockState.pendingOrders = [];
    mockState.existingPosition = undefined;
  });

  it("no-ops on a second concurrent invocation for the same user", async () => {
    // Block the first sync at the credentials await so the guard key stays set.
    let unblockFirst: () => void = () => {};
    mocks.getKalshiCredentials.mockReturnValueOnce(
      new Promise<typeof CONNECTED_CREDS>((resolve) => {
        unblockFirst = () => resolve(CONNECTED_CREDS);
      }),
    );

    // Start first sync without awaiting — it is now waiting for credentials.
    const sync1 = syncPendingOrders(7);

    // Yield to the event loop so sync1 has run up to the `await getKalshiCredentials`.
    await new Promise<void>((r) => setImmediate(r));

    // Second invocation for the same user should return immediately (guard fires).
    await syncPendingOrders(7);

    // Only one credentials call was made (the second invocation never reached it).
    expect(mocks.getKalshiCredentials).toHaveBeenCalledTimes(1);

    // Unblock the first sync so the test cleans up properly.
    unblockFirst();
    await sync1;
  });
});

describe("syncPendingOrders — order processing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _selectCallCount = 0;
    mockState.pendingOrders = [];
    mockState.existingPosition = undefined;
    mocks.getKalshiCredentials.mockResolvedValue(CONNECTED_CREDS);
    mocks.createPositionFromFill.mockResolvedValue(undefined);
    mocks.closePositionFromFill.mockResolvedValue(true);
  });

  it("does nothing when there are no pending orders in the ledger", async () => {
    mockState.pendingOrders = [];
    mocks.getKalshiOrderStatus.mockResolvedValue(null);

    await syncPendingOrders(7);

    expect(mocks.getKalshiOrderStatus).not.toHaveBeenCalled();
    expect(mocks.createPositionFromFill).not.toHaveBeenCalled();
  });

  it("creates a position record when a buy order has been filled", async () => {
    mockState.pendingOrders = [PENDING_BUY_ORDER];
    mockState.existingPosition = undefined; // no existing position
    mocks.getKalshiOrderStatus.mockResolvedValue({
      status: "filled",
      filledQuantity: 2,
      averagePrice: 0.44,
    });

    await syncPendingOrders(7);

    expect(mocks.createPositionFromFill).toHaveBeenCalledOnce();
    expect(mocks.createPositionFromFill).toHaveBeenCalledWith(
      7,
      PENDING_BUY_ORDER.orderId,
      PENDING_BUY_ORDER.marketId,
      PENDING_BUY_ORDER.side,
      2,
      0.44, // uses averagePrice when > 0
    );
  });

  it("skips position creation when an open position already exists (idempotency guard)", async () => {
    mockState.pendingOrders = [PENDING_BUY_ORDER];
    mockState.existingPosition = { id: 99, marketId: "KXTEST-1", positionStatus: "open" };
    mocks.getKalshiOrderStatus.mockResolvedValue({
      status: "filled",
      filledQuantity: 2,
      averagePrice: 0.44,
    });

    await syncPendingOrders(7);

    expect(mocks.createPositionFromFill).not.toHaveBeenCalled();
  });

  it("falls back to limitPrice when averagePrice is zero", async () => {
    mockState.pendingOrders = [PENDING_BUY_ORDER];
    mockState.existingPosition = undefined;
    mocks.getKalshiOrderStatus.mockResolvedValue({
      status: "filled",
      filledQuantity: 2,
      averagePrice: 0, // exchange did not return an average price
    });

    await syncPendingOrders(7);

    expect(mocks.createPositionFromFill).toHaveBeenCalledWith(
      7,
      PENDING_BUY_ORDER.orderId,
      PENDING_BUY_ORDER.marketId,
      PENDING_BUY_ORDER.side,
      2,
      PENDING_BUY_ORDER.limitPrice, // falls back to order's limitPrice
    );
  });

  it("calls closePositionFromFill when a sell/close order has been filled", async () => {
    mockState.pendingOrders = [PENDING_SELL_ORDER];
    mocks.getKalshiOrderStatus.mockResolvedValue({
      status: "filled",
      filledQuantity: 1,
      averagePrice: 0.62,
    });

    await syncPendingOrders(7);

    expect(mocks.closePositionFromFill).toHaveBeenCalledOnce();
    expect(mocks.closePositionFromFill).toHaveBeenCalledWith(
      7,
      PENDING_SELL_ORDER.marketId,
      PENDING_SELL_ORDER.side,
      1,
      0.62,
    );
    expect(mocks.createPositionFromFill).not.toHaveBeenCalled();
  });

  it("continues processing remaining orders when one order throws", async () => {
    const goodOrder = { ...PENDING_BUY_ORDER, orderId: "order-good", marketId: "KXTEST-GOOD" };
    const badOrder = { ...PENDING_BUY_ORDER, orderId: "order-bad", marketId: "KXTEST-BAD" };
    mockState.pendingOrders = [badOrder, goodOrder];
    mockState.existingPosition = undefined;

    mocks.getKalshiOrderStatus
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({ status: "filled", filledQuantity: 2, averagePrice: 0.44 });

    await syncPendingOrders(7);

    // The bad order threw, but the good order after it was still processed.
    expect(mocks.createPositionFromFill).toHaveBeenCalledOnce();
    expect(mocks.createPositionFromFill).toHaveBeenCalledWith(
      7,
      goodOrder.orderId,
      goodOrder.marketId,
      goodOrder.side,
      2,
      0.44,
    );
  });
});
