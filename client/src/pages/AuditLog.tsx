import { trpc } from "@/lib/trpc";
import {
  formatAutonomyActivityTime,
  getAutonomyEventLabel,
  getAutonomyReviewSummary,
} from "@/lib/tradingAutonomy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle } from "lucide-react";

export default function AuditLog() {
  const auditLog = trpc.kalshi.getAuditLog.useQuery();
  const autonomyActivity = trpc.kalshi.getAutonomyActivity.useQuery();

  if (auditLog.isLoading || autonomyActivity.isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="mt-2 text-3xl font-bold text-cyan-400 font-mono">[ AUDIT LOG ]</h1>
          <p className="mt-2 text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (auditLog.error || autonomyActivity.error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="mt-2 text-3xl font-bold text-cyan-400 font-mono">[ AUDIT LOG ]</h1>
          <p className="mt-2 text-red-400">Error loading audit activity</p>
        </div>
      </div>
    );
  }

  const reviewSummary = getAutonomyReviewSummary(autonomyActivity.data);

  const getEventColor = (eventType: string) => {
    if (eventType.includes("kill_switch")) return "bg-red-900 text-red-200";
    if (eventType.includes("scheduled_autonomy_order_placed")) return "bg-emerald-900 text-emerald-200";
    if (eventType.includes("scheduled_autonomy_run_blocked")) return "bg-amber-900 text-amber-200";
    if (eventType.includes("scheduled_autonomy_run_generated_only")) return "bg-cyan-900 text-cyan-200";
    if (eventType.includes("scheduled_autonomy_run_skipped")) return "bg-slate-800 text-slate-200";
    if (eventType.includes("position_close")) return "bg-yellow-900 text-yellow-200";
    if (eventType.includes("strategy")) return "bg-blue-900 text-blue-200";
    if (eventType.includes("risk")) return "bg-orange-900 text-orange-200";
    return "bg-gray-900 text-gray-200";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-cyan-400 font-mono">[ AUDIT LOG ]</h1>
        <p className="mt-2 text-gray-400">
          Immutable record of all system decisions, overrides, and away-from-chat trading events
        </p>
      </div>

      <Card className="border-emerald-500/20 bg-emerald-500/5">
        <CardHeader>
          <CardTitle>Latest away-from-chat review</CardTitle>
          <CardDescription>
            Laurenzo now records whether the scheduled autonomy loop executed, generated analysis only, skipped, or was blocked.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
            <div className={`text-lg font-semibold ${reviewSummary.tone}`}>{reviewSummary.title}</div>
            <p className="mt-2 text-sm text-muted-foreground">{reviewSummary.body}</p>
            <div className="mt-4 text-xs uppercase tracking-[0.2em] text-muted-foreground">Recorded</div>
            <div className="mt-2 text-sm font-medium text-foreground">
              {formatAutonomyActivityTime(autonomyActivity.data?.lastRun?.createdAt)}
            </div>
          </div>

          <div className="rounded-2xl border border-border/60 bg-background/40 p-4">
            <div className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Recent autonomy activity</div>
            <div className="mt-3 space-y-2">
              {autonomyActivity.data?.recentActivity.slice(0, 4).map((event) => (
                <div key={event.id} className="rounded-xl border border-border/60 bg-background/50 p-3 text-sm">
                  <div className="font-medium text-foreground">{getAutonomyEventLabel(event.eventType)}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {formatAutonomyActivityTime(event.createdAt)}
                  </div>
                </div>
              ))}
              {!autonomyActivity.data?.recentActivity.length ? (
                <div className="rounded-xl border border-dashed border-border/60 p-3 text-sm text-muted-foreground">
                  No scheduled autonomy activity has been recorded yet.
                </div>
              ) : null}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-2">
        {auditLog.data?.map((event: any) => (
          <Card key={event.id} className="border-gray-800 bg-black/50">
            <CardContent className="pt-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge className={getEventColor(event.eventType)}>
                      {getAutonomyEventLabel(event.eventType).toUpperCase()}
                    </Badge>
                    <span className="text-xs text-gray-500">
                      {new Date(event.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="text-sm text-gray-300">{getAutonomyEventLabel(event.eventType)}</div>
                  {event.details && (
                    <div className="mt-2 rounded bg-black/50 p-2 font-mono text-xs text-gray-400">
                      {event.details}
                    </div>
                  )}
                </div>
                {event.triggeredByOpenId && (
                  <div className="text-right text-xs text-gray-500">
                    <div>User</div>
                    <div className="font-mono">{event.triggeredByOpenId.substring(0, 8)}...</div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        ))}

        {!auditLog.data || (auditLog.data.length === 0 && (
          <Card className="border-gray-800 bg-black/50">
            <CardContent className="pt-6">
              <div className="text-center text-gray-400">
                <AlertCircle className="mx-auto mb-2 h-8 w-8 opacity-50" />
                <p>No audit events recorded</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
