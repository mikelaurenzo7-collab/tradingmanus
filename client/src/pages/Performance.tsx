import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc";
// import { useAuth } from "@/client/src/_core/hooks/useAuth";

export default function Performance() {
  const [selectedMetric, setSelectedMetric] = useState<"sharpe" | "drawdown" | "winrate" | "pnl">("sharpe");

  const capitalQuery = trpc.kalshi.getCapital.useQuery();

  const capital = capitalQuery.data;
  const performance = new Map(); // Placeholder for signal performance

  const metrics = [
    {
      label: "Sharpe Ratio",
      value: capital?.sharpeRatio?.toFixed(2) ?? "0.00",
      description: "Risk-adjusted returns",
      icon: "📊",
      color: "from-violet-500 to-purple-500",
    },
    {
      label: "Max Drawdown",
      value: `${Math.abs(capital?.maxDrawdown ?? 0).toFixed(2)}%`,
      description: "Peak-to-trough decline",
      icon: "📉",
      color: "from-red-500 to-pink-500",
    },
    {
      label: "Win Rate",
      value: `${((capital?.winRate ?? 0) * 100).toFixed(1)}%`,
      description: "Winning trades ratio",
      icon: "🎯",
      color: "from-green-500 to-emerald-500",
    },
    {
      label: "Total P&L",
      value: `$${(capital?.totalPnl ?? 0).toFixed(2)}`,
      description: "Realized profit/loss",
      icon: "💰",
      color: capital?.totalPnl ?? 0 >= 0 ? "from-green-500 to-lime-500" : "from-red-500 to-orange-500",
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
          <p className="text-slate-400">Track your trading performance and signal accuracy</p>
        </div>

        {/* Key Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {metrics.map((metric) => (
            <Card
              key={metric.label}
              className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl hover:border-slate-600 transition-all cursor-pointer"
              onClick={() => setSelectedMetric(metric.label.toLowerCase().replace(" ", "") as any)}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-slate-300">{metric.label}</CardTitle>
                  <span className="text-2xl">{metric.icon}</span>
                </div>
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold bg-gradient-to-r ${metric.color} bg-clip-text text-transparent mb-1`}>
                  {metric.value}
                </div>
                <p className="text-xs text-slate-500">{metric.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Signal Performance by Type */}
        {false && performance && performance.size > 0 && (
          <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl mb-8">
            <CardHeader>
              <CardTitle>Signal Performance by Type</CardTitle>
              <CardDescription>Win rates and accuracy for each signal type</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {Array.from(performance.values()).map((perf: any) => (
                  <div key={perf.signalType} className="border border-slate-700/50 rounded-lg p-4 bg-slate-900/30">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-slate-200 capitalize">{perf.signalType.replace("_", " ")}</h3>
                      <span className="text-sm text-slate-400">{perf.totalSignals} signals</span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div>
                        <p className="text-xs text-slate-500 mb-1">Win Rate</p>
                        <p className="text-lg font-bold text-green-400">{((perf as any).winRate * 100).toFixed(1)}%</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 mb-1">Avg Confidence</p>
                        <p className="text-lg font-bold text-violet-400">{(perf as any).avgConfidence.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 mb-1">Avg Expected Value</p>
                        <p className="text-lg font-bold text-cyan-400">${(perf as any).avgExpectedValue.toFixed(2)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-500 mb-1">Realized P&L</p>
                        <p className={`text-lg font-bold ${(perf as any).realizedPnL >= 0 ? "text-green-400" : "text-red-400"}`}>
                          ${(perf as any).realizedPnL.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    {/* Progress bar */}
                    <div className="mt-3 bg-slate-800/50 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-violet-500 to-cyan-500 h-full transition-all"
                        style={{ width: `${(perf as any).winRate * 100}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Capital Summary */}
        {capital && (
          <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle>Capital Summary</CardTitle>
              <CardDescription>Account balance and trading statistics</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="border-l-4 border-violet-500 pl-4">
                  <p className="text-sm text-slate-500 mb-1">Starting Balance</p>
                  <p className="text-2xl font-bold text-slate-200">${capital.startingBalance.toFixed(2)}</p>
                </div>
                <div className="border-l-4 border-cyan-500 pl-4">
                  <p className="text-sm text-slate-500 mb-1">Current Balance</p>
                  <p className="text-2xl font-bold text-slate-200">${capital.currentBalance.toFixed(2)}</p>
                </div>
                <div className={`border-l-4 ${capital.totalPnl >= 0 ? "border-green-500" : "border-red-500"} pl-4`}>
                  <p className="text-sm text-slate-500 mb-1">Total P&L</p>
                  <p className={`text-2xl font-bold ${capital.totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {capital.totalPnl >= 0 ? "+" : ""}{capital.totalPnl.toFixed(2)}
                  </p>
                </div>
              </div>

              <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <p className="text-xs text-slate-500 mb-2">Total Trades</p>
                  <p className="text-xl font-bold text-slate-200">{capital.totalTrades}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-2">Winning Trades</p>
                  <p className="text-xl font-bold text-green-400">{capital.winningTrades}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-2">Losing Trades</p>
                  <p className="text-xl font-bold text-red-400">{capital.totalTrades - capital.winningTrades}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-500 mb-2">Return on Capital</p>
                  <p className={`text-xl font-bold ${capital.totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    {((capital.totalPnl / capital.startingBalance) * 100).toFixed(1)}%
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Loading State */}
        {capitalQuery.isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-pulse text-slate-400">Loading performance metrics...</div>
          </div>
        )}

        {/* Error State */}
        {capitalQuery.isError && (
          <Card className="border border-red-500/50 bg-red-950/20">
            <CardContent className="pt-6">
              <p className="text-red-400">Failed to load performance metrics. Please try again.</p>
              <Button onClick={() => capitalQuery.refetch()} className="mt-4">
                Retry
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
