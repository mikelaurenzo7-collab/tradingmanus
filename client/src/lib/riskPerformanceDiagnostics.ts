export function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

export function summarizeRiskBudget(currentBalance: number, maxLossPerTrade: number, maxLossPerDay: number) {
  const safeBalance = Math.max(currentBalance, 1);
  return {
    perTradeUsage: maxLossPerTrade / safeBalance,
    dailyUsage: maxLossPerDay / safeBalance,
  };
}

export function classifyRiskPosture(alertCount: number, hardStopsHit: number) {
  if (hardStopsHit > 0) return "critical" as const;
  if (alertCount > 0) return "elevated" as const;
  return "stable" as const;
}

export function summarizeLearningMetrics(metrics: {
  avgWin: number;
  avgLoss: number;
  breakevenTrades: number;
  profitFactor: number;
  recoveryFactor: number;
}) {
  const edgeRatio = metrics.avgLoss > 0 ? metrics.avgWin / metrics.avgLoss : 0;

  return {
    edgeRatio,
    breakevenTrades: metrics.breakevenTrades,
    profitFactor: Number.isFinite(metrics.profitFactor) ? metrics.profitFactor : 0,
    recoveryFactor: Number.isFinite(metrics.recoveryFactor) ? metrics.recoveryFactor : 0,
  };
}
