import { useState, useMemo } from "react";
import { trpc } from "@/lib/trpc";
import {
  formatAutonomyActivityTime,
  getAutonomyEventLabel,
  getAutonomyReviewSummary,
} from "@/lib/tradingAutonomy";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, ScrollText, Activity, Clock, AlertTriangle } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyStates";
import { StatCard } from "@/components/widgets/StatCard";
import { Table, Column } from "@/components/enhanced/Table";
import { TableSkeleton } from "@/components/enhanced/Skeletons";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export default function AuditLog() {
  const [eventTypeFilter, setEventTypeFilter] = useState<string>("all");
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
        <div className="grid gap-4 md:grid-cols-3">
          <StatCard label="Total Events" value="-" loading />
          <StatCard label="Critical (24h)" value="-" loading />
          <StatCard label="Last Event" value="-" loading />
        </div>
        <div className="glass-card">
          <TableSkeleton rows={10} />
        </div>
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
          message="Please refresh the page or try again in a moment."
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

  const getEventBadgeVariant = (eventType: string): "destructive" | "default" | "secondary" | "outline" => {
    if (eventType.includes("kill_switch")) return "destructive";
    if (eventType.includes("blocked") || eventType.includes("risk")) return "outline";
    if (eventType.includes("order_placed") || eventType.includes("trading")) return "default";
    return "secondary";
  };

  const getEventBadgeColor = (eventType: string): string => {
    // Order events → cyan
    if (eventType.includes("order_placed") || eventType.includes("position")) return "border-cyan-400/40 bg-cyan-500/10 text-cyan-300";
    // Risk/blocked → amber
    if (eventType.includes("blocked") || eventType.includes("risk")) return "border-amber-400/40 bg-amber-500/10 text-amber-300";
    // Kill switch/errors → red
    if (eventType.includes("kill_switch") || eventType.includes("error")) return "border-rose-400/40 bg-rose-500/10 text-rose-300";
    // Auth → violet
    if (eventType.includes("auth") || eventType.includes("login")) return "border-violet-400/40 bg-violet-500/10 text-violet-300";
    return "border-slate-400/30 bg-slate-500/10 text-slate-300";
  };

  // Calculate summary metrics
  const totalEvents = auditLog.data?.length ?? 0;
  const now = new Date();
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const criticalEvents24h = auditLog.data?.filter(
    (e: any) => 
      new Date(e.createdAt) > last24h && 
      (e.eventType.includes("kill_switch") || e.eventType.includes("blocked") || e.eventType.includes("risk"))
  ).length ?? 0;
  const lastEventTime = auditLog.data?.[0]?.createdAt 
    ? new Date(auditLog.data[0].createdAt).toLocaleString()
    : "No events yet";

  // Filter events
  const filteredEvents = useMemo(() => {
    if (!auditLog.data) return [];
    if (eventTypeFilter === "all") return auditLog.data;
    return auditLog.data.filter((e: any) => e.eventType.includes(eventTypeFilter));
  }, [auditLog.data, eventTypeFilter]);

  // Define table columns
  const columns: Column<any>[] = [
    {
      key: "eventType",
      header: "Event Type",
      sortable: true,
      render: (value: any, row: any) => (
        <Badge 
          variant={getEventBadgeVariant(row.eventType)} 
          className={`text-[10px] tracking-wide font-semibold ${getEventBadgeColor(row.eventType)}`}
        >
          {getAutonomyEventLabel(row.eventType).toUpperCase()}
        </Badge>
      ),
    },
    {
      key: "createdAt",
      header: "Time",
      sortable: true,
      render: (value: any) => (
        <span className="text-xs text-muted-foreground">
          {new Date(value).toLocaleString()}
        </span>
      ),
    },
    {
      key: "details",
      header: "Details",
      render: (value: any) => (
        <div className="text-xs text-slate-300 max-w-md truncate">
          {typeof value === "string" ? value : JSON.stringify(value)}
        </div>
      ),
    },
    {
      key: "triggeredByOpenId",
      header: "User",
      render: (value: any) => (
        value ? (
          <span className="font-mono text-xs text-muted-foreground">
            {value.substring(0, 8)}…
          </span>
        ) : null
      ),
    },
  ];

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon={ScrollText}
        title="Audit Log"
        description="Immutable event log — every trade decision, risk block, and reviewer call"
        iconGradient="from-violet-500 to-purple-500"
      />

      {/* Summary metrics */}
      <div className="grid gap-4 md:grid-cols-3 animate-fade-in" style={{ animationDelay: '100ms' }}>
        <StatCard
          label="Total Events"
          value={totalEvents}
          icon={<ScrollText className="w-5 h-5" />}
          color="#8b5cf6"
        />
        <StatCard
          label="Critical (24h)"
          value={criticalEvents24h}
          icon={<AlertTriangle className="w-5 h-5" />}
          color={criticalEvents24h > 0 ? "#ef4444" : "#10b981"}
        />
        <StatCard
          label="Last Event"
          value={lastEventTime}
          icon={<Clock className="w-5 h-5" />}
          color="#06b6d4"
        />
      </div>

      <Card className="glass-card border-emerald-400/20 bg-gradient-to-br from-emerald-500/[0.07] to-cyan-500/[0.04] backdrop-blur-sm animate-fade-in" style={{ animationDelay: '200ms' }}>
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

      {/* Filter bar */}
      <div className="glass-card p-4 animate-fade-in" style={{ animationDelay: '300ms' }}>
        <div className="flex items-center gap-4">
          <label className="text-sm font-medium text-muted-foreground">Filter by event type:</label>
          <Select value={eventTypeFilter} onValueChange={setEventTypeFilter}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="All events" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All events</SelectItem>
              <SelectItem value="order_placed">Orders placed</SelectItem>
              <SelectItem value="kill_switch">Kill switch</SelectItem>
              <SelectItem value="blocked">Blocked runs</SelectItem>
              <SelectItem value="risk">Risk events</SelectItem>
              <SelectItem value="position_close">Position closes</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Audit log table */}
      <div className="glass-card p-6 animate-fade-in" style={{ animationDelay: '400ms' }}>
        {filteredEvents.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No audit events recorded"
            message="System decisions and trading events will appear here as they happen."
          />
        ) : (
          <Table
            columns={columns}
            data={filteredEvents}
            stickyHeader
            zebraStriping
            hoverGlow
          />
        )}
      </div>
    </div>
  );
}
