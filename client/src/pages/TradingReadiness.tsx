import { Loader2, ClipboardCheck, CheckCircle2, XCircle, AlertCircle, TrendingUp, TrendingDown } from "lucide-react";
import { trpc } from "@/lib/trpc";
import PaperTradingStatus from "@/components/PaperTradingStatus";
import DeskMemoryTape from "@/components/DeskMemoryTape";
import AutonomyMetrics from "@/components/AutonomyMetrics";
import PreLiveChecklist from "@/components/PreLiveChecklist";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatCard } from "@/components/widgets/StatCard";

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
        <Loader2 className="animate-spin w-8 h-8 text-primary" />
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
          iconColor="text-accent"
        />
        <EmptyState
          title="Unable to load readiness data"
          description="Please refresh the page or try again in a moment."
        />
      </div>
    );
  }

  // Determine overall readiness status
  const allItemsPassed = checklistData.checklist.every((item) => item.completed);
  const hasBlockers = checklistData.checklist.some((item) => !item.completed && item.score < 50);
  const isReady = allItemsPassed && !hasBlockers;

  return (
    <div className="space-y-6 animate-fade-in">
      <PageHeader
        icon={ClipboardCheck}
        title="Trading Readiness"
        description="Monitor your preparation for live trading"
        iconColor="text-accent"
      />

      {/* Hero Status Indicator */}
      <div className={`glass-panel p-8 text-center relative overflow-hidden ${isReady ? 'glow-success' : 'glow-destructive'}`}>
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-white/5" />
        <div className="relative z-10">
          {isReady ? (
            <>
              <CheckCircle2 className="w-16 h-16 mx-auto mb-4 text-emerald-400 animate-float" />
              <h2 className="text-5xl font-bold gradient-text mb-2">READY TO TRADE</h2>
              <p className="text-slate-300 text-lg">All systems operational. You're cleared for live trading.</p>
            </>
          ) : (
            <>
              <XCircle className="w-16 h-16 mx-auto mb-4 text-red-400 animate-pulse" />
              <h2 className="text-5xl font-bold gradient-text mb-2">BLOCKED</h2>
              <p className="text-slate-300 text-lg">
                {hasBlockers ? 'Critical issues detected. Address them before going live.' : 'Complete all checklist items to proceed.'}
              </p>
            </>
          )}
        </div>
      </div>

      {/* Readiness Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="animate-fade-in" style={{ animationDelay: '100ms' }}>
          <StatCard
            label="Paper Trades"
            value={metricsData.paperTotalTrades}
            icon={<TrendingUp className="w-5 h-5" />}
            color="#8864ff"
          />
        </div>
        <div className="animate-fade-in" style={{ animationDelay: '150ms' }}>
          <StatCard
            label="Paper Win Rate"
            value={`${metricsData.paperWinRate}%`}
            change={metricsData.paperWinRate - 50}
            icon={<TrendingUp className="w-5 h-5" />}
            color={metricsData.paperWinRate > 60 ? "#22c55e" : metricsData.paperWinRate > 50 ? "#eab308" : "#f43f5e"}
          />
        </div>
        <div className="animate-fade-in" style={{ animationDelay: '200ms' }}>
          <StatCard
            label="Paper P&L"
            value={`$${metricsData.paperTotalPnL.toFixed(2)}`}
            change={metricsData.paperTotalPnL}
            icon={metricsData.paperTotalPnL >= 0 ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
            color={metricsData.paperTotalPnL >= 0 ? "#22c55e" : "#f43f5e"}
          />
        </div>
        <div className="animate-fade-in" style={{ animationDelay: '250ms' }}>
          <StatCard
            label="Checklist Progress"
            value={`${checklistData.checklist.filter((item) => item.completed).length}/${checklistData.checklist.length}`}
            icon={<CheckCircle2 className="w-5 h-5" />}
            color={isReady ? "#22c55e" : "#8864ff"}
          />
        </div>
      </div>

      {/* Animated Checklist */}
      <div className={`glass-panel p-6 ${isReady ? 'glow-success border-emerald-500/30' : ''}`}>
        <h2 className="text-xl font-semibold mb-6 flex items-center gap-2">
          <ClipboardCheck className="w-6 h-6 text-accent" />
          <span className="gradient-text">Pre-Live Checklist</span>
        </h2>
        <div className="space-y-3">
          {checklistData.checklist.map((item, index) => {
            const Icon = item.completed ? CheckCircle2 : item.score < 50 ? XCircle : AlertCircle;
            const iconColor = item.completed ? 'text-emerald-400' : item.score < 50 ? 'text-red-400' : 'text-yellow-400';
            const glowClass = item.completed ? 'glow-success' : item.score < 50 ? 'glow-destructive' : '';
            
            return (
              <div
                key={item.id}
                className={`data-card flex items-start gap-4 p-4 animate-fade-in transition-all duration-300 ${glowClass}`}
                style={{ animationDelay: `${300 + index * 80}ms` }}
              >
                <Icon className={`w-6 h-6 ${iconColor} flex-shrink-0 mt-0.5`} />
                <div className="flex-1 min-w-0">
                  <h3 className="font-semibold text-slate-100">{item.label}</h3>
                  <p className="text-sm text-slate-400 mt-1">{item.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Paper Trading Status */}
      <PaperTradingStatus data={readinessData} />

      {/* Desk Memory Health */}
      <DeskMemoryTape deskMemoryStats={readinessData.deskMemoryStats} />

      {/* Paper vs Real Performance */}
      <div className="glass-panel p-6 space-y-4">
        <h2 className="text-xl font-semibold"><span className="gradient-text">📈 Paper vs Real Performance</span></h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="border border-border rounded-lg p-4 bg-white/5">
            <h3 className="font-semibold text-sm text-muted-foreground mb-3">
              Paper Trading
            </h3>
            <div className="space-y-2">
              <div>
                <span className="text-muted-foreground text-sm">Trades:</span>{" "}
                <span className="font-mono tabular-nums font-bold text-lg">
                  {metricsData.paperTotalTrades}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-sm">Win Rate:</span>{" "}
                <span
                  className={`font-mono tabular-nums font-bold text-lg ${
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
                  className={`font-mono tabular-nums font-bold ${
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

          <div className="border border-border rounded-lg p-4 bg-white/5">
            <h3 className="font-semibold text-sm text-muted-foreground mb-3">
              Real Trading {metricsData.realTotalTrades === 0 ? "(not started)" : ""}
            </h3>
            <div className="space-y-2">
              <div>
                <span className="text-muted-foreground text-sm">Trades:</span>{" "}
                <span className="font-mono tabular-nums font-bold text-lg">
                  {metricsData.realTotalTrades}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-sm">Win Rate:</span>{" "}
                <span className="font-mono tabular-nums font-bold text-lg text-muted-foreground">
                  {metricsData.realTotalTrades > 0 ? `${metricsData.realWinRate}%` : "—"}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground text-sm">Total P&L:</span>{" "}
                <span
                  className={`font-mono tabular-nums font-bold ${
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
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-100 p-3 rounded-lg text-sm">
            <strong>⚠️ Alert:</strong> {metricsData.comparison.alertMessage}
          </div>
        )}

        {metricsData.comparison.recommendation && (
          <div className="bg-blue-500/10 border border-blue-500/30 text-blue-100 p-3 rounded-lg text-sm">
            <strong>💡 Recommendation:</strong> {metricsData.comparison.recommendation}
          </div>
        )}
      </div>

      {/* Autonomy Metrics */}
      <AutonomyMetrics recentRuns={readinessData.recentAutonomyRuns} />
    </div>
  );
}
