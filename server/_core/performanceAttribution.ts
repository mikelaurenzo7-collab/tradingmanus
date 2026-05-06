export interface AttributionInput {
  side: "yes" | "no";
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  signalConfidence?: number;
  benchmarkWinRate?: number;
  expectedSlippagePct?: number;
}

export interface AttributionBreakdown {
  totalPnl: number;
  signalAlpha: number;
  execution: number;
  timing: number;
  luck: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function calculateAttributionBreakdown(input: AttributionInput): AttributionBreakdown {
  const quantity = Math.max(0, input.quantity);
  const entryPrice = Math.max(0, input.entryPrice);
  const exitPrice = Math.max(0, input.exitPrice);

  const totalPnl = input.side === "no"
    ? quantity * (entryPrice - exitPrice)
    : quantity * (exitPrice - entryPrice);

  const confidence = clamp(input.signalConfidence ?? 0.5, 0, 1);
  const benchmark = clamp(input.benchmarkWinRate ?? 0.5, 0, 1);
  const confidenceEdge = confidence - benchmark;

  const signalAlpha = totalPnl * clamp(confidenceEdge * 1.2, -1, 1);

  const expectedSlippagePct = Math.max(0, input.expectedSlippagePct ?? 0.005);
  const notional = quantity * entryPrice;
  const execution = -notional * expectedSlippagePct;

  const timing = totalPnl * 0.2;
  const luck = totalPnl - signalAlpha - execution - timing;

  return {
    totalPnl,
    signalAlpha,
    execution,
    timing,
    luck,
  };
}

export function calculateSharpeBySource(rows: AttributionBreakdown[]): {
  signalAlpha: number;
  execution: number;
  timing: number;
  luck: number;
} {
  const keys: Array<keyof Omit<AttributionBreakdown, "totalPnl">> = [
    "signalAlpha",
    "execution",
    "timing",
    "luck",
  ];

  const result: Record<string, number> = {};
  for (const key of keys) {
    const values = rows.map((row) => row[key]);
    if (values.length === 0) {
      result[key] = 0;
      continue;
    }
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const stdDev = Math.sqrt(variance);
    result[key] = stdDev > 0 ? mean / stdDev : 0;
  }

  return result as {
    signalAlpha: number;
    execution: number;
    timing: number;
    luck: number;
  };
}

export function identifyLosingPatterns(rows: Array<{
  signalType: string;
  category?: string | null;
  totalPnl: number;
}>): Array<{ signalType: string; category: string; avgPnl: number; trades: number }> {
  const groups = new Map<string, { signalType: string; category: string; pnl: number; trades: number }>();

  for (const row of rows) {
    const category = (row.category ?? "unknown").trim().toLowerCase() || "unknown";
    const key = `${row.signalType}::${category}`;
    const existing = groups.get(key) ?? { signalType: row.signalType, category, pnl: 0, trades: 0 };
    existing.pnl += row.totalPnl;
    existing.trades += 1;
    groups.set(key, existing);
  }

  return Array.from(groups.values())
    .map((group) => ({
      signalType: group.signalType,
      category: group.category,
      avgPnl: group.trades > 0 ? group.pnl / group.trades : 0,
      trades: group.trades,
    }))
    .filter((group) => group.trades >= 3 && group.avgPnl < 0)
    .sort((a, b) => a.avgPnl - b.avgPnl);
}
