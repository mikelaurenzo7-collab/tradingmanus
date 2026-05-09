import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  DollarSign,
  Layers,
  Plug,
  RefreshCw,
  Settings as SettingsIcon,
  Sparkles,
  Trophy,
  Zap,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StatCard } from "@/components/widgets/StatCard";
import { DailyPlayScoreboard } from "@/components/widgets/DailyPlayScoreboard";
import { PerformanceChart } from "@/components/charts/PerformanceChart";
import { StartTradingDialog } from "@/components/StartTradingDialog";
import { LiveHeartbeat } from "@/components/LiveHeartbeat";
import { DashboardSkeleton } from "@/components/enhanced/Skeletons";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { cn } from "@/lib/utils";
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
  const timestamp =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
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
  const [showStartTrading, setShowStartTrading] = useState(false);
  const [activationMessage, setActivationMessage] = useState<string | null>(
    null
  );

  const performanceOverviewQuery =
    trpc.kalshi.getPerformanceOverview.useQuery();
  const accountStatusQuery = trpc.kalshi.getKalshiAccountStatus.useQuery();
  const { data: instructions } = trpc.training.getInstructions.useQuery();
  const autonomyActivityQuery = trpc.kalshi.getAutonomyActivity.useQuery();
  const equityCurveQuery = trpc.kalshi.getEquityCurve.useQuery({ days: 7 });

  const startTradingMutation = trpc.kalshi.setTradingActivation.useMutation({
    onSuccess: async result => {
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
    onError: error =>
      setActivationMessage(error.message || "Unable to arm live trading."),
  });

  const equityCurveForMemo = equityCurveQuery.data;

  const performanceChartData = useMemo(() => {
    if (!equityCurveForMemo?.points || equityCurveForMemo.points.length === 0) {
      return [];
    }
    const { points, startingBalance } = equityCurveForMemo;
    return points.map(point => {
      const dateObj = new Date(`${point.date}T00:00:00Z`);
      const dayLabel = dateObj.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const pnl = point.equity - startingBalance;
      return { date: dayLabel, equity: point.equity, pnl };
    });
  }, [equityCurveForMemo]);

  const pnlTrend = useMemo(
    () => performanceChartData.map(d => d.pnl),
    [performanceChartData]
  );
  const equityTrend = useMemo(
    () => performanceChartData.map(d => d.equity),
    [performanceChartData]
  );

  if (
    performanceOverviewQuery.isLoading ||
    accountStatusQuery.isLoading ||
    autonomyActivityQuery.isLoading
  ) {
    return <DashboardSkeleton />;
  }

  // Hard-fail only if account status itself can't load — derived data is fail-soft.
  if (accountStatusQuery.isError) {
    const errorMessage =
      accountStatusQuery.error?.message ||
      "We couldn't load your account status. Please try again.";

    return (
      <div className="flex items-center justify-center min-h-[60vh] p-6">
        <Card className="w-full max-w-md">
          <CardContent className="flex flex-col items-center gap-4 p-6 text-center">
            <AlertTriangle className="h-12 w-12 text-destructive" />
            <div className="space-y-2">
              <h2 className="text-xl font-semibold">
                Unable to load dashboard
              </h2>
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
  if (performanceOverviewQuery.isError)
    degradedSources.push("performance overview");
  if (autonomyActivityQuery.isError) degradedSources.push("autonomy activity");

  const accountStatus = accountStatusQuery.data;
  const performanceOverview = performanceOverviewQuery.data;
  const metrics = performanceOverview?.metrics;

  const kalshiConnected = accountStatus?.connected || false;
  const isConnected = kalshiConnected;
  const equity = isConnected ? accountStatus?.equity || 0 : 0;
  const isFunded = equity > 0;
  const hasInstructions = (instructions?.length || 0) > 0;
  const tradingPreferences =
    accountStatus?.tradingPreferences ?? DEFAULT_TRADING_PREFERENCES;
  const autonomyStatus = getAutonomyStatusSummary(tradingPreferences);
  const autonomyReviewSummary = getAutonomyReviewSummary(
    autonomyActivityQuery.data
  );
  const autonomyReadinessSummary = getAutonomyReadinessSummary({
    preferences: tradingPreferences,
    connected: kalshiConnected,
    equity,
    lastRunAt: autonomyActivityQuery.data?.lastRun?.createdAt ?? null,
  });
  const lastAccountSyncAt = accountStatus?.lastSyncedAt ?? null;
  const lastAccountSyncMs = getTimestampMs(lastAccountSyncAt);
  const accountSyncAgeMs = lastAccountSyncMs
    ? Date.now() - lastAccountSyncMs
    : Number.POSITIVE_INFINITY;
  const isAccountDataStale =
    isConnected && accountSyncAgeMs > DATA_STALE_AFTER_MS;

  const hasClosedTrades = (metrics?.totalTrades || 0) > 0;
  const winRate = metrics?.winRate ?? 0;
  const dailyPnl = metrics?.dailyPnL ?? 0;
  const sharpeRatio = metrics?.sharpeRatio ?? 0;
  const maxDrawdown = metrics?.maxDrawdown ?? 0;
  const realizedPnl = metrics?.realizedPnL ?? 0;
  const unrealizedPnl = metrics?.unrealizedPnL ?? 0;
  const activePositions = metrics?.activePositions ?? 0;
  const recoveryFactor = metrics?.recoveryFactor ?? 0;

  const handleStartTrading = () => {
    setActivationMessage(null);
    startTradingMutation.mutate({ enabled: true });
  };

  const handleRefreshDashboard = () => {
    performanceOverviewQuery.refetch();
    accountStatusQuery.refetch();
    autonomyActivityQuery.refetch();
    equityCurveQuery.refetch();
  };

  const isRefreshing =
    performanceOverviewQuery.isFetching ||
    accountStatusQuery.isFetching ||
    autonomyActivityQuery.isFetching ||
    equityCurveQuery.isFetching;

  // ---------- Onboarding gates ---------- //

  if (!isConnected) {
    return <ConnectionGate onConnect={() => navigate("/connect")} />;
  }

  if (kalshiConnected && !isFunded) {
    return <FundingGate equity={equity} />;
  }

  // ---------- Funded dashboard ---------- //

  return (
    <div className="space-y-4">
      {/* Optional banners */}
      {degradedSources.length > 0 && (
        <Card className="border-warning/30 bg-warning/5">
          <CardContent className="flex flex-wrap items-center gap-3 p-3 text-sm">
            <AlertCircle className="w-4 h-4 text-warning shrink-0" />
            <span className="text-foreground">
              Some dashboard data is temporarily unavailable
              <span className="text-muted-foreground">
                {" "}
                ({degradedSources.join(", ")})
              </span>
              . Live trading and connection status are unaffected.
            </span>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto h-7"
              onClick={handleRefreshDashboard}
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      {activationMessage && (
        <Card className="border-accent/30 bg-accent/5">
          <CardContent className="flex items-center gap-2 p-3 text-sm">
            <CheckCircle2 className="w-4 h-4 text-accent shrink-0" />
            <span className="text-foreground">{activationMessage}</span>
            <button
              onClick={() => setActivationMessage(null)}
              className="ml-auto text-xs text-muted-foreground hover:text-foreground"
            >
              Dismiss
            </button>
          </CardContent>
        </Card>
      )}

      <LiveHeartbeat />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <PlatformStatusTile
          platform="Kalshi"
          connected={kalshiConnected}
          detail={
            kalshiConnected
              ? `$${equity.toFixed(2)} synced capital`
              : "Connect RSA API credentials"
          }
          onConnect={() => navigate("/connect")}
        />
        <PolymarketStatusTileFromQuery
          onConnect={() => navigate("/connect")}
        />
      </div>

      {/* Row 1: Hero KPI strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label="Total P&L"
          value={`$${realizedPnl.toFixed(2)}`}
          change={
            realizedPnl !== 0 && equity > 0
              ? (realizedPnl / equity) * 100
              : undefined
          }
          trend={pnlTrend}
          icon={<DollarSign size={18} />}
          color={realizedPnl >= 0 ? "#10b981" : "#ef4444"}
        />
        <StatCard
          label="Account Capital"
          value={`$${equity.toFixed(2)}`}
          trend={equityTrend}
          icon={<Sparkles size={18} />}
          color="#6366f1"
        />
        <StatCard
          label="Open Positions"
          value={activePositions}
          icon={<Layers size={18} />}
          color="#f59e0b"
        />
        <StatCard
          label="Win Rate"
          value={hasClosedTrades ? `${(winRate * 100).toFixed(1)}%` : "—"}
          icon={<Trophy size={18} />}
          color="#ec4899"
        />
      </div>

      {/* Row 2: Chart + autonomy command panel */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-3">
        <Card className="xl:col-span-2 glass-panel">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
                  Equity Curve
                  <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    7d
                  </span>
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Synced {formatFreshnessLabel(lastAccountSyncAt)}
                  {isAccountDataStale && (
                    <span className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-warning/10 text-warning text-[10px] font-medium">
                      <AlertCircle className="w-3 h-3" />
                      Refresh before trading
                    </span>
                  )}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefreshDashboard}
                disabled={isRefreshing}
                className="h-7 px-2 text-xs"
              >
                <RefreshCw
                  className={cn("w-3.5 h-3.5", isRefreshing && "animate-spin")}
                />
              </Button>
            </div>
            <PerformanceChart
              data={performanceChartData}
              series={[{ key: "equity", name: "Equity", color: "#8864ff" }]}
              height={240}
              formatY={value => `$${value.toFixed(0)}`}
              areaShading={true}
            />
          </CardContent>
        </Card>

        <DailyPlayScoreboard compact className="mb-6" />

        <AutonomyCommandPanel
          welcomeName={user?.name ?? null}
          equity={equity}
          autonomyStatusTitle={autonomyStatus.title}
          autonomyStatusTone={autonomyStatus.tone}
          modeLabel={getAutonomyModeLabel(tradingPreferences.autonomyMode)}
          minConfidencePct={Math.round(
            tradingPreferences.minSignalConfidence * 100
          )}
          maxOrderNotional={tradingPreferences.maxOrderNotional}
          liveArmed={tradingPreferences.liveTradingEnabled}
          canArm={tradingPreferences.autonomyMode !== "manual"}
          reviewTitle={autonomyReviewSummary.title}
          reviewTone={autonomyReviewSummary.tone}
          lastScanLabel={formatAutonomyActivityTime(
            autonomyActivityQuery.data?.lastRun?.createdAt
          )}
          readinessTitle={autonomyReadinessSummary.title}
          readinessTone={autonomyReadinessSummary.tone}
          onArm={() => setShowStartTrading(true)}
          onSettings={() => navigate("/autonomy")}
        />
      </div>

      {/* Row 3: Detailed performance metrics — single line at lg+ */}
      <Card className="data-card">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-4">
            <MiniMetric
              label="Daily P&L"
              value={`${dailyPnl >= 0 ? "+" : ""}$${dailyPnl.toFixed(2)}`}
              tone={dailyPnl >= 0 ? "increase" : "decrease"}
              hint="Closed today"
            />
            <MiniMetric
              label="Realized"
              value={`${realizedPnl >= 0 ? "+" : ""}$${realizedPnl.toFixed(2)}`}
              tone={realizedPnl >= 0 ? "increase" : "decrease"}
              hint="Closed positions"
            />
            <MiniMetric
              label="Unrealized"
              value={`${unrealizedPnl >= 0 ? "+" : ""}$${unrealizedPnl.toFixed(2)}`}
              tone={unrealizedPnl >= 0 ? "increase" : "decrease"}
              hint="Open positions"
            />
            <MiniMetric
              label="Max Drawdown"
              value={`${(maxDrawdown * 100).toFixed(2)}%`}
              tone="destructive"
              hint="Peak-to-trough"
            />
            <MiniMetric
              label="Sharpe"
              value={sharpeRatio.toFixed(2)}
              tone="accent"
              hint={hasClosedTrades ? "risk-adjusted" : "awaiting trades"}
            />
            <MiniMetric
              label="Recovery"
              value={recoveryFactor.toFixed(2)}
              tone="primary"
              hint="Profit vs max loss"
            />
          </div>
        </CardContent>
      </Card>

      {/* Start trading dialog (modal) */}
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
    </div>
  );
}

// =========================================================================
// Sub-components
// =========================================================================

interface AutonomyCommandPanelProps {
  welcomeName: string | null;
  equity: number;
  autonomyStatusTitle: string;
  autonomyStatusTone: string;
  modeLabel: string;
  minConfidencePct: number;
  maxOrderNotional: number;
  liveArmed: boolean;
  canArm: boolean;
  reviewTitle: string;
  reviewTone: string;
  lastScanLabel: string;
  readinessTitle: string;
  readinessTone: string;
  onArm: () => void;
  onSettings: () => void;
}

function AutonomyCommandPanel(props: AutonomyCommandPanelProps) {
  return (
    <Card className="glass-panel border-primary/10">
      <CardContent className="p-4 space-y-3">
        {/* Status header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-primary" />
            <h3 className="text-sm font-semibold">Autonomy</h3>
          </div>
          <span
            className={cn("text-xs font-semibold", props.autonomyStatusTone)}
          >
            {props.autonomyStatusTitle}
          </span>
        </div>

        {/* Config snapshot */}
        <div className="space-y-1.5 text-xs rounded-md bg-background/40 border border-border/40 p-2.5">
          <ConfigRow label="Mode" value={props.modeLabel} />
          <ConfigRow
            label="Min confidence"
            value={`${props.minConfidencePct}%`}
          />
          <ConfigRow
            label="Max order"
            value={`$${props.maxOrderNotional.toFixed(0)}`}
          />
        </div>

        {/* Last scan + readiness */}
        <div className="space-y-1.5 text-xs">
          <div className="flex items-start justify-between gap-2">
            <span className="text-muted-foreground">Last scan</span>
            <span className="text-foreground text-right">
              {props.lastScanLabel || "Pending"}
            </span>
          </div>
          <div className="flex items-start justify-between gap-2">
            <span className="text-muted-foreground">Reviewer</span>
            <span className={cn("text-right", props.reviewTone)}>
              {props.reviewTitle}
            </span>
          </div>
          <div className="flex items-start justify-between gap-2">
            <span className="text-muted-foreground">Readiness</span>
            <span className={cn("text-right", props.readinessTone)}>
              {props.readinessTitle}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            variant="outline"
            onClick={props.onSettings}
            className="flex-1 h-8 gap-1.5"
          >
            <SettingsIcon className="w-3.5 h-3.5" />
            Settings
          </Button>
          {!props.liveArmed && (
            <Button
              size="sm"
              disabled={!props.canArm}
              onClick={props.onArm}
              className="flex-1 h-8 gap-1.5 bg-gradient-to-r from-primary to-accent hover:opacity-90"
            >
              <Zap className="w-3.5 h-3.5" />
              Arm
            </Button>
          )}
          {props.liveArmed && (
            <div className="flex-1 h-8 rounded-md border border-destructive/30 bg-destructive/10 flex items-center justify-center gap-1.5 text-xs font-semibold text-destructive">
              <span className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
              Live armed
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function ConfigRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground tabular-nums">{value}</span>
    </div>
  );
}

interface MiniMetricProps {
  label: string;
  value: string;
  tone: "increase" | "decrease" | "destructive" | "accent" | "primary";
  hint: string;
}

function MiniMetric({ label, value, tone, hint }: MiniMetricProps) {
  const toneClass: Record<MiniMetricProps["tone"], string> = {
    increase: "stat-increase",
    decrease: "stat-decrease",
    destructive: "text-destructive",
    accent: "text-accent",
    primary: "text-primary",
  };

  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/70 mb-1">
        {label}
      </p>
      <p
        className={cn(
          "text-lg font-bold tabular-nums leading-none",
          toneClass[tone]
        )}
      >
        {value}
      </p>
      <p className="text-[10px] text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}

// =========================================================================
// Onboarding gates
// =========================================================================

function PlatformStatusTile({
  platform,
  connected,
  detail,
  onConnect,
}: {
  platform: string;
  connected: boolean;
  detail: string;
  onConnect: () => void;
}) {
  return (
    <Card
      className={cn(
        "border",
        connected
          ? "border-emerald-400/30 bg-emerald-500/5"
          : "border-border/60 bg-card/50"
      )}
    >
      <CardContent className="flex items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">
            Bot venue
          </p>
          <h3 className="font-semibold flex items-center gap-2">
            {platform}
            <span
              className={cn(
                "text-[10px] rounded-full px-2 py-0.5",
                connected
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "bg-muted text-muted-foreground"
              )}
            >
              {connected ? "Connected" : "Not connected"}
            </span>
          </h3>
          <p className="text-xs text-muted-foreground truncate">{detail}</p>
        </div>
        <Button
          size="sm"
          variant={connected ? "outline" : "default"}
          onClick={onConnect}
        >
          {connected ? "Manage" : "Connect"}
        </Button>
      </CardContent>
    </Card>
  );
}

function ConnectionGate({ onConnect }: { onConnect: () => void }) {
  return (
    <div className="max-w-2xl mx-auto pt-8 space-y-6">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-accent shadow-lg">
          <Plug className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-2xl font-bold gradient-text">
          Welcome to Laurenzo
        </h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Let's get your trading desk live in three steps. Start by connecting
          your Kalshi account.
        </p>
      </div>

      {/* Step indicators */}
      <div className="grid grid-cols-3 gap-3">
        <OnboardingStep
          number={1}
          title="Connect"
          subtitle="API credentials"
          active
        />
        <OnboardingStep
          number={2}
          title="Fund"
          subtitle="Fund Kalshi"
        />
        <OnboardingStep number={3} title="Arm" subtitle="Configure & go live" />
      </div>

      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="p-6 space-y-4">
          <div>
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Plug className="w-4 h-4 text-primary" />
              Step 1 · Connect Kalshi
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              Generate a Kalshi RSA key pair and paste your API Key ID + private
              key. Credentials are validated live and stored AES-256-GCM
              encrypted.
            </p>
          </div>
          <Button
            onClick={onConnect}
            size="lg"
            className="w-full gap-2 bg-gradient-to-r from-primary to-accent hover:opacity-90"
          >
            Connect Kalshi
            <ArrowRight className="w-4 h-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function FundingGate({ equity }: { equity: number }) {
  return (
    <div className="max-w-2xl mx-auto pt-8 space-y-6">
      <div className="text-center space-y-3">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-warning to-amber-500 shadow-lg">
          <AlertCircle className="w-7 h-7 text-white" />
        </div>
        <h1 className="text-2xl font-bold">Fund your account</h1>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Connection successful. Deposit funds in Kalshi before arming live
          autonomy.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <OnboardingStep
          number={1}
          title="Connect"
          subtitle="API credentials"
          complete
        />
        <OnboardingStep
          number={2}
          title="Fund"
          subtitle="Fund Kalshi"
          active
        />
        <OnboardingStep number={3} title="Arm" subtitle="Configure & go live" />
      </div>

      <Card className="border-warning/30 bg-warning/5">
        <CardContent className="p-6 space-y-4">
          <div>
            <p className="text-xs uppercase tracking-widest text-muted-foreground">
              Current balance
            </p>
            <p className="text-3xl font-bold text-warning tabular-nums">
              ${equity.toFixed(2)}
            </p>
          </div>
          <p className="text-sm text-muted-foreground">
            Deposit only the amount that matches your risk tolerance and
            first-test plan. Funds remain in your exchange account at all times.
          </p>
          <Button
            onClick={() =>
              window.open("https://kalshi.com/account/deposit", "_blank")
            }
            size="lg"
            className="w-full gap-2 bg-gradient-to-r from-warning to-amber-500 hover:opacity-90"
          >
            Open Kalshi deposits
            <ArrowRight className="w-4 h-4" />
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function OnboardingStep({
  number,
  title,
  subtitle,
  active,
  complete,
}: {
  number: number;
  title: string;
  subtitle: string;
  active?: boolean;
  complete?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-3 flex items-start gap-3 transition-colors",
        complete && "border-success/40 bg-success/5",
        active && !complete && "border-primary/40 bg-primary/5",
        !active && !complete && "border-border/60 bg-card/40 opacity-60"
      )}
    >
      <div
        className={cn(
          "shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold",
          complete && "bg-success text-white",
          active && !complete && "bg-primary text-white",
          !active && !complete && "bg-muted text-muted-foreground"
        )}
      >
        {complete ? <CheckCircle2 className="w-4 h-4" /> : number}
      </div>
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground leading-tight">
          {title}
        </p>
        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
      </div>
    </div>
  );
}

function PolymarketStatusTileFromQuery({ onConnect }: { onConnect: () => void }) {
  const polyStatus = trpc.polymarket.getPolymarketAccountStatus.useQuery(undefined, {
    retry: false,
  });
  // Only treat as connected when the query genuinely succeeded — otherwise
  // a slow/failing status call shows a misleading "Not connected" tile.
  const connected = polyStatus.isSuccess && polyStatus.data?.connected === true;
  const liveReady =
    polyStatus.isSuccess && polyStatus.data?.liveTradingReady === true;
  const detail = polyStatus.isLoading
    ? "Checking Polymarket account…"
    : polyStatus.isError
      ? "Status unavailable — retry shortly"
      : connected
        ? liveReady
          ? "Live-trading ready (wallet on file)"
          : "Read-only · add wallet key for live trades"
        : "Optional · enables cross-arb + Polymarket trading";
  return (
    <PlatformStatusTile
      platform="Polymarket"
      connected={connected}
      detail={detail}
      onConnect={onConnect}
    />
  );
}
