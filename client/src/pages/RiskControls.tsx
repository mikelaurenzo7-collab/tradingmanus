import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, ShieldAlert, ShieldCheck, Siren, TriangleAlert } from "lucide-react";

export default function RiskControls() {
  const [killSwitchResult, setKillSwitchResult] = useState<string | null>(null);
  const riskLimits = trpc.kalshi.getRiskLimits.useQuery();
  const capital = trpc.kalshi.getCapital.useQuery();
  const utils = trpc.useUtils();

  const killSwitch = trpc.kalshi.killSwitch.useMutation({
    onSuccess: async (result) => {
      setKillSwitchResult(
        result.success
          ? `Kill switch completed. Closed ${result.closedPositions} position(s).`
          : `Kill switch completed with ${result.failedPositions} failure(s) across ${result.totalPositions} position(s).`
      );
      await Promise.all([
        utils.kalshi.getCapital.invalidate(),
        utils.kalshi.getPositions.invalidate(),
        utils.kalshi.getAuditLog.invalidate(),
      ]);
    },
    onError: (error) => {
      setKillSwitchResult(error.message || "Kill switch failed.");
    },
  });

  if (riskLimits.isLoading || capital.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-3xl font-bold text-cyan-400">[ RISK CONTROLS ]</h1>
          <p className="mt-2 text-gray-400">Loading risk configuration...</p>
        </div>
      </div>
    );
  }

  if (riskLimits.error || capital.error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-3xl font-bold text-cyan-400">[ RISK CONTROLS ]</h1>
          <p className="mt-2 text-red-400">Unable to load risk controls.</p>
        </div>
      </div>
    );
  }

  const limits = riskLimits.data;
  const capitalData = capital.data;

  if (!limits || !capitalData) {
    return (
      <Card className="border-gray-800 bg-black/50">
        <CardContent className="pt-6">
          <div className="text-center text-gray-400">
            <AlertCircle className="mx-auto mb-2 h-8 w-8 opacity-50" />
            <p>No risk data available.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="font-mono text-3xl font-bold text-cyan-400">[ RISK CONTROLS ]</h1>
          <p className="mt-2 text-gray-400">Capital-protection rules and emergency controls for the $100 Kalshi account.</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className="border border-cyan-700 bg-cyan-950/40 px-3 py-1 font-mono text-cyan-300">
            <ShieldCheck className="mr-2 h-3.5 w-3.5" /> Hard Limits Active
          </Badge>
          <Button
            type="button"
            variant="outline"
            className="border-red-500/60 bg-red-950/30 font-mono text-red-300 hover:bg-red-950/50"
            disabled={killSwitch.isPending}
            onClick={() => {
              setKillSwitchResult(null);
              killSwitch.mutate();
            }}
          >
            <Siren className="mr-2 h-4 w-4" />
            {killSwitch.isPending ? "Flattening..." : "Activate Kill Switch"}
          </Button>
        </div>
      </div>

      {killSwitchResult ? (
        <Card className="border-red-900/70 bg-red-950/20">
          <CardContent className="flex items-start gap-3 pt-6 text-sm text-red-200">
            <ShieldAlert className="mt-0.5 h-4 w-4" />
            <p>{killSwitchResult}</p>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-cyan-900 bg-black/50">
          <CardHeader>
            <CardTitle className="text-cyan-400">Starting Capital</CardTitle>
            <CardDescription>Initial account size</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl text-cyan-300">${capitalData.startingBalance.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card className="border-cyan-900 bg-black/50">
          <CardHeader>
            <CardTitle className="text-cyan-400">Current Capital</CardTitle>
            <CardDescription>Available tracked balance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl text-cyan-300">${capitalData.currentBalance.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card className="border-magenta-900 bg-black/50">
          <CardHeader>
            <CardTitle className="text-magenta-400">Tracked P&amp;L</CardTitle>
            <CardDescription>Realized plus unrealized summary</CardDescription>
          </CardHeader>
          <CardContent>
            <div className={`font-mono text-2xl ${capitalData.totalPnl >= 0 ? "text-green-400" : "text-red-400"}`}>
              ${capitalData.totalPnl.toFixed(2)}
            </div>
          </CardContent>
        </Card>
        <Card className="border-yellow-900 bg-black/50">
          <CardHeader>
            <CardTitle className="text-yellow-300">Max Drawdown</CardTitle>
            <CardDescription>Portfolio stress ceiling</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl text-yellow-200">{(capitalData.maxDrawdown * 100).toFixed(1)}%</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-cyan-900 bg-black/50">
          <CardHeader>
            <CardTitle className="font-mono text-cyan-400">[ ENFORCED LIMITS ]</CardTitle>
            <CardDescription>Orders are blocked when any rule is breached.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 font-mono text-sm text-gray-300">
            <div className="flex items-center justify-between rounded border border-cyan-950/80 px-3 py-2">
              <span>Max capital</span>
              <span className="text-cyan-300">${limits.maxCapital}</span>
            </div>
            <div className="flex items-center justify-between rounded border border-cyan-950/80 px-3 py-2">
              <span>Max loss per trade</span>
              <span className="text-cyan-300">${limits.maxLossPerTrade}</span>
            </div>
            <div className="flex items-center justify-between rounded border border-cyan-950/80 px-3 py-2">
              <span>Max loss per day</span>
              <span className="text-cyan-300">${limits.maxLossPerDay}</span>
            </div>
            <div className="flex items-center justify-between rounded border border-cyan-950/80 px-3 py-2">
              <span>Max position size</span>
              <span className="text-cyan-300">${limits.maxPositionSize}</span>
            </div>
            <div className="flex items-center justify-between rounded border border-cyan-950/80 px-3 py-2">
              <span>Max open positions</span>
              <span className="text-cyan-300">{limits.maxOpenPositions}</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-magenta-900 bg-black/50">
          <CardHeader>
            <CardTitle className="font-mono text-magenta-400">[ OPERATOR NOTES ]</CardTitle>
            <CardDescription>What the backend now enforces before submitting an order.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-300">
            <div className="flex gap-3 rounded border border-magenta-950/80 px-3 py-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 text-magenta-300" />
              <p>Orders are rejected when the position count is already at the configured ceiling.</p>
            </div>
            <div className="flex gap-3 rounded border border-magenta-950/80 px-3 py-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 text-magenta-300" />
              <p>Orders are rejected when the requested exposure exceeds the per-trade or per-position risk budget.</p>
            </div>
            <div className="flex gap-3 rounded border border-magenta-950/80 px-3 py-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 text-magenta-300" />
              <p>Orders are rejected when realized losses for the current day have already reached the daily stop limit.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
