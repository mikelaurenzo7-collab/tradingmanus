import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertTriangle, CheckCircle2, Loader2, Settings2 } from "lucide-react";
import {
  formatConfidence,
  getAutonomyModeDescription,
  getAutonomyModeLabel,
  getExecutionCadenceLabel,
  getRiskPostureLabel,
  type TradingPreferences,
} from "@/lib/tradingAutonomy";

interface StartTradingDialogProps {
  equity: number;
  hasInstructions: boolean;
  preferences: TradingPreferences;
  onConfirm: () => void;
  onManageSettings: () => void;
  onCancel: () => void;
  isLoading?: boolean;
}

export function StartTradingDialog({
  equity,
  hasInstructions,
  preferences,
  onConfirm,
  onManageSettings,
  onCancel,
  isLoading = false,
}: StartTradingDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);
  const [step, setStep] = useState<"checklist" | "risks" | "confirm">("checklist");

  const canContinueChecklist = equity > 0 && preferences.autonomyMode !== "manual";
  const canConfirm = acknowledged && canContinueChecklist;

  return (
    <div className="space-y-6">
      {step === "checklist" ? (
        <Card className="laurenzo-card">
          <CardHeader>
            <CardTitle>Prepare live trading</CardTitle>
            <CardDescription>
              Review connection, funding, and autonomy policy before live execution is armed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-xl border border-border/60 p-4">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full ${equity > 0 ? "bg-cyan-500/20 text-cyan-400" : "bg-pink-500/20 text-pink-400"}`}>
                  {equity > 0 ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                </div>
                <div>
                  <p className="text-sm font-semibold">Funded account</p>
                  <p className="text-xs text-muted-foreground">
                    {equity > 0 ? `Live Kalshi equity confirmed: $${equity.toFixed(2)}` : "Fund the connected Kalshi account before arming live trading."}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/60 p-4">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full ${preferences.autonomyMode !== "manual" ? "bg-cyan-500/20 text-cyan-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                  {preferences.autonomyMode !== "manual" ? <CheckCircle2 className="h-4 w-4" /> : <Settings2 className="h-4 w-4" />}
                </div>
                <div>
                  <p className="text-sm font-semibold">Autonomy policy</p>
                  <p className="text-xs text-muted-foreground">
                    {getAutonomyModeLabel(preferences.autonomyMode)} · {getRiskPostureLabel(preferences.riskPosture)} · {getExecutionCadenceLabel(preferences.executionCadence)}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {getAutonomyModeDescription(preferences.autonomyMode)}
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border/60 p-4">
              <div className="flex items-start gap-3">
                <div className={`mt-0.5 flex h-6 w-6 items-center justify-center rounded-full ${hasInstructions ? "bg-cyan-500/20 text-cyan-400" : "bg-yellow-500/20 text-yellow-400"}`}>
                  {hasInstructions ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
                </div>
                <div>
                  <p className="text-sm font-semibold">Training instructions</p>
                  <p className="text-xs text-muted-foreground">
                    {hasInstructions
                      ? "Instructions are available to shape signal selection and execution behavior."
                      : "No custom instructions are active. You can still trade, but the policy will rely on default signal logic."}
                  </p>
                </div>
              </div>
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Manual mode cannot arm live trading. If you want Laurenzo to submit live orders directly under your saved autonomy settings, switch to Approval Required, Semi-autonomous, or Fully Autonomous first.
              </AlertDescription>
            </Alert>

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={onManageSettings}>
                Adjust autonomy settings
              </Button>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                className="laurenzo-button ml-auto"
                disabled={!canContinueChecklist}
                onClick={() => setStep("risks")}
              >
                Continue to risk acknowledgment
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "risks" ? (
        <Card className="laurenzo-card border-pink-500/30 bg-pink-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-pink-400" />
              Risk acknowledgment
            </CardTitle>
            <CardDescription>
              Confirm that you understand the implications of arming live trading.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-3 text-sm text-muted-foreground">
              <p>
                <strong>Capital risk:</strong> Live trading can lose money, including all capital allocated to a strategy or session.
              </p>
              <p>
                <strong>Execution risk:</strong> Fast price changes, low liquidity, or API delays can lead to worse fills than expected.
              </p>
              <p>
                <strong>Model risk:</strong> Even high-confidence signals can be wrong, and autonomous behavior may amplify a bad decision if you configure it too aggressively.
              </p>
              <p>
                <strong>Operator responsibility:</strong> You decide the autonomy level, and you can disarm live trading at any time from the dashboard or autonomy controls.
              </p>
            </div>

            <div className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/50 p-4">
              <input
                id="live-trading-risk-ack"
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-1"
              />
              <label htmlFor="live-trading-risk-ack" className="text-sm text-foreground">
                I understand the risks of live trading and I explicitly approve arming the app under the selected autonomy policy.
              </label>
            </div>

            <div className="flex gap-3">
              <Button variant="outline" onClick={() => setStep("checklist")}>
                Back
              </Button>
              <Button
                className="laurenzo-button ml-auto"
                disabled={!acknowledged}
                onClick={() => setStep("confirm")}
              >
                Continue to confirmation
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {step === "confirm" ? (
        <Card className="laurenzo-card border-cyan-500/30 bg-cyan-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-cyan-400" />
              Final confirmation
            </CardTitle>
            <CardDescription>
              This final step shows exactly how autonomous the app is allowed to be once live trading is armed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-background/50 p-4 text-sm">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Mode</div>
                <div className="mt-2 font-semibold text-foreground">
                  {getAutonomyModeLabel(preferences.autonomyMode)}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {getAutonomyModeDescription(preferences.autonomyMode)}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/50 p-4 text-sm">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Thresholds</div>
                <div className="mt-2 space-y-1 text-muted-foreground">
                  <div>Minimum confidence: <strong className="text-foreground">{formatConfidence(preferences.minSignalConfidence)}</strong></div>
                  <div>Max order notional: <strong className="text-foreground">${preferences.maxOrderNotional.toFixed(2)}</strong></div>
                  <div>Approval above: <strong className="text-foreground">${preferences.requireApprovalAbove.toFixed(2)}</strong></div>
                  <div>Daily order cap: <strong className="text-foreground">{preferences.maxDailyOrders}</strong></div>
                </div>
              </div>
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Arming live trading does not change your stored risk controls. When direct autonomous trading is enabled for your account, Laurenzo still follows your saved autonomy mode, approval threshold, daily caps, and the rest of your guardrails before any live order can be submitted.
              </AlertDescription>
            </Alert>

            <div className="flex flex-wrap gap-3">
              <Button variant="outline" onClick={() => setStep("risks")}>
                Back
              </Button>
              <Button variant="outline" onClick={onManageSettings}>
                Adjust settings
              </Button>
              <Button
                className="laurenzo-button ml-auto"
                disabled={isLoading || !canConfirm}
                onClick={onConfirm}
                size="lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Arming live trading...
                  </>
                ) : (
                  "Arm live trading"
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
