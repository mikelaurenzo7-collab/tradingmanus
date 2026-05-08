import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { CheckCircle2, Circle, Loader2, Shield, Zap, ChevronRight, Clock, Ban, Activity, AlertTriangle, Target, TrendingUp, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { trpc } from "@/lib/trpc";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/widgets/StatCard";
import { EmptyState } from "@/components/EmptyStates";
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

  const ownerModeMutation = trpc.kalshi.setOwnerMode.useMutation({
    onSuccess: async (result) => {
      setForm(result.preferences);
      setMessage(
        result.preferences.ownerMode
          ? "Owner Mode enabled — autonomy armed at maximum permission."
          : "Owner Mode disabled.",
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
    <div className="space-y-8 max-w-5xl mx-auto">
      <PageHeader
        icon={isArmed ? Zap : Shield}
        title="Trading Autonomy"
        description="Configure autonomous trading and arm live order execution when ready."
        iconColor={isArmed ? "text-destructive" : "text-primary"}
      />

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
        <Alert className="border-accent-500/30 bg-accent-500/5">
          <CheckCircle2 className="h-4 w-4" />
          <AlertDescription>{message}</AlertDescription>
        </Alert>
      )}

      {/* ── Owner Mode quick-arm ─────────────────────────────────────── */}
      <Card className={`glass-panel border-l-4 ${form.ownerMode ? "border-l-rose-500 glow-destructive" : "border-l-amber-500/40"}`}>
        <CardContent className="p-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Zap className={`h-4 w-4 ${form.ownerMode ? "text-rose-400" : "text-amber-400"}`} />
              <span className="font-semibold text-sm">Owner Mode</span>
              {form.ownerMode ? (
                <span className="text-[10px] uppercase tracking-wider px-2 py-0.5 rounded bg-rose-500/15 text-rose-300">
                  ON
                </span>
              ) : null}
            </div>
            <p className="text-xs text-muted-foreground max-w-2xl">
              One-click switch that arms full autonomy at maximum permission and bypasses
              the policy gates an owner who accepts the risk would otherwise fight: the 5-min
              recent-manual-order cooldown, the per-category concentration cap, and the
              posture-driven confidence floor boost. Hard safety gates (credentials, capital,
              price drift, exchange rejection) stay enforced.
            </p>
          </div>
          <Button
            variant={form.ownerMode ? "outline" : "default"}
            size="sm"
            disabled={ownerModeMutation.isPending || (!connected && !form.ownerMode)}
            onClick={() => ownerModeMutation.mutate({ enabled: !form.ownerMode })}
            className={form.ownerMode ? "" : "bg-rose-500 hover:bg-rose-600 text-white"}
          >
            {ownerModeMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
            ) : null}
            {form.ownerMode ? "Disable Owner Mode" : "Enable Owner Mode"}
          </Button>
        </CardContent>
      </Card>

      {/* ── Hero Status Card ─────────────────────────────────────────── */}
      <Card className={`glass-panel relative overflow-hidden ${isArmed ? 'glow-primary animate-pulse-glow' : ''}`}>
        <CardContent className="pt-6 pb-6">
          <div className="flex flex-col md:flex-row items-center md:items-start justify-between gap-6">
            {/* Status indicator */}
            <div className="flex items-center gap-4">
              <div className={`w-16 h-16 rounded-full flex items-center justify-center ${
                isArmed 
                  ? 'bg-rose-500/20 text-rose-400' 
                  : 'bg-slate-500/20 text-slate-400'
              }`}>
                {isArmed ? <Zap className="w-8 h-8" /> : <Shield className="w-8 h-8" />}
              </div>
              <div>
                <div className="text-2xl font-bold text-foreground mb-1">
                  {isArmed ? "Armed" : "Disarmed"}
                </div>
                <div className="text-sm text-muted-foreground">
                  {isArmed 
                    ? `${getAutonomyModeLabel(form.autonomyMode)} active` 
                    : "Live trading disabled"
                  }
                </div>
                {isArmed && (
                  <div className="flex items-center gap-2 mt-2 text-xs text-muted-foreground">
                    <div className="w-2 h-2 rounded-full bg-rose-400 animate-pulse" />
                    Live orders enabled
                  </div>
                )}
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex flex-col gap-2">
              {!isArmed ? (
                <Button
                  size="lg"
                  className="bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-all"
                  disabled={isMutating || !canArm}
                  onClick={() => activationMutation.mutate({ enabled: true })}
                >
                  {activationMutation.isPending && !isArmed ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Arming…</>
                  ) : (
                    <><Zap className="w-4 h-4 mr-2" />Arm Live Trading</>
                  )}
                </Button>
              ) : (
                <Button
                  size="lg"
                  variant="destructive"
                  className="glow-destructive"
                  disabled={isMutating}
                  onClick={() => {
                    if (confirm("Disarm live trading? No new orders will be placed.")) {
                      activationMutation.mutate({ enabled: false });
                    }
                  }}
                >
                  {activationMutation.isPending ? (
                    <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Disarming…</>
                  ) : (
                    <><Ban className="w-4 h-4 mr-2" />Disarm</>
                  )}
                </Button>
              )}
              {!canArm && !isArmed && (
                <p className="text-xs text-amber-400 text-center">
                  {!connected ? "Connect Kalshi" : form.autonomyMode === "manual" ? "Enable autonomy mode" : "Insufficient equity"}
                </p>
              )}
            </div>
          </div>

          {/* Readiness summary */}
          <div className={`mt-6 rounded-lg border px-4 py-3 text-sm ${
            isArmed ? 'border-rose-500/30 bg-rose-500/5' : 'border-border/60 bg-background/40'
          }`}>
            <div className={`font-semibold mb-1 ${readiness.tone}`}>{readiness.title}</div>
            <p className="text-muted-foreground text-xs">{readiness.body}</p>
          </div>
        </CardContent>
      </Card>

      {/* Policy locked notice */}
      {policyLocked && (
        <Alert className="border-amber-500/40 bg-amber-500/10">
          <Shield className="h-4 w-4" />
          <AlertDescription>
            Disarm live trading before changing autonomy mode, cadence, thresholds, or risk posture.
          </AlertDescription>
        </Alert>
      )}

      {/* ── Autonomy Metrics ─────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Autonomy Mode"
          value={getAutonomyModeLabel(form.autonomyMode)}
          icon={<Target className="w-5 h-5" />}
          color="#8864ff"
        />
        <StatCard
          label="Risk Posture"
          value={getRiskPostureLabel(form.riskPosture)}
          icon={<Shield className="w-5 h-5" />}
          color="#ec4899"
        />
        <StatCard
          label="Min Confidence"
          value={formatConfidence(form.minSignalConfidence)}
          icon={<TrendingUp className="w-5 h-5" />}
          color="#22d3ee"
        />
        <StatCard
          label="Max Order Size"
          value={fmt(form.maxOrderNotional)}
          icon={<Settings className="w-5 h-5" />}
          color="#f59e0b"
        />
      </div>

      {/* ── Mode Selector ────────────────────────────────────────────── */}
      <Card className="glass-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-accent" />
            Autonomy Mode
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Controls whether the AI can place live orders automatically or only prepares analysis.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            {AUTONOMY_MODES.map((mode) => {
              const active = form.autonomyMode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={policyLocked}
                  onClick={() =>
                    setForm((f) => ({ ...f, autonomyMode: mode, liveTradingEnabled: mode === "manual" ? false : f.liveTradingEnabled }))
                  }
                  className={`glass-panel p-5 text-left transition-all duration-300 disabled:cursor-not-allowed disabled:opacity-50 ${
                    active ? 'glow-primary border-accent-400' : 'hover:border-accent-500/30'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-3">
                    <div className="text-lg font-bold text-foreground">{getAutonomyModeLabel(mode)}</div>
                    {active ? (
                      <CheckCircle2 className="w-5 h-5 text-accent shrink-0" />
                    ) : (
                      <Circle className="w-5 h-5 text-border/60 shrink-0" />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {getAutonomyModeDescription(mode)}
                  </p>
                </button>
              );
            })}
          </div>

          {/* Execution Cadence — hidden for manual mode */}
          {form.autonomyMode !== "manual" && (
            <div className="mt-6">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                <Clock className="w-3 h-3 inline mr-1" />
                Execution Cadence
              </p>
              <div className="grid gap-3 sm:grid-cols-2">
                {EXECUTION_CADENCES.map((c) => {
                  const active = form.executionCadence === c;
                  const cadenceDescriptions: Record<string, string> = {
                    manual_only: "Only acts during sessions you manually start.",
                    session_assisted: "Stays active while you're guiding in-app.",
                    hourly_watch: "Scans markets once per hour automatically.",
                    continuous_watch: "Most proactive — scans as often as allowed.",
                  };
                  return (
                    <button
                      key={c}
                      type="button"
                      disabled={policyLocked}
                      onClick={() => setForm((f) => ({ ...f, executionCadence: c }))}
                      className={`rounded-xl border px-4 py-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                        active ? "border-primary-400 bg-primary-500/10" : "border-border/60 bg-background/40 hover:border-primary-500/30"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{getExecutionCadenceLabel(c)}</span>
                        {active ? (
                          <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                        ) : (
                          <Circle className="w-4 h-4 text-border/60 shrink-0" />
                        )}
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

      {/* ── Risk Settings ────────────────────────────────────────────── */}
      <Card className="glass-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5 stat-decrease" />
            Risk Settings & Thresholds
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Define guardrails the AI must stay within on every order.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Risk posture */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">Risk Posture</p>
            <div className="grid gap-3 sm:grid-cols-3">
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
                      active ? "border-destructive-400 bg-destructive-500/10" : "border-border/60 bg-background/40 hover:border-destructive-500/30"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{getRiskPostureLabel(rp)}</span>
                      {active ? (
                        <CheckCircle2 className="w-4 h-4 stat-decrease shrink-0" />
                      ) : (
                        <Circle className="w-4 h-4 text-border/60 shrink-0" />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">{posDescriptions[rp]}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Paper-mode toggle */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
              Trade Mode
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                type="button"
                disabled={policyLocked}
                onClick={() => setForm((f) => ({ ...f, paperTradeMode: false }))}
                className={`rounded-xl border px-4 py-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  !form.paperTradeMode
                    ? "border-emerald-400/60 bg-emerald-500/10"
                    : "border-border/60 bg-background/40 hover:border-emerald-500/30"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">Live trading</span>
                  {!form.paperTradeMode ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-border/60 shrink-0" />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Real orders against your Kalshi account.  Real P&L, real fees.
                </p>
              </button>
              <button
                type="button"
                disabled={policyLocked}
                onClick={() => setForm((f) => ({ ...f, paperTradeMode: true }))}
                className={`rounded-xl border px-4 py-3 text-left text-sm transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  form.paperTradeMode
                    ? "border-amber-400/60 bg-amber-500/10"
                    : "border-border/60 bg-background/40 hover:border-amber-500/30"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">Paper (simulated)</span>
                  {form.paperTradeMode ? (
                    <CheckCircle2 className="w-4 h-4 text-amber-400 shrink-0" />
                  ) : (
                    <Circle className="w-4 h-4 text-border/60 shrink-0" />
                  )}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Same logic, no real orders.  Outcomes record to performance for shadow-testing.
                </p>
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Operator-level <code className="font-mono text-foreground/80">PAPER_TRADE_MODE=true</code> env still wins as a global kill switch over this per-user setting.
            </p>
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
              <p className="text-xs text-muted-foreground">The AI only acts on signals that meet this quality threshold.</p>
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

          {/* Save button */}
          {!isArmed && (
            <div className="flex gap-3">
              <Button
                className="bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-all"
                disabled={isMutating || policyLocked}
                onClick={() => { setMessage(null); saveMutation.mutate(form); }}
              >
                {saveMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving…</>
                ) : (
                  "Save Settings"
                )}
              </Button>
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
          )}
        </CardContent>
      </Card>

      {/* ── Recent Activity Timeline ────────────────────────────────── */}
      <Card className="glass-panel">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-accent" />
            Recent Autonomous Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className={`font-medium ${activitySummary.tone}`}>{activitySummary.title}</div>
          <p className="text-muted-foreground text-sm">{activitySummary.body}</p>

          {/* Activity stats */}
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="glass-panel p-4">
              <div className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" />Last scan
              </div>
              <div className="font-medium text-sm">{formatAutonomyActivityTime(autonomyActivityQuery.data?.lastRun?.createdAt)}</div>
            </div>
            <div className="glass-panel p-4">
              <div className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
                <Zap className="w-3.5 h-3.5" />Last order
              </div>
              <div className="font-medium text-sm">{formatAutonomyActivityTime(autonomyActivityQuery.data?.lastOrder?.createdAt)}</div>
            </div>
            <div className="glass-panel p-4">
              <div className="text-xs text-muted-foreground mb-2 flex items-center gap-2">
                <Ban className="w-3.5 h-3.5" />Last block reason
              </div>
              <div className="font-medium text-sm truncate">
                {autonomyActivityQuery.data?.lastRun?.reason ?? "Not recorded yet"}
              </div>
            </div>
          </div>

          {/* Timeline of recent events */}
          {autonomyActivityQuery.data?.recentActivity && autonomyActivityQuery.data.recentActivity.length > 0 ? (
            <div className="space-y-1 pt-2">
              <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-3">
                Event Timeline
              </p>
              {autonomyActivityQuery.data.recentActivity.slice(0, 8).map((event, idx) => (
                <div key={event.id} className="flex items-center gap-3 py-2 border-b border-border/30 last:border-0">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${
                    event.eventType.includes('error') || event.eventType.includes('blocked') 
                      ? 'bg-red-400' 
                      : event.eventType.includes('executed') || event.eventType.includes('placed')
                      ? 'bg-green-400'
                      : 'bg-accent-400'
                  }`} />
                  <span className="text-sm text-foreground/80 flex-1">
                    {event.eventType.replace(/_/g, " ")}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatAutonomyActivityTime(event.createdAt)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={Activity}
              title="No activity yet"
              message="Autonomous trading events will appear here once you arm the system."
            />
          )}
        </CardContent>
      </Card>

      {/* ── Kill Switch (prominent when armed) ──────────────────────── */}
      {isArmed && (
        <Card className="glass-panel border-red-500/30 glow-destructive">
          <CardContent className="pt-6 pb-6">
            <div className="flex flex-col md:flex-row items-center md:items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-full bg-red-500/20 text-red-400 flex items-center justify-center">
                  <AlertTriangle className="w-6 h-6" />
                </div>
                <div>
                  <div className="text-lg font-bold text-foreground mb-1">Emergency Kill Switch</div>
                  <p className="text-sm text-muted-foreground">
                    Immediately disarm live trading and halt all autonomous activity.
                  </p>
                </div>
              </div>
              <Button
                size="lg"
                variant="destructive"
                disabled={isMutating}
                onClick={() => {
                  if (confirm("Emergency disarm? This will immediately stop all autonomous trading.")) {
                    activationMutation.mutate({ enabled: false });
                  }
                }}
              >
                {activationMutation.isPending ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Disarming…</>
                ) : (
                  <><Ban className="w-4 h-4 mr-2" />Kill Switch</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
