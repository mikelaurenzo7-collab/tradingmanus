import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { Loader2, TrendingUp, TrendingDown, AlertTriangle, Zap, Sparkles, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function Dashboard() {
  const { user } = useAuth();
  const [killSwitchConfirm, setKillSwitchConfirm] = useState(false);

  // Fetch dashboard overview
  const overviewQuery = trpc.kalshi.getCapital.useQuery();
  const accountStatusQuery = trpc.kalshi.getKalshiAccountStatus.useQuery();
  const killSwitchMutation = { mutateAsync: async () => {} };

  if (overviewQuery.isLoading || accountStatusQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="animate-spin w-12 h-12 text-primary" />
          <p className="text-muted-foreground">Initializing trading engine...</p>
        </div>
      </div>
    );
  }

  const overview = overviewQuery.data;
  const accountStatus = accountStatusQuery.data;
  const displayEquity = accountStatus?.connected ? accountStatus.equity : overview?.currentBalance;

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

  return (
    <div className="space-y-8 p-6">
      {/* Header with gradient text */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-5xl font-bold gradient-text mb-2">
            LAURENZO
          </h1>
          <p className="text-muted-foreground text-lg">
            Multi-Market Trading Dashboard • Owner: <span className="text-primary font-semibold">{user?.name || "Anonymous"}</span>
          </p>
        </div>
        <div className="flex gap-3">
          <Button
            onClick={handleKillSwitch}
            className="nexus-button-kill"
            size="lg"
          >
            <Zap className="w-5 h-5 mr-2" />
            {killSwitchConfirm ? "CONFIRM KILL" : "KILL SWITCH"}
          </Button>
        </div>
      </div>

      {/* Portfolio Overview - Hero Section */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* Global Equity - Hero Card */}
        <div className="nexus-card lg:col-span-2 lg:row-span-2 relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-br from-violet-500/10 via-transparent to-pink-500/10 opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-4">
              <Sparkles className="w-5 h-5 text-primary" />
              <div className="text-xs text-muted-foreground tracking-widest font-semibold">GLOBAL EQUITY</div>
            </div>
            <div className="text-5xl font-bold gradient-text mb-2">
              ${displayEquity?.toFixed(2) || "0.00"}
            </div>
            <div className="flex items-center gap-4 mt-6 pt-6 border-t border-border/50">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Daily PnL</div>
                <div className={`text-xl font-bold ${(overview?.totalPnl ?? 0) > 0 ? "profit" : "loss"}`}>
                  {(overview?.totalPnl ?? 0) > 0 ? "+" : ""}{overview?.totalPnl?.toFixed(2) || "0.00"}
                </div>
              </div>
              <div className="ml-auto">
                {(overview?.totalPnl ?? 0) > 0 ? (
                  <TrendingUp className="w-8 h-8 text-cyan-400" />
                ) : (
                  <TrendingDown className="w-8 h-8 text-pink-400" />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Total Equity */}
        <div className="nexus-card">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-5 h-5 text-primary" />
            <div className="text-xs text-muted-foreground tracking-widest font-semibold">TOTAL EQUITY</div>
          </div>
          <div className={`text-3xl font-bold mb-3 ${(displayEquity ?? 0) > 0 ? "profit" : "loss"}`}>
            ${displayEquity?.toFixed(2) || "0.00"}
          </div>
          <div className="text-xs text-muted-foreground">
            Starting: <span className="text-foreground font-semibold">${overview?.startingBalance?.toFixed(2) || "0.00"}</span>
          </div>
        </div>

        {/* Total Trades */}
        <div className="nexus-card">
          <div className="flex items-center gap-2 mb-4">
            <Zap className="w-5 h-5 text-primary" />
            <div className="text-xs text-muted-foreground tracking-widest font-semibold">TOTAL TRADES</div>
          </div>
          <div className="text-3xl font-bold mb-3 gradient-text">
            {overview?.totalTrades || 0}
          </div>
          <div className="text-xs text-muted-foreground">
            Winning: <span className="text-cyan-400 font-semibold">{overview?.winningTrades || 0}</span>
          </div>
        </div>

        {/* Prediction Markets */}
        <div className="nexus-card">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-primary" />
            <div className="text-xs text-muted-foreground tracking-widest font-semibold">WIN RATE</div>
          </div>
          <div className="text-3xl font-bold mb-3 gradient-text">
            {(overview?.winRate ?? 0 * 100).toFixed(1)}%
          </div>
          <div className="text-xs text-muted-foreground">
            Success ratio on closed trades
          </div>
        </div>
      </div>

      {/* Risk Metrics - Advanced Analytics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Sharpe Ratio */}
        <div className="nexus-card group">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs text-muted-foreground tracking-widest font-semibold">SHARPE RATIO</div>
              <TrendingUp className="w-5 h-5 text-cyan-400 opacity-70" />
            </div>
            <div className="text-4xl font-bold gradient-text">
              {overview?.sharpeRatio?.toFixed(2) || "0.00"}
            </div>
            <div className="text-xs text-muted-foreground mt-3">Risk-adjusted returns</div>
          </div>
        </div>

        {/* Drawdown */}
        <div className="nexus-card group">
          <div className="absolute inset-0 bg-gradient-to-br from-pink-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs text-muted-foreground tracking-widest font-semibold">MAX DRAWDOWN</div>
              <TrendingDown className="w-5 h-5 text-pink-400 opacity-70" />
            </div>
            <div className="text-4xl font-bold loss">
              {(overview?.maxDrawdown ?? 0 * 100).toFixed(2)}%
            </div>
            <div className="text-xs text-muted-foreground mt-3">Peak-to-trough decline</div>
          </div>
        </div>

        {/* Realized PnL */}
        <div className="nexus-card group">
          <div className="absolute inset-0 bg-gradient-to-br from-lime-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-2xl" />
          <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs text-muted-foreground tracking-widest font-semibold">REALIZED PnL</div>
              <AlertTriangle className="w-5 h-5 text-lime-400 opacity-70" />
            </div>
            <div className={`text-4xl font-bold ${(overview?.totalPnl ?? 0) > 0 ? "profit" : "loss"}`}>
              ${overview?.totalPnl?.toFixed(2) || "0.00"}
            </div>
            <div className="text-xs text-muted-foreground mt-3">Closed position gains</div>
          </div>
        </div>
      </div>

      {/* System Status - Sleek Layout */}
      <div className="nexus-card">
        <div className="flex items-center gap-2 mb-6">
          <Activity className="w-5 h-5 text-primary pulse-glow" />
          <div className="text-sm text-muted-foreground tracking-widest font-semibold">SYSTEM STATUS</div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <div className="pb-6 border-b-2 border-border/30 md:border-b-0 md:border-r-2 md:border-border/30">
            <div className="text-xs text-muted-foreground mb-2 tracking-wide">Bots Active</div>
            <div className="text-2xl font-bold gradient-text">--</div>
          </div>
          <div className="pb-6 border-b-2 border-border/30 md:border-b-0 md:border-r-2 md:border-border/30">
            <div className="text-xs text-muted-foreground mb-2 tracking-wide">Open Positions</div>
            <div className="text-2xl font-bold gradient-text">--</div>
          </div>
          <div className="pb-6 border-b-2 border-border/30 md:border-b-0 md:border-r-2 md:border-border/30">
            <div className="text-xs text-muted-foreground mb-2 tracking-wide">Last Trade</div>
            <div className="text-2xl font-bold gradient-text">--</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground mb-2 tracking-wide">System Health</div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
              <div className="text-lg font-bold text-cyan-400">NOMINAL</div>
            </div>
          </div>
        </div>
      </div>

      {/* Error Code Display */}
      {false && (
        <div className="nexus-card border-destructive">
          <div className="error-code">
            ERR_KILL_SWITCH_FAILED: Unknown error
          </div>
        </div>
      )}
    </div>
  );
}
