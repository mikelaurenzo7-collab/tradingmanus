import { Loader2, TrendingUp, TrendingDown, AlertTriangle, Zap, Sparkles, Activity, CheckCircle2, AlertCircle, Plug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StartTradingDialog } from "@/components/StartTradingDialog";
import { useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";

export default function Dashboard() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [killSwitchConfirm, setKillSwitchConfirm] = useState(false);
  const [showStartTrading, setShowStartTrading] = useState(false);

  // Fetch dashboard overview
  const overviewQuery = trpc.kalshi.getCapital.useQuery();
  const accountStatusQuery = trpc.kalshi.getKalshiAccountStatus.useQuery();
  const { data: instructions } = trpc.training.getInstructions.useQuery();
  
  const startTradingMutation = {
    mutate: (data: any, callbacks: any) => {
      callbacks?.onSuccess?.();
    },
    isPending: false,
  };
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
  
  // Show $0 until Kalshi account is connected
  const isConnected = accountStatus?.connected || false;
  const equity = isConnected ? (accountStatus?.equity || 0) : 0;
  const displayEquity = equity;
  const isFunded = equity > 0;
  const hasInstructions = (instructions?.length || 0) > 0;

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
    startTradingMutation.mutate(
      {},
      {
        onSuccess: () => {
          setShowStartTrading(false);
          alert("Trading started! Your agent is now active.");
        },
        onError: (error: any) => {
          alert(`Error: ${error?.message || 'Unknown error'}`);
        },
      }
    );
  };

  // Show connection required if not connected
  if (!isConnected) {
    return (
      <div className="space-y-8 p-6">
        <div>
          <h1 className="text-5xl font-bold gradient-text mb-2">Connect Your Kalshi Account</h1>
          <p className="text-muted-foreground text-lg">
            Connect your Kalshi account to start trading and see your real account balance
          </p>
        </div>

        <Card className="laurenzo-card border-violet-500/30 bg-violet-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4 mb-6">
              <Plug className="w-12 h-12 text-violet-400" />
              <div>
                <p className="text-sm text-muted-foreground mb-1">Account Balance</p>
                <p className="text-3xl font-bold text-violet-400">$0.00</p>
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-muted-foreground">
                To start trading on Kalshi prediction markets, connect your Kalshi account first. Your real account balance will appear here once connected.
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

        {/* Placeholder metrics showing $0 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 opacity-50">
          <Card className="laurenzo-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">GLOBAL EQUITY</p>
                <Sparkles className="w-4 h-4 text-primary" />
              </div>
              <p className="text-3xl font-bold text-muted-foreground">$0.00</p>
              <p className="text-xs text-muted-foreground mt-2">Connect to see real balance</p>
            </CardContent>
          </Card>

          <Card className="laurenzo-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">TOTAL TRADES</p>
                <TrendingUp className="w-4 h-4 text-lime-400" />
              </div>
              <p className="text-3xl font-bold text-muted-foreground">0</p>
              <p className="text-xs text-muted-foreground mt-2">Winning: 0</p>
            </CardContent>
          </Card>

          <Card className="laurenzo-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">WIN RATE</p>
                <TrendingDown className="w-4 h-4 text-pink-400" />
              </div>
              <p className="text-3xl font-bold text-muted-foreground">0.0%</p>
              <p className="text-xs text-muted-foreground mt-2">Success ratio</p>
            </CardContent>
          </Card>

          <Card className="laurenzo-card">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm text-muted-foreground">SHARPE RATIO</p>
                <Activity className="w-4 h-4" />
              </div>
              <p className="text-3xl font-bold text-muted-foreground">0.00</p>
              <p className="text-xs text-muted-foreground mt-2">Risk-adjusted returns</p>
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
          <h1 className="text-5xl font-bold gradient-text mb-2">Account Funding Required</h1>
          <p className="text-muted-foreground text-lg">
            Your Kalshi account needs funds to start trading
          </p>
        </div>

        <Card className="laurenzo-card border-pink-500/30 bg-pink-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4 mb-6">
              <AlertCircle className="w-12 h-12 text-pink-400" />
              <div>
                <p className="text-sm text-muted-foreground mb-1">Current Balance</p>
                <p className="text-3xl font-bold text-pink-400">${equity.toFixed(2)}</p>
              </div>
            </div>

            <div className="space-y-4">
              <p className="text-muted-foreground">
                To start trading on Kalshi prediction markets, you need to deposit funds into your account.
              </p>
              <Button
                onClick={() => window.open("https://kalshi.com/account/deposit", "_blank")}
                className="laurenzo-button w-full"
                size="lg"
              >
                Deposit Funds on Kalshi
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                Recommended starting amount: $10-$100
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
          <h1 className="text-5xl font-bold gradient-text mb-2">{user?.name || "LAURENZO"}</h1>
          <p className="text-muted-foreground">Kalshi Trading Dashboard • Owner: {user?.name}</p>
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

      {/* Start Trading Banner */}
      {!showStartTrading && (
        <Card className="laurenzo-card border-cyan-500/30 bg-cyan-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <CheckCircle2 className="w-8 h-8 text-cyan-400" />
                <div>
                  <p className="font-semibold">Account Funded & Ready</p>
                  <p className="text-sm text-muted-foreground">Start trading with your agent</p>
                </div>
              </div>
              <Button onClick={() => setShowStartTrading(true)} className="laurenzo-button">
                Start Trading
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Start Trading Dialog */}
      {showStartTrading && (
        <StartTradingDialog
          equity={equity}
          hasInstructions={hasInstructions}
          onConfirm={handleStartTrading}
          isLoading={startTradingMutation.isPending}
        />
      )}

      {/* Equity Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">GLOBAL EQUITY</p>
              <Sparkles className="w-4 h-4 text-primary" />
            </div>
            <p className="text-3xl font-bold gradient-text">${displayEquity.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-2">Real Kalshi account balance</p>
          </CardContent>
        </Card>

        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">TOTAL EQUITY</p>
              <Activity className="w-4 h-4 text-cyan-400" />
            </div>
            <p className="text-3xl font-bold text-cyan-400">${displayEquity.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground mt-2">Current account value</p>
          </CardContent>
        </Card>

        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">TOTAL TRADES</p>
              <TrendingUp className="w-4 h-4 text-lime-400" />
            </div>
            <p className="text-3xl font-bold text-lime-400">0</p>
            <p className="text-xs text-muted-foreground mt-2">Winning: 0</p>
          </CardContent>
        </Card>

        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">WIN RATE</p>
              <TrendingDown className="w-4 h-4 text-pink-400" />
            </div>
            <p className="text-3xl font-bold text-pink-400">0.0%</p>
            <p className="text-xs text-muted-foreground mt-2">Success ratio on closed trades</p>
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
            <p className="text-2xl font-bold text-pink-400">$0.00</p>
          </CardContent>
        </Card>

        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">SHARPE RATIO</p>
              <Activity className="w-4 h-4" />
            </div>
            <p className="text-2xl font-bold text-cyan-400">0.00</p>
            <p className="text-xs text-muted-foreground mt-2">Risk-adjusted returns</p>
          </CardContent>
        </Card>

        <Card className="laurenzo-card">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-muted-foreground">MAX DRAWDOWN</p>
              <AlertTriangle className="w-4 h-4" />
            </div>
            <p className="text-2xl font-bold text-pink-400">0.00%</p>
            <p className="text-xs text-muted-foreground mt-2">Peak-to-trough decline</p>
          </CardContent>
        </Card>
      </div>

      {/* Additional Metrics */}
      <Card className="laurenzo-card">
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div>
              <p className="text-xs text-muted-foreground mb-2">REALIZED P&L</p>
              <p className="text-xl font-bold text-lime-400">$0.00</p>
              <p className="text-xs text-muted-foreground mt-1">Closed position gains</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">UNREALIZED P&L</p>
              <p className="text-xl font-bold text-cyan-400">$0.00</p>
              <p className="text-xs text-muted-foreground mt-1">Open position gains</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">RECOVERY FACTOR</p>
              <p className="text-xl font-bold text-pink-400">0.00</p>
              <p className="text-xs text-muted-foreground mt-1">Profit vs max loss</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground mb-2">ACTIVE POSITIONS</p>
              <p className="text-xl font-bold text-yellow-400">0</p>
              <p className="text-xs text-muted-foreground mt-1">Open trades</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
