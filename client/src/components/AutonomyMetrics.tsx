interface AutonomyRun {
  runId: string;
  timestamp: string;
  platform: "kalshi" | "polymarket";
  signalsGenerated: number;
  signalsApproved: number;
  ordersPlaced: number;
  ordersBlocked: number;
  totalPnL: number;
  executionStatus: "completed" | "skipped" | "error";
}

interface AutonomyMetricsProps {
  recentRuns: AutonomyRun[];
}

function getStatusColor(status: "completed" | "skipped" | "error"): string {
  if (status === "completed") return "text-emerald-400";
  if (status === "skipped") return "text-blue-400";
  return "text-rose-400";
}

function getStatusBadgeColor(status: "completed" | "skipped" | "error"): string {
  if (status === "completed") return "bg-emerald-500/20 text-emerald-400";
  if (status === "skipped") return "bg-blue-500/20 text-blue-400";
  return "bg-rose-500/20 text-rose-400";
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export default function AutonomyMetrics({ recentRuns }: AutonomyMetricsProps) {
  return (
    <div className="laurenzo-card space-y-4">
      <h2 className="text-xl font-semibold">⚙️ Autonomy Run Metrics</h2>

      {recentRuns.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          No autonomy runs recorded yet. Enable autonomy mode to begin.
        </div>
      ) : (
        <div className="space-y-3">
          {recentRuns.map((run, idx) => (
            <div
              key={run.runId || idx}
              className="border border-border rounded p-4 hover:bg-muted/30 transition-colors"
            >
              <div className="flex items-start justify-between mb-2">
                <div>
                  <p className="text-sm text-muted-foreground font-mono">
                    {run.runId || "unknown"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDate(run.timestamp)} • {run.platform.toUpperCase()}
                  </p>
                </div>
                <span
                  className={`text-xs font-bold uppercase px-2 py-1 rounded ${getStatusBadgeColor(
                    run.executionStatus
                  )}`}
                >
                  {run.executionStatus}
                </span>
              </div>

              <div className="grid grid-cols-4 gap-2 text-sm">
                <div>
                  <p className="text-muted-foreground text-xs">Signals</p>
                  <p className="font-bold">{run.signalsGenerated}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Approved</p>
                  <p className="font-bold">{run.signalsApproved}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Placed</p>
                  <p className="font-bold text-emerald-400">{run.ordersPlaced}</p>
                </div>
                <div>
                  <p className="text-muted-foreground text-xs">Blocked</p>
                  <p className="font-bold text-rose-400">{run.ordersBlocked}</p>
                </div>
              </div>

              {run.totalPnL !== 0 && (
                <div className="mt-2 pt-2 border-t border-border">
                  <span className="text-xs text-muted-foreground">P&L: </span>
                  <span
                    className={`font-bold font-mono ${
                      run.totalPnL > 0 ? "text-emerald-400" : "text-rose-400"
                    }`}
                  >
                    {run.totalPnL > 0 ? "+" : ""}${run.totalPnL.toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="bg-blue-500/10 border border-blue-500/30 text-blue-100 p-3 rounded text-sm">
        <strong>⚙️ Autonomy Runs:</strong> Shows recent scheduled trading cycles. "Completed"
        means an order was placed; "skipped" means no candidates met thresholds.
      </div>
    </div>
  );
}
