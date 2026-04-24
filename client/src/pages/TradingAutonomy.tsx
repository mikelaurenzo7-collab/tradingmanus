import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { AlertTriangle, CheckCircle2, Loader2, Shield, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import {
  AUTONOMY_MODES,
  DEFAULT_TRADING_PREFERENCES,
  EXECUTION_CADENCES,
  RISK_POSTURES,
  formatAutonomyActivityTime,
  formatConfidence,
  getAutonomyModeDescription,
  getAutonomyModeLabel,
  getAutonomyReviewSummary,
  getAutonomyStatusSummary,
  getExecutionCadenceLabel,
  getRiskPostureLabel,
  type TradingPreferences,
} from "@/lib/tradingAutonomy";

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export default function TradingAutonomy() {
  const utils = trpc.useUtils();
  const accountStatusQuery = trpc.kalshi.getKalshiAccountStatus.useQuery();
  const instructionsQuery = trpc.training.getInstructions.useQuery();
  const preferencesQuery = trpc.kalshi.getTradingPreferences.useQuery();
  const autonomyActivityQuery = trpc.kalshi.getAutonomyActivity.useQuery();
  const [form, setForm] = useState<TradingPreferences>(DEFAULT_TRADING_PREFERENCES);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (preferencesQuery.data) {
      setForm(preferencesQuery.data);
    }
  }, [preferencesQuery.data]);

  const saveMutation = trpc.kalshi.updateTradingPreferences.useMutation({
    onSuccess: async (result) => {
      setForm(result.preferences);
      setMessage("Trading autonomy settings saved.");
      await Promise.all([
        utils.kalshi.getTradingPreferences.invalidate(),
        utils.kalshi.getKalshiAccountStatus.invalidate(),
      ]);
    },
    onError: (error) => setMessage(error.message),
  });

  const activationMutation = trpc.kalshi.setTradingActivation.useMutation({
    onSuccess: async (result) => {
      setForm(result.preferences);
      setMessage(
        result.preferences.liveTradingEnabled
          ? `${getAutonomyModeLabel(result.preferences.autonomyMode)} mode is now armed for live trading.`
          : "Live trading is now disarmed."
      );
      await Promise.all([
        utils.kalshi.getTradingPreferences.invalidate(),
        utils.kalshi.getKalshiAccountStatus.invalidate(),
      ]);
    },
    onError: (error) => setMessage(error.message),
  });

  const accountStatus = accountStatusQuery.data;
  const connected = accountStatus?.connected ?? false;
  const equity = accountStatus?.equity ?? 0;
  const hasInstructions = (instructionsQuery.data?.length ?? 0) > 0;
  const status = useMemo(() => getAutonomyStatusSummary(form), [form]);
  const activitySummary = useMemo(
    () => getAutonomyReviewSummary(autonomyActivityQuery.data),
    [autonomyActivityQuery.data]
  );
  const canArm = connected && equity > 0 && form.autonomyMode !== "manual";
  const saveDisabled = saveMutation.isPending || activationMutation.isPending;

  if (
    accountStatusQuery.isLoading ||
    instructionsQuery.isLoading ||
    preferencesQuery.isLoading ||
    autonomyActivityQuery.isLoading
  ) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading trading autonomy controls...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="mb-2 text-5xl font-bold gradient-text">Trading Autonomy</h1>
          <p className="max-w-3xl text-lg text-muted-foreground">
            This is the control room for deciding how autonomous the agent is. Choose whether the app should only research trades, require approval for every live order, or operate in a more autonomous execution mode within your saved guardrails.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/signals">
            <Button variant="outline">Review Signals</Button>
          </Link>
          <Link href="/risk-controls">
            <Button className="laurenzo-button">Review Risk Controls</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="laurenzo-card border-cyan-500/30 bg-cyan-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-cyan-400" />
              How to have the AI start trading
            </CardTitle>
            <CardDescription>
              The user decides the autonomy level. Fully autonomous trading is an explicit in-app choice.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              First, connect your live Kalshi account. Second, choose an autonomy mode on this page. Third, save your thresholds and risk posture. Fourth, arm live trading. If you choose <strong>Fully Autonomous</strong>, the agent may place eligible live orders automatically while the app is armed and operating inside your configured limits.
            </p>
            <p>
              If you prefer tighter control, choose <strong>Approval Required</strong> so the agent can prepare opportunities without placing a live order until you approve it.
            </p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="rounded-2xl border border-border/60 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Connection</div>
                <div className="mt-2 text-lg font-semibold text-foreground">
                  {connected ? "Connected" : "Not connected"}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {connected
                    ? `Live account equity: ${formatCurrency(equity)}`
                    : "Connect Kalshi before enabling live execution."}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Training</div>
                <div className="mt-2 text-lg font-semibold text-foreground">
                  {hasInstructions ? "Configured" : "Optional"}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {hasInstructions
                    ? "Your trading instructions are available to guide execution behavior."
                    : "You can still trade without instructions, but a policy profile is recommended."}
                </p>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Current status</div>
                <div className={`mt-2 text-lg font-semibold ${status.tone}`}>
                  {status.title}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">{status.body}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="laurenzo-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-violet-400" />
              Live trading master arm
            </CardTitle>
            <CardDescription>
              Saving a policy does not arm live trading by itself. Arming is a separate explicit action.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">Autonomy policy</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {getAutonomyModeLabel(form.autonomyMode)} · {getRiskPostureLabel(form.riskPosture)} · {getExecutionCadenceLabel(form.executionCadence)}
                  </div>
                </div>
                <div className={`text-sm font-semibold ${form.liveTradingEnabled ? "text-emerald-300" : "text-amber-300"}`}>
                  {form.liveTradingEnabled ? "Armed" : "Disarmed"}
                </div>
              </div>
            </div>

            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                Manual mode always keeps live execution disarmed. To let the app place live orders, choose Approval Required, Semi-autonomous, or Fully Autonomous, then arm live trading explicitly.
              </AlertDescription>
            </Alert>

            {message ? (
              <Alert className="border-cyan-500/30 bg-cyan-500/5">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>{message}</AlertDescription>
              </Alert>
            ) : null}

            <div className="flex flex-wrap gap-3">
              <Button
                className="laurenzo-button"
                disabled={saveDisabled || form.autonomyMode === "manual" || !canArm}
                onClick={() => activationMutation.mutate({ enabled: true })}
              >
                {activationMutation.isPending && !form.liveTradingEnabled ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Arming...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Arm live trading
                  </>
                )}
              </Button>
              <Button
                variant="outline"
                disabled={saveDisabled || !form.liveTradingEnabled}
                onClick={() => activationMutation.mutate({ enabled: false })}
              >
                Disarm live trading
              </Button>
              {!connected ? (
                <Link href="/connect">
                  <Button variant="outline">Connect Kalshi first</Button>
                </Link>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="laurenzo-card">
        <CardHeader>
          <CardTitle>Choose your autonomy mode</CardTitle>
          <CardDescription>
            The user decides how autonomous the agent is. These modes control whether the app can place live orders automatically.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-4">
          {AUTONOMY_MODES.map((mode) => {
            const selected = form.autonomyMode === mode;
            return (
              <button
                key={mode}
                type="button"
                onClick={() =>
                  setForm((current) => ({
                    ...current,
                    autonomyMode: mode,
                    liveTradingEnabled: mode === "manual" ? false : current.liveTradingEnabled,
                  }))
                }
                className={`rounded-3xl border p-5 text-left transition ${selected ? "border-cyan-400 bg-cyan-500/10 shadow-[0_0_30px_rgba(34,211,238,0.12)]" : "border-border/60 bg-background/40 hover:border-cyan-500/40"}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-lg font-semibold text-foreground">
                    {getAutonomyModeLabel(mode)}
                  </div>
                  {selected ? <CheckCircle2 className="h-5 w-5 text-cyan-300" /> : null}
                </div>
                <p className="mt-3 text-sm text-muted-foreground">
                  {getAutonomyModeDescription(mode)}
                </p>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card className="laurenzo-card border-emerald-500/20 bg-emerald-500/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-emerald-300" />
            Latest away-from-chat activity
          </CardTitle>
          <CardDescription>
            This panel shows the most recent scheduled review outcome recorded by the deployed autonomy loop.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="space-y-3 rounded-2xl border border-border/60 bg-background/40 p-4">
            <div className={`text-lg font-semibold ${activitySummary.tone}`}>{activitySummary.title}</div>
            <p className="text-sm text-muted-foreground">{activitySummary.body}</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-background/50 p-3 text-sm">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Last review</div>
                <div className="mt-2 font-semibold text-foreground">
                  {formatAutonomyActivityTime(autonomyActivityQuery.data?.lastRun?.createdAt)}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {autonomyActivityQuery.data?.lastRun?.autonomyMode
                    ? `${autonomyActivityQuery.data.lastRun.autonomyMode} · ${autonomyActivityQuery.data.lastRun.executionCadence ?? "cadence unknown"}`
                    : "No away-from-chat review has been persisted yet."}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-background/50 p-3 text-sm">
                <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Last away order event</div>
                <div className="mt-2 font-semibold text-foreground">
                  {formatAutonomyActivityTime(autonomyActivityQuery.data?.lastOrder?.createdAt)}
                </div>
                <p className="mt-2 text-xs text-muted-foreground">
                  {autonomyActivityQuery.data?.lastOrder?.marketId
                    ? `${autonomyActivityQuery.data.lastOrder.marketId} · ${autonomyActivityQuery.data.lastOrder.side?.toUpperCase() ?? "UNKNOWN"} side`
                    : "No away-from-chat order event is recorded yet."}
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-border/60 bg-background/40 p-4">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Recent autonomy events</div>
              <p className="mt-2 text-sm text-muted-foreground">
                The latest persisted events help separate real scheduled reviews from manual arm/disarm actions.
              </p>
            </div>
            <div className="space-y-2">
              {autonomyActivityQuery.data?.recentActivity.slice(0, 4).map((event) => (
                <div key={event.id} className="rounded-xl border border-border/60 bg-background/50 p-3 text-sm">
                  <div className="font-medium text-foreground">{event.eventType.replace(/_/g, " ")}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatAutonomyActivityTime(event.createdAt)}
                  </div>
                </div>
              ))}
              {!autonomyActivityQuery.data?.recentActivity.length ? (
                <div className="rounded-xl border border-dashed border-border/60 p-3 text-sm text-muted-foreground">
                  No scheduled autonomy events have been recorded yet.
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card className="laurenzo-card">
          <CardHeader>
            <CardTitle>Choose your autonomy mode</CardTitle>
            <CardDescription>
              Configure when the agent is allowed to act and how demanding the signal quality threshold should be.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <div className="mb-3 text-sm font-medium text-foreground">Execution cadence</div>
              <div className="grid gap-3 md:grid-cols-2">
                {EXECUTION_CADENCES.map((cadence) => {
                  const selected = form.executionCadence === cadence;
                  return (
                    <button
                      key={cadence}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, executionCadence: cadence }))}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${selected ? "border-violet-400 bg-violet-500/10" : "border-border/60 bg-background/40 hover:border-violet-500/40"}`}
                    >
                      <div className="font-medium text-foreground">{getExecutionCadenceLabel(cadence)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {cadence === "manual_only"
                          ? "Only act during explicitly initiated trading sessions."
                          : cadence === "session_assisted"
                            ? "Stay active while you are guiding the session inside the app."
                            : cadence === "hourly_watch"
                              ? "Prefer scheduled reviews and controlled periodic scans."
                              : "Use the most proactive monitoring posture available to the execution loop."}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <div className="mb-3 text-sm font-medium text-foreground">Risk posture</div>
              <div className="grid gap-3 md:grid-cols-3">
                {RISK_POSTURES.map((riskPosture) => {
                  const selected = form.riskPosture === riskPosture;
                  return (
                    <button
                      key={riskPosture}
                      type="button"
                      onClick={() => setForm((current) => ({ ...current, riskPosture }))}
                      className={`rounded-2xl border px-4 py-3 text-left transition ${selected ? "border-pink-400 bg-pink-500/10" : "border-border/60 bg-background/40 hover:border-pink-500/40"}`}
                    >
                      <div className="font-medium text-foreground">{getRiskPostureLabel(riskPosture)}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {riskPosture === "conservative"
                          ? "Bias toward fewer trades and tighter thresholds."
                          : riskPosture === "balanced"
                            ? "Blend caution with moderate opportunity capture."
                            : "Allow the most assertive behavior that still respects your hard limits."}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <label className="space-y-2 text-sm">
                <span className="font-medium text-foreground">Minimum signal confidence</span>
                <input
                  type="range"
                  min={0.5}
                  max={0.95}
                  step={0.01}
                  value={form.minSignalConfidence}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      minSignalConfidence: Number(event.target.value),
                    }))
                  }
                  className="w-full"
                />
                <div className="text-xs text-muted-foreground">
                  Candidate trades must meet at least <strong>{formatConfidence(form.minSignalConfidence)}</strong> model confidence.
                </div>
              </label>

              <label className="space-y-2 text-sm">
                <span className="font-medium text-foreground">Maximum order notional</span>
                <input
                  type="number"
                  min={1}
                  max={250}
                  step={1}
                  value={form.maxOrderNotional}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      maxOrderNotional: Number(event.target.value || 0),
                    }))
                  }
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
                />
                <div className="text-xs text-muted-foreground">
                  Live orders above this notional are blocked by your autonomy policy.
                </div>
              </label>

              <label className="space-y-2 text-sm">
                <span className="font-medium text-foreground">Require approval above</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  step={1}
                  value={form.requireApprovalAbove}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      requireApprovalAbove: Number(event.target.value || 0),
                    }))
                  }
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
                />
                <div className="text-xs text-muted-foreground">
                  In semi-autonomous mode, live orders above this size should wait for approval.
                </div>
              </label>

              <label className="space-y-2 text-sm">
                <span className="font-medium text-foreground">Maximum daily orders</span>
                <input
                  type="number"
                  min={1}
                  max={48}
                  step={1}
                  value={form.maxDailyOrders}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      maxDailyOrders: Number(event.target.value || 0),
                    }))
                  }
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground"
                />
                <div className="text-xs text-muted-foreground">
                  This caps how many trades the autonomy policy may permit during one trading day.
                </div>
              </label>
            </div>
          </CardContent>
        </Card>

        <Card className="laurenzo-card border-violet-500/30 bg-violet-500/5">
          <CardHeader>
            <CardTitle>Save and activate</CardTitle>
            <CardDescription>
              Save your policy first, then arm live trading when you are ready.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Your saved policy becomes the single source of truth for how autonomous the agent is allowed to be. The current selection is <strong>{getAutonomyModeLabel(form.autonomyMode)}</strong> with <strong>{formatConfidence(form.minSignalConfidence)}</strong> minimum confidence and a <strong>{formatCurrency(form.maxOrderNotional)}</strong> max order size.
            </p>
            <p>
              Arming the app is intentionally separate so you can prepare the policy in advance without accidentally permitting live execution.
            </p>
            <Button
              className="w-full laurenzo-button"
              disabled={saveDisabled}
              onClick={() => {
                setMessage(null);
                saveMutation.mutate(form);
              }}
              size="lg"
            >
              {saveMutation.isPending ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Saving policy...
                </>
              ) : (
                "Save autonomy policy"
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
