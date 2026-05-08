import { trpc } from "@/lib/trpc";
import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Activity, AlertTriangle, CheckCircle2, Clock, Loader2, Pause, Zap } from "lucide-react";

type Activity = "booting" | "idle" | "scanning" | "evaluating" | "placing" | "syncing" | "skipped" | "blocked" | "error";

const ACTIVITY_LABELS: Record<Activity, string> = {
  booting: "Booting",
  idle: "Idle",
  scanning: "Scanning",
  evaluating: "Reviewing",
  placing: "Placing order",
  syncing: "Syncing",
  skipped: "Skipped",
  blocked: "Blocked",
  error: "Error",
};

function formatRelative(epochMs: number | null) {
  if (!epochMs) return "never";
  const delta = Math.max(0, Date.now() - epochMs);
  if (delta < 1000) return "just now";
  if (delta < 60_000) return `${Math.floor(delta / 1000)}s ago`;
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  return `${Math.floor(delta / 3_600_000)}h ago`;
}

function formatEta(etaMs: number | null) {
  if (!etaMs) return "—";
  const delta = etaMs - Date.now();
  if (delta <= 0) return "any moment";
  if (delta < 60_000) return `in ${Math.ceil(delta / 1000)}s`;
  return `in ${Math.ceil(delta / 60_000)}m`;
}

function ActivityDot({ activity }: { activity: Activity }) {
  if (activity === "scanning" || activity === "evaluating" || activity === "placing" || activity === "syncing") {
    return <Loader2 className="w-3.5 h-3.5 text-emerald-400 animate-spin" />;
  }
  if (activity === "blocked" || activity === "error") {
    return <AlertTriangle className="w-3.5 h-3.5 text-red-400" />;
  }
  if (activity === "skipped") {
    return <Pause className="w-3.5 h-3.5 text-amber-300" />;
  }
  if (activity === "idle") {
    return <CheckCircle2 className="w-3.5 h-3.5 text-emerald-300" />;
  }
  return <Clock className="w-3.5 h-3.5 text-muted-foreground" />;
}

function SchedulerRow({ name, snap }: { name: string; snap: any }) {
  const activity = (snap?.activity ?? "booting") as Activity;
  const label = ACTIVITY_LABELS[activity];
  const tel = snap?.telemetry ?? {};

  const detail = useMemo(() => {
    // snap can be undefined on the first poll (heartbeat query hasn't
    // returned yet) or when a scheduler kind is missing from the payload;
    // optional-chain every access so an undefined snapshot can't crash
    // the dashboard.
    if (activity === "blocked") return snap?.blockReason ?? "Blocked";
    if (activity === "skipped") return tel.skipReason ?? snap?.message ?? "Skipped this tick";
    if (activity === "error") return snap?.message ?? "Error — see logs";
    if (snap?.message) return snap.message;
    if (tel.ordersPlaced) return `Placed ${tel.ordersPlaced} order${tel.ordersPlaced === 1 ? "" : "s"} this tick`;
    if (tel.marketsScanned) return `Scanned ${tel.marketsScanned} markets`;
    return null;
  }, [activity, snap, tel]);

  return (
    <div className="flex items-center justify-between gap-3 py-1.5 text-xs">
      <div className="flex items-center gap-2 min-w-0">
        <ActivityDot activity={activity} />
        <span className="font-medium text-foreground/90">{name}</span>
        <span className="text-muted-foreground">·</span>
        <span className="text-foreground">{label}</span>
        {detail ? (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground truncate">{detail}</span>
          </>
        ) : null}
      </div>
      <div className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
        last {formatRelative(snap?.lastTickAt ?? null)} · next {formatEta(snap?.nextTickEta ?? null)}
      </div>
    </div>
  );
}

export function LiveHeartbeat() {
  const heartbeatQuery = trpc.kalshi.getSchedulerHeartbeat.useQuery(undefined, {
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  });

  const data = heartbeatQuery.data;
  const schedulers = data?.schedulers;

  // Roll up into a single "what is the bot doing right now" headline so the
  // user gets a one-glance answer.  Priority: error > blocked > placing >
  // evaluating > scanning > syncing > skipped > idle > booting.
  const headline = useMemo(() => {
    if (!schedulers) return { kind: "booting" as Activity, text: "Connecting to scheduler…" };
    const order: Activity[] = ["error", "blocked", "placing", "evaluating", "scanning", "syncing", "skipped", "idle", "booting"];
    // Defensively filter out null/undefined snapshots before iterating so a
    // partial heartbeat payload can't crash the whole headline memo.
    const all = (Object.values(schedulers) as Array<any | null | undefined>).filter(
      (s) => s != null,
    );
    for (const want of order) {
      const hit = all.find((s) => s?.activity === want);
      if (hit) {
        const verbose: Record<string, string> = {
          error: hit?.message ?? "A scheduler errored",
          blocked: hit?.blockReason ?? "Blocked",
          placing: hit?.message ?? "Placing an order",
          evaluating: hit?.message ?? "Reviewing signals",
          scanning: hit?.message ?? "Scanning markets",
          syncing: hit?.message ?? "Reconciling positions",
          skipped: hit?.telemetry?.skipReason ?? "Skipped this tick",
          idle: "All schedulers idle — next tick scheduled",
          booting: "Scheduler warming up",
        };
        return { kind: want, text: verbose[want] };
      }
    }
    return { kind: "booting" as Activity, text: "Initializing" };
  }, [schedulers]);

  const headlineColor = (() => {
    if (headline.kind === "error" || headline.kind === "blocked") return "text-red-400";
    if (headline.kind === "skipped") return "text-amber-300";
    if (headline.kind === "idle" || headline.kind === "booting") return "text-muted-foreground";
    return "text-emerald-300";
  })();

  return (
    <Card className="glass-panel">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Zap className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold">Live bot activity</span>
          </div>
          <Activity className={`w-4 h-4 ${headlineColor}`} />
        </div>
        <div className={`text-sm ${headlineColor}`}>{headline.text}</div>
        <div className="border-t border-border/40 pt-2 space-y-0.5">
          <SchedulerRow name="Kalshi autonomy" snap={schedulers?.autonomy_kalshi} />
          <SchedulerRow name="Order sync + exits" snap={schedulers?.order_sync} />
        </div>
      </CardContent>
    </Card>
  );
}
