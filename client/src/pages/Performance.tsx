import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
import {
  formatCurrency,
  formatPercent,
  summarizeLearningMetrics,
} from "@/lib/riskPerformanceDiagnostics";
import { BrainCircuit, CandlestickChart, CircleOff, DollarSign, Sparkles, TrendingUp } from "lucide-react";

export default function Performance() {
  const performanceOverviewQuery = trpc.kalshi.getPerformanceOverview.useQuery();

  const performanceOverview = performanceOverviewQuery.data;
  const performanceMetrics = performanceOverview?.metrics;
  const signalPerformance = performanceOverview?.signalPerformance ?? [];
  const hasTradeHistory = (performanceMetrics?.totalTrades ?? 0) > 0;

  const realizedPnL = performanceMetrics?.realizedPnL ?? 0;
  const unrealizedPnL = performanceMetrics?.unrealizedPnL ?? 0;
  const dailyPnL = performanceMetrics?.dailyPnL ?? 0;
  const activePositions = performanceMetrics?.activePositions ?? 0;
  const learning = summarizeLearningMetrics({
    avgWin: performanceMetrics?.avgWin ?? 0,
    avgLoss: performanceMetrics?.avgLoss ?? 0,
    breakevenTrades: performanceMetrics?.breakevenTrades ?? 0,
    profitFactor: performanceMetrics?.profitFactor ?? 0,
    recoveryFactor: performanceMetrics?.recoveryFactor ?? 0,
  });

  const attributionCards = [
    {
      label: "Realized P&L",
      value: formatCurrency(realizedPnL),
      description: "Closed-trade contribution",
      tone: realizedPnL >= 0 ? "text-green-400" : "text-red-400",
    },
    {
      label: "Unrealized P&L",
      value: formatCurrency(unrealizedPnL),
      description: "Open-position contribution",
      tone: unrealizedPnL >= 0 ? "text-cyan-400" : "text-red-400",
    },
    {
      label: "Daily P&L",
      value: formatCurrency(dailyPnL),
      description: "Current trading-day impact",
      tone: dailyPnL >= 0 ? "text-emerald-400" : "text-orange-400",
    },
    {
      label: "Active Positions",
      value: activePositions.toString(),
      description: "Currently contributing live risk",
      tone: "text-violet-400",
    },
  ];
  const topSignal = signalPerformance[0];
  const weakestSignal = signalPerformance.at(-1);

  const metricCards = [
    {
      label: "Sharpe Ratio",
      value: performanceMetrics?.sharpeRatio?.toFixed(2) ?? "0.00",
      description: "Risk-adjusted returns",
      icon: <TrendingUp className="h-5 w-5 text-violet-300" />,
    },
    {
      label: "Max Drawdown",
      value: formatPercent(performanceMetrics?.maxDrawdown ?? 0),
      description: "Peak-to-trough decline",
      icon: <CandlestickChart className="h-5 w-5 text-rose-300" />,
    },
    {
      label: "Win Rate",
      value: formatPercent(performanceMetrics?.winRate ?? 0),
      description: "Winning trades ratio",
      icon: <Sparkles className="h-5 w-5 text-emerald-300" />,
    },
    {
      label: "Total P&L",
      value: formatCurrency(performanceMetrics?.totalPnL ?? 0),
      description: "Realized plus unrealized",
      icon: <DollarSign className="h-5 w-5 text-cyan-300" />,
    },
  ];

  if (performanceOverviewQuery.isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-slate-400">
        Loading performance metrics...
      </div>
    );
  }

  if (performanceOverviewQuery.isError) {
    return (
      <Card className="border border-red-500/50 bg-red-950/20">
        <CardContent className="pt-6">
          <p className="text-red-400">Failed to load performance metrics. Please try again.</p>
          <Button onClick={() => performanceOverviewQuery.refetch()} className="mt-4">
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="mx-auto max-w-7xl space-y-8">
        <div>
          <h1 className="mb-2 bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-4xl font-bold text-transparent">
            Performance Metrics
          </h1>
          <p className="text-slate-400">
            Track trading quality, capital attribution, and signal-learning posture from real Kalshi activity.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {metricCards.map((metric) => (
            <Card key={metric.label} className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-slate-300">{metric.label}</CardTitle>
                  {metric.icon}
                </div>
              </CardHeader>
              <CardContent>
                <div className="mb-1 text-3xl font-bold text-slate-100">{metric.value}</div>
                <p className="text-xs text-slate-500">{metric.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {attributionCards.map((metric) => (
            <Card key={metric.label} className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-slate-300">{metric.label}</CardTitle>
                <CardDescription>{metric.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${metric.tone}`}>{metric.value}</div>
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="grid gap-4 xl:grid-cols-3">
          <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-100">
                <BrainCircuit className="h-5 w-5 text-violet-300" />
                Learning Diagnostics
              </CardTitle>
              <CardDescription>Backend-derived trade learning metrics that help rank edge quality.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Average Win / Loss</p>
                <p className="mt-2 text-xl font-semibold text-slate-100">
                  {formatCurrency(performanceMetrics?.avgWin ?? 0)} / {formatCurrency(performanceMetrics?.avgLoss ?? 0)}
                </p>
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Edge Ratio</p>
                <p className="mt-2 text-xl font-semibold text-emerald-300">{learning.edgeRatio.toFixed(2)}x</p>
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Profit / Recovery</p>
                <p className="mt-2 text-xl font-semibold text-cyan-300">
                  {learning.profitFactor.toFixed(2)} / {learning.recoveryFactor.toFixed(2)}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-100">
                <CircleOff className="h-5 w-5 text-amber-300" />
                Trade Outcome Mix
              </CardTitle>
              <CardDescription>Closed-trade result composition from the performance engine.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-3 xl:grid-cols-1">
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Winning Trades</p>
                <p className="mt-2 text-xl font-semibold text-emerald-300">{performanceMetrics?.winningTrades ?? 0}</p>
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Losing Trades</p>
                <p className="mt-2 text-xl font-semibold text-rose-300">{performanceMetrics?.losingTrades ?? 0}</p>
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Breakeven Trades</p>
                <p className="mt-2 text-xl font-semibold text-amber-300">{learning.breakevenTrades}</p>
              </div>
            </CardContent>
          </Card>

          <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-slate-100">
                <Sparkles className="h-5 w-5 text-cyan-300" />
                Operator Guidance
              </CardTitle>
              <CardDescription>Practical takeaways from the current performance posture.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-slate-300">
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
                <span className="font-medium text-slate-100">Sizing posture:</span>{" "}
                {learning.edgeRatio >= 1.5
                  ? "Average wins still exceed average losses by a healthy margin."
                  : "Edge compression is visible; reduce size until win/loss asymmetry improves."}
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
                <span className="font-medium text-slate-100">Recovery posture:</span>{" "}
                {learning.recoveryFactor >= 1
                  ? "Recovered capital remains ahead of drawdown pressure."
                  : "Recovery factor is weak relative to recent stress and should be monitored closely."}
              </div>
              <div className="rounded-xl border border-slate-700/60 bg-slate-900/40 p-3">
                <span className="font-medium text-slate-100">Signal posture:</span>{" "}
                {topSignal
                  ? `Favor ${topSignal.signalType.replaceAll("_", " ")} while weaker cohorts are reevaluated.`
                  : "Generate more closed trades to unlock stronger strategy-level ranking confidence."}
              </div>
            </CardContent>
          </Card>
        </div>

        {(topSignal || weakestSignal) && (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
              <CardHeader>
                <CardTitle>Strategy Leaderboard</CardTitle>
                <CardDescription>
                  The learning loop ranks signal families by realized quality and confidence.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {topSignal && (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-emerald-300">Highest Conviction</p>
                    <p className="mt-2 text-xl font-semibold capitalize text-slate-100">
                      {topSignal.signalType.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      {topSignal.recommendation.replaceAll("_", " ")} with {(topSignal.successRate * 100).toFixed(1)}% win rate across {topSignal.totalSignals} signals.
                    </p>
                  </div>
                )}
                {weakestSignal && weakestSignal !== topSignal && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
                    <p className="text-xs uppercase tracking-[0.2em] text-amber-300">Needs Adjustment</p>
                    <p className="mt-2 text-xl font-semibold capitalize text-slate-100">
                      {weakestSignal.signalType.replaceAll("_", " ")}
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      Recommendation: {weakestSignal.recommendation.replaceAll("_", " ")} based on {formatCurrency(weakestSignal.totalPnL)} realized P&amp;L.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
              <CardHeader>
                <CardTitle>Capital Summary</CardTitle>
                <CardDescription>
                  {hasTradeHistory
                    ? "Account balance and trading statistics"
                    : "Account balance is real, trade metrics will populate after closed trades"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="border-l-4 border-violet-500 pl-4">
                    <p className="mb-1 text-sm text-slate-500">Starting Balance</p>
                    <p className="text-2xl font-bold text-slate-200">{formatCurrency(performanceOverview?.startingBalance ?? 0)}</p>
                  </div>
                  <div className="border-l-4 border-cyan-500 pl-4">
                    <p className="mb-1 text-sm text-slate-500">Current Balance</p>
                    <p className="text-2xl font-bold text-slate-200">{formatCurrency(performanceOverview?.currentBalance ?? 0)}</p>
                  </div>
                  <div className={`border-l-4 ${(performanceMetrics?.totalPnL ?? 0) >= 0 ? "border-green-500" : "border-red-500"} pl-4`}>
                    <p className="mb-1 text-sm text-slate-500">Return on Capital</p>
                    <p className={`text-2xl font-bold ${(performanceMetrics?.totalPnL ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}>
                      {performanceOverview && performanceOverview.startingBalance > 0
                        ? `${(((performanceMetrics?.totalPnL ?? 0) / performanceOverview.startingBalance) * 100).toFixed(1)}%`
                        : "0.0%"}
                    </p>
                  </div>
                </div>

                {!hasTradeHistory && (
                  <div className="mt-6 rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
                    Close a few trades to unlock richer learning signals, average-win diagnostics, and strategy promotion or demotion guidance.
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {signalPerformance.length > 0 && (
          <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle>Signal Performance by Type</CardTitle>
              <CardDescription>
                Win rates, realized P&amp;L, and recommendation quality for each signal family.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {signalPerformance.map((perf) => (
                  <div key={perf.signalType} className="rounded-lg border border-slate-700/50 bg-slate-900/30 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-semibold capitalize text-slate-200">{perf.signalType.replace("_", " ")}</h3>
                      <span className="text-sm text-slate-400">{perf.totalSignals} signals</span>
                    </div>

                    <div className="grid gap-4 md:grid-cols-5">
                      <div>
                        <p className="mb-1 text-xs text-slate-500">Win Rate</p>
                        <p className="text-lg font-bold text-green-400">{formatPercent(perf.successRate)}</p>
                      </div>
                      <div>
                        <p className="mb-1 text-xs text-slate-500">Avg Confidence</p>
                        <p className="text-lg font-bold text-violet-400">{perf.avgConfidence.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="mb-1 text-xs text-slate-500">Recommendation</p>
                        <p className="text-lg font-bold capitalize text-cyan-400">{perf.recommendation.replace("_", " ")}</p>
                      </div>
                      <div>
                        <p className="mb-1 text-xs text-slate-500">Realized P&amp;L</p>
                        <p className={`text-lg font-bold ${perf.totalPnL >= 0 ? "text-green-400" : "text-red-400"}`}>{formatCurrency(perf.totalPnL)}</p>
                      </div>
                      <div>
                        <p className="mb-1 text-xs text-slate-500">Per-Signal Edge</p>
                        <p className="text-lg font-bold text-amber-300">{perf.profitFactor.toFixed(2)}</p>
                      </div>
                    </div>

                    <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-800/50">
                      <div className="h-full bg-gradient-to-r from-violet-500 to-cyan-500 transition-all" style={{ width: `${perf.successRate * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
