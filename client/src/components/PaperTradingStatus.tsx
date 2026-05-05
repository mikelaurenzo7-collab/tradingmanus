interface PaperTradingStatusProps {
  data: {
    paperTradeMode: boolean;
    daysInPaperMode: number;
    autonomyCyclesCompleted: number;
    recentAutonomyRuns: Array<{
      runId: string;
      timestamp: string;
      platform: "kalshi" | "polymarket";
      signalsGenerated: number;
      signalsApproved: number;
      ordersPlaced: number;
      ordersBlocked: number;
      totalPnL: number;
      executionStatus: "completed" | "skipped" | "error";
    }>;
  };
}

export default function PaperTradingStatus({ data }: PaperTradingStatusProps) {
  const latestRun = data.recentAutonomyRuns?.[0];

  return (
    <div className="laurenzo-card space-y-4">
      <h2 className="text-xl font-semibold">📊 Paper Trading Status</h2>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="border border-border rounded p-4">
          <div className="text-sm text-muted-foreground mb-1">Mode</div>
          <div className="flex items-center gap-2">
            <span
              className={`inline-block w-3 h-3 rounded-full ${
                data.paperTradeMode ? "bg-yellow-500" : "bg-red-500"
              }`}
            />
            <span className="font-semibold">
              {data.paperTradeMode ? "PAPER" : "LIVE"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground mt-2">
            {data.daysInPaperMode} days in{" "}
            {data.paperTradeMode ? "paper mode" : "live trading"}
          </div>
        </div>

        <div className="border border-border rounded p-4">
          <div className="text-sm text-muted-foreground mb-1">Autonomy Cycles</div>
          <div className="font-bold text-2xl">{data.autonomyCyclesCompleted}</div>
          <div className="text-xs text-muted-foreground mt-2">runs completed</div>
        </div>

        <div className="border border-border rounded p-4">
          <div className="text-sm text-muted-foreground mb-1">Latest Run</div>
          {latestRun ? (
            <>
              <div className="font-mono text-sm font-bold">
                {latestRun.signalsGenerated} signals
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                {latestRun.ordersPlaced} placed, {latestRun.ordersBlocked} blocked
              </div>
              <div
                className={`text-xs font-semibold mt-2 ${
                  latestRun.executionStatus === "completed"
                    ? "text-emerald-400"
                    : latestRun.executionStatus === "skipped"
                      ? "text-blue-400"
                      : "text-rose-400"
                }`}
              >
                {latestRun.executionStatus}
              </div>
            </>
          ) : (
            <div className="text-xs text-muted-foreground">No runs yet</div>
          )}
        </div>
      </div>

      <div className="bg-blue-500/10 border border-blue-500/30 text-blue-100 p-3 rounded text-sm">
        <strong>ℹ️ Paper Mode:</strong> All trades are simulated. No real capital at risk.
        Review readiness metrics before enabling live trading.
      </div>
    </div>
  );
}
