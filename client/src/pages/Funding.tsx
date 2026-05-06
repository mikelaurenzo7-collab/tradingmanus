import { AlertCircle, CheckCircle2, ArrowRight, DollarSign, Zap, Wallet, Loader2, TrendingUp, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/widgets/StatCard";
import { EmptyState } from "@/components/EmptyStates";

export default function Funding() {
  const { data: accountStatus, isLoading } = trpc.kalshi.getKalshiAccountStatus.useQuery();
  const { data: capital } = trpc.kalshi.getCapital.useQuery();
  const { data: positions } = trpc.kalshi.getPositions.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin w-12 h-12 text-violet-400" />
      </div>
    );
  }

  const equity = accountStatus?.equity || 0;
  const isFunded = equity > 0;
  const currentBalance = capital?.currentBalance || equity;
  const totalPnl = capital?.totalPnl || 0;
  
  // Calculate buying power: equity minus locked capital in positions
  const lockedCapital = positions?.reduce((sum: number, pos: any) => {
    const positionValue = Math.abs(pos.quantity * (pos.entryPrice || 0));
    return sum + positionValue;
  }, 0) || 0;
  const buyingPower = Math.max(0, equity - lockedCapital);
  
  // Calculate capital utilization percentage
  const utilizationPercent = equity > 0 ? Math.min(100, (lockedCapital / equity) * 100) : 0;

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <PageHeader
        icon={Wallet}
        title="Account Funding"
        description="Balance and capital management for live trading"
        iconGradient={isFunded ? "from-emerald-500 to-teal-500" : "from-amber-500 to-rose-500"}
        badge={
          <Badge
            variant="outline"
            className={`gap-1.5 px-2.5 py-1 ${isFunded ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300" : "border-amber-400/40 bg-amber-500/10 text-amber-300"}`}
          >
            {isFunded ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
            {isFunded ? "Ready to trade" : "No funds"}
          </Badge>
        }
      />

      {/* Hero Stat Cards */}
      {isFunded && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="animate-fade-in" style={{ animationDelay: '0ms' }}>
            <StatCard
              label="Total Balance"
              value={`$${currentBalance.toFixed(2)}`}
              icon={<Wallet className="w-5 h-5" />}
              color="#10b981"
              className="glass-card"
            />
          </div>
          <div className="animate-fade-in" style={{ animationDelay: '100ms' }}>
            <StatCard
              label="Available to Trade"
              value={`$${buyingPower.toFixed(2)}`}
              icon={<Zap className="w-5 h-5" />}
              color="#f59e0b"
              className="glass-card"
            />
          </div>
          <div className="animate-fade-in" style={{ animationDelay: '200ms' }}>
            <StatCard
              label="Reserved"
              value={`$${lockedCapital.toFixed(2)}`}
              icon={<BarChart3 className="w-5 h-5" />}
              color="#8864ff"
              className="glass-card"
            />
          </div>
          <div className="animate-fade-in" style={{ animationDelay: '300ms' }}>
            <StatCard
              label="Total P&L"
              value={`${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`}
              change={totalPnl}
              icon={<TrendingUp className="w-5 h-5" />}
              color={totalPnl >= 0 ? "#10b981" : "#ef4444"}
              className="glass-card"
            />
          </div>
        </div>
      )}

      {/* Capital Utilization */}
      {isFunded && (
        <div className="animate-fade-in glass-card p-6" style={{ animationDelay: '400ms' }}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-muted-foreground">Capital Utilization</h3>
            <span className="font-mono tabular-nums text-sm font-bold">{utilizationPercent.toFixed(1)}%</span>
          </div>
          <Progress value={utilizationPercent} className="h-2" />
          <div className="flex justify-between mt-2 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">Reserved: ${lockedCapital.toFixed(2)}</span>
            <span className="font-mono tabular-nums">Total: ${equity.toFixed(2)}</span>
          </div>
        </div>
      )}

      {/* Current Status */}
      {!isFunded && (
        <div className="animate-fade-in">
          <Card className="glass-card border-amber-400/30 bg-gradient-to-br from-amber-500/[0.07] to-rose-500/[0.04]">
            <CardContent className="pt-6">
              <EmptyState
                icon={AlertCircle}
                title="No Funds Available"
                message="Your Kalshi account needs funds before you can start trading. Deposit to get started."
                action={
                  <Button
                    onClick={() => window.open("https://kalshi.com/account/deposit", "_blank")}
                    className="mt-4 gap-2 bg-gradient-to-br from-amber-500 to-rose-500 hover:from-amber-600 hover:to-rose-600 shadow-md hover:shadow-lg transition-all glow-primary"
                    size="lg"
                  >
                    <DollarSign className="w-5 h-5" />
                    Deposit Funds
                    <ArrowRight className="w-4 h-4" />
                  </Button>
                }
              />
            </CardContent>
          </Card>
        </div>
      )}

      {isFunded && (
        <div className="animate-fade-in" style={{ animationDelay: '500ms' }}>
          <Card className="glass-card border-emerald-400/30 bg-gradient-to-br from-emerald-500/[0.07] to-teal-500/[0.04] glow-success">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-md">
                  <Zap className="w-4 h-4 text-white" />
                </div>
                <CardTitle className="text-lg"><span className="gradient-text">Ready to Start Trading</span></CardTitle>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Your account is funded and ready. Here's what to do next:
              </p>
              <ol className="space-y-2.5 text-sm">
                {[
                  <>Review your trading instructions in the <strong className="text-white">Training</strong> tab</>,
                  <>Understand the risk controls and capital limits</>,
                  <>Go to <strong className="text-white">Signals</strong> to generate trading recommendations</>,
                  <>Click <strong className="text-white">Start Trading</strong> to begin executing signals</>,
                ].map((line, i) => (
                  <li key={i} className="flex gap-3 items-start">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 font-bold text-xs shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-slate-300">{line}</span>
                  </li>
                ))}
              </ol>
              <Link href="/signals">
                <Button className="w-full mt-2 gap-2 bg-gradient-to-br from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 shadow-md hover:shadow-lg transition-all glow-primary" size="lg">
                  <Zap className="w-5 h-5" />
                  Go to Signals
                </Button>
              </Link>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Deposit Instructions */}
      {!isFunded && (
        <div className="space-y-6 animate-fade-in" style={{ animationDelay: '100ms' }}>
          <Card className="glass-card">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 shadow-md">
                  <DollarSign className="w-4 h-4 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg">How to Deposit Funds</CardTitle>
                  <CardDescription>Add funds to your Kalshi account in 3 easy steps</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-5">
              <Step
                n={1}
                title="Visit Kalshi Account"
                body={
                  <>
                    Go to{" "}
                    <a
                      href="https://kalshi.com/account/deposit"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-violet-300 hover:text-violet-200 underline underline-offset-4"
                    >
                      kalshi.com/account/deposit
                    </a>
                  </>
                }
                action={
                  <Button
                    onClick={() => window.open("https://kalshi.com/account/deposit", "_blank")}
                    className="laurenzo-button gap-2 mt-3"
                  >
                    Open Kalshi Deposit <ArrowRight className="w-4 h-4" />
                  </Button>
                }
              />
              <Step
                n={2}
                title="Choose Payment Method"
                body="Select your preferred payment method (bank transfer, card, etc.)"
              />
              <Step
                n={3}
                title="Complete Deposit"
                body="Your balance will update automatically. We'll sync within 1 minute."
              />
            </CardContent>
          </Card>

          {/* Recommended Amounts */}
          <Card className="glass-card">
            <CardHeader>
              <CardTitle className="text-lg">Recommended Starting Amounts</CardTitle>
              <CardDescription>Choose based on your risk tolerance and trading experience</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { amount: "$1–$5", label: "Minimal", desc: "Test the workflow with very small size", gradient: "from-blue-500/20 to-cyan-500/20", border: "border-blue-400/30" },
                { amount: "$10–$50", label: "Conservative", desc: "Add room for measured live testing", gradient: "from-violet-500/20 to-indigo-500/20", border: "border-violet-400/30" },
                { amount: "$50+", label: "Flexible", desc: "Support broader sizing and multiple positions", gradient: "from-emerald-500/20 to-teal-500/20", border: "border-emerald-400/30" },
              ].map((tier) => (
                <div
                  key={tier.label}
                  className={`laurenzo-card p-5 ${tier.border} bg-gradient-to-br ${tier.gradient} hover:scale-[1.02] transition-transform duration-200`}
                >
                  <p className="text-2xl font-bold gradient-text mb-1 font-mono tabular-nums">{tier.amount}</p>
                  <p className="font-semibold text-sm mb-1.5 text-white/90">{tier.label}</p>
                  <p className="text-xs text-muted-foreground leading-relaxed">{tier.desc}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Alert className="border-violet-400/30 bg-violet-500/10">
            <AlertCircle className="h-4 w-4 text-violet-400" />
            <AlertDescription className="text-violet-200 text-sm leading-relaxed">
              <strong className="text-white">Kalshi risk controls:</strong> Risk limits are enforced against your live connected Kalshi balance, including per-trade and daily loss caps. Your dashboard will only size trades from confirmed account equity.
            </AlertDescription>
          </Alert>
        </div>
      )}

      {/* Withdrawal Options */}
      {isFunded && (
        <div className="animate-fade-in" style={{ animationDelay: '600ms' }}>
          <Card className="glass-card">
            <CardHeader>
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-violet-500 to-indigo-500 shadow-md">
                  <Wallet className="w-4 h-4 text-white" />
                </div>
                <div>
                  <CardTitle className="text-lg"><span className="gradient-text">Manage Your Funds</span></CardTitle>
                  <CardDescription>Deposit more or withdraw available balance</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <Button
                  onClick={() => window.open("https://kalshi.com/account/deposit", "_blank")}
                  variant="outline"
                  className="flex-1 gap-2 border-emerald-400/30 hover:bg-emerald-500/10"
                >
                  <DollarSign className="w-4 h-4" />
                  Deposit More Funds
                </Button>
                <Button
                  onClick={() => window.open("https://kalshi.com/account/withdraw", "_blank")}
                  variant="outline"
                  className="flex-1 gap-2 border-violet-400/30 hover:bg-violet-500/10"
                >
                  <ArrowRight className="w-4 h-4" />
                  Withdraw Funds
                </Button>
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Changes reflect automatically after processing on Kalshi
              </p>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function Step({ n, title, body, action }: { n: number; title: string; body: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex gap-4">
      <div className="flex-shrink-0">
        <div className="flex items-center justify-center h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500/20 to-indigo-500/20 border border-violet-400/30 text-violet-300 font-bold text-sm">
          {n}
        </div>
      </div>
      <div className="flex-1 pt-1">
        <h3 className="font-semibold mb-1 text-white/90">{title}</h3>
        <div className="text-sm text-muted-foreground leading-relaxed">{body}</div>
        {action}
      </div>
    </div>
  );
}
