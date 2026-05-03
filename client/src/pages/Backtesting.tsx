import { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { chooseBacktestMode, buildScenarioTrades, mapClosedPositionsToBacktestTrades } from "@/lib/backtesting";
import { BarChart3, Gauge, History, Loader2, Shield, TrendingUp } from "lucide-react";

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

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="mb-2 bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-4xl font-bold text-transparent">
              Backtesting
            </h1>
            <p className="max-w-3xl text-slate-400">
              Validate the trading stack with procedure-driven performance statistics, Monte Carlo robustness, and
              walk-forward analysis using either real closed trades or a scenario sandbox.
            </p>
          </div>

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
        </div>

        <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
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

        {isLoadingAny ? (
          <div className="flex min-h-[18rem] items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/50">
            <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
          </div>
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                    <BarChart3 className="h-5 w-5 text-cyan-400" />
                    Total Trades
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold text-cyan-300">{stats?.totalTrades ?? 0}</div>
                  <p className="mt-2 text-sm text-slate-500">
                    {effectiveMode === "live" ? "Closed trades pulled from your saved Kalshi history." : "Scenario-generated trades from the selected date range."}
                  </p>
                </CardContent>
              </Card>

              <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                    <TrendingUp className="h-5 w-5 text-emerald-400" />
                    Win Rate
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold text-emerald-300">{formatPercent(stats?.winRate ?? 0)}</div>
                  <p className="mt-2 text-sm text-slate-500">Share of analyzed trades that closed with positive P&amp;L.</p>
                </CardContent>
              </Card>

              <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                    <Gauge className="h-5 w-5 text-fuchsia-400" />
                    Sharpe Ratio
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold text-fuchsia-300">{(stats?.sharpeRatio ?? 0).toFixed(2)}</div>
                  <p className="mt-2 text-sm text-slate-500">Annualized return efficiency based on the selected trade-return stream.</p>
                </CardContent>
              </Card>

              <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                    <Shield className="h-5 w-5 text-amber-400" />
                    Max Drawdown
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-semibold text-amber-300">{formatPercent(stats?.maxDrawdown ?? 0)}</div>
                  <p className="mt-2 text-sm text-slate-500">Worst peak-to-trough capital decline along the equity curve.</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
              <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
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

              <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
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

            <div className="grid gap-6 xl:grid-cols-[1.15fr_0.85fr]">
              <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
                <CardHeader>
                  <CardTitle>Equity Curve</CardTitle>
                  <CardDescription>
                    Cumulative account value across the analyzed trade sequence for the active source mode.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid h-72 grid-cols-12 items-end gap-2 rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                    {equityCurve.slice(1).map((value, index) => {
                      const span = Math.max(1, equityRange.max - equityRange.min);
                      const height = 18 + ((value - equityRange.min) / span) * 82;
                      return (
                        <div key={`${value}-${index}`} className="flex h-full items-end">
                          <div
                            className="w-full rounded-t-lg bg-gradient-to-t from-cyan-500 via-violet-500 to-fuchsia-500"
                            style={{ height: `${height}%` }}
                            title={`Trade ${index + 1}: ${formatCurrency(value)}`}
                          />
                        </div>
                      );
                    })}
                  </div>
                </CardContent>
              </Card>

              <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
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
          </>
        )}

        {(tradeHistoryQuery.error || capitalQuery.error || runAnalysisMutation.error) && (
          <Card className="border border-rose-900/60 bg-rose-950/30 backdrop-blur-xl">
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
