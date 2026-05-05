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

  const performanceOverview = performanceOverviewQuery.data;
  const performanceMetrics = performanceOverview?.metrics;
  const signalPerformance = performanceOverview?.signalPerformance ?? [];
  const hasTradeHistory = (performanceMetrics?.totalTrades ?? 0) > 0;

  // Calculate return percentage
  const returnPercent = useMemo(() => {
    if (!performanceOverview || performanceOverview.startingBalance === 0) return 0;
    return ((performanceMetrics?.totalPnL ?? 0) / performanceOverview.startingBalance) * 100;
  }, [performanceOverview, performanceMetrics]);

  // Build equity curve data (mock demonstration — replace with real historical data when available)
  const equityCurveData = useMemo(() => {
    if (!performanceOverview) return [];
    const startBal = performanceOverview.startingBalance;
    const currentBal = performanceOverview.currentBalance;
    const totalPnL = performanceMetrics?.totalPnL ?? 0;

    // Generate a simple 30-day mock curve for visualization
    const data = [];
    const days = 30;
    for (let i = 0; i <= days; i++) {
      const progress = i / days;
      const equity = startBal + (totalPnL * progress);
      data.push({
        date: new Date(Date.now() - (days - i) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        equity: equity,
      });
    }
    return data;
  }, [performanceOverview, performanceMetrics]);

  // Build distribution chart data from signal performance
  const distributionData = useMemo(() => {
    if (signalPerformance.length === 0) return [];
    return signalPerformance.map((perf) => ({
      label: perf.signalType.replaceAll('_', ' '),
      value: perf.successRate * 100,
      color: perf.totalPnL >= 0 ? '#86efac' : '#f87171',
    }));
  }, [signalPerformance]);

  // Build heatmap data for activity tracking (MOCK DATA — replace when real activity tracking is available)
  const heatmapData = useMemo(() => {
    // Demo data: day-of-week x hour-of-day activity
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const hours = Array.from({ length: 24 }, (_, i) => i);
    const data: Array<{ row: string | number; col: string | number; value: number }> = [];
    
    for (const day of days) {
      for (const hour of hours) {
        // Simulate higher activity during market hours (9-16) on weekdays
        let value = Math.random() * 20;
        if (['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(day) && hour >= 9 && hour <= 16) {
          value += Math.random() * 30;
        }
        data.push({ row: day, col: hour, value: Math.round(value) });
      }
    }
    return data;
  }, []);

  const heatmapRows = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const heatmapCols = Array.from({ length: 24 }, (_, i) => i);

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
          iconGradient="from-emerald-500 to-cyan-500"
        />
        <div className="glass-card p-8">
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
        iconGradient="from-emerald-500 to-cyan-500"
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
        <div className="glass-card p-6 glow-subtle">
          <h3 className="text-lg font-semibold mb-4 text-foreground">Equity Curve</h3>
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
        <div className="glass-card p-6 glow-subtle">
          <h3 className="text-lg font-semibold mb-4 text-foreground">Strategy Win Rate Distribution</h3>
          <DistributionChart
            data={distributionData}
            formatValue={(v: number) => `${v.toFixed(1)}%`}
            colorByIndex={false}
          />
        </div>
      )}

      {/* Heatmap Chart — Activity Tracking (Demo Data) */}
      <div className="glass-card p-6 glow-subtle">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-foreground">Trading Activity Heatmap</h3>
          <span className="text-xs text-muted-foreground">Demo data — activity tracking coming soon</span>
        </div>
        <HeatmapChart
          data={heatmapData}
          rows={heatmapRows}
          cols={heatmapCols}
          height={280}
          formatValue={(v: number) => `${v} signals`}
          colorScale="purple-coral"
          showValues={false}
        />
      </div>
    </div>
  );
}
