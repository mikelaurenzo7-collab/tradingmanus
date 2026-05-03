import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, Circle, Loader2, Shield, Zap, ChevronRight, Clock, Ban, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
  getAutonomyReadinessSummary,
  getAutonomyReviewSummary,
  getExecutionCadenceLabel,
  getRiskPostureLabel,
  type TradingPreferences,
} from "@/lib/tradingAutonomy";

function fmt(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(value);
}

// ── Pill selector ─────────────────────────────────────────────────────────────
function PillGroup<T extends string>({
  options,
  value,
  disabled,
  label,
  description,
  onChange,
}: {
  options: readonly T[];
  value: T;
  disabled: boolean;
  label: (v: T) => string;
  description: (v: T) => string;
  onChange: (v: T) => void;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
      {options.map((opt) => {
        const active = opt === value;
        return (
          <button
            key={opt}
            type="button"
            disabled={disabled}
            onClick={() => onChange(opt)}
            className={`rounded-xl border px-4 py-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
              active
                ? "border-cyan-400 bg-cyan-500/10 shadow-[0_0_12px_rgba(34,211,238,0.1)]"
                : "border-border/60 bg-background/40 hover:border-cyan-500/30"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold text-foreground">{label(opt)}</span>
              {active ? <CheckCircle2 className="w-4 h-4 text-cyan-400 shrink-0" /> : <Circle className="w-4 h-4 text-border/60 shrink-0" />}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">{description(opt)}</p>
          </button>
        );
      })}
    </div>
  );
}

// ── Step header ───────────────────────────────────────────────────────────────
function StepHeader({ n, title, subtitle }: { n: number; title: string; subtitle: string }) {
  return (
    <div className="flex items-start gap-4">
      <div className="w-8 h-8 rounded-full bg-cyan-500/20 text-cyan-300 flex items-center justify-center font-bold text-sm shrink-0">
        {n}
      </div>
      <div>
        <h2 className="font-semibold text-foreground">{title}</h2>
        <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
      </div>
    </div>
  );
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
    if (preferencesQuery.data) setForm(preferencesQuery.data);
  }, [preferencesQuery.data]);

  const saveMutation = trpc.kalshi.updateTradingPreferences.useMutation({
    onSuccess: async (result) => {
      setForm(result.preferences);
      setMessage("Settings saved.");
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
          ? `${getAutonomyModeLabel(result.preferences.autonomyMode)} is now armed.`
          : "Live trading disarmed.",
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

  const readiness = useMemo(
    () => getAutonomyReadinessSummary({ preferences: form, connected, equity, lastRunAt: autonomyActivityQuery.data?.lastRun?.createdAt ?? null }),
    [autonomyActivityQuery.data?.lastRun?.createdAt, connected, equity, form],
  );
  const activitySummary = useMemo(() => getAutonomyReviewSummary(autonomyActivityQuery.data), [autonomyActivityQuery.data]);

  const canArm = connected && equity > 0 && form.autonomyMode !== "manual";
  const isMutating = saveMutation.isPending || activationMutation.isPending;
  const isArmed = form.liveTradingEnabled;
  const policyLocked = isArmed;

  if (accountStatusQuery.isLoading || preferencesQuery.isLoading || autonomyActivityQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-8 max-w-4xl">
      {/* Page title + status pill */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Trading Autonomy</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure how autonomous the Claude reviewer is, then arm live trading when you're ready.
          </p>
        </div>
        <div className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
          isArmed
            ? "border-rose-400/50 bg-rose-500/10 text-rose-200"
            : "border-border/60 bg-background/50 text-muted-foreground"
        }`}>
          {isArmed ? <Zap className="w-3.5 h-3.5" /> : <Shield className="w-3.5 h-3.5" />}
          {isArmed ? "Armed — live trading active" : "Disarmed"}
        </div>
      </div>

      {/* Connection gate */}
      {!connected && (
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <AlertDescription className="flex items-center justify-between gap-3 flex-wrap">
            <span>Connect your Kalshi account before arming live trading.</span>
            <Link href="/connect"><Button size="sm" variant="outline">Connect Kalshi</Button></Link>
          </AlertDescription>
        </Alert>
      )}

      {/* Message feedback */}
      {message && (
        <Alert className="border-cyan-500/30 bg-cyan-500/5">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {/* Policy locked notice */}
      {policyLocked && (
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <Shield className="h-4 w-4" />
          <AlertDescription>
            Disarm live trading before changing autonomy mode, cadence, thresholds, or risk posture.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Step 1: Choose mode ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-4">
          <StepHeader
            n={1}
            title="Choose how autonomous the Claude reviewer is"
            subtitle="This controls whether the AI reviewer can place live orders automatically or only prepares analysis."
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <PillGroup
            options={AUTONOMY_MODES}
            value={form.autonomyMode}
            disabled={policyLocked}
            label={getAutonomyModeLabel}
            description={getAutonomyModeDescription}
            onChange={(mode) =>
              setForm((f) => ({ ...f, autonomyMode: mode, liveTradingEnabled: mode === "manual" ? false : f.liveTradingEnabled }))
            }
          />

          {/* Cadence — hidden for manual mode */}
          {form.autonomyMode !== "manual" && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2 mt-4">How often Claude scans</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {EXECUTION_CADENCES.map((c) => {
                  const active = form.executionCadence === c;
                  const cadenceDescriptions: Record<string, string> = {
                    manual_only: "Only acts during sessions you manually start.",
                    session_assisted: "Stays active while you're guiding in-app.",
                    hourly_watch: "Scans markets once per minute (rate-limited to ~hourly cadence).",
                    continuous_watch: "Most proactive — scans every cron tick (1 min).",
                  };
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={policyLocked}
                      onClick={() => setForm((f) => ({ ...f, executionCadence: c }))}
                      className={`rounded-xl border px-4 py-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        active ? "border-violet-400 bg-violet-500/10" : "border-border/60 bg-background/40 hover:border-violet-500/30"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{getExecutionCadenceLabel(c)}</span>
                        {active ? <CheckCircle2 className="w-4 h-4 text-violet-400 shrink-0" /> : <Circle className="w-4 h-4 text-border/60 shrink-0" />}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{cadenceDescriptions[c]}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Step 2: Set thresholds ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-4">
          <StepHeader
            n={2}
            title="Set thresholds and size limits"
            subtitle="These numbers define the guardrails Claude must stay within on every order."
          />
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Risk posture */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">Risk posture</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {RISK_POSTURES.map((rp) => {
                const active = form.riskPosture === rp;
                const posDescriptions: Record<string, string> = {
                  conservative: "Fewer trades, tighter thresholds, capital preservation first.",
                  balanced: "Moderate — blend caution with opportunity.",
                  aggressive: "Most assertive within your hard limits.",
                };
                return (
                  <button
                    key={rp}
                    type="button"
                    disabled={policyLocked}
                    onClick={() => setForm((f) => ({ ...f, riskPosture: rp }))}
                    className={`rounded-xl border px-4 py-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      active ? "border-pink-400 bg-pink-500/10" : "border-border/60 bg-background/40 hover:border-pink-500/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{getRiskPostureLabel(rp)}</span>
                      {active ? <CheckCircle2 className="w-4 h-4 text-pink-400 shrink-0" /> : <Circle className="w-4 h-4 text-border/60 shrink-0" />}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{posDescriptions[rp]}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Numeric controls */}
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="font-medium">Minimum signal confidence</span>
                <span className="text-muted-foreground font-mono">{formatConfidence(form.minSignalConfidence)}</span>
              </div>
              <input
                type="range" min={0.5} max={0.95} step={0.01}
                value={form.minSignalConfidence}
                disabled={policyLocked}
                onChange={(e) => setForm((f) => ({ ...f, minSignalConfidence: Number(e.target.value) }))}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">Claude only acts on signals that meet this quality threshold.</p>
            </label>

            <label className="space-y-2 text-sm">
              <span className="font-medium">Max order size ($)</span>
              <input
                type="number" min={1} max={250} step={1}
                value={form.maxOrderNotional}
                disabled={policyLocked}
                onChange={(e) => setForm((f) => ({ ...f, maxOrderNotional: Number(e.target.value || 0) }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground disabled:opacity-50"
              />
              <p className="text-xs text-muted-foreground">Orders above this notional are blocked automatically.</p>
            </label>

            <label className="space-y-2 text-sm">
              <span className="font-medium">Max orders per day</span>
              <input
                type="number" min={1} max={48} step={1}
                value={form.maxDailyOrders}
                disabled={policyLocked}
                onChange={(e) => setForm((f) => ({ ...f, maxDailyOrders: Number(e.target.value || 0) }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground disabled:opacity-50"
              />
              <p className="text-xs text-muted-foreground">Daily cap on autonomous orders across all markets.</p>
            </label>

            <label className="space-y-2 text-sm">
              <span className="font-medium">Require approval above ($)</span>
              <input
                type="number" min={1} max={500} step={1}
                value={form.requireApprovalAbove}
                disabled={policyLocked}
                onChange={(e) => setForm((f) => ({ ...f, requireApprovalAbove: Number(e.target.value || 0) }))}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-foreground disabled:opacity-50"
              />
              <p className="text-xs text-muted-foreground">In semi-autonomous mode, orders above this size need your approval.</p>
            </label>
          </div>

          {/* Summary line */}
          <div className="rounded-lg border border-border/60 bg-background/40 px-4 py-3 text-sm text-muted-foreground">
            <span className="text-foreground font-medium">Summary: </span>
            {getAutonomyModeLabel(form.autonomyMode)} · {getRiskPostureLabel(form.riskPosture)} · {getExecutionCadenceLabel(form.executionCadence)} · min {formatConfidence(form.minSignalConfidence)} confidence · {fmt(form.maxOrderNotional)} max order · {form.maxDailyOrders} orders/day
          </div>
        </CardContent>
      </Card>

      {/* ── Step 3: Save & arm ─────────────────────────────────────────── */}
      <Card className={isArmed ? "border-rose-500/30 bg-rose-500/5" : "border-emerald-500/20 bg-emerald-500/5"}>
        <CardHeader className="pb-4">
          <StepHeader
            n={3}
            title={isArmed ? "Live trading is armed" : "Save settings and arm when ready"}
            subtitle={
              isArmed
                ? "Disarm before changing any settings. Use the kill switch in Risk Controls or the header to close positions instantly."
                : "Save your policy first, then arm. Arming is intentionally a separate step."
            }
          />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className={`rounded-lg border px-4 py-3 text-sm ${isArmed ? "border-rose-500/30 bg-rose-500/5" : "border-border/60 bg-background/40"}`}>
            <div className={`font-semibold mb-1 ${readiness.tone}`}>{readiness.title}</div>
            <p className="text-muted-foreground text-xs">{readiness.body}</p>
          </div>

          <div className="flex flex-wrap gap-3">
            {!isArmed && (
              <Button
                className="laurenzo-button"
                disabled={isMutating || policyLocked}
                onClick={() => { setMessage(null); saveMutation.mutate(form); }}
              >
                {saveMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</> : "Save settings"}
              </Button>
            )}
            {!isArmed && (
              <Button
                className="laurenzo-button"
                disabled={isMutating || !canArm}
                onClick={() => activationMutation.mutate({ enabled: true })}
              >
                {activationMutation.isPending && !isArmed ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Arming…</> : <><Zap className="w-4 h-4 mr-2" />Arm live trading</>}
              </Button>
            )}
            {isArmed && (
              <Button
                variant="outline"
                disabled={isMutating}
                onClick={() => activationMutation.mutate({ enabled: false })}
              >
                {activationMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Disarming…</> : "Disarm live trading"}
              </Button>
            )}
            <Link href="/risk-controls">
              <Button variant="outline" className="flex items-center gap-1">
                Risk Controls <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
            <Link href="/signals">
              <Button variant="outline" className="flex items-center gap-1">
                Signals <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </Link>
          </div>
        </CardContent>
      </Card>

      {/* ── Last activity (compact) ────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-xs font-semibold uppercase tracking-widest text-muted-foreground flex items-center gap-2">
            <Activity className="w-3.5 h-3.5" /> Last Autonomous Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-3">
          <div className={`font-medium ${activitySummary.tone}`}>{activitySummary.title}</div>
          <p className="text-muted-foreground text-xs">{activitySummary.body}</p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Clock className="w-3 h-3" />Last scan</div>
              <div className="font-medium text-xs">{formatAutonomyActivityTime(autonomyActivityQuery.data?.lastRun?.createdAt)}</div>
            </div>
            <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Zap className="w-3 h-3" />Last order</div>
              <div className="font-medium text-xs">{formatAutonomyActivityTime(autonomyActivityQuery.data?.lastOrder?.createdAt)}</div>
            </div>
            <div className="rounded-lg border border-border/40 bg-background/40 px-3 py-2.5">
              <div className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Ban className="w-3 h-3" />Last block reason</div>
              <div className="font-medium text-xs">
                {autonomyActivityQuery.data?.lastRun?.reason ?? "Not recorded yet"}
              </div>
            </div>
          </div>

          {autonomyActivityQuery.data?.recentActivity.length ? (
            <div className="space-y-1 pt-1">
              {autonomyActivityQuery.data.recentActivity.slice(0, 5).map((event) => (
                <div key={event.id} className="flex items-center justify-between text-xs text-muted-foreground py-1 border-b border-border/30 last:border-0">
                  <span className="text-foreground/70">{event.eventType.replace(/_/g, " ")}</span>
                  <span>{formatAutonomyActivityTime(event.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">No autonomous trading events recorded yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
