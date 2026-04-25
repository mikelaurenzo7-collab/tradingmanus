import { useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  preferences,
  onConfirm,
  onManageSettings,
  onCancel,
  isLoading = false,
}: StartTradingDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  const canArm = equity > 0 && preferences.autonomyMode !== "manual";

  return (
    <Card className="laurenzo-card border-cyan-500/30 bg-cyan-500/5">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-amber-400" />
          Arm live trading — final review
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Policy summary */}
        <div className="grid gap-3 sm:grid-cols-2 text-sm">
          <div className="rounded-lg border border-border/60 bg-background/50 px-4 py-3">
            <p className="text-xs text-muted-foreground mb-1">Autonomy mode</p>
            <p className="font-semibold text-foreground">{getAutonomyModeLabel(preferences.autonomyMode)}</p>
            <p className="text-xs text-muted-foreground mt-1">{getAutonomyModeDescription(preferences.autonomyMode)}</p>
          </div>
          <div className="rounded-lg border border-border/60 bg-background/50 px-4 py-3">
            <p className="text-xs text-muted-foreground mb-1">Guardrails</p>
            <p className="text-xs text-muted-foreground space-y-0.5">
              <span className="block"><strong className="text-foreground">Cadence:</strong> {getExecutionCadenceLabel(preferences.executionCadence)}</span>
              <span className="block"><strong className="text-foreground">Risk posture:</strong> {getRiskPostureLabel(preferences.riskPosture)}</span>
              <span className="block"><strong className="text-foreground">Min confidence:</strong> {formatConfidence(preferences.minSignalConfidence)}</span>
              <span className="block"><strong className="text-foreground">Max order:</strong> ${preferences.maxOrderNotional.toFixed(2)}</span>
              <span className="block"><strong className="text-foreground">Daily cap:</strong> {preferences.maxDailyOrders} orders</span>
            </p>
          </div>
        </div>

        {/* Checklist */}
        <div className="space-y-2 text-sm">
          <div className={`flex items-center gap-2 ${equity > 0 ? "text-emerald-300" : "text-rose-300"}`}>
            {equity > 0
              ? <CheckCircle2 className="w-4 h-4 shrink-0" />
              : <AlertTriangle className="w-4 h-4 shrink-0" />}
            {equity > 0 ? `Funded — $${equity.toFixed(2)} equity` : "Account not funded — deposit before arming"}
          </div>
          <div className={`flex items-center gap-2 ${preferences.autonomyMode !== "manual" ? "text-emerald-300" : "text-amber-300"}`}>
            {preferences.autonomyMode !== "manual"
              ? <CheckCircle2 className="w-4 h-4 shrink-0" />
              : <Settings2 className="w-4 h-4 shrink-0" />}
            {preferences.autonomyMode !== "manual" ? "Autonomy mode set" : "Manual mode — switch to allow live execution"}
          </div>
        </div>

        {/* Risk acknowledgment */}
        <div className="rounded-lg border border-border/60 bg-background/50 px-4 py-3 text-sm space-y-2">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-widest">Risk acknowledgment</p>
          <ul className="space-y-1 text-xs text-muted-foreground list-disc ml-4">
            <li>Live trading can lose money, including all capital in a position.</li>
            <li>Fast markets or low liquidity can produce worse fills than the signal predicted.</li>
            <li>You can disarm at any time from the dashboard header or Trading Autonomy page.</li>
          </ul>
          <label className="flex items-start gap-3 mt-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            <span className="text-xs text-foreground">I understand the risks and explicitly approve arming live trading under these settings.</span>
          </label>
        </div>

        {!canArm && (
          <Alert className="border-amber-500/40 bg-amber-500/10">
            <AlertDescription className="text-sm">
              {equity <= 0 ? "Fund the Kalshi account first." : "Switch to a non-manual autonomy mode first."}
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap gap-3 pt-1">
          <Button variant="outline" onClick={onCancel} disabled={isLoading}>Cancel</Button>
          <Button variant="outline" onClick={onManageSettings} disabled={isLoading}>Adjust settings</Button>
          <Button
            className="laurenzo-button ml-auto"
            disabled={isLoading || !acknowledged || !canArm}
            onClick={onConfirm}
          >
            {isLoading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Arming…</> : "Arm live trading"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
