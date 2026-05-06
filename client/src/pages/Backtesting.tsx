import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { chooseBacktestMode, buildScenarioTrades, mapClosedPositionsToBacktestTrades } from "@/lib/backtesting";
import { BarChart3, History, Loader2, ActivitySquare } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/widgets/StatCard";
import { PerformanceChart } from "@/components/charts/PerformanceChart";
import { DistributionChart } from "@/components/charts/DistributionChart";
import { EnhancedTable, Column } from "@/components/enhanced/Table";
import { EmptyState } from "@/components/EmptyStates";
import { chartColors } from "@/lib/chartTheme";

type AnalysisMode = "live" | "scenario";

type TradeHistoryRow = {
  marketId: string;
  side: "yes" | "no";
  quantity: number;
  entryPrice: number;
  currentPrice: number;
  realizedPnl: number;
  positionStatus: "open" | "closed";
  openedAt?: string | Date | null;
  closedAt?: string | Date | null;
};

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function Backtesting() {
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [initialCapital, setInitialCapital] = useState(2500);
  const [windowSize, setWindowSize] = useState(4);
  const [mode, setMode] = useState<AnalysisMode>("live");

  const tradeHistoryQuery = trpc.kalshi.getTradeHistory.useQuery({ limit: 200 });
  const capitalQuery = trpc.kalshi.getCapital.useQuery();
  const runAnalysisMutation = trpc.advanced.backtest.runAnalysis.useMutation();
  const lastAnalysisSignatureRef = useRef<string>("");

  const liveTrades = useMemo(
    () => mapClosedPositionsToBacktestTrades((tradeHistoryQuery.data ?? []) as TradeHistoryRow[]),
    [tradeHistoryQuery.data],
  );

  useEffect(() => {
    if (mode === "live" && liveTrades.length === 0 && !tradeHistoryQuery.isLoading) {
      setMode("scenario");
    }
  }, [liveTrades.length, mode, tradeHistoryQuery.isLoading]);

  const effectiveMode = chooseBacktestMode(liveTrades.length, mode);
  const scenarioTrades = useMemo(
    () => buildScenarioTrades(startDate, endDate, initialCapital),
    [endDate, initialCapital, startDate],
  );

  const trades = effectiveMode === "live" ? liveTrades : scenarioTrades;
  const effectiveStartingCapital =
    effectiveMode === "live"
      ? Math.max(0, Number(capitalQuery.data?.currentBalance ?? capitalQuery.data?.startingBalance ?? 0))
      : initialCapital;

  useEffect(() => {
    if (
      tradeHistoryQuery.isLoading ||
      capitalQuery.isLoading ||
      trades.length === 0 ||
      runAnalysisMutation.isPending
    ) {
      return;
    }

    const signature = JSON.stringify({
      effectiveMode,
      effectiveStartingCapital,
      iterations: 250,
      windowSize,
      trades,
    });

    if (lastAnalysisSignatureRef.current === signature) {
      return;
    }

    lastAnalysisSignatureRef.current = signature;
    runAnalysisMutation.mutate({
      trades,
      startingCapital: effectiveStartingCapital,
      iterations: 250,
      windowSize,
    });
  }, [
    capitalQuery.isLoading,
    effectiveMode,
    effectiveStartingCapital,
    runAnalysisMutation,
    tradeHistoryQuery.isLoading,
    trades,
    windowSize,
  ]);

  const stats = runAnalysisMutation.data?.stats;
  const equityCurve = runAnalysisMutation.data?.equityCurve ?? [];
  const monteCarlo = runAnalysisMutation.data?.monteCarlo;
  const walkForward = runAnalysisMutation.data?.walkForward ?? [];

  const walkForwardConsistency = useMemo(() => {
    if (walkForward.length === 0) {
      return { averageWinRate: 0, volatility: 0, stable: false };
    }

    const winRates = walkForward.map((window) => window.winRate);
    const averageWinRate = winRates.reduce((sum, value) => sum + value, 0) / winRates.length;
    const variance = winRates.reduce((sum, value) => sum + Math.pow(value - averageWinRate, 2), 0) / winRates.length;
    const volatility = Math.sqrt(variance);

    return {
      averageWinRate,
      volatility,
      stable: volatility < 0.1,
    };
  }, [walkForward]);

  const equityRange = useMemo(() => {
    if (equityCurve.length === 0) return { min: 0, max: 1 };
    return {
      min: Math.min(...equityCurve),
      max: Math.max(...equityCurve),
    };
  }, [equityCurve]);

  const sourceDescription =
    effectiveMode === "live"
      ? `Using ${liveTrades.length} closed trades from your stored Kalshi trade history.`
      : "Using a configurable scenario trade sample so you can explore behavior before live fills accumulate.";

  const isLoadingAny = tradeHistoryQuery.isLoading || capitalQuery.isLoading || runAnalysisMutation.isPending;

  // Build trade-by-trade table data
  const tradeTableData = useMemo(() => {
    if (!trades?.length) return [];
    return trades.map((trade, index) => ({
      id: index + 1,
      marketId: trade.marketId || `trade-${index}`,
      side: trade.side,
      pnl: trade.pnl,
      profit: trade.pnl > 0,
      pnlFormatted: formatCurrency(trade.pnl),
    }));
  }, [trades]);

  const tradeTableColumns: Column<typeof tradeTableData[number]>[] = [
    { key: 'id', header: '#', width: 60 },
    { key: 'marketId', header: 'Market', sortable: true },
    { key: 'side', header: 'Side', width: 80, render: (val) => String(val).toUpperCase() },
    {
      key: 'pnl',
      header: 'P&L',
      sortable: true,
      render: (_, row) => (
        <span className={row.profit ? 'text-emerald-400 font-semibold' : 'text-rose-400 font-semibold'}>
          {row.pnlFormatted}
        </span>
      ),
    },
  ];

  // Build distribution data for wins/losses
  const distributionData = useMemo(() => {
    if (!stats) return [];
    const wins = stats.totalTrades * stats.winRate;
    const losses = stats.totalTrades * (1 - stats.winRate);
    return [
      { label: 'Wins', value: wins, color: chartColors[0] },
      { label: 'Losses', value: losses, color: chartColors[3] },
    ];
  }, [stats]);

  // Build performance chart data from equity curve
  const performanceData = useMemo(() => {
    return equityCurve.map((value, index) => ({
      index,
      equity: value,
    }));
  }, [equityCurve]);

  return (
    <div className="space-y-8 max-w-7xl mx-auto animate-fade-in">
      <PageHeader
        icon={ActivitySquare}
        iconColor="text-primary"
        title="Backtesting"
        description="Validate the trading stack with procedure-driven performance statistics, Monte Carlo robustness, and walk-forward analysis using either real closed trades or a scenario sandbox."

        actions={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={effectiveMode === "live" ? "default" : "outline"}
              onClick={() => setMode("live")}
              disabled={liveTrades.length === 0}
              className={
                effectiveMode === "live"
                  ? "bg-gradient-to-r from-cyan-500 to-violet-500 text-white"
                  : "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
              }
            >
              <History className="mr-2 h-4 w-4" />
              Live Trade History
            </Button>
            <Button
              type="button"
              variant={effectiveMode === "scenario" ? "default" : "outline"}
              onClick={() => setMode("scenario")}
              className={
                effectiveMode === "scenario"
                  ? "bg-gradient-to-r from-fuchsia-500 to-cyan-500 text-white"
                  : "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
              }
            >
              Scenario Sandbox
            </Button>
            {liveTrades.length === 0 ? (
              <p className="basis-full text-xs text-slate-500">
                Live trade-history mode unlocks after your first closed Kalshi trade. Use the scenario sandbox until then.
              </p>
            ) : null}
          </div>
        }
      />

        <Card className="glass-panel animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <CardHeader>
            <CardTitle>Analysis Source</CardTitle>
            <CardDescription>{sourceDescription}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Closed Live Trades</div>
                <div className="mt-2 text-2xl font-semibold text-cyan-300">{liveTrades.length}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Working Sample Size</div>
                <div className="mt-2 text-2xl font-semibold text-emerald-300">{trades.length}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Starting Capital</div>
                <div className="mt-2 text-2xl font-semibold text-fuchsia-300">{formatCurrency(effectiveStartingCapital)}</div>
              </div>
            </div>

            {effectiveMode === "scenario" && (
              <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-800 bg-slate-950/60 p-4">
                <div>
                  <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">Start Date</div>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                    className="border-slate-700 bg-slate-950 text-slate-100"
                  />
                </div>
                <div>
                  <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">End Date</div>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                    className="border-slate-700 bg-slate-950 text-slate-100"
                  />
                </div>
                <div>
                  <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">Initial Capital</div>
                  <Input
                    type="number"
                    min="100"
                    step="100"
                    value={initialCapital}
                    onChange={(event) => setInitialCapital(Math.max(100, Number(event.target.value) || 100))}
                    className="w-32 border-slate-700 bg-slate-950 text-slate-100"
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setStartDate("2024-01-01");
                      setEndDate("2024-12-31");
                      setInitialCapital(2500);
                      setWindowSize(4);
                    }}
                    className="border-slate-700 bg-slate-950 text-slate-200 hover:bg-slate-900"
                  >
                    Reset Scenario
                  </Button>
                </div>
              </div>
            )}

            <div>
              <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">Walk-Forward Window</div>
              <Input
                type="number"
                min="2"
                max="8"
                step="1"
                value={windowSize}
                onChange={(event) => setWindowSize(Math.max(2, Number(event.target.value) || 2))}
                className="w-28 border-slate-700 bg-slate-950 text-slate-100"
              />
            </div>
          </CardContent>
        </Card>

        {trades.length === 0 && !isLoadingAny ? (
          <Card className="glass-panel">
            <CardContent className="pt-6">
              <EmptyState
                icon={BarChart3}
                title="No backtest run yet"
                message={"Configure your analysis source and parameters above to begin backtesting."}
              />
            </CardContent>
          </Card>
        ) : isLoadingAny ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 animate-fade-in" style={{ animationDelay: '0.2s' }}>
            <StatCard label="Total Trades" value="0" loading />
            <StatCard label="Win Rate" value="0%" loading />
            <StatCard label="Sharpe Ratio" value="0.00" loading />
            <StatCard label="Max Drawdown" value="0%" loading />
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 animate-fade-in" style={{ animationDelay: '0.2s' }}>
              <StatCard
                label="Total Return"
                value={formatPercent(stats?.totalReturn ?? 0)}
                icon={<BarChart3 className="h-5 w-5" />}
                color="#06b6d4"
              />
              <StatCard
                label="Win Rate"
                value={formatPercent(stats?.winRate ?? 0)}
                change={stats ? (stats.winRate - 0.5) * 100 : undefined}
                icon={<History className="h-5 w-5" />}
                color="#10b981"
              />
              <StatCard
                label="Sharpe Ratio"
                value={(stats?.sharpeRatio ?? 0).toFixed(2)}
                icon={<ActivitySquare className="h-5 w-5" />}
                color="#d946ef"
              />
              <StatCard
                label="Max Drawdown"
                value={formatPercent(stats?.maxDrawdown ?? 0)}
                icon={<Loader2 className="h-5 w-5" />}
                color="#f59e0b"
              />
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr] animate-fade-in" style={{ animationDelay: '0.3s' }}>
              <Card className="glass-panel">
                <CardHeader>
                  <CardTitle>Backtest Summary</CardTitle>
                  <CardDescription>
                    Procedure-driven metrics from the current trade set, ready for benchmarking and strategy comparisons.
                  </CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total P&amp;L</div>
                    <div className="mt-2 text-2xl font-semibold text-emerald-300">{formatCurrency(stats?.totalPnL ?? 0)}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Total Return</div>
                    <div className="mt-2 text-2xl font-semibold text-cyan-300">{formatPercent(stats?.totalReturn ?? 0)}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Profit Factor</div>
                    <div className="mt-2 text-2xl font-semibold text-violet-300">{(stats?.profitFactor ?? 0).toFixed(2)}</div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Average Win / Loss</div>
                    <div className="mt-2 text-lg font-semibold text-slate-100">
                      {formatCurrency(stats?.averageWin ?? 0)} / {formatCurrency(stats?.averageLoss ?? 0)}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardHeader>
                  <CardTitle>Monte Carlo Robustness</CardTitle>
                  <CardDescription>
                    Randomized path analysis across the same trade-distribution profile to assess return dispersion.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Average Simulated Return</div>
                    <div className="mt-2 text-2xl font-semibold text-emerald-300">{formatPercent(monteCarlo?.avgReturn ?? 0)}</div>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Best Case</div>
                      <div className="mt-2 text-xl font-semibold text-cyan-300">{formatPercent(monteCarlo?.bestCase ?? 0)}</div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Worst Case</div>
                      <div className="mt-2 text-xl font-semibold text-rose-300">{formatPercent(monteCarlo?.worstCase ?? 0)}</div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Dispersion</div>
                    <div className="mt-2 text-xl font-semibold text-slate-100">{formatPercent(monteCarlo?.stdDev ?? 0)}</div>
                    <p className="mt-2 text-xs text-slate-500">Higher values indicate more unstable outcome paths under resampling.</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr] animate-fade-in" style={{ animationDelay: '0.4s' }}>
              <Card className="glass-panel">
                <CardHeader>
                  <CardTitle>Equity Curve</CardTitle>
                  <CardDescription>
                    Cumulative account value across the analyzed trade sequence for the active source mode.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <PerformanceChart
                    data={performanceData}
                    series={[{ key: 'equity', name: 'Portfolio Value', color: '#06b6d4' }]}
                    height={300}
                    areaShading
                    formatY={(val) => formatCurrency(val)}
                  />
                </CardContent>
              </Card>

              <Card className="glass-panel">
                <CardHeader>
                  <CardTitle>Walk-Forward Validation</CardTitle>
                  <CardDescription>
                    Segment the trade sequence into rolling windows to check whether edge quality is stable across periods.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Average Window Win Rate</div>
                    <div className="mt-2 text-2xl font-semibold text-slate-100">{formatPercent(walkForwardConsistency.averageWinRate)}</div>
                    <p className="mt-2 text-xs text-slate-500">
                      Stability flag: {walkForwardConsistency.stable ? "consistent enough for refinement" : "volatile across windows"}.
                    </p>
                  </div>

                  <div className="space-y-3">
                    {walkForward.length ? (
                      walkForward.map((window, index) => (
                        <div key={`window-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                          <div className="flex items-center justify-between gap-4">
                            <div>
                              <div className="text-sm font-medium text-slate-100">Window {index + 1}</div>
                              <div className="mt-1 text-xs text-slate-500">{window.totalTrades} trades</div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm font-semibold text-emerald-300">{formatPercent(window.winRate)}</div>
                              <div className="text-xs text-slate-500">volatility {formatPercent(walkForwardConsistency.volatility)}</div>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 p-6 text-sm text-slate-500">
                        Increase the time span or reduce the walk-forward window to generate comparison periods.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            {distributionData.length > 0 && (
              <Card className="glass-panel animate-fade-in" style={{ animationDelay: '0.5s' }}>
                <CardHeader>
                  <CardTitle>Trade Outcome Distribution</CardTitle>
                  <CardDescription>Win/loss breakdown across the analyzed trade sequence.</CardDescription>
                </CardHeader>
                <CardContent>
                  <DistributionChart
                    data={distributionData}
                    height={200}
                    formatValue={(val) => val.toFixed(0)}
                  />
                </CardContent>
              </Card>
            )}

            {tradeTableData.length > 0 && (
              <Card className="glass-panel animate-fade-in" style={{ animationDelay: '0.6s' }}>
                <CardHeader>
                  <CardTitle>Trade-by-Trade Results</CardTitle>
                  <CardDescription>Detailed breakdown of each trade in the backtest sequence.</CardDescription>
                </CardHeader>
                <CardContent>
                  <EnhancedTable
                    columns={tradeTableColumns}
                    data={tradeTableData}
                    stickyHeader
                    zebraStriping
                    hoverGlow
                  />
                </CardContent>
              </Card>
            )}
          </>
        )}

        {(tradeHistoryQuery.error || capitalQuery.error || runAnalysisMutation.error) && (
          <Card className="glass-panel border-rose-900/60 bg-rose-950/30">
            <CardHeader>
              <CardTitle className="text-rose-300">Backtesting Pipeline Unavailable</CardTitle>
              <CardDescription className="text-rose-200/80">
                One or more analytics procedures failed while processing the active trade source.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-rose-100/90">
                {tradeHistoryQuery.error?.message ?? capitalQuery.error?.message ?? runAnalysisMutation.error?.message}
              </p>
            </CardContent>
          </Card>
        )}
    </div>
  );
}
