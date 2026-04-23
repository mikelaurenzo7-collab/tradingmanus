import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Zap, BarChart3, TrendingUp } from "lucide-react";

export default function Backtesting() {
  const [startDate, setStartDate] = useState("2024-01-01");
  const [endDate, setEndDate] = useState("2024-12-31");
  const [initialCapital, setInitialCapital] = useState(100);

  const backtest = {
    totalTrades: 150,
    winningTrades: 95,
    losingTrades: 55,
    totalPnL: 2450,
    sharpeRatio: 1.85,
    maxDrawdown: -12.5,
    winRate: 63.3,
    profitFactor: 2.1,
  };

  const metrics = [
    {
      label: "Total Trades",
      value: backtest.totalTrades,
      icon: "📊",
      color: "from-blue-500 to-cyan-500",
    },
    {
      label: "Win Rate",
      value: `${backtest.winRate.toFixed(1)}%`,
      icon: "🎯",
      color: "from-green-500 to-emerald-500",
    },
    {
      label: "Sharpe Ratio",
      value: backtest.sharpeRatio.toFixed(2),
      icon: "📈",
      color: "from-purple-500 to-pink-500",
    },
    {
      label: "Profit Factor",
      value: backtest.profitFactor.toFixed(2),
      icon: "💰",
      color: "from-yellow-500 to-orange-500",
    },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-2">
            Backtesting
          </h1>
          <p className="text-slate-400">Validate strategies against historical data</p>
        </div>

        {/* Backtest Parameters */}
        <Card className="mb-8 border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Backtest Parameters</CardTitle>
            <CardDescription>Configure your historical simulation</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Start Date
                </label>
                <Input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  End Date
                </label>
                <Input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="bg-slate-800 border-slate-700 text-slate-100"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Initial Capital ($)
                </label>
                <Input
                  type="number"
                  value={initialCapital}
                  onChange={(e) => setInitialCapital(parseFloat(e.target.value))}
                  className="bg-slate-800 border-slate-700 text-slate-100"
                />
              </div>
              <div className="flex items-end">
                <Button className="w-full bg-gradient-to-r from-cyan-500 to-blue-500 hover:from-cyan-600 hover:to-blue-600 text-white font-semibold">
                  Run Backtest
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          {metrics.map((metric) => (
            <Card
              key={metric.label}
              className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl hover:border-slate-600 transition-all"
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
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Results Summary */}
        <Card className="mb-8 border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Backtest Results</CardTitle>
            <CardDescription>Historical performance summary</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <h3 className="font-semibold text-slate-300 mb-4">Trade Statistics</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Total Trades:</span>
                    <span className="font-mono text-slate-200">{backtest.totalTrades}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Winning Trades:</span>
                    <span className="font-mono text-green-400">{backtest.winningTrades}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Losing Trades:</span>
                    <span className="font-mono text-red-400">{backtest.losingTrades}</span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-slate-300 mb-4">Performance Metrics</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Total P&L:</span>
                    <span className="font-mono text-green-400">${backtest.totalPnL.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Max Drawdown:</span>
                    <span className="font-mono text-red-400">{backtest.maxDrawdown.toFixed(2)}%</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">ROI:</span>
                    <span className="font-mono text-blue-400">{((backtest.totalPnL / initialCapital) * 100).toFixed(1)}%</span>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="font-semibold text-slate-300 mb-4">Risk Metrics</h3>
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Sharpe Ratio:</span>
                    <span className="font-mono text-purple-400">{backtest.sharpeRatio.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Profit Factor:</span>
                    <span className="font-mono text-yellow-400">{backtest.profitFactor.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-400">Win Rate:</span>
                    <span className="font-mono text-green-400">{backtest.winRate.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Equity Curve */}
        <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Equity Curve</CardTitle>
            <CardDescription>Account balance over time</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-64 flex items-center justify-center bg-slate-800/30 rounded-lg border border-slate-700">
              <div className="text-center">
                <BarChart3 className="w-12 h-12 text-slate-500 mx-auto mb-2" />
                <p className="text-slate-400">Equity curve visualization</p>
                <p className="text-sm text-slate-500">Run a backtest to see results</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
