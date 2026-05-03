import { AlertCircle, CheckCircle2, ArrowRight, DollarSign, Zap, Wallet, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { trpc } from "@/lib/trpc";
import { Link } from "wouter";
import { PageHeader } from "@/components/PageHeader";

export default function Funding() {
  const { data: accountStatus, isLoading } = trpc.kalshi.getKalshiAccountStatus.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin w-12 h-12 text-violet-400" />
      </div>
    );
  }

  const equity = accountStatus?.equity || 0;
  const isFunded = equity > 0;

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      <PageHeader
        icon={Wallet}
        title="Account Funding"
        description={
          isFunded
            ? "Your account is funded and ready to trade"
            : "Fund your Kalshi account to start trading"
        }
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

      {/* Current Status */}
      <Card
        className={`laurenzo-card overflow-hidden border-2 ${isFunded ? "border-emerald-400/30 bg-gradient-to-br from-emerald-500/[0.07] to-teal-500/[0.04]" : "border-rose-400/30 bg-gradient-to-br from-rose-500/[0.07] to-pink-500/[0.04]"}`}
      >
        <CardContent className="pt-6">
          <div className="flex items-center justify-between flex-wrap gap-6">
            <div className="flex items-center gap-5">
              <div className={`flex items-center justify-center w-16 h-16 rounded-2xl shadow-lg ${isFunded ? "bg-gradient-to-br from-emerald-500 to-teal-500 shadow-emerald-500/30" : "bg-gradient-to-br from-rose-500 to-pink-500 shadow-rose-500/30"}`}>
                {isFunded ? (
                  <CheckCircle2 className="w-8 h-8 text-white" />
                ) : (
                  <AlertCircle className="w-8 h-8 text-white" />
                )}
              </div>
              <div>
                <p className="text-sm text-muted-foreground mb-1 uppercase tracking-wider font-semibold">Current Balance</p>
                <p className={`text-4xl font-bold tabular-nums ${isFunded ? "text-emerald-400" : "text-rose-400"}`}>
                  ${equity.toFixed(2)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground mb-2 uppercase tracking-wider font-semibold">Status</p>
              <p className={`text-lg font-bold ${isFunded ? "text-emerald-400" : "text-rose-400"}`}>
                {isFunded ? "Ready to Trade" : "Funding Required"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {!isFunded && (
        <>
          {/* Deposit Instructions */}
          <Card className="laurenzo-card">
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
          <Card className="laurenzo-card">
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
                  className={`p-5 rounded-xl border ${tier.border} bg-gradient-to-br ${tier.gradient} hover:scale-[1.02] transition-transform duration-200`}
                >
                  <p className="text-2xl font-bold gradient-text mb-1 tabular-nums">{tier.amount}</p>
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
        </>
      )}

      {isFunded && (
        <Card className="laurenzo-card border-emerald-400/30 bg-gradient-to-br from-emerald-500/[0.07] to-teal-500/[0.04]">
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-md">
                <Zap className="w-4 h-4 text-white" />
              </div>
              <CardTitle className="text-lg">Ready to Start Trading</CardTitle>
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
              <Button className="w-full mt-2 gap-2 bg-gradient-to-br from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 shadow-md hover:shadow-lg transition-all" size="lg">
                <Zap className="w-5 h-5" />
                Go to Signals
              </Button>
            </Link>
          </CardContent>
        </Card>
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
