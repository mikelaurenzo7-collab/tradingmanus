import { trpc } from "@/lib/trpc";
import {
  formatAutonomyActivityTime,
  getAutonomyEventLabel,
  getAutonomyReviewSummary,
} from "@/lib/tradingAutonomy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ScrollText, Activity } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";

export default function AuditLog() {
  const auditLog = trpc.kalshi.getAuditLog.useQuery();
  const autonomyActivity = trpc.kalshi.getAutonomyActivity.useQuery();

  if (auditLog.isLoading || autonomyActivity.isLoading) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={ScrollText}
          title="Audit Log"
          description="Loading audit activity…"
        />
      </div>
    );
  }

  if (auditLog.error || autonomyActivity.error) {
    return (
      <div className="space-y-6">
        <PageHeader icon={ScrollText} title="Audit Log" />
        <EmptyState
          icon={AlertCircle}
          title="Error loading audit activity"
          description="Please refresh the page or try again in a moment."
          iconGradient="from-rose-500/20 to-pink-500/20"
        />
      </div>
    );
  }

  const reviewSummary = getAutonomyReviewSummary(autonomyActivity.data);

  const getEventColor = (eventType: string) => {
    if (eventType.includes("kill_switch")) return "border-rose-400/40 bg-rose-500/10 text-rose-300";
    if (eventType.includes("scheduled_autonomy_order_placed")) return "border-emerald-400/40 bg-emerald-500/10 text-emerald-300";
    if (eventType.includes("scheduled_autonomy_run_blocked")) return "border-amber-400/40 bg-amber-500/10 text-amber-300";
    if (eventType.includes("scheduled_autonomy_run_generated_only")) return "border-cyan-400/40 bg-cyan-500/10 text-cyan-300";
    if (eventType.includes("scheduled_autonomy_run_skipped")) return "border-slate-400/30 bg-slate-500/10 text-slate-300";
    if (eventType.includes("position_close")) return "border-yellow-400/40 bg-yellow-500/10 text-yellow-300";
    if (eventType.includes("strategy")) return "border-blue-400/40 bg-blue-500/10 text-blue-300";
    if (eventType.includes("risk")) return "border-orange-400/40 bg-orange-500/10 text-orange-300";
    return "border-white/10 bg-white/5 text-slate-300";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ScrollText}
        title="Audit Log"
        description="Immutable record of all system decisions, overrides, and away-from-chat trading events"
      />

      <Card className="border-emerald-400/20 bg-gradient-to-br from-emerald-500/[0.07] to-cyan-500/[0.04] backdrop-blur-sm">
        <CardHeader className="pb-3">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-500 shadow-md">
              <Activity className="w-4 h-4 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg">Latest away-from-chat review</CardTitle>
              <CardDescription className="text-xs mt-0.5">
                The system records whether the scheduled autonomy loop executed, generated analysis only, skipped, or was blocked.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className={`text-lg font-semibold ${reviewSummary.tone}`}>{reviewSummary.title}</div>
            <p className="mt-2 text-sm text-muted-foreground leading-relaxed">{reviewSummary.body}</p>
            <div className="mt-4 text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">Recorded</div>
            <div className="mt-1.5 text-sm font-medium text-foreground">
              {formatAutonomyActivityTime(autonomyActivity.data?.lastRun?.createdAt)}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground font-semibold">Recent autonomy activity</div>
            <div className="mt-3 space-y-2">
              {autonomyActivity.data?.recentActivity.slice(0, 4).map((event) => (
                <div key={event.id} className="rounded-xl border border-white/10 bg-white/[0.02] p-3 text-sm hover:border-white/20 transition-colors">
                  <div className="font-medium text-foreground">{getAutonomyEventLabel(event.eventType)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatAutonomyActivityTime(event.createdAt)}
                  </div>
                  {event.details?.reconciliationStatus === "pending" ? (
                    <div className="mt-2 text-xs font-medium text-amber-300">
                      Needs reconciliation: {String(event.details?.reconciliationReason ?? "local ledger follow-up required")}
                    </div>
                  ) : null}
                </div>
              ))}
              {!autonomyActivity.data?.recentActivity.length ? (
                <div className="rounded-xl border border-dashed border-white/10 p-3 text-sm text-muted-foreground">
                  No scheduled autonomy activity has been recorded yet.
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {auditLog.data?.map((event: any) => (
          <Card
            key={event.id}
            className="border-white/10 bg-white/[0.02] backdrop-blur-sm hover:border-white/20 transition-colors"
          >
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant="outline" className={`${getEventColor(event.eventType)} text-[10px] tracking-wide`}>
                      {getAutonomyEventLabel(event.eventType).toUpperCase()}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm text-slate-300">{getAutonomyEventLabel(event.eventType)}</div>
                  {event.details && (
                    <div className="mt-2 rounded-lg bg-black/30 border border-white/5 p-2.5 font-mono text-xs text-muted-foreground overflow-x-auto">
                      {typeof event.details === "string"
                        ? event.details
                        : JSON.stringify(event.details, null, 2)}
                    </div>
                  )}
                </div>
                {event.triggeredByOpenId && (
                  <div className="text-right text-xs text-muted-foreground shrink-0">
                    <div className="uppercase tracking-wider font-semibold">User</div>
                    <div className="font-mono mt-0.5">{event.triggeredByOpenId.substring(0, 8)}…</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {!auditLog.data || auditLog.data.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit events recorded"
            description="System decisions and trading events will appear here as they happen."
          />
        ) : null}
      </div>
    </div>
  );
}
