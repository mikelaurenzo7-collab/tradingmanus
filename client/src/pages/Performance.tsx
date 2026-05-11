import { trpc } from "@/lib/trpc";
import {
  formatCurrency,
  formatPercent,
  summarizeLearningMetrics,
} from "@/lib/riskPerformanceDiagnostics";
import { BarChart3, TrendingUp, TrendingDown, Target, Clock, Activity, DollarSign } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/widgets/StatCard";
import { PerformanceChart } from "@/components/charts/PerformanceChart";
import { DistributionChart } from "@/components/charts/DistributionChart";
import { HeatmapChart } from "@/components/charts/HeatmapChart";
import { DashboardSkeleton } from "@/components/enhanced/Skeletons";
import { ErrorState } from "@/components/EmptyStates";
import { Button } from "@/components/ui/button";
import { useState, useMemo } from "react";

type TimeRange = '1D' | '1W' | '1M' | '3M' | '1Y' | 'All';

export default function Performance() {
  const [timeRange, setTimeRange] = useState<TimeRange>('All');
  
  const performanceOverviewQuery = trpc.kalshi.getPerformanceOverview.useQuery();
  const expertMetricsQuery = trpc.kalshi.getExpertPerformance.useQuery();
  const attributionQuery = trpc.kalshi.getAttributionAnalysis.useQuery({ limit: 250 });

  const equityCurveDays = useMemo<number>(() => {
    switch (timeRange) {
      case '1D': return 7; // server minimum is 7d
      case '1W': return 7;
      case '1M': return 30;
      case '3M': return 90;
      case '1Y': return 365;
      default: return 365;
    }
  }, [timeRange]);
  const equityCurveQuery = trpc.kalshi.getEquityCurve.useQuery({ days: equityCurveDays });
  const activityHeatmapQuery = trpc.kalshi.getActivityHeatmap.useQuery({ days: 90 });

  const performanceOverview = performanceOverviewQuery.data;
  const performanceMetrics = performanceOverview?.metrics;
  const signalPerformance = performanceOverview?.signalPerformance ?? [];
  const hasTradeHistory = (performanceMetrics?.totalTrades ?? 0) > 0;

  // Calculate return percentage
  const returnPercent = useMemo(() => {
    if (!performanceOverview || performanceOverview.startingBalance === 0) return 0;
    return ((performanceMetrics?.totalPnL ?? 0) / performanceOverview.startingBalance) * 100;
  }, [performanceOverview, performanceMetrics]);

  // Real equity curve from closed-position history + live current balance.
  const equityCurveData = useMemo(() => {
    return equityCurveQuery.data?.points ?? [];
  }, [equityCurveQuery.data]);
  const equityCurveHasHistory = equityCurveQuery.data?.hasHistory ?? false;

  // Build distribution chart data from signal performance
  const distributionData = useMemo(() => {
    if (signalPerformance.length === 0) return [];
    return signalPerformance.map((perf) => ({
      label: perf.signalType.replaceAll('_', ' '),
      value: perf.successRate * 100,
      color: perf.totalPnL >= 0 ? '#86efac' : '#f87171',
    }));
  }, [signalPerformance]);

  // Real activity heatmap derived from order placement history (UTC).
  const heatmapRows = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const heatmapCols = Array.from({ length: 24 }, (_, i) => i);
  const heatmapData = useMemo(() => {
    const buckets = activityHeatmapQuery.data?.buckets ?? [];
    const counts = new Map<string, number>();
    for (const b of buckets) {
      counts.set(`${b.dow}:${b.hour}`, b.count);
    }
    const data: Array<{ row: string | number; col: string | number; value: number }> = [];
    for (let dow = 0; dow < heatmapRows.length; dow++) {
      for (const hour of heatmapCols) {
        data.push({
          row: heatmapRows[dow],
          col: hour,
          value: counts.get(`${dow}:${hour}`) ?? 0,
        });
      }
    }
    return data;
  }, [activityHeatmapQuery.data]);
  const heatmapHasActivity = (activityHeatmapQuery.data?.buckets?.length ?? 0) > 0;

  const attributionBreakdownData = useMemo(() => {
    const totals = attributionQuery.data?.totals;
    if (!totals) return [];

    return [
      { label: 'Signal Alpha', value: totals.signalAlpha, color: '#34d399' },
      { label: 'Execution', value: totals.execution, color: '#60a5fa' },
      { label: 'Timing', value: totals.timing, color: '#fbbf24' },
      { label: 'Luck', value: totals.luck, color: '#f87171' },
    ];
  }, [attributionQuery.data]);

  const sharpeSourceData = useMemo(() => {
    const sharpeBySource = attributionQuery.data?.sharpeBySource;
    if (!sharpeBySource) return [];

    return [
      { label: 'Signal Alpha', value: sharpeBySource.signalAlpha, color: '#34d399' },
      { label: 'Execution', value: sharpeBySource.execution, color: '#60a5fa' },
      { label: 'Timing', value: sharpeBySource.timing, color: '#fbbf24' },
      { label: 'Luck', value: sharpeBySource.luck, color: '#f87171' },
    ];
  }, [attributionQuery.data]);

  const losingPatterns = attributionQuery.data?.losingPatterns ?? [];

  if (performanceOverviewQuery.isLoading) {
    return <DashboardSkeleton />;
  }

  if (performanceOverviewQuery.isError) {
    return (
      <div className="space-y-8 max-w-7xl mx-auto">
        <PageHeader
          icon={BarChart3}
          title="Performance Metrics"
          description="Track trading quality, capital attribution, and signal-learning posture from real Kalshi activity."
          iconColor="text-success"
        />
        <div className="glass-panel p-8">
          <ErrorState
            error="Failed to load performance metrics"
            onRetry={() => performanceOverviewQuery.refetch()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto animate-fade-in">
      <PageHeader
        icon={BarChart3}
        title="Performance Metrics"
        description="Track trading quality, capital attribution, and signal-learning posture from real Kalshi activity."
        iconColor="text-success"
      />

      {/* Stat Cards Grid — 6 key metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard
          label="Return"
          value={`${returnPercent >= 0 ? '+' : ''}${returnPercent.toFixed(2)}%`}
          icon={returnPercent >= 0 ? <TrendingUp size={20} /> : <TrendingDown size={20} />}
          color={returnPercent >= 0 ? '#86efac' : '#f87171'}
          change={returnPercent}
        />
        
        <StatCard
          label="Win Rate"
          value={formatPercent(performanceMetrics?.winRate ?? 0)}
          icon={<Target size={20} />}
          color="#a78bfa"
        />
        
        <StatCard
          label="Sharpe Ratio"
          value={performanceMetrics?.sharpeRatio?.toFixed(2) ?? '0.00'}
          icon={<Activity size={20} />}
          color="#60a5fa"
        />
        
        <StatCard
          label="Max Drawdown"
          value={formatPercent(performanceMetrics?.maxDrawdown ?? 0)}
          icon={<TrendingDown size={20} />}
          color="#f87171"
        />
        
        <StatCard
          label="Avg Hold Time"
          value="—"
          subtitle="not yet tracked"
          icon={<Clock size={20} />}
          color="#fbbf24"
        />
        
        <StatCard
          label="Total Trades"
          value={performanceMetrics?.totalTrades ?? 0}
          icon={<DollarSign size={20} />}
          color="#34d399"
        />
      </div>

      {/* Time Range Selector */}
      <div className="flex gap-2 items-center justify-end">
        {(['1D', '1W', '1M', '3M', '1Y', 'All'] as TimeRange[]).map((range) => (
          <Button
            key={range}
            variant={timeRange === range ? 'default' : 'ghost'}
            size="sm"
            onClick={() => setTimeRange(range)}
            className={timeRange === range ? 'bg-primary/20 glow-primary' : ''}
          >
            {range}
          </Button>
        ))}
      </div>

      {/* Equity Curve Chart — Full Width */}
      {equityCurveData.length > 0 && (
        <div className="glass-panel p-6 glow-subtle">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Equity Curve</h3>
            {!equityCurveHasHistory && (
              <span className="text-xs text-muted-foreground">
                No closed trades yet — showing current balance only
              </span>
            )}
          </div>
          <PerformanceChart
            data={equityCurveData}
            series={[{ key: 'equity', name: 'Account Balance', color: '#8b5cf6' }]}
            height={350}
            areaShading
            formatY={(v: number) => formatCurrency(v)}
            formatX={(v: string | number) => {
              const d = new Date(v);
              return `${d.getMonth() + 1}/${d.getDate()}`;
            }}
          />
        </div>
      )}

      {/* Distribution Chart — Signal Type Win Rates */}
      {distributionData.length > 0 && (
        <div className="glass-panel p-6 glow-subtle">
          <h3 className="text-lg font-semibold mb-4 text-foreground">Strategy Win Rate Distribution</h3>
          <DistributionChart
            data={distributionData}
            formatValue={(v: number) => `${v.toFixed(1)}%`}
            colorByIndex={false}
          />
        </div>
      )}

      {/* Heatmap Chart — Activity Tracking (real order placement times, UTC) */}
      <div className="glass-panel p-6 glow-subtle">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Trading Activity Heatmap</h3>
          <span className="text-xs text-muted-foreground">
            {heatmapHasActivity
              ? 'Order placements over the last 90 days (UTC)'
              : 'No order activity yet in the last 90 days'}
          </span>
        </div>
      <HeatmapChart
          data={heatmapData}
          rows={heatmapRows}
          cols={heatmapCols}
          height={280}
          formatValue={(v: number) => `${v} order${v === 1 ? '' : 's'}`}
          colorScale="purple-coral"
          showValues={false}
        />
      </div>

      {/* Institutional/Expert Performance Section */}
      {expertMetricsQuery.isSuccess && (
        <div className="grid gap-6 md:grid-cols-2">
          <div className="glass-panel p-6 glow-primary">
            <div className="flex items-center gap-2 mb-4">
              <Activity className="text-primary" size={20} />
              <h3 className="text-lg font-semibold text-foreground">Risk-Adjusted Alpha</h3>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Sortino</div>
                <div className="text-2xl font-mono text-success">{expertMetricsQuery.data.financial.sortinoRatio.toFixed(2)}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Calmar</div>
                <div className="text-2xl font-mono text-primary">{expertMetricsQuery.data.financial.calmarRatio.toFixed(2)}</div>
              </div>
              <div className="space-y-1">
                <div className="text-xs text-muted-foreground uppercase tracking-wider">Brier Score</div>
                <div className="text-2xl font-mono text-warning">{expertMetricsQuery.data.calibration.brierScore.toFixed(3)}</div>
              </div>
            </div>
            <div className="mt-6 p-3 rounded-lg bg-primary/5 border border-primary/10">
              <div className="flex justify-between items-center mb-1">
                <span className="text-xs font-medium text-muted-foreground">Kelly Compliance</span>
                <span className="text-xs font-mono text-primary">{formatPercent(expertMetricsQuery.data.risk.kellyComplianceRate)}</span>
              </div>
              <div className="h-1.5 w-full bg-primary/10 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-primary glow-primary" 
                  style={{ width: `${expertMetricsQuery.data.risk.kellyComplianceRate * 100}%` }}
                />
              </div>
            </div>
          </div>

          <div className="glass-panel p-6 border-success/20">
            <div className="flex items-center gap-2 mb-4">
              <Target className="text-success" size={20} />
              <h3 className="text-lg font-semibold text-foreground">Operational Integrity</h3>
            </div>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Avg Signal Latency</span>
                <span className="text-sm font-medium text-foreground">{expertMetricsQuery.data.operational.avgLatencyMs}ms</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">API Success Rate</span>
                <span className="text-sm font-medium text-success">{formatPercent(expertMetricsQuery.data.operational.apiSuccessRate)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Confidence Alignment</span>
                <span className="text-sm font-medium text-primary">{expertMetricsQuery.data.calibration.confidenceAlignment.toFixed(2)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-muted-foreground">Drift Threshold</span>
                <span className="text-sm font-medium text-warning">+{expertMetricsQuery.data.calibration.expectedValueDrift.toFixed(3)} EV</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Attribution Charts */}
      {attributionQuery.isError && (
        <div className="glass-panel p-6">
          <ErrorState
            error="Failed to load attribution analysis"
            onRetry={() => attributionQuery.refetch()}
          />
        </div>
      )}

      {attributionQuery.isSuccess && attributionBreakdownData.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          <div className="glass-panel p-6 glow-subtle">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-foreground">P&L Attribution Breakdown</h3>
              <span className="text-xs text-muted-foreground">
                {attributionQuery.data.count} records
              </span>
            </div>
            <DistributionChart
              data={attributionBreakdownData}
              formatValue={(v: number) => formatCurrency(v)}
              colorByIndex={false}
            />
          </div>

          <div className="glass-panel p-6 glow-subtle">
            <h3 className="text-lg font-semibold mb-4 text-foreground">Sharpe by Attribution Source</h3>
            <DistributionChart
              data={sharpeSourceData}
              formatValue={(v: number) => v.toFixed(2)}
              colorByIndex={false}
            />
          </div>
        </div>
      )}

      {attributionQuery.isSuccess && losingPatterns.length > 0 && (
        <div className="glass-panel p-6 glow-subtle">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-foreground">Losing Patterns</h3>
            <span className="text-xs text-muted-foreground">Most negative average P&L buckets</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {losingPatterns.slice(0, 6).map((pattern) => (
              <div
                key={`${pattern.signalType}-${pattern.category}`}
                className="rounded-xl border border-red-400/20 bg-red-500/5 px-4 py-3"
              >
                <div className="text-sm font-medium text-foreground">
                  {pattern.signalType.replaceAll('_', ' ')}
                </div>
                <div className="text-xs text-muted-foreground">{pattern.category}</div>
                <div className="mt-2 text-sm text-red-300">
                  Avg P&L: {formatCurrency(pattern.avgPnl)}
                </div>
                <div className="text-xs text-muted-foreground">Trades: {pattern.trades}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
