import { AlertCircle, CheckCircle2, ArrowRight, DollarSign, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";

export default function Funding() {
  const { data: accountStatus, isLoading } = trpc.kalshi.getKalshiAccountStatus.useQuery();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin w-12 h-12 text-primary" />
      </div>
    );
  }

  const equity = accountStatus?.equity || 0;
  const isFunded = equity > 0;

  return (
    <div className="space-y-8 p-6">
      {/* Header */}
      <div>
        <h1 className="text-5xl font-bold gradient-text mb-2">Account Funding</h1>
        <p className="text-muted-foreground text-lg">
          {isFunded ? "Your account is funded and ready to trade" : "Fund your account to start trading"}
        </p>
      </div>

      {/* Current Status */}
      <Card className={`laurenzo-card ${isFunded ? "border-cyan-500/30 bg-cyan-500/5" : "border-pink-500/30 bg-pink-500/5"}`}>
        <CardContent className="pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              {isFunded ? (
                <CheckCircle2 className="w-12 h-12 text-cyan-400" />
              ) : (
                <AlertCircle className="w-12 h-12 text-pink-400" />
              )}
              <div>
                <p className="text-sm text-muted-foreground mb-1">Current Balance</p>
                <p className={`text-4xl font-bold ${isFunded ? "text-cyan-400" : "text-pink-400"}`}>
                  ${equity.toFixed(2)}
                </p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-sm text-muted-foreground mb-2">Status</p>
              <p className={`text-lg font-bold ${isFunded ? "text-cyan-400" : "text-pink-400"}`}>
                {isFunded ? "Ready to Trade" : "No Funds"}
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
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="w-5 h-5" />
                How to Deposit Funds
              </CardTitle>
              <CardDescription>
                Add funds to your Kalshi account in 3 easy steps
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Step 1 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/20 text-primary font-bold">
                    1
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Visit Kalshi Account</h3>
                  <p className="text-sm text-muted-foreground mb-3">
                    Go to <a href="https://kalshi.com/account/deposit" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">kalshi.com/account/deposit</a>
                  </p>
                  <Button
                    onClick={() => window.open("https://kalshi.com/account/deposit", "_blank")}
                    className="laurenzo-button"
                  >
                    Open Kalshi Deposit <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </div>
              </div>

              {/* Step 2 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/20 text-primary font-bold">
                    2
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Choose Payment Method</h3>
                  <p className="text-sm text-muted-foreground">
                    Select your preferred payment method (bank transfer, card, etc.)
                  </p>
                </div>
              </div>

              {/* Step 3 */}
              <div className="flex gap-4">
                <div className="flex-shrink-0">
                  <div className="flex items-center justify-center h-10 w-10 rounded-lg bg-primary/20 text-primary font-bold">
                    3
                  </div>
                </div>
                <div>
                  <h3 className="font-semibold mb-1">Complete Deposit</h3>
                  <p className="text-sm text-muted-foreground">
                    Your balance will update automatically. We'll sync within 1 minute.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Recommended Amounts */}
          <Card className="laurenzo-card">
            <CardHeader>
              <CardTitle>Recommended Starting Amounts</CardTitle>
              <CardDescription>
                Choose based on your risk tolerance and trading experience
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { amount: "$1-$5", label: "Minimal", desc: "Test the workflow with very small size" },
                { amount: "$10-$50", label: "Conservative", desc: "Add room for measured live testing" },
                { amount: "$50+", label: "Flexible", desc: "Support broader sizing and multiple positions" },
              ].map((tier) => (
                <div key={tier.label} className="p-4 rounded-lg border border-border/50 hover:border-primary/50 transition-colors">
                  <p className="text-2xl font-bold gradient-text mb-1">{tier.amount}</p>
                  <p className="font-semibold text-sm mb-1">{tier.label}</p>
                  <p className="text-xs text-muted-foreground">{tier.desc}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Risk Info */}
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              <strong>LAURENZO OMEGA Risk Controls:</strong> Risk limits are enforced against your live connected Kalshi balance, including per-trade and daily loss caps. Your dashboard will only size trades from confirmed account equity.
            </AlertDescription>
          </Alert>
        </>
      )}

      {isFunded && (
        <>
          {/* Ready to Trade */}
          <Card className="laurenzo-card border-cyan-500/30 bg-cyan-500/5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-cyan-400" />
                Ready to Start Trading
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-muted-foreground">
                Your account is funded and ready. Here's what to do next:
              </p>
              <ol className="space-y-3 text-sm">
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">1.</span>
                  <span>Review your trading instructions in the <strong>Training</strong> tab</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">2.</span>
                  <span>Understand the risk controls and capital limits</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">3.</span>
                  <span>Go to <strong>Signals</strong> to generate trading recommendations</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-semibold text-primary">4.</span>
                  <span>Click <strong>Start Trading</strong> to begin executing signals</span>
                </li>
              </ol>
              <Button className="laurenzo-button w-full mt-6" size="lg">
                <Zap className="w-5 h-5 mr-2" />
                Go to Signals
              </Button>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
