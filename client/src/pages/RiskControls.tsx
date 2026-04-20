import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";

export default function RiskControls() {
  const riskLimits = trpc.kalshi.getCapital.useQuery();

  if (riskLimits.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-cyan-400 font-mono">[ RISK CONTROLS ]</h1>
          <p className="text-gray-400 mt-2">Loading...</p>
        </div>
      </div>
    );
  }

  if (riskLimits.error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold text-cyan-400 font-mono">[ RISK CONTROLS ]</h1>
          <p className="text-red-400 mt-2">Error loading risk limits</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-cyan-400 font-mono">[ RISK CONTROLS ]</h1>
        <p className="text-gray-400 mt-2">Hard capital, trade, model, and portfolio constraints</p>
      </div>

      {/* Capital Controls */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-magenta-400 font-mono">[ CAPITAL CONTROLS ]</h2>
        <div className="grid gap-4">
          {riskLimits.data && (
            <>
              <Card className="border-cyan-900 bg-black/50">
                <CardHeader>
                  <CardTitle className="text-cyan-400">Starting Balance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-mono text-cyan-400">${riskLimits.data.startingBalance.toFixed(2)}</div>
                </CardContent>
              </Card>
              <Card className="border-cyan-900 bg-black/50">
                <CardHeader>
                  <CardTitle className="text-cyan-400">Current Balance</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-mono text-cyan-400">${riskLimits.data.currentBalance.toFixed(2)}</div>
                </CardContent>
              </Card>
              <Card className="border-cyan-900 bg-black/50">
                <CardHeader>
                  <CardTitle className="text-cyan-400">Total PnL</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className={`text-2xl font-mono ${riskLimits.data.totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
                    ${riskLimits.data.totalPnl.toFixed(2)}
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Trade Controls */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-magenta-400 font-mono">[ TRADE CONTROLS ]</h2>
        <div className="grid gap-4">
          {riskLimits.data && (
            <>
              <Card className="border-magenta-900 bg-black/50">
                <CardHeader>
                  <CardTitle className="text-magenta-400">Win Rate</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-mono text-magenta-400">{(riskLimits.data.winRate * 100).toFixed(1)}%</div>
                </CardContent>
              </Card>
              <Card className="border-magenta-900 bg-black/50">
                <CardHeader>
                  <CardTitle className="text-magenta-400">Sharpe Ratio</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-mono text-magenta-400">{riskLimits.data.sharpeRatio.toFixed(2)}</div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {/* Portfolio Controls */}
      <div className="space-y-4">
        <h2 className="text-xl font-bold text-magenta-400 font-mono">[ PORTFOLIO CONTROLS ]</h2>
        <div className="grid gap-4">
          {riskLimits.data && (
            <>
              <Card className="border-magenta-900 bg-black/50">
                <CardHeader>
                  <CardTitle className="text-magenta-400">Max Drawdown</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-mono text-magenta-400">{(riskLimits.data.maxDrawdown * 100).toFixed(1)}%</div>
                </CardContent>
              </Card>
              <Card className="border-magenta-900 bg-black/50">
                <CardHeader>
                  <CardTitle className="text-magenta-400">Total Trades</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-mono text-magenta-400">{riskLimits.data.totalTrades}</div>
                </CardContent>
              </Card>
            </>
          )}
        </div>
      </div>

      {!riskLimits.data && (
        <Card className="border-gray-800 bg-black/50">
          <CardContent className="pt-6">
            <div className="text-center text-gray-400">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No risk limits configured</p>
              <p className="text-sm mt-1">Set hard risk controls before enabling live trading</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
