import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";

interface StartTradingDialogProps {
  equity: number;
  hasInstructions: boolean;
  onConfirm: () => void;
  isLoading?: boolean;
}

export function StartTradingDialog({
  equity,
  hasInstructions,
  onConfirm,
  isLoading = false,
}: StartTradingDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [step, setStep] = useState<"checklist" | "risks" | "confirm">("checklist");

  const canProceed = acknowledged && equity > 0;

  const handleNext = () => {
    if (step === "checklist") {
      setStep("risks");
    } else if (step === "risks") {
      setStep("confirm");
    }
  };

  const handleConfirm = () => {
    if (canProceed) {
      onConfirm();
    }
  };

  return (
    <div className="space-y-6">
      {step === "checklist" && (
        <Card className="laurenzo-card">
          <CardHeader>
            <CardTitle>Pre-Trade Checklist</CardTitle>
            <CardDescription>
              Make sure you're ready before starting to trade
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Account Funded */}
            <div className="flex items-start gap-3 p-3 rounded-lg border border-border/50">
              <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${equity > 0 ? "bg-cyan-500/20 text-cyan-400" : "bg-pink-500/20 text-pink-400"}`}>
                {equity > 0 ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm">Account Funded</p>
                <p className="text-xs text-muted-foreground">
                  {equity > 0 ? `✓ $${equity.toFixed(2)} available` : "✗ No funds in account"}
                </p>
              </div>
            </div>

            {/* Training Instructions */}
            <div className="flex items-start gap-3 p-3 rounded-lg border border-border/50">
              <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${hasInstructions ? "bg-cyan-500/20 text-cyan-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                {hasInstructions ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm">Training Instructions</p>
                <p className="text-xs text-muted-foreground">
                  {hasInstructions ? "✓ Instructions defined" : "⚠ No instructions (optional)"}
                </p>
              </div>
            </div>

            {/* Risk Limits Understood */}
            <div className="flex items-start gap-3 p-3 rounded-lg border border-border/50">
              <div className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center bg-yellow-500/20 text-yellow-400">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-sm">Risk Limits</p>
                <p className="text-xs text-muted-foreground">
                  Max $5 loss per trade, $10 per day, $20 per position
                </p>
              </div>
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Trading involves risk. Your capital is protected by automatic risk controls, but losses are possible.
              </AlertDescription>
            </Alert>

            <Button onClick={handleNext} disabled={!canProceed} className="w-full laurenzo-button">
              Continue to Risk Acknowledgment
            </Button>
          </CardContent>
        </Card>
      )}

      {step === "risks" && (
        <Card className="laurenzo-card border-pink-500/30 bg-pink-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-pink-400" />
              Risk Acknowledgment
            </CardTitle>
            <CardDescription>
              Please read and acknowledge the risks
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3 text-sm">
              <p>
                <strong>Trading Risk:</strong> Past performance does not guarantee future results. You may lose some or all of your invested capital.
              </p>
              <p>
                <strong>Market Risk:</strong> Prediction markets can be volatile. Prices may move against your positions quickly.
              </p>
              <p>
                <strong>Liquidity Risk:</strong> Some markets may have low liquidity, making it difficult to exit positions.
              </p>
              <p>
                <strong>Technical Risk:</strong> System failures, API errors, or network issues could impact trading.
              </p>
              <p>
                <strong>Agent Risk:</strong> The trading agent makes decisions based on signals. These signals may be wrong.
              </p>
            </div>

            <div className="flex items-start gap-3 p-4 rounded-lg bg-background/50 border border-border/50">
              <input
                type="checkbox"
                id="acknowledge"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-1"
              />
              <label htmlFor="acknowledge" className="text-sm cursor-pointer">
                I understand the risks and acknowledge that I may lose money. I have read and agree to the terms.
              </label>
            </div>

            <div className="flex gap-3">
              <Button onClick={() => setStep("checklist")} variant="outline" className="flex-1">
                Back
              </Button>
              <Button onClick={handleNext} disabled={!acknowledged} className="flex-1 laurenzo-button">
                Continue to Confirmation
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === "confirm" && (
        <Card className="laurenzo-card border-cyan-500/30 bg-cyan-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-cyan-400" />
              Ready to Start Trading
            </CardTitle>
            <CardDescription>
              Your account is configured and ready
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Account Balance:</span>
                <span className="font-semibold text-cyan-400">${equity.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Max Loss/Trade:</span>
                <span className="font-semibold">$5</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Max Loss/Day:</span>
                <span className="font-semibold">$10</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Max Position Size:</span>
                <span className="font-semibold">$20</span>
              </div>
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Once you start trading, the agent will automatically execute signals based on your instructions and market conditions.
              </AlertDescription>
            </Alert>

            <div className="flex gap-3">
              <Button onClick={() => setStep("risks")} variant="outline" className="flex-1">
                Back
              </Button>
              <Button
                onClick={handleConfirm}
                disabled={isLoading || !canProceed}
                className="flex-1 laurenzo-button"
                size="lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Starting...
                  </>
                ) : (
                  "Start Trading Now"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
