import { Loader2, ClipboardCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import PaperTradingStatus from "@/components/PaperTradingStatus";
import DeskMemoryTape from "@/components/DeskMemoryTape";
import AutonomyMetrics from "@/components/AutonomyMetrics";
import PreLiveChecklist from "@/components/PreLiveChecklist";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";

export default function TradingReadiness() {
  const readinessQuery = trpc.trading.getTradingReadinessStatus.useQuery(
    undefined,
    { refetchInterval: 30000 } // Auto-refresh every 30 seconds
  );
  const metricsQuery = trpc.trading.getPaperTradingMetrics.useQuery(
    undefined,
    { refetchInterval: 30000 }
  );
  const checklistQuery = trpc.trading.getPreLiveChecklist.useQuery(
    undefined,
    { refetchInterval: 30000 }
  );

  if (readinessQuery.isLoading || metricsQuery.isLoading || checklistQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin w-8 h-8 text-violet-400" />
      </div>
    );
  }

  const readinessData = readinessQuery.data;
  const metricsData = metricsQuery.data;
  const checklistData = checklistQuery.data;

  if (!readinessData || !metricsData || !checklistData) {
    return (
      <div className="space-y-6">
        <PageHeader
          icon={ClipboardCheck}
          title="Trading Readiness"
          iconGradient="from-cyan-500 to-blue-500"
        />
        <EmptyState
          title="Unable to load readiness data"
          description="Please refresh the page or try again in a moment."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        icon={ClipboardCheck}
        title="Trading Readiness"
        description="Monitor your preparation for live trading"
        iconGradient="from-cyan-500 to-blue-500"
      />

      {/* Paper Trading Status */}
      <PaperTradingStatus data={readinessData} />

      {/* Desk Memory Health */}
      <DeskMemoryTape deskMemoryStats={readinessData.deskMemoryStats} />

      {/* Paper vs Real Performance */}
      <div className="laurenzo-card space-y-4">
        <h2 className="text-xl font-semibold">📈 Paper vs Real Performance</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border border-border rounded p-4">
            <h3 className="font-semibold text-sm text-muted-foreground mb-3">
              Paper Trading
            </h3>
            <div className="space-y-2">
              <div>
                <span className="text-muted-foreground text-sm">Trades:</span>{" "}
                <span className="font-mono font-bold text-lg">
                  {metricsData.paperTotalTrades}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-sm">Win Rate:</span>{" "}
                <span
                  className={`font-mono font-bold text-lg ${
                    metricsData.paperWinRate > 60
                      ? "text-emerald-400"
                      : metricsData.paperWinRate > 50
                        ? "text-yellow-400"
                        : "text-rose-400"
                  }`}
                >
                  {metricsData.paperWinRate}%
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-sm">Total P&L:</span>{" "}
                <span
                  className={`font-mono font-bold ${
                    metricsData.paperTotalPnL > 0
                      ? "text-emerald-400"
                      : metricsData.paperTotalPnL < 0
                        ? "text-rose-400"
                        : "text-muted-foreground"
                  }`}
                >
                  {metricsData.paperTotalPnL > 0 ? "+" : ""}
                  ${metricsData.paperTotalPnL.toFixed(2)}
                </span>
              </div>
            </div>
          </div>

          <div className="border border-border rounded p-4">
            <h3 className="font-semibold text-sm text-muted-foreground mb-3">
              Real Trading {metricsData.realTotalTrades === 0 ? "(not started)" : ""}
            </h3>
            <div className="space-y-2">
              <div>
                <span className="text-muted-foreground text-sm">Trades:</span>{" "}
                <span className="font-mono font-bold text-lg">
                  {metricsData.realTotalTrades}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-sm">Win Rate:</span>{" "}
                <span className="font-mono font-bold text-lg text-muted-foreground">
                  {metricsData.realTotalTrades > 0 ? `${metricsData.realWinRate}%` : "—"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-sm">Total P&L:</span>{" "}
                <span
                  className={`font-mono font-bold ${
                    metricsData.realTotalPnL > 0
                      ? "text-emerald-400"
                      : metricsData.realTotalPnL < 0
                        ? "text-rose-400"
                        : "text-muted-foreground"
                  }`}
                >
                  {metricsData.realTotalPnL > 0 ? "+" : ""}
                  ${metricsData.realTotalPnL.toFixed(2)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {metricsData.comparison.alertMessage && (
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-100 p-3 rounded text-sm">
            <strong>⚠️ Alert:</strong> {metricsData.comparison.alertMessage}
          </div>
        )}

        {metricsData.comparison.recommendation && (
          <div className="bg-blue-500/10 border border-blue-500/30 text-blue-100 p-3 rounded text-sm">
            <strong>💡 Recommendation:</strong> {metricsData.comparison.recommendation}
          </div>
        )}
      </div>

      {/* Autonomy Metrics */}
      <AutonomyMetrics recentRuns={readinessData.recentAutonomyRuns} />

      {/* Pre-Live Checklist */}
      <PreLiveChecklist checklist={checklistData} />
    </div>
  );
}
