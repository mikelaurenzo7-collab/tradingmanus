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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StartTradingDialog } from "@/components/StartTradingDialog";
import { useState } from "react";
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

  if (
    performanceOverviewQuery.isLoading ||
    accountStatusQuery.isLoading ||
    autonomyActivityQuery.isLoading
  ) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin w-12 h-12 text-primary" />
          <p className="text-muted-foreground">
            Initializing trading engine...
          </p>
        </div>
      </div>
    );
  }

  if (
    performanceOverviewQuery.isError ||
    accountStatusQuery.isError ||
    autonomyActivityQuery.isError
  ) {
    const errorMessage =
      performanceOverviewQuery.error?.message ||
      accountStatusQuery.error?.message ||
      autonomyActivityQuery.error?.message ||
      "We couldn't load your dashboard data. Please try again.";

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
        <div>
          <h1 className="text-5xl font-bold gradient-text mb-2">
            Connect Your Kalshi Account
          </h1>
          <p className="text-muted-foreground text-lg">
            Connect your Kalshi account to start trading and see your real
            account balance
          </p>
        </div>

        <Card className="laurenzo-card border-violet-500/30 bg-violet-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4 mb-6">
              <Plug className="w-12 h-12 text-violet-400" />
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  Account Balance
                </p>
                <p className="text-3xl font-bold text-violet-400">$0.00</p>
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
                className="laurenzo-button w-full"
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
          <Card className="laurenzo-card">
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

          <Card className="laurenzo-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">TOTAL TRADES</p>
                <TrendingUp className="w-4 h-4 text-lime-400" />
              </div>
              <p className="text-3xl font-bold text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground mt-2">
                Connect to unlock trade history
              </p>
            </CardContent>
          </Card>

          <Card className="laurenzo-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">WIN RATE</p>
                <TrendingDown className="w-4 h-4 text-pink-400" />
              </div>
              <p className="text-3xl font-bold text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground mt-2">
                Requires completed trades
              </p>
            </CardContent>
          </Card>

          <Card className="laurenzo-card">
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
        <div>
          <h1 className="text-5xl font-bold gradient-text mb-2">
            Account Funding Required
          </h1>
          <p className="text-muted-foreground text-lg">
            Your Kalshi account needs funds to start trading
          </p>
        </div>

        <Card className="laurenzo-card border-pink-500/30 bg-pink-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4 mb-6">
              <AlertCircle className="w-12 h-12 text-pink-400" />
              <div>
                <p className="text-sm text-muted-foreground mb-1">
                  Current Balance
                </p>
                <p className="text-3xl font-bold text-pink-400">
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
                className="laurenzo-button w-full"
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
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {user?.name} · Kalshi equity: <strong className="text-foreground">${displayEquity.toFixed(2)}</strong>
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <Button
            onClick={handleRefreshDashboard}
            variant="outline"
            disabled={
              performanceOverviewQuery.isFetching ||
              accountStatusQuery.isFetching ||
              autonomyActivityQuery.isFetching
            }
          >
            <RefreshCw
              className={`w-4 h-4 mr-2 ${
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
            variant={killSwitchConfirm ? "destructive" : "outline"}
            className={killSwitchConfirm ? "bg-pink-600 hover:bg-pink-700" : ""}
          >
            <Zap className="w-4 h-4 mr-2" />
            {killSwitchConfirm ? "Confirm Kill Switch" : "KILL SWITCH"}
          </Button>
        </div>
      </div>

      <Card className={`laurenzo-card ${isAccountDataStale ? "border-yellow-500/30 bg-yellow-500/5" : "border-cyan-500/20 bg-cyan-500/5"}`}>
        <CardContent className="flex flex-col gap-3 pt-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Live data freshness</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Kalshi equity synced {formatFreshnessLabel(lastAccountSyncAt)}. Dashboard refreshed {formatFreshnessLabel(dashboardRefreshedAt)}.
            </p>
          </div>
          <div className={`rounded-full border px-3 py-1 text-xs font-semibold ${isAccountDataStale ? "border-yellow-500/40 text-yellow-300" : "border-cyan-500/40 text-cyan-300"}`}>
            {isAccountDataStale ? "Refresh before trading decisions" : "Fresh enough for monitoring"}
          </div>
        </CardContent>
      </Card>

      {activationMessage ? (
        <Card className="laurenzo-card border-cyan-500/30 bg-cyan-500/5">
          <CardContent className="pt-6">
            <p className="text-sm text-cyan-200">{activationMessage}</p>
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
              <Button size="sm" className="laurenzo-button" disabled={tradingPreferences.autonomyMode === "manual"} onClick={() => setShowStartTrading(true)}>Arm</Button>
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

      {/* Key metrics grid */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground mb-1">Account Equity</p>
            <p className="text-2xl font-bold gradient-text">${displayEquity.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-1">Kalshi balance</p>
          </CardContent>
        </Card>
        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground mb-1">Total Trades</p>
            <p className="text-2xl font-bold text-lime-400">{totalTrades}</p>
            <p className="text-xs text-muted-foreground mt-1">{winningTrades} winning</p>
          </CardContent>
        </Card>
        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground mb-1">Win Rate</p>
            <p className="text-2xl font-bold text-pink-400">{(winRate * 100).toFixed(1)}%</p>
            <p className="text-xs text-muted-foreground mt-1">{hasClosedTrades ? "closed trades" : "no trades yet"}</p>
          </CardContent>
        </Card>
        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <p className="text-xs text-muted-foreground mb-1">Active Positions</p>
            <p className="text-2xl font-bold text-yellow-400">{activePositions}</p>
            <p className="text-xs text-muted-foreground mt-1">open trades</p>
          </CardContent>
        </Card>
      </div>

      {/* P&L + risk metrics */}
      <Card className="laurenzo-card">
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-muted-foreground mb-1">Daily P&L</p>
              <p className={`text-xl font-bold ${dailyPnl >= 0 ? "text-lime-400" : "text-pink-400"}`}>{dailyPnl >= 0 ? "+" : ""}${dailyPnl.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">Closed today</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Realized P&L</p>
              <p className={`text-xl font-bold ${realizedPnl >= 0 ? "text-lime-400" : "text-pink-400"}`}>{realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">Closed positions</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Unrealized P&L</p>
              <p className={`text-xl font-bold ${unrealizedPnl >= 0 ? "text-cyan-400" : "text-pink-400"}`}>{unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">Open positions</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Max Drawdown</p>
              <p className="text-xl font-bold text-pink-400">{(maxDrawdown * 100).toFixed(2)}%</p>
              <p className="text-xs text-muted-foreground mt-1">Peak-to-trough</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Sharpe Ratio</p>
              <p className="text-xl font-bold text-cyan-400">{sharpeRatio.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">{hasClosedTrades ? "risk-adjusted" : "awaiting trades"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-1">Recovery Factor</p>
              <p className="text-xl font-bold text-pink-400">{(metrics?.recoveryFactor ?? 0).toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-1">Profit vs max loss</p>
            </div>
          </div>
        </CardContent>
      </Card>

    </div>
  );
}
