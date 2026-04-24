export type BacktestTradeInput = {
  marketId: string;
  entryPrice: number;
  exitPrice: number;
  size: number;
  entryTime: number;
  exitTime: number;
  pnl: number;
  pnlPercent: number;
  side: string;
};

export type ClosedPositionLike = {
  marketId: string;
  side: "yes" | "no";
  quantity: number;
  entryPrice: number;
  currentPrice?: number;
  realizedPnl?: number;
  openedAt?: string | Date | null;
  closedAt?: string | Date | null;
  positionStatus?: string;
};

const SAMPLE_MARKETS = [
  { marketId: "FED_CUT_JUN", side: "yes" },
  { marketId: "CPI_COOLING", side: "yes" },
  { marketId: "BTC_ABOVE_90K", side: "yes" },
  { marketId: "ELECTION_SWING_STATE", side: "no" },
  { marketId: "TESLA_DELIVERY_BEAT", side: "yes" },
  { marketId: "RECESSION_ODDS", side: "no" },
] as const;

const RETURN_PATTERN = [0.08, -0.03, 0.06, 0.04, -0.02, 0.05, 0.03, -0.01, 0.07, -0.025, 0.045, 0.035] as const;

function toTimestamp(value: string | Date | null | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildScenarioTrades(startDate: string, endDate: string, initialCapital: number): BacktestTradeInput[] {
  const start = new Date(`${startDate}T00:00:00.000Z`).getTime();
  const end = new Date(`${endDate}T00:00:00.000Z`).getTime();
  const span = Math.max(1, end - start);
  const tradeCount = Math.max(8, Math.min(18, Math.round(span / (1000 * 60 * 60 * 24 * 21))));
  const positionSize = Math.max(25, initialCapital * 0.08);

  return Array.from({ length: tradeCount }, (_, index) => {
    const template = SAMPLE_MARKETS[index % SAMPLE_MARKETS.length];
    const pnlPercent = RETURN_PATTERN[index % RETURN_PATTERN.length];
    const entryPrice = 0.42 + (index % 5) * 0.05;
    const entryTime = start + Math.round((span / tradeCount) * index);
    const exitTime = Math.min(end, entryTime + Math.round(span / tradeCount / 2));
    const priceMove = pnlPercent * entryPrice;
    const exitPrice = template.side === "yes" ? entryPrice + priceMove : entryPrice - priceMove;
    const pnl = pnlPercent * entryPrice * positionSize;

    return {
      marketId: `${template.marketId}_${index + 1}`,
      entryPrice,
      exitPrice,
      size: positionSize,
      entryTime,
      exitTime,
      pnl,
      pnlPercent,
      side: template.side,
    };
  });
}

export function mapClosedPositionsToBacktestTrades(positions: ClosedPositionLike[]): BacktestTradeInput[] {
  return positions
    .filter(position => position.positionStatus === "closed" && Number(position.quantity) > 0)
    .map((position, index) => {
      const size = Number(position.quantity) || 0;
      const entryPrice = Number(position.entryPrice) || 0;
      const pnl = Number(position.realizedPnl) || 0;
      const inferredExitPrice = size > 0 ? entryPrice + pnl / size : Number(position.currentPrice ?? entryPrice);
      const capitalAtRisk = Math.max(size * Math.max(entryPrice, 0.01), 1);
      const pnlPercent = pnl / capitalAtRisk;
      const fallbackStart = Date.now() - (positions.length - index) * 60_000;
      const entryTime = toTimestamp(position.openedAt, fallbackStart);
      const exitTime = toTimestamp(position.closedAt, entryTime + 60_000);

      return {
        marketId: position.marketId,
        entryPrice,
        exitPrice: inferredExitPrice,
        size,
        entryTime,
        exitTime: Math.max(exitTime, entryTime),
        pnl,
        pnlPercent,
        side: position.side,
      };
    })
    .sort((a, b) => a.exitTime - b.exitTime);
}

export function chooseBacktestMode(liveTradeCount: number, requestedMode: "live" | "scenario") {
  if (requestedMode === "live" && liveTradeCount === 0) {
    return "scenario" as const;
  }

  return requestedMode;
}
