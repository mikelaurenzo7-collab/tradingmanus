import {
  Loader2,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  Zap,
  Sparkles,
  Activity,
  CheckCircle2,
  AlertCircle,
  Plug,
  RefreshCw,
  DollarSign,
  Target,
  Trophy,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StartTradingDialog } from "@/components/StartTradingDialog";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/widgets/StatCard";
import { PerformanceChart } from "@/components/charts/PerformanceChart";
import { DashboardSkeleton } from "@/components/enhanced/Skeletons";
import { useState, useMemo } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import {
  DEFAULT_TRADING_PREFERENCES,
  formatAutonomyActivityTime,
  getAutonomyModeLabel,
  getAutonomyReadinessSummary,
  getAutonomyReviewSummary,
  getAutonomyStatusSummary,
} from "@/lib/tradingAutonomy";

const DATA_STALE_AFTER_MS = 5 * 60 * 1000;

function getTimestampMs(value: Date | string | null | undefined) {
  if (!value) return null;
  const timestamp = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function formatFreshnessLabel(value: Date | string | null | undefined) {
  const timestamp = getTimestampMs(value);
  if (!timestamp) return "not synced yet";

  const ageMs = Math.max(0, Date.now() - timestamp);
  if (ageMs < 60 * 1000) return "just now";

  const ageMinutes = Math.floor(ageMs / (60 * 1000));
  if (ageMinutes < 60) return `${ageMinutes}m ago`;

  const ageHours = Math.floor(ageMinutes / 60);
  return `${ageHours}h ago`;
}

export default function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const [killSwitchConfirm, setKillSwitchConfirm] = useState(false);
  const [showStartTrading, setShowStartTrading] = useState(false);
  const [activationMessage, setActivationMessage] = useState<string | null>(null);

  const performanceOverviewQuery =
    trpc.kalshi.getPerformanceOverview.useQuery();
  const accountStatusQuery = trpc.kalshi.getKalshiAccountStatus.useQuery();
  const { data: instructions } = trpc.training.getInstructions.useQuery();
  const autonomyActivityQuery = trpc.kalshi.getAutonomyActivity.useQuery();
  const equityCurveQuery = trpc.kalshi.getEquityCurve.useQuery({ days: 7 });

  const startTradingMutation = trpc.kalshi.setTradingActivation.useMutation({
    onSuccess: async (result) => {
      setShowStartTrading(false);
      setActivationMessage(
        result.preferences.liveTradingEnabled
          ? `${getAutonomyModeLabel(result.preferences.autonomyMode)} mode is now armed for live trading.`
          : "Live trading has been disarmed."
      );
      await Promise.all([
        utils.kalshi.getKalshiAccountStatus.invalidate(),
        utils.kalshi.getTradingPreferences.invalidate(),
      ]);
    },
    onError: (error) => {
      setActivationMessage(error.message || "Unable to arm live trading.");
    },
  });
  const killSwitchMutation = trpc.kalshi.killSwitch.useMutation({
    onSuccess: async (result) => {
      setKillSwitchConfirm(false);
      setActivationMessage(
        result.success
          ? `Kill switch submitted. Live trading is disarmed and ${result.closedPositions}/${result.totalPositions} position(s) have close orders submitted or closed.`
          : `Kill switch disarmed live trading, but ${result.failedPositions}/${result.totalPositions} position(s) need manual review.`
      );
      await Promise.all([
        utils.kalshi.getKalshiAccountStatus.invalidate(),
        utils.kalshi.getTradingPreferences.invalidate(),
        utils.kalshi.getAutonomyActivity.invalidate(),
        utils.kalshi.getPositions.invalidate(),
      ]);
    },
    onError: (error) => {
      setKillSwitchConfirm(false);
      setActivationMessage(error.message || "Unable to disarm live trading.");
    },
  });

  // NOTE: All hooks must be called unconditionally before any early return to
  // satisfy React's Rules of Hooks. Extract query data here for later memoization.
  const equityCurveForMemo = equityCurveQuery.data;

  // Wire chart to real getEquityCurve data (7 days)
  const performanceChartData = useMemo(() => {
    // If query is loading, errored, or returned no data, fall back to empty
    if (!equityCurveForMemo?.points || equityCurveForMemo.points.length === 0) {
      return [];
    }

    const { points, startingBalance } = equityCurveForMemo;

    // Transform ISO date strings (e.g., "2026-05-06") to display format (e.g., "May 6")
    return points.map((point) => {
      const dateObj = new Date(`${point.date}T00:00:00Z`);
      const dayLabel = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const pnl = point.equity - startingBalance;

      return {
        date: dayLabel,
        equity: point.equity,
        pnl,
      };
    });
  }, [equityCurveForMemo]);

  // Generate trend data for sparklines (last 7 data points)
  const pnlTrend = useMemo(
    () => performanceChartData.map((d) => d.pnl),
    [performanceChartData],
  );

  const equityTrend = useMemo(
    () => performanceChartData.map((d) => d.equity),
    [performanceChartData],
  );

  if (
    performanceOverviewQuery.isLoading ||
    accountStatusQuery.isLoading ||
    autonomyActivityQuery.isLoading
  ) {
    return <DashboardSkeleton />;
  }

  // We deliberately *don't* hard-block the dashboard when only the
  // performance-overview or autonomy-activity queries fail. Those datasets
  // are derived/aggregated and a single sub-query failure (e.g. transient
  // schema drift on Railway) used to brick the entire landing page. The
  // page already tolerates missing metrics (everything is `?? 0`), so we
  // surface a non-blocking banner instead and let the user keep working.
  // We only fail-hard if the account status itself is unloadable, since
  // that drives the connection-required vs. connected branches below.
  if (accountStatusQuery.isError) {
    const errorMessage =
      accountStatusQuery.error?.message ||
      "We couldn't load your account status. Please try again.";

    return (
      <div className="flex items-center justify-center min-h-screen p-6">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
            <AlertTriangle className="h-12 w-12 text-destructive" />
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">Unable to load dashboard</h2>
              <p className="text-sm text-muted-foreground">{errorMessage}</p>
            </div>
            <Button
              onClick={() => {
                performanceOverviewQuery.refetch();
                accountStatusQuery.refetch();
                autonomyActivityQuery.refetch();
              }}
            >
              Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const degradedSources: string[] = [];
  if (performanceOverviewQuery.isError) degradedSources.push("performance overview");
  if (autonomyActivityQuery.isError) degradedSources.push("autonomy activity");

  const accountStatus = accountStatusQuery.data;
  const performanceOverview = performanceOverviewQuery.data;
  const metrics = performanceOverview?.metrics;

  // Show $0 until Kalshi account is connected
  const isConnected = accountStatus?.connected || false;
  const equity = isConnected ? accountStatus?.equity || 0 : 0;
  const displayEquity = equity;
  const isFunded = equity > 0;
  const hasInstructions = (instructions?.length || 0) > 0;
  const tradingPreferences = accountStatus?.tradingPreferences ?? DEFAULT_TRADING_PREFERENCES;
  const autonomyStatus = getAutonomyStatusSummary(tradingPreferences);
  const autonomyReviewSummary = getAutonomyReviewSummary(autonomyActivityQuery.data);
  const autonomyReadinessSummary = getAutonomyReadinessSummary({
    preferences: tradingPreferences,
    connected: isConnected,
    equity,
    lastRunAt: autonomyActivityQuery.data?.lastRun?.createdAt ?? null,
  });
  const lastAccountSyncAt = accountStatus?.lastSyncedAt ?? null;
  const lastAccountSyncMs = getTimestampMs(lastAccountSyncAt);
  const accountSyncAgeMs = lastAccountSyncMs ? Date.now() - lastAccountSyncMs : Number.POSITIVE_INFINITY;
  const isAccountDataStale = isConnected && accountSyncAgeMs > DATA_STALE_AFTER_MS;
  const dashboardRefreshedAt = performanceOverviewQuery.dataUpdatedAt
    ? new Date(performanceOverviewQuery.dataUpdatedAt)
    : null;

  const hasClosedTrades = (metrics?.totalTrades || 0) > 0;
  const winningTrades = metrics?.winningTrades ?? 0;
  const totalTrades = metrics?.totalTrades ?? 0;
  const winRate = metrics?.winRate ?? 0;
  const dailyPnl = metrics?.dailyPnL ?? 0;
  const sharpeRatio = metrics?.sharpeRatio ?? 0;
  const maxDrawdown = metrics?.maxDrawdown ?? 0;
  const realizedPnl = metrics?.realizedPnL ?? 0;
  const unrealizedPnl = metrics?.unrealizedPnL ?? 0;
  const activePositions = metrics?.activePositions ?? 0;

  const handleKillSwitch = async () => {
    if (!killSwitchConfirm) {
      setKillSwitchConfirm(true);
      return;
    }

    try {
      await killSwitchMutation.mutateAsync();
    } catch (error) {
      console.error("Kill switch activation failed:", error);
    }
  };

  const handleStartTrading = () => {
    setActivationMessage(null);
    startTradingMutation.mutate({ enabled: true });
  };

  const handleRefreshDashboard = () => {
    performanceOverviewQuery.refetch();
    accountStatusQuery.refetch();
    autonomyActivityQuery.refetch();
  };

  // Show connection required if not connected
  if (!isConnected) {
    return (
      <div className="space-y-8">
        <PageHeader
          icon={Plug}
          title="Connect Your Kalshi Account"
          description="Connect your Kalshi account to start trading and see your real account balance"
          iconColor="text-primary"
        />

        <Card className="data-card border-primary/30 bg-primary/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4 mb-6">
              <Plug className="w-12 h-12 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  Account Balance
                </p>
                <p className="text-3xl font-bold text-primary">$0.00</p>
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-muted-foreground">
                To start trading on Kalshi prediction markets, connect your
                Kalshi account first. Your real account balance will appear here
                once connected.
              </p>
              <Button
                onClick={() => navigate("/connect")}
                className="w-full bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-all"
                size="lg"
              >
                <Plug className="w-4 h-4 mr-2" />
                Connect Kalshi Account
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Your API key is encrypted and stored securely
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Explicit empty-state metrics while disconnected */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 opacity-50">
          <Card className="data-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">GLOBAL EQUITY</p>
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <p className="text-3xl font-bold text-muted-foreground">$0.00</p>
              <p className="text-xs text-muted-foreground mt-2">
                Connect to see real balance
              </p>
            </CardContent>
          </Card>

          <Card className="data-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">TOTAL TRADES</p>
                <TrendingUp className="w-4 h-4 stat-increase" />
              </div>
              <p className="text-3xl font-bold text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground mt-2">
                Connect to unlock trade history
              </p>
            </CardContent>
          </Card>

          <Card className="data-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">WIN RATE</p>
                <TrendingDown className="w-4 h-4 stat-decrease" />
              </div>
              <p className="text-3xl font-bold text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground mt-2">
                Requires completed trades
              </p>
            </CardContent>
          </Card>

          <Card className="data-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">SHARPE RATIO</p>
                <Activity className="w-4 h-4" />
              </div>
              <p className="text-3xl font-bold text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground mt-2">
                Calculated after closed trades
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Show funding page if connected but not funded
  if (!isFunded) {
    return (
      <div className="space-y-8">
        <PageHeader
          icon={AlertCircle}
          title="Account Funding Required"
          description="Your Kalshi account needs funds to start trading"
          iconColor="text-warning"
        />

        <Card className="data-card border-warning/30 bg-warning/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4 mb-6">
              <AlertCircle className="w-12 h-12 text-warning" />
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  Current Balance
                </p>
                <p className="text-3xl font-bold text-warning">
                  ${equity.toFixed(2)}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-muted-foreground">
                To start trading on Kalshi prediction markets, you need to
                deposit funds into your account.
              </p>
              <Button
                onClick={() =>
                  window.open("https://kalshi.com/account/deposit", "_blank")
                }
                className="w-full bg-gradient-to-r from-warning to-warning/80 hover:opacity-90 transition-all"
                size="lg"
              >
                Deposit Funds on Kalshi
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Deposit only the amount that matches your risk tolerance and first-test plan.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Funded account - show full dashboard

  return (
    <div className="space-y-6">
      {degradedSources.length > 0 && (
        <Card className="glass-panel border-warning/30 bg-warning/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-4 text-sm">
            <AlertCircle className="w-4 h-4 text-warning shrink-0" />
            <span className="text-foreground">
              Some dashboard data is temporarily unavailable
              <span className="text-muted-foreground"> ({degradedSources.join(", ")})</span>.
              Live trading and connection status are unaffected.
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={() => {
                performanceOverviewQuery.refetch();
                autonomyActivityQuery.refetch();
              }}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-2" />
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Header */}
      <PageHeader
        icon={Activity}
        title="Dashboard"
        description={
          <>
            {user?.name} · Kalshi equity:{" "}
            <strong className="text-foreground tabular-nums">${displayEquity.toFixed(2)}</strong>
          </>
        }
        iconColor="text-primary"
        actions={
          <>
            <Button
              onClick={handleRefreshDashboard}
              variant="outline"
              size="sm"
              disabled={
                performanceOverviewQuery.isFetching ||
                accountStatusQuery.isFetching ||
                autonomyActivityQuery.isFetching
              }
              className="gap-2"
            >
              <RefreshCw
                className={`w-4 h-4 ${
                  performanceOverviewQuery.isFetching ||
                  accountStatusQuery.isFetching ||
                  autonomyActivityQuery.isFetching
                    ? "animate-spin"
                    : ""
                }`}
              />
              Refresh
            </Button>
            <Button
              onClick={handleKillSwitch}
              size="sm"
              variant={killSwitchConfirm ? "destructive" : "outline"}
              className={`gap-2 ${killSwitchConfirm ? "bg-rose-600 hover:bg-rose-700 border-rose-500" : "border-rose-400/40 text-rose-300 hover:bg-rose-500/10 hover:text-rose-200"}`}
            >
              <Zap className="w-4 h-4" />
              {killSwitchConfirm ? "Confirm Kill Switch" : "Kill Switch"}
            </Button>
          </>
        }
      />

      <Card className={`glass-panel ${isAccountDataStale ? "border-warning/30 bg-warning/5" : "border-accent/20 bg-accent/5"}`}>
        <CardContent className="flex flex-col gap-3 pt-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Live data freshness</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Kalshi equity synced {formatFreshnessLabel(lastAccountSyncAt)}. Dashboard refreshed {formatFreshnessLabel(dashboardRefreshedAt)}.
            </p>
          </div>
          <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${isAccountDataStale ? "border-warning/40 text-warning-foreground" : "border-accent/40 text-accent-foreground"}`}>
            {isAccountDataStale ? "Refresh before trading decisions" : "Fresh enough for monitoring"}
          </div>
        </CardContent>
      </Card>

      {activationMessage ? (
        <Card className="glass-panel border-accent/30 bg-accent/5">
          <CardContent className="pt-6">
            <p className="text-sm text-accent-foreground">{activationMessage}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Autonomy status bar */}
      {!showStartTrading && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/50 px-4 py-3">
          <div className="text-sm">
            <span className={`font-semibold ${autonomyStatus.tone}`}>{autonomyStatus.title}</span>
            <span className="text-muted-foreground ml-2">· {getAutonomyModeLabel(tradingPreferences.autonomyMode)} · {Math.round(tradingPreferences.minSignalConfidence * 100)}% min confidence · ${tradingPreferences.maxOrderNotional.toFixed(0)} max order</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => navigate("/autonomy")}>Settings</Button>
            {!tradingPreferences.liveTradingEnabled && (
              <Button size="sm" className="bg-gradient-to-r from-primary to-accent hover:opacity-90" disabled={tradingPreferences.autonomyMode === "manual"} onClick={() => setShowStartTrading(true)}>Arm</Button>
            )}
          </div>
        </div>
      )}

      {/* Start Trading Dialog */}
      {showStartTrading && (
        <StartTradingDialog
          equity={equity}
          hasInstructions={hasInstructions}
          preferences={tradingPreferences}
          onConfirm={handleStartTrading}
          onManageSettings={() => navigate("/autonomy")}
          onCancel={() => setShowStartTrading(false)}
          isLoading={startTradingMutation.isPending}
        />
      )}

      {/* Last scan summary */}
      <div className="rounded-lg border border-border/60 bg-background/50 px-4 py-3 text-sm">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div>
            <span className={`font-medium ${autonomyReviewSummary.tone}`}>{autonomyReviewSummary.title}</span>
            <span className="text-muted-foreground ml-2">· Last scan: {formatAutonomyActivityTime(autonomyActivityQuery.data?.lastRun?.createdAt)}</span>
          </div>
          <span className={`text-xs ${autonomyReadinessSummary.tone}`}>{autonomyReadinessSummary.title}</span>
        </div>
      </div>

      {/* Key metrics grid - 4-column StatCard layout */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 animate-fade-in">
        <StatCard
          label="Total P&L"
          value={`$${realizedPnl.toFixed(2)}`}
          change={realizedPnl !== 0 ? (realizedPnl / displayEquity) * 100 : undefined}
          trend={pnlTrend}
          icon={<DollarSign size={20} />}
          color={realizedPnl >= 0 ? "#10b981" : "#ef4444"}
          className="data-card hover:scale-105 transition-transform"
        />
        <StatCard
          label="Account Capital"
          value={`$${displayEquity.toFixed(2)}`}
          trend={equityTrend}
          icon={<Sparkles size={20} />}
          color="#6366f1"
          className="data-card hover:scale-105 transition-transform"
        />
        <StatCard
          label="Open Positions"
          value={activePositions}
          icon={<Layers size={20} />}
          color="#f59e0b"
          className="data-card hover:scale-105 transition-transform"
        />
        <StatCard
          label="Win Rate"
          value={hasClosedTrades ? `${(winRate * 100).toFixed(1)}%` : "—"}
          icon={<Trophy size={20} />}
          color="#ec4899"
          className="data-card hover:scale-105 transition-transform"
        />
      </div>

      {/* Performance Chart */}
      <Card className="glass-panel animate-fade-in">
        <CardContent className="pt-6">
          <div className="mb-4">
            <h3 className="text-lg font-semibold text-foreground mb-1">Equity Curve</h3>
            <p className="text-sm text-muted-foreground">7-day performance overview</p>
          </div>
          <PerformanceChart
            data={performanceChartData}
            series={[
              { key: 'equity', name: 'Equity', color: '#8864ff' },
            ]}
            height={280}
            formatY={(value) => `$${value.toFixed(0)}`}
            areaShading={false}
          />
        </CardContent>
      </Card>

      {/* P&L + risk metrics - Enhanced card layout */}
      <Card className="data-card animate-fade-in">
        <CardContent className="pt-6">
          <h3 className="text-lg font-semibold text-foreground mb-4">Performance Metrics</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Daily P&L</p>
              <p className={`text-xl font-bold stat-${dailyPnl >= 0 ? "increase" : "decrease"}`}>{dailyPnl >= 0 ? "+" : ""}${dailyPnl.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">Closed today</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Realized P&L</p>
              <p className={`text-xl font-bold stat-${realizedPnl >= 0 ? "increase" : "decrease"}`}>{realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">Closed positions</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Unrealized P&L</p>
              <p className={`text-xl font-bold stat-${unrealizedPnl >= 0 ? "increase" : "decrease"}`}>{unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">Open positions</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Max Drawdown</p>
              <p className="text-xl font-bold text-destructive">{(maxDrawdown * 100).toFixed(2)}%</p>
              <p className="text-xs text-muted-foreground mt-1">Peak-to-trough</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Sharpe Ratio</p>
              <p className="text-xl font-bold text-accent">{sharpeRatio.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">{hasClosedTrades ? "risk-adjusted" : "awaiting trades"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Recovery Factor</p>
              <p className="text-xl font-bold text-primary">{(metrics?.recoveryFactor ?? 0).toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">Profit vs max loss</p>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
