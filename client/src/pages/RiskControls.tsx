import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle, ShieldAlert, ShieldCheck, Siren, TriangleAlert, Gauge, Wallet, Target, Shield } from "lucide-react";
import { classifyRiskPosture, formatPercent, summarizeRiskBudget } from "@/lib/riskPerformanceDiagnostics";

export default function RiskControls() {
  const [killSwitchResult, setKillSwitchResult] = useState<string | null>(null);
  const riskLimits = trpc.kalshi.getRiskLimits.useQuery();
  const capital = trpc.kalshi.getCapital.useQuery();
  const performanceOverview = trpc.kalshi.getPerformanceOverview.useQuery();
  const utils = trpc.useUtils();

  const riskAlertQuery = trpc.advanced.risk.generateRiskAlerts.useQuery(
    {
      metrics: {
        volatility: Math.max(
          Math.abs(performanceOverview.data?.metrics.dailyPnL ?? 0) / Math.max(capital.data?.currentBalance ?? 1, 1),
          performanceOverview.data?.metrics.maxDrawdown ?? 0,
        ),
        sharpeRatio: performanceOverview.data?.metrics.sharpeRatio ?? 0,
        maxDrawdown: performanceOverview.data?.metrics.maxDrawdown ?? 0,
        recoveryFactor: performanceOverview.data?.metrics.recoveryFactor ?? 0,
        profitFactor: Number.isFinite(performanceOverview.data?.metrics.profitFactor)
          ? (performanceOverview.data?.metrics.profitFactor ?? 0)
          : 999,
        riskPerTrade: (riskLimits.data?.maxLossPerTrade ?? 0) / Math.max(capital.data?.currentBalance ?? 1, 1),
      },
      limits: {
        maxLossPerTrade: riskLimits.data?.maxLossPerTrade ?? 0,
        maxLossPerDay: riskLimits.data?.maxLossPerDay ?? 0,
        maxLossPerWeek: Math.max((riskLimits.data?.maxLossPerDay ?? 0) * 5, riskLimits.data?.maxLossPerDay ?? 0),
        maxDrawdown: capital.data?.maxDrawdown ?? 0.2,
        maxPositionSize: riskLimits.data?.maxPositionSize ?? 0,
        maxCorrelation: 0.75,
      },
    },
    {
      enabled: Boolean(riskLimits.data && capital.data && performanceOverview.data),
      refetchOnWindowFocus: false,
    },
  );

  const killSwitch = trpc.kalshi.killSwitch.useMutation({
    onSuccess: async (result) => {
      setKillSwitchResult(
        result.success
          ? `Kill switch completed. Closed ${result.closedPositions} position(s).`
          : `Kill switch completed with ${result.failedPositions} failure(s) across ${result.totalPositions} position(s).`,
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

  if (riskLimits.isLoading || capital.isLoading || performanceOverview.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-mono text-3xl font-bold text-cyan-400">[ RISK CONTROLS ]</h1>
          <p className="mt-2 text-gray-400">Loading risk configuration...</p>
        </div>
      </div>
    );
  }

  if (riskLimits.error || capital.error || performanceOverview.error) {
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
  const performanceMetrics = performanceOverview.data?.metrics;
  const riskAlerts = riskAlertQuery.data ?? [];
  const hardStopsHit = [
    performanceMetrics?.maxDrawdown && performanceMetrics.maxDrawdown >= (capitalData?.maxDrawdown ?? 1),
    Math.abs(performanceMetrics?.dailyPnL ?? 0) >= (limits?.maxLossPerDay ?? Number.POSITIVE_INFINITY),
    (performanceMetrics?.activePositions ?? 0) >= (limits?.maxOpenPositions ?? Number.POSITIVE_INFINITY),
  ].filter(Boolean).length;

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

  const riskBudget = summarizeRiskBudget(capitalData.currentBalance, limits.maxLossPerTrade, limits.maxLossPerDay);
  const riskPosture = classifyRiskPosture(riskAlerts.length, hardStopsHit);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="font-mono text-3xl font-bold text-cyan-400">[ RISK CONTROLS ]</h1>
          <p className="mt-2 text-gray-400">Capital-protection rules and emergency controls for the live Kalshi operating envelope.</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge className={`border px-3 py-1 font-mono ${riskPosture === "critical" ? "border-red-700 bg-red-950/40 text-red-300" : riskPosture === "elevated" ? "border-amber-700 bg-amber-950/40 text-amber-300" : "border-cyan-700 bg-cyan-950/40 text-cyan-300"}`}>
            <ShieldCheck className="mr-2 h-3.5 w-3.5" />
            {riskPosture === "critical" ? "Critical posture" : riskPosture === "elevated" ? "Elevated posture" : "Stable posture"}
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
            <CardTitle className="flex items-center gap-2 text-cyan-400"><Wallet className="h-4 w-4" />Starting Capital</CardTitle>
            <CardDescription>Initial account size</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl text-cyan-300">${capitalData.startingBalance.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card className="border-cyan-900 bg-black/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-cyan-400"><Gauge className="h-4 w-4" />Current Capital</CardTitle>
            <CardDescription>Available tracked balance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl text-cyan-300">${capitalData.currentBalance.toFixed(2)}</div>
          </CardContent>
        </Card>
        <Card className="border-magenta-900 bg-black/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-magenta-400"><Shield className="h-4 w-4" />Risk Per Trade</CardTitle>
            <CardDescription>Configured budget per position</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl text-fuchsia-300">{formatPercent(riskBudget.perTradeUsage)}</div>
          </CardContent>
        </Card>
        <Card className="border-yellow-900 bg-black/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-yellow-300"><Target className="h-4 w-4" />Daily Risk Budget</CardTitle>
            <CardDescription>Max daily loss as share of balance</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="font-mono text-2xl text-yellow-200">{formatPercent(riskBudget.dailyUsage)}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="border-yellow-900 bg-black/50">
          <CardHeader>
            <CardTitle className="font-mono text-yellow-300">[ LIVE RISK POSTURE ]</CardTitle>
            <CardDescription>Operational health from balance, drawdown, and current position load.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-300">
            <div className="flex items-center justify-between rounded border border-yellow-950/80 px-3 py-2">
              <span>Daily P&amp;L</span>
              <span className={(performanceMetrics?.dailyPnL ?? 0) >= 0 ? "text-green-400" : "text-red-400"}>${(performanceMetrics?.dailyPnL ?? 0).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between rounded border border-yellow-950/80 px-3 py-2">
              <span>Active positions</span>
              <span className="text-yellow-200">{performanceMetrics?.activePositions ?? 0} / {limits.maxOpenPositions}</span>
            </div>
            <div className="flex items-center justify-between rounded border border-yellow-950/80 px-3 py-2">
              <span>Hard-stop triggers</span>
              <span className={hardStopsHit > 0 ? "text-red-400" : "text-green-400"}>{hardStopsHit}</span>
            </div>
            <div className="flex items-center justify-between rounded border border-yellow-950/80 px-3 py-2">
              <span>Drawdown usage</span>
              <span className="text-yellow-200">
                {formatPercent((performanceMetrics?.maxDrawdown ?? 0) / Math.max(capitalData.maxDrawdown || 1, 0.0001))}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-red-900 bg-black/50 lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-mono text-red-300">[ RISK ALERTS ]</CardTitle>
            <CardDescription>Procedure-driven warnings derived from current performance and configured risk ceilings.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-gray-300">
            {riskAlerts.length > 0 ? riskAlerts.map((alert, index) => (
              <div key={`${alert}-${index}`} className="flex items-start gap-3 rounded border border-red-950/80 px-3 py-3">
                <TriangleAlert className="mt-0.5 h-4 w-4 text-red-300" />
                <div>
                  <p className="font-medium text-red-200">Risk warning {index + 1}</p>
                  <p className="text-gray-400">{alert}</p>
                </div>
              </div>
            )) : (
              <div className="flex items-start gap-3 rounded border border-emerald-950/80 px-3 py-3">
                <ShieldCheck className="mt-0.5 h-4 w-4 text-emerald-300" />
                <div>
                  <p className="font-medium text-emerald-200">No active risk alerts</p>
                  <p className="text-gray-400">Current drawdown, daily loss, and risk-per-trade posture remain inside configured limits.</p>
                </div>
              </div>
            )}
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
            <CardTitle className="font-mono text-magenta-400">[ OPERATOR GUIDANCE ]</CardTitle>
            <CardDescription>What the current backend posture implies before placing the next order.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-gray-300">
            <div className="flex gap-3 rounded border border-magenta-950/80 px-3 py-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 text-magenta-300" />
              <p>
                {riskPosture === "critical"
                  ? "At least one hard-stop threshold is effectively reached. Flatten exposure or avoid new risk until the posture resets."
                  : riskPosture === "elevated"
                    ? "Alert conditions are building. Favor smaller sizes and only the highest-conviction signals until the warning stack clears."
                    : "The posture is currently stable. New orders can still be screened against daily and per-trade budgets normally."}
              </p>
            </div>
            <div className="flex gap-3 rounded border border-magenta-950/80 px-3 py-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 text-magenta-300" />
              <p>
                Per-trade risk is capped near {formatPercent(riskBudget.perTradeUsage)} of tracked balance, while the daily stop currently represents {formatPercent(riskBudget.dailyUsage)} of balance.
              </p>
            </div>
            <div className="flex gap-3 rounded border border-magenta-950/80 px-3 py-3">
              <TriangleAlert className="mt-0.5 h-4 w-4 text-magenta-300" />
              <p>
                Orders are rejected when position count is at the configured ceiling or when realized loss has already exhausted the current day’s risk budget.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
