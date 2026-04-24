import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";

export default function Performance() {
  const [selectedMetric, setSelectedMetric] = useState<
    "sharpe" | "drawdown" | "winrate" | "pnl"
  >("sharpe");

  const performanceOverviewQuery =
    trpc.kalshi.getPerformanceOverview.useQuery();

  const performanceOverview = performanceOverviewQuery.data;
  const performanceMetrics = performanceOverview?.metrics;
  const signalPerformance = performanceOverview?.signalPerformance ?? [];
  const hasTradeHistory = (performanceMetrics?.totalTrades ?? 0) > 0;

  const metricCards = [
    {
      label: "Sharpe Ratio",
      value: performanceMetrics?.sharpeRatio?.toFixed(2) ?? "0.00",
      description: "Risk-adjusted returns",
      icon: "📊",
      color: "from-violet-500 to-purple-500",
    },
    {
      label: "Max Drawdown",
      value: `${((performanceMetrics?.maxDrawdown ?? 0) * 100).toFixed(2)}%`,
      description: "Peak-to-trough decline",
      icon: "📉",
      color: "from-red-500 to-pink-500",
    },
    {
      label: "Win Rate",
      value: `${((performanceMetrics?.winRate ?? 0) * 100).toFixed(1)}%`,
      description: "Winning trades ratio",
      icon: "🎯",
      color: "from-green-500 to-emerald-500",
    },
    {
      label: "Total P&L",
      value: `$${(performanceMetrics?.totalPnL ?? 0).toFixed(2)}`,
      description: "Realized profit/loss",
      icon: "💰",
      color:
        (performanceMetrics?.totalPnL ?? 0 >= 0)
          ? "from-green-500 to-lime-500"
          : "from-red-500 to-orange-500",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-2">
            Performance Metrics
          </h1>
          <p className="text-slate-400">
            Track your trading performance and signal accuracy
          </p>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {metricCards.map(metric => (
            <Card
              key={metric.label}
              className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl hover:border-slate-600 transition-all cursor-pointer"
              onClick={() =>
                setSelectedMetric(
                  metric.label.toLowerCase().replace(" ", "") as any
                )
              }
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-slate-300">
                    {metric.label}
                  </CardTitle>
                  <span className="text-2xl">{metric.icon}</span>
                </div>
              </CardHeader>
              <CardContent>
                <div
                  className={`text-3xl font-bold bg-gradient-to-r ${metric.color} bg-clip-text text-transparent mb-1`}
                >
                  {metric.value}
                </div>
                <p className="text-xs text-slate-500">{metric.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Signal Performance by Type */}
        {signalPerformance.length > 0 && (
          <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl mb-8">
            <CardHeader>
              <CardTitle>Signal Performance by Type</CardTitle>
              <CardDescription>
                Win rates and accuracy for each signal type
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {signalPerformance.map(perf => (
                  <div
                    key={perf.signalType}
                    className="border border-slate-700/50 rounded-lg p-4 bg-slate-900/30"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-slate-200 capitalize">
                        {perf.signalType.replace("_", " ")}
                      </h3>
                      <span className="text-sm text-slate-400">
                        {perf.totalSignals} signals
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-slate-500 mb-1">Win Rate</p>
                        <p className="text-lg font-bold text-green-400">
                          {(perf.successRate * 100).toFixed(1)}%
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 mb-1">
                          Avg Confidence
                        </p>
                        <p className="text-lg font-bold text-violet-400">
                          {perf.avgConfidence.toFixed(2)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 mb-1">
                          Recommendation
                        </p>
                        <p className="text-lg font-bold text-cyan-400 capitalize">
                          {perf.recommendation.replace("_", " ")}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 mb-1">
                          Realized P&L
                        </p>
                        <p
                          className={`text-lg font-bold ${perf.totalPnL >= 0 ? "text-green-400" : "text-red-400"}`}
                        >
                          ${perf.totalPnL.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="mt-3 bg-slate-800/50 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-violet-500 to-cyan-500 h-full transition-all"
                        style={{ width: `${perf.successRate * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Capital Summary */}
        {performanceOverview && (
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
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="border-l-4 border-violet-500 pl-4">
                  <p className="text-sm text-slate-500 mb-1">
                    Starting Balance
                  </p>
                  <p className="text-2xl font-bold text-slate-200">
                    ${performanceOverview.startingBalance.toFixed(2)}
                  </p>
                </div>
                <div className="border-l-4 border-cyan-500 pl-4">
                  <p className="text-sm text-slate-500 mb-1">Current Balance</p>
                  <p className="text-2xl font-bold text-slate-200">
                    ${performanceOverview.currentBalance.toFixed(2)}
                  </p>
                </div>
                <div
                  className={`border-l-4 ${(performanceMetrics?.totalPnL ?? 0) >= 0 ? "border-green-500" : "border-red-500"} pl-4`}
                >
                  <p className="text-sm text-slate-500 mb-1">Total P&L</p>
                  <p
                    className={`text-2xl font-bold ${(performanceMetrics?.totalPnL ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}
                  >
                    {(performanceMetrics?.totalPnL ?? 0) >= 0 ? "+" : ""}
                    {(performanceMetrics?.totalPnL ?? 0).toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-2">Total Trades</p>
                  <p className="text-xl font-bold text-slate-200">
                    {performanceMetrics?.totalTrades ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-2">Winning Trades</p>
                  <p className="text-xl font-bold text-green-400">
                    {performanceMetrics?.winningTrades ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-2">Losing Trades</p>
                  <p className="text-xl font-bold text-red-400">
                    {performanceMetrics?.losingTrades ?? 0}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-2">
                    Return on Capital
                  </p>
                  <p
                    className={`text-xl font-bold ${(performanceMetrics?.totalPnL ?? 0) >= 0 ? "text-green-400" : "text-red-400"}`}
                  >
                    {performanceOverview.startingBalance > 0
                      ? (
                          ((performanceMetrics?.totalPnL ?? 0) /
                            performanceOverview.startingBalance) *
                          100
                        ).toFixed(1)
                      : "0.0"}
                    %
                  </p>
                </div>
              </div>

              {!hasTradeHistory && (
                <div className="mt-6 rounded-lg border border-dashed border-slate-700 bg-slate-900/40 p-4 text-sm text-slate-400">
                  Close a few trades to unlock Sharpe ratio, drawdown, and
                  signal recommendations based on real outcomes.
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Loading State */}
        {performanceOverviewQuery.isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-pulse text-slate-400">
              Loading performance metrics...
            </div>
          </div>
        )}

        {/* Error State */}
        {performanceOverviewQuery.isError && (
          <Card className="border border-red-500/50 bg-red-950/20">
            <CardContent className="pt-6">
              <p className="text-red-400">
                Failed to load performance metrics. Please try again.
              </p>
              <Button
                onClick={() => performanceOverviewQuery.refetch()}
                className="mt-4"
              >
                Retry
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
