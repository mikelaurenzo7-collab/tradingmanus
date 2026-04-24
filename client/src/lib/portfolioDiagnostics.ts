type EditableSignal = {
  marketId: string;
  side: string;
  confidence: number;
  expectedValue: number;
};

type PortfolioPosition = {
  marketId: string;
  side: string;
  size: number;
  expectedReturn: number;
  risk: number;
};

type OptimizedPortfolio = {
  positions: PortfolioPosition[];
  expectedReturn: number;
  portfolioRisk: number;
  diversificationScore: number;
  kellyFraction: number;
};

export function getSignalKey(signal: Pick<EditableSignal, "marketId" | "side">) {
  return `${signal.marketId}:${signal.side}`;
}

export function buildSelectedPositionMap(portfolio?: OptimizedPortfolio | null) {
  return new Map((portfolio?.positions ?? []).map((position) => [getSignalKey(position), position]));
}

export function summarizePortfolioDeployment(equity: number, portfolio?: OptimizedPortfolio | null) {
  const capitalAllocated = portfolio?.positions.reduce((sum, position) => sum + position.size, 0) ?? 0;
  const allocationRatio = equity > 0 ? capitalAllocated / equity : 0;
  const remainingCash = Math.max(0, equity - capitalAllocated);

  return {
    capitalAllocated,
    allocationRatio,
    remainingCash,
    selectedCount: portfolio?.positions.length ?? 0,
  };
}

export function splitSignalsBySelection(signals: EditableSignal[], portfolio?: OptimizedPortfolio | null) {
  const selected = buildSelectedPositionMap(portfolio);

  return signals.reduce(
    (result, signal) => {
      if (selected.has(getSignalKey(signal))) {
        result.selected.push(signal);
      } else {
        result.excluded.push(signal);
      }
      return result;
    },
    { selected: [] as EditableSignal[], excluded: [] as EditableSignal[] },
  );
}
