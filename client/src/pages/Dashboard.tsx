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
  const killSwitchMutation = { mutateAsync: async () => {} };

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
      setKillSwitchConfirm(false);
    } catch (error) {
      console.error("Kill switch activation failed:", error);
    }
  };

  const handleStartTrading = () => {
    setActivationMessage(null);
    startTradingMutation.mutate({ enabled: true });
  };

  // Show connection required if not connected
  if (!isConnected) {
    return (
      <div className="space-y-8 p-6">
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
      <div className="space-y-8 p-6">
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
    <div className="space-y-8 p-6">
      {/* Header with gradient text */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-5xl font-bold gradient-text mb-2">
            {user?.name || "LAURENZO"}
          </h1>
          <p className="text-muted-foreground">
            Kalshi Trading Dashboard • Owner: {user?.name}
          </p>
        </div>
        <Button
          onClick={handleKillSwitch}
          variant={killSwitchConfirm ? "destructive" : "outline"}
          className={killSwitchConfirm ? "bg-pink-600 hover:bg-pink-700" : ""}
        >
          <Zap className="w-4 h-4 mr-2" />
          {killSwitchConfirm ? "Confirm Kill Switch" : "KILL SWITCH"}
        </Button>
      </div>

      {activationMessage ? (
        <Card className="laurenzo-card border-cyan-500/30 bg-cyan-500/5">
          <CardContent className="pt-6">
            <p className="text-sm text-cyan-200">{activationMessage}</p>
          </CardContent>
        </Card>
      ) : null}

      {/* Start Trading Banner */}
      {!showStartTrading && (
        <Card className="laurenzo-card border-cyan-500/30 bg-cyan-500/5">
          <CardContent className="space-y-5 pt-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="mt-1 w-8 h-8 text-cyan-400" />
                <div>
                  <p className="font-semibold">Trading autonomy is now explicit</p>
                  <p className="text-sm text-muted-foreground">
                    {autonomyStatus.title}. Open Trading Autonomy to choose Manual, Approval Required, Semi-autonomous, or Fully Autonomous behavior.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-3">
                <Button onClick={() => navigate("/autonomy")} variant="outline">
                  Open Trading Autonomy
                </Button>
                <Button
                  onClick={() => setShowStartTrading(true)}
                  className="laurenzo-button"
                  disabled={tradingPreferences.autonomyMode === "manual"}
                >
                  Arm Live Trading
                </Button>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Current mode</div>
                <div className="mt-2 text-lg font-semibold text-foreground">{getAutonomyModeLabel(tradingPreferences.autonomyMode)}</div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {tradingPreferences.liveTradingEnabled ? "Live trading armed" : "Live trading disarmed"}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Confidence floor</div>
                <div className="mt-2 text-lg font-semibold text-foreground">{Math.round(tradingPreferences.minSignalConfidence * 100)}%</div>
                <p className="mt-2 text-xs text-muted-foreground">Minimum signal quality required by the saved policy.</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Order limit</div>
                <div className="mt-2 text-lg font-semibold text-foreground">${tradingPreferences.maxOrderNotional.toFixed(2)}</div>
                <p className="mt-2 text-xs text-muted-foreground">Maximum notional permitted by the autonomy policy.</p>
              </div>
            </div>
          </CardContent>
        </Card>
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

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="laurenzo-card border-emerald-500/20 bg-emerald-500/5">
          <CardContent className="space-y-3 pt-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-foreground">Away-from-chat status</p>
                <p className={`mt-2 text-lg font-semibold ${autonomyReadinessSummary.tone}`}>
                  {autonomyReadinessSummary.title}
                </p>
              </div>
              <Button variant="outline" onClick={() => navigate("/autonomy")}>
                Open Trading Autonomy
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{autonomyReadinessSummary.body}</p>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Latest away review</div>
                <div className={`mt-2 text-base font-semibold ${autonomyReviewSummary.tone}`}>{autonomyReviewSummary.title}</div>
                <p className="mt-2 text-xs text-muted-foreground">{autonomyReviewSummary.body}</p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Last recorded review time</div>
                <div className="mt-2 text-base font-semibold text-foreground">
                  {formatAutonomyActivityTime(autonomyActivityQuery.data?.lastRun?.createdAt)}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  Mode: {getAutonomyModeLabel(tradingPreferences.autonomyMode)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Equity Cards */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">GLOBAL EQUITY</p>
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <p className="text-3xl font-bold gradient-text">
              ${displayEquity.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Real Kalshi account balance
            </p>
          </CardContent>
        </Card>

        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">TOTAL EQUITY</p>
              <Activity className="w-4 h-4 text-cyan-400" />
            </div>
            <p className="text-3xl font-bold text-cyan-400">
              ${displayEquity.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Current account value
            </p>
          </CardContent>
        </Card>

        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">TOTAL TRADES</p>
              <TrendingUp className="w-4 h-4 text-lime-400" />
            </div>
            <p className="text-3xl font-bold text-lime-400">{totalTrades}</p>
            <p className="text-xs text-muted-foreground mt-2">
              Winning: {winningTrades}
            </p>
          </CardContent>
        </Card>

        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">WIN RATE</p>
              <TrendingDown className="w-4 h-4 text-pink-400" />
            </div>
            <p className="text-3xl font-bold text-pink-400">
              {(winRate * 100).toFixed(1)}%
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {hasClosedTrades
                ? "Success ratio on closed trades"
                : "No closed trades yet"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Performance Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">DAILY P&L</p>
              <TrendingUp className="w-4 h-4" />
            </div>
            <p
              className={`text-2xl font-bold ${dailyPnl >= 0 ? "text-lime-400" : "text-pink-400"}`}
            >
              {dailyPnl >= 0 ? "+" : ""}${dailyPnl.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Closed-trade P&L today
            </p>
          </CardContent>
        </Card>

        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">SHARPE RATIO</p>
              <Activity className="w-4 h-4" />
            </div>
            <p className="text-2xl font-bold text-cyan-400">
              {sharpeRatio.toFixed(2)}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              {hasClosedTrades
                ? "Risk-adjusted returns"
                : "Waiting for trade history"}
            </p>
          </CardContent>
        </Card>

        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">MAX DRAWDOWN</p>
              <AlertTriangle className="w-4 h-4" />
            </div>
            <p className="text-2xl font-bold text-pink-400">
              {(maxDrawdown * 100).toFixed(2)}%
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Peak-to-trough decline
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Additional Metrics */}
      <Card className="laurenzo-card">
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-muted-foreground mb-2">REALIZED P&L</p>
              <p
                className={`text-xl font-bold ${realizedPnl >= 0 ? "text-lime-400" : "text-pink-400"}`}
              >
                {realizedPnl >= 0 ? "+" : ""}${realizedPnl.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Closed position gains
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">
                UNREALIZED P&L
              </p>
              <p
                className={`text-xl font-bold ${unrealizedPnl >= 0 ? "text-cyan-400" : "text-pink-400"}`}
              >
                {unrealizedPnl >= 0 ? "+" : ""}${unrealizedPnl.toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Open position gains
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">
                RECOVERY FACTOR
              </p>
              <p className="text-xl font-bold text-pink-400">
                {(metrics?.recoveryFactor ?? 0).toFixed(2)}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Profit vs max loss
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">
                ACTIVE POSITIONS
              </p>
              <p className="text-xl font-bold text-yellow-400">
                {activePositions}
              </p>
              <p className="text-xs text-muted-foreground mt-1">Open trades</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
