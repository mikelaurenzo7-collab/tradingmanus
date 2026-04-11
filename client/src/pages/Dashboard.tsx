import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Loader2, TrendingUp, TrendingDown, AlertTriangle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function Dashboard() {
  const { user } = useAuth();
  const [killSwitchConfirm, setKillSwitchConfirm] = useState(false);

  // Fetch dashboard overview
  const overviewQuery = trpc.dashboard.overview.useQuery();
  const killSwitchMutation = trpc.killSwitch.activate.useMutation();

  if (overviewQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="animate-spin w-8 h-8 text-primary" />
      </div>
    );
  }

  const overview = overviewQuery.data;

  const handleKillSwitch = async () => {
    if (!killSwitchConfirm) {
      setKillSwitchConfirm(true);
      return;
    }

    try {
      await killSwitchMutation.mutateAsync({
        reason: "Manual kill switch activation by owner",
      });
      setKillSwitchConfirm(false);
    } catch (error) {
      console.error("Kill switch activation failed:", error);
    }
  };

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-wider">
            <span className="bracket">[</span>
            NEXUS OMEGA
            <span className="bracket">]</span>
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Multi-Market Trading Dashboard • Owner: {user?.name || "Anonymous"}
          </p>
        </div>
        <Button
          onClick={handleKillSwitch}
          className="nexus-button-kill"
          size="lg"
        >
          <Zap className="w-4 h-4 mr-2" />
          {killSwitchConfirm ? "CONFIRM KILL SWITCH" : "KILL SWITCH"}
        </Button>
      </div>

      {/* Portfolio Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Global Equity */}
        <div className="nexus-card">
          <div className="text-xs text-muted-foreground tracking-wider mb-2">
            <span className="bracket">[</span> GLOBAL EQUITY <span className="bracket">]</span>
          </div>
          <div className="text-2xl font-bold">
            ${overview?.global?.totalEquity?.toFixed(2) || "0.00"}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Daily PnL: <span className={overview?.global?.dailyPnl ?? 0 > 0 ? "profit" : "loss"}>
              {overview?.global?.dailyPnl?.toFixed(2) || "0.00"}
            </span>
          </div>
        </div>

        {/* Stocks */}
        <div className="nexus-card">
          <div className="text-xs text-muted-foreground tracking-wider mb-2">
            <span className="bracket">[</span> STOCKS <span className="bracket">]</span>
          </div>
          <div className="text-2xl font-bold">
            ${overview?.stocks?.totalEquity?.toFixed(2) || "0.00"}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Win Rate: {(overview?.stocks?.winRate ?? 0 * 100).toFixed(1)}%
          </div>
        </div>

        {/* Crypto */}
        <div className="nexus-card">
          <div className="text-xs text-muted-foreground tracking-wider mb-2">
            <span className="bracket">[</span> CRYPTO <span className="bracket">]</span>
          </div>
          <div className="text-2xl font-bold">
            ${overview?.crypto?.totalEquity?.toFixed(2) || "0.00"}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Win Rate: {(overview?.crypto?.winRate ?? 0 * 100).toFixed(1)}%
          </div>
        </div>

        {/* Prediction Markets */}
        <div className="nexus-card">
          <div className="text-xs text-muted-foreground tracking-wider mb-2">
            <span className="bracket">[</span> PREDICTION <span className="bracket">]</span>
          </div>
          <div className="text-2xl font-bold">
            ${overview?.prediction?.totalEquity?.toFixed(2) || "0.00"}
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            Win Rate: {(overview?.prediction?.winRate ?? 0 * 100).toFixed(1)}%
          </div>
        </div>
      </div>

      {/* Risk Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Sharpe Ratio */}
        <div className="nexus-card">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground tracking-wider mb-2">
                SHARPE RATIO
              </div>
              <div className="text-2xl font-bold">
                {overview?.global?.sharpeRatio?.toFixed(2) || "0.00"}
              </div>
            </div>
            <TrendingUp className="w-8 h-8 text-primary opacity-50" />
          </div>
        </div>

        {/* Drawdown */}
        <div className="nexus-card">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground tracking-wider mb-2">
                MAX DRAWDOWN
              </div>
              <div className="text-2xl font-bold loss">
                {(overview?.global?.drawdownPct ?? 0).toFixed(2)}%
              </div>
            </div>
            <TrendingDown className="w-8 h-8 text-destructive opacity-50" />
          </div>
        </div>

        {/* Realized PnL */}
        <div className="nexus-card">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-muted-foreground tracking-wider mb-2">
                REALIZED PnL
              </div>
              <div className={`text-2xl font-bold ${(overview?.global?.realizedPnl ?? 0) > 0 ? "profit" : "loss"}`}>
                ${overview?.global?.realizedPnl?.toFixed(2) || "0.00"}
              </div>
            </div>
            <AlertTriangle className="w-8 h-8 opacity-50" />
          </div>
        </div>
      </div>

      {/* System Status */}
      <div className="nexus-card">
        <div className="text-xs text-muted-foreground tracking-wider mb-4">
          <span className="bracket">[</span> SYSTEM STATUS <span className="bracket">]</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-xs text-muted-foreground">Bots Active</div>
            <div className="text-lg font-bold">--</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Open Positions</div>
            <div className="text-lg font-bold">--</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">Last Trade</div>
            <div className="text-lg font-bold">--</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">System Health</div>
            <div className="text-lg font-bold text-primary">NOMINAL</div>
          </div>
        </div>
      </div>

      {/* Error Code Display */}
      {killSwitchMutation.isError && (
        <div className="nexus-card border-destructive">
          <div className="error-code">
            ERR_KILL_SWITCH_FAILED: {killSwitchMutation.error?.message || "Unknown error"}
          </div>
        </div>
      )}
    </div>
  );
}
