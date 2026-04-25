import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle, CheckCircle2, Siren, ShieldCheck, ShieldAlert, TriangleAlert } from "lucide-react";
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
          ? `Kill switch activated. Closed ${result.closedPositions} position(s).`
          : `Kill switch activated with ${result.failedPositions} failure(s) — check positions manually.`,
      );
      await Promise.all([
        utils.kalshi.getCapital.invalidate(),
        utils.kalshi.getPositions.invalidate(),
        utils.kalshi.getAuditLog.invalidate(),
      ]);
    },
    onError: (error) => setKillSwitchResult(error.message || "Kill switch failed."),
  });

  const isLoading = riskLimits.isLoading || capital.isLoading || performanceOverview.isLoading;
  const isError = riskLimits.isError || capital.isError || performanceOverview.isError;

  if (isLoading) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-1">Risk Controls</h1>
        <p className="text-muted-foreground text-sm">Loading…</p>
      </div>
    );
  }

  if (isError || !riskLimits.data || !capital.data) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold mb-1">Risk Controls</h1>
        <p className="text-sm text-rose-400 flex items-center gap-2">
          <AlertCircle className="w-4 h-4" />
          Unable to load risk data.
        </p>
      </div>
    );
  }

  const limits = riskLimits.data;
  const capitalData = capital.data;
  const metrics = performanceOverview.data?.metrics;
  const riskAlerts = riskAlertQuery.data ?? [];
  const hardStopsHit = [
    metrics?.maxDrawdown && metrics.maxDrawdown >= (capitalData?.maxDrawdown ?? 1),
    Math.abs(metrics?.dailyPnL ?? 0) >= (limits?.maxLossPerDay ?? Number.POSITIVE_INFINITY),
    (metrics?.activePositions ?? 0) >= (limits?.maxOpenPositions ?? Number.POSITIVE_INFINITY),
  ].filter(Boolean).length;

  const riskBudget = summarizeRiskBudget(capitalData.currentBalance, limits.maxLossPerTrade, limits.maxLossPerDay);
  const posture = classifyRiskPosture(riskAlerts.length, hardStopsHit);

  const postureConfig: Record<string, { color: string; bg: string; icon: typeof ShieldCheck; label: string }> = {
    critical: { color: "text-rose-400", bg: "border-rose-800 bg-rose-950/30", icon: ShieldAlert, label: "Critical — flatten exposure before placing new orders" },
    elevated: { color: "text-amber-300", bg: "border-amber-800 bg-amber-950/30", icon: TriangleAlert, label: "Elevated — prefer smaller sizes and high-conviction signals only" },
    stable: { color: "text-emerald-300", bg: "border-emerald-800 bg-emerald-950/30", icon: ShieldCheck, label: "Stable — all metrics within configured limits" },
  };
  const pc = postureConfig[posture] ?? postureConfig.stable;
  const PostureIcon = pc.icon;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Risk Controls</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Hard limits enforced before every live order. Claude never bypasses these.
          </p>
        </div>
        <Button
          variant="outline"
          className="border-rose-500/60 bg-rose-950/30 text-rose-300 hover:bg-rose-950/50"
          disabled={killSwitch.isPending}
          onClick={() => { setKillSwitchResult(null); killSwitch.mutate(); }}
        >
          <Siren className="w-4 h-4 mr-2" />
          {killSwitch.isPending ? "Flattening…" : "Kill Switch"}
        </Button>
      </div>

      {/* Kill switch result */}
      {killSwitchResult && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-800 bg-rose-950/30 px-4 py-3 text-sm text-rose-200">
          <ShieldAlert className="w-4 h-4 mt-0.5 shrink-0" />
          {killSwitchResult}
        </div>
      )}

      {/* Posture banner */}
      <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 text-sm font-medium ${pc.bg} ${pc.color}`}>
        <PostureIcon className="w-4 h-4 shrink-0" />
        {pc.label}
      </div>

      {/* Live snapshot + hard limits side-by-side */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Live Snapshot</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {[
              ["Balance", `$${capitalData.currentBalance.toFixed(2)}`],
              ["Daily P&L", `${(metrics?.dailyPnL ?? 0) >= 0 ? "+" : ""}$${(metrics?.dailyPnL ?? 0).toFixed(2)}`],
              ["Open positions", `${metrics?.activePositions ?? 0} / ${limits.maxOpenPositions}`],
              ["Drawdown used", formatPercent((metrics?.maxDrawdown ?? 0) / Math.max(capitalData.maxDrawdown || 1, 0.0001))],
              ["Hard stops triggered", String(hardStopsHit)],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-2 border-b border-border/40 last:border-0">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium tabular-nums">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Enforced Hard Limits</CardTitle>
          </CardHeader>
          <CardContent className="text-sm">
            {[
              ["Max loss per trade", `$${limits.maxLossPerTrade} (${formatPercent(riskBudget.perTradeUsage)} of balance)`],
              ["Max loss per day", `$${limits.maxLossPerDay} (${formatPercent(riskBudget.dailyUsage)} of balance)`],
              ["Max position size", `$${limits.maxPositionSize}`],
              ["Max open positions", String(limits.maxOpenPositions)],
              ["Max capital tracked", `$${limits.maxCapital}`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between py-2 border-b border-border/40 last:border-0">
                <span className="text-muted-foreground">{label}</span>
                <span className="font-medium tabular-nums">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Alerts */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-widest flex items-center gap-2">
            Active Alerts
            {riskAlerts.length > 0 && <span className="text-rose-400">({riskAlerts.length})</span>}
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm">
          {riskAlerts.length === 0 ? (
            <div className="flex items-center gap-2 text-emerald-300">
              <CheckCircle2 className="w-4 h-4" />
              No active alerts — all metrics within limits.
            </div>
          ) : (
            <ul className="space-y-2">
              {riskAlerts.map((alert, i) => (
                <li key={i} className="flex items-start gap-2 text-amber-200">
                  <TriangleAlert className="w-4 h-4 mt-0.5 shrink-0 text-amber-400" />
                  {alert}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* How limits work */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">How These Limits Work</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>Every order is blocked if <strong className="text-foreground">any</strong> of the following are true at submission time:</p>
          <ul className="space-y-1 ml-4 list-disc">
            <li>Daily realized loss has already reached the daily cap.</li>
            <li>Open position count is at or above the configured ceiling.</li>
            <li>The order's max loss would exceed the per-trade limit.</li>
            <li>Available capital is below the required order exposure.</li>
          </ul>
          <p className="pt-1">These checks run in the backend before the Kalshi API is ever called. The kill switch closes all open positions and disarms live trading immediately.</p>
        </CardContent>
      </Card>
    </div>
  );
}
