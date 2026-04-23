import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Zap, Target, TrendingUp } from "lucide-react";

export default function PortfolioOptimization() {
  const [winProbability, setWinProbability] = useState(0.55);
  const [odds, setOdds] = useState(1.0);

  const kellyQuery = trpc.advanced.portfolio.calculateKellyFraction.useQuery(
    {
      winProbability,
      odds,
    },
    { enabled: true }
  );

  const kellyFraction = kellyQuery.data ?? 0;

  const getKellyRecommendation = (fraction: number) => {
    if (fraction <= 0) return { label: "Avoid", color: "text-red-500", bg: "from-red-500 to-pink-500" };
    if (fraction < 0.05) return { label: "Minimal", color: "text-yellow-500", bg: "from-yellow-500 to-orange-500" };
    if (fraction < 0.1) return { label: "Conservative", color: "text-blue-500", bg: "from-blue-500 to-cyan-500" };
    return { label: "Aggressive", color: "text-green-500", bg: "from-green-500 to-emerald-500" };
  };

  const recommendation = getKellyRecommendation(kellyFraction);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-2">
            Portfolio Optimization
          </h1>
          <p className="text-slate-400">Optimize position sizing using Kelly Criterion</p>
        </div>

        {/* Kelly Fraction Card */}
        <Card className="mb-8 border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Kelly Criterion Calculator</CardTitle>
            <CardDescription>Optimal position sizing for risk-adjusted returns</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Input: Win Probability */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Win Probability
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    value={winProbability}
                    onChange={(e) => setWinProbability(parseFloat(e.target.value))}
                    className="flex-1 bg-slate-800 border-slate-700 text-slate-100"
                  />
                  <span className="text-slate-400 font-mono">{(winProbability * 100).toFixed(0)}%</span>
                </div>
              </div>

              {/* Input: Odds */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Odds (Payoff Ratio)
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min="0.1"
                    step="0.1"
                    value={odds}
                    onChange={(e) => setOdds(parseFloat(e.target.value))}
                    className="flex-1 bg-slate-800 border-slate-700 text-slate-100"
                  />
                  <span className="text-slate-400 font-mono">x</span>
                </div>
              </div>

              {/* Output: Kelly Fraction */}
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Kelly Fraction
                </label>
                <div className={`text-3xl font-bold ${recommendation.color} font-mono`}>
                  {(kellyFraction * 100).toFixed(2)}%
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Recommendation Card */}
        <Card className="mb-8 border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Position Sizing Recommendation</CardTitle>
            <CardDescription>Based on Kelly Criterion calculation</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <div className={`text-5xl font-bold bg-gradient-to-r ${recommendation.bg} bg-clip-text text-transparent mb-2`}>
                  {recommendation.label}
                </div>
                <p className="text-slate-400 max-w-md">
                  {recommendation.label === "Avoid" && "This trade has negative expected value. Skip it."}
                  {recommendation.label === "Minimal" && "Very low edge. Only risk a tiny fraction of capital."}
                  {recommendation.label === "Conservative" && "Moderate edge. Risk a small fraction of capital."}
                  {recommendation.label === "Aggressive" && "Strong edge. Risk a larger fraction of capital."}
                </p>
              </div>
              <div className="text-6xl">
                {recommendation.label === "Avoid" && "❌"}
                {recommendation.label === "Minimal" && "⚠️"}
                {recommendation.label === "Conservative" && "✅"}
                {recommendation.label === "Aggressive" && "🚀"}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Kelly Criterion Explanation */}
        <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Kelly Criterion Formula</CardTitle>
            <CardDescription>Mathematical foundation for optimal position sizing</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="bg-slate-800/50 p-4 rounded-lg border border-slate-700">
                <p className="text-slate-300 font-mono text-center">
                  f* = (p × b - q) / b
                </p>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <h3 className="font-semibold text-slate-300 mb-3">Variables</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-slate-400">f*:</span>
                      <span className="text-slate-300">Fraction of capital to risk</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">p:</span>
                      <span className="text-slate-300">Probability of winning</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">q:</span>
                      <span className="text-slate-300">Probability of losing (1-p)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">b:</span>
                      <span className="text-slate-300">Odds (payoff ratio)</span>
                    </div>
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold text-slate-300 mb-3">Key Insights</h3>
                  <div className="space-y-2 text-sm text-slate-400">
                    <p>• Maximizes long-term geometric growth</p>
                    <p>• Prevents over-leveraging</p>
                    <p>• Minimizes risk of ruin</p>
                    <p>• Works best with consistent edge</p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Loading State */}
        {kellyQuery.isLoading && (
          <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl mt-8">
            <CardContent className="pt-6">
              <div className="flex items-center justify-center">
                <Zap className="animate-spin text-cyan-400 mr-2" />
                <span className="text-slate-400">Calculating Kelly Fraction...</span>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
