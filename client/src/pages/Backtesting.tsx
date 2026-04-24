import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { BarChart3, Gauge, Shield, TrendingUp } from "lucide-react";

type TradeInput = {
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

const SAMPLE_MARKETS = [
  { marketId: "FED_CUT_JUN", side: "yes" },
  { marketId: "CPI_COOLING", side: "yes" },
  { marketId: "BTC_ABOVE_90K", side: "yes" },
  { marketId: "ELECTION_SWING_STATE", side: "no" },
  { marketId: "TESLA_DELIVERY_BEAT", side: "yes" },
  { marketId: "RECESSION_ODDS", side: "no" },
];

const RETURN_PATTERN = [0.08, -0.03, 0.06, 0.04, -0.02, 0.05, 0.03, -0.01, 0.07, -0.025, 0.045, 0.035];

function buildSampleTrades(startDate: string, endDate: string, initialCapital: number): TradeInput[] {
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

  const trades = useMemo(() => buildSampleTrades(startDate, endDate, initialCapital), [endDate, initialCapital, startDate]);

  const statsQuery = trpc.advanced.backtest.calculateBacktestStats.useQuery({ trades }, { enabled: trades.length > 0 });
  const equityQuery = trpc.advanced.backtest.calculateEquityCurve.useQuery(
    {
      trades,
      startingCapital: initialCapital,
    },
    { enabled: trades.length > 0 }
  );
  const monteCarloQuery = trpc.advanced.backtest.monteCarloSimulation.useQuery(
    {
      trades,
      iterations: 250,
    },
    { enabled: trades.length > 0 }
  );
  const walkForwardQuery = trpc.advanced.backtest.walkForwardValidation.useQuery(
    {
      trades,
      windowSize,
    },
    { enabled: trades.length >= windowSize }
  );

  const stats = statsQuery.data;
  const equityCurve = equityQuery.data ?? [];
  const monteCarlo = monteCarloQuery.data;
  const walkForward = walkForwardQuery.data ?? [];
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="mb-2 bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-4xl font-bold text-transparent">
              Backtesting
            </h1>
            <p className="max-w-3xl text-slate-400">
              Validate the trading stack with procedure-driven performance statistics, Monte Carlo robustness, and
              walk-forward windows derived from a configurable trade sample.
            </p>
          </div>

          <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-800 bg-slate-900/70 p-4 backdrop-blur-xl">
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
        </div>

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
              <p className="mt-2 text-sm text-slate-500">Synthetic trade sample generated from the selected period.</p>
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
              <p className="mt-2 text-sm text-slate-500">Share of simulated trades that closed with positive P&amp;L.</p>
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
              <p className="mt-2 text-sm text-slate-500">Annualized return efficiency based on the simulated trade-return stream.</p>
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
                Procedure-driven metrics from the current trade sample, ready for benchmarking and strategy comparisons.
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
                Cumulative account value across the simulated trade sequence from the current scenario inputs.
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

        {(statsQuery.error || equityQuery.error || monteCarloQuery.error || walkForwardQuery.error) && (
          <Card className="border border-rose-900/60 bg-rose-950/30 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-rose-300">Backtesting Pipeline Unavailable</CardTitle>
              <CardDescription className="text-rose-200/80">
                One or more analytics procedures failed while processing the current scenario.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-rose-100/90">
                {statsQuery.error?.message ?? equityQuery.error?.message ?? monteCarloQuery.error?.message ?? walkForwardQuery.error?.message}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
