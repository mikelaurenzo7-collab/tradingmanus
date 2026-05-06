import { useMemo, useState } from "react";
import { Activity, BarChart3, Gauge, Loader2, ShieldAlert, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";
import { buildLiquidityRow, type FeedSnapshot, summarizeLiquidityRows } from "@/lib/liquidityAnalytics";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/widgets/StatCard";
import { Sparkline } from "@/components/charts/Sparkline";
import { EmptyState } from "@/components/EmptyStates";

type MarketView = "all" | "liquid" | "imbalanced";

function formatPercent(value: number) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value);
}

export default function Analytics() {
  const [activeView, setActiveView] = useState<MarketView>("all");
  const feedsQuery = trpc.kalshi.getAllMarketFeeds.useQuery();

  const rows = useMemo(() => {
    const feeds = (feedsQuery.data ?? []) as FeedSnapshot[];

    return feeds
      .map((feed) => buildLiquidityRow(feed))
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter((row) => {
        if (activeView === "liquid") return row.totalVolume >= 1500;
        if (activeView === "imbalanced") return row.imbalance >= 0.2;
        return true;
      })
      .sort((a, b) => b.tradabilityScore - a.tradabilityScore);
  }, [activeView, feedsQuery.data]);

  const summary = useMemo(() => summarizeLiquidityRows(rows), [rows]);
  const topTradable = rows.slice(0, 5);
  const topImbalanced = [...rows].sort((a, b) => b.imbalance - a.imbalance).slice(0, 5);
  const topPressure = [...rows].sort((a, b) => b.microstructurePressure - a.microstructurePressure).slice(0, 5);

  if (feedsQuery.isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-accent" />
      </div>
    );
  }

  if (feedsQuery.error) {
    return (
      <Card className="mx-auto max-w-3xl border-rose-400/30 bg-rose-500/5">
        <CardHeader>
          <CardTitle className="text-rose-300">Market Analytics Unavailable</CardTitle>
          <CardDescription className="text-rose-100/80">
            The live market-feed pipeline could not be loaded for the analytics dashboard.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-rose-100/90">{feedsQuery.error.message}</CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <PageHeader
        icon={BarChart3}
        title="Market Microstructure Analytics"
        description="Monitor real-time order-book proxies, liquidity depth, spread quality, and volume imbalance so execution quality and signal selection stay grounded in tradable conditions."
        iconColor="text-accent"
        actions={
          <div className="flex flex-wrap gap-2">
            {([
              ["all", "All Feeds"],
              ["liquid", "High Liquidity"],
              ["imbalanced", "Volume Imbalance"],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                size="sm"
                variant={activeView === value ? "default" : "outline"}
                onClick={() => setActiveView(value)}
                className={
                  activeView === value
                    ? "bg-gradient-to-br from-violet-500 to-indigo-500 hover:from-violet-600 hover:to-indigo-600 text-white border-0"
                    : ""
                }
              >
                {label}
              </Button>
            ))}
          </div>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5 animate-fade-in" style={{ animationDelay: '100ms' }}>
        <StatCard
          label="Tracked Markets"
          value={summary.tracked}
          icon={<BarChart3 className="w-5 h-5" />}
          color="#06b6d4"
        />

        <StatCard
          label="Average Liquidity"
          value={formatNumber(summary.avgLiquidity)}
          icon={<Waves className="w-5 h-5" />}
          color="#10b981"
        />

        <StatCard
          label="Spread Proxy"
          value={formatPercent(summary.avgSpread)}
          icon={<Activity className="w-5 h-5" />}
          color="#d946ef"
        />

        <StatCard
          label="Tradability Score"
          value={formatPercent(summary.avgTradability)}
          icon={<ShieldAlert className="w-5 h-5" />}
          color="#f59e0b"
        />

        <StatCard
          label="Pressure Score"
          value={formatPercent(summary.avgPressure)}
          icon={<Gauge className="w-5 h-5" />}
          color="#ef4444"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr] animate-fade-in" style={{ animationDelay: '200ms' }}>
        <Card className="glass-panel border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Order-Book and Liquidity Surface</CardTitle>
            <CardDescription>
              Use live YES/NO depth, implied probability, spread proxy, momentum, and pressure to decide which markets are actually executable.
            </CardDescription>
          </CardHeader>
            <CardContent className="space-y-4">
              {rows.length ? (
                rows.map((row) => {
                  const yesShare = row.totalVolume > 0 ? row.yesVolume / row.totalVolume : 0;

                  return (
                    <div key={row.marketId} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="text-sm font-medium text-slate-100">{row.marketId}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{row.status}</div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-5">
                          <div>
                            <div className="text-xs text-slate-500">Implied Probability</div>
                            <div className="mt-1 font-semibold text-cyan-300">{formatPercent(row.impliedProbability)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">Spread Proxy</div>
                            <div className="mt-1 font-semibold text-fuchsia-300">{formatPercent(row.spreadProxy)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">Price Momentum</div>
                            <div className={`mt-1 font-semibold ${row.momentum >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                              {row.momentum >= 0 ? "+" : ""}{formatPercent(row.momentum)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">Depth Momentum</div>
                            <div className={`mt-1 font-semibold ${row.depthMomentum >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                              {row.depthMomentum >= 0 ? "+" : ""}{formatPercent(row.depthMomentum)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">Pressure</div>
                            <div className="mt-1 font-semibold text-rose-300">{formatPercent(row.microstructurePressure)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-3">
                        <div>
                          <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">Depth Split</div>
                          <div className="h-3 overflow-hidden rounded-full bg-slate-800">
                            <div className="h-full bg-gradient-to-r from-cyan-500 to-emerald-400" style={{ width: `${yesShare * 100}%` }} />
                          </div>
                          <div className="mt-2 flex justify-between text-xs text-slate-500">
                            <span>YES {formatNumber(row.yesVolume)}</span>
                            <span>NO {formatNumber(row.noVolume)}</span>
                          </div>
                        </div>

                        <div>
                          <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">Liquidity Filter</div>
                          <div className="h-3 overflow-hidden rounded-full bg-slate-800">
                            <div className="h-full bg-gradient-to-r from-violet-500 to-fuchsia-500" style={{ width: `${row.tradabilityScore * 100}%` }} />
                          </div>
                          <div className="mt-2 flex justify-between text-xs text-slate-500">
                            <span>Imbalance {formatPercent(row.imbalance)}</span>
                            <span>Quality {row.dataQualityScore.toFixed(2)}</span>
                          </div>
                        </div>

                        <div>
                          <div className="mb-2 text-xs uppercase tracking-[0.2em] text-slate-500">Execution Posture</div>
                          <div className="h-3 overflow-hidden rounded-full bg-slate-800">
                            <div className="h-full bg-gradient-to-r from-rose-500 to-amber-400" style={{ width: `${row.microstructurePressure * 100}%` }} />
                          </div>
                          <div className="mt-2 flex justify-between text-xs text-slate-500">
                            <span>Depth {formatNumber(row.totalVolume)}</span>
                            <span>Tradability {formatPercent(row.tradabilityScore)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <EmptyState
                  title="No Market Feeds"
                  message="No live market feeds are available for the selected filter yet."
                  icon={BarChart3}
                />
              )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card className="glass-panel border border-slate-800 bg-slate-900/70 backdrop-blur-xl animate-fade-in" style={{ animationDelay: '300ms' }}>
              <CardHeader>
                <CardTitle>Liquidity-Adjusted Candidates</CardTitle>
                <CardDescription>
                  Prioritize markets where momentum and sentiment can actually be executed under reasonable depth and spread conditions.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {topTradable.length ? (
                  topTradable.map((row, index) => (
                    <div key={`${row.marketId}-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-slate-100">{row.marketId}</div>
                          <div className="mt-1 text-xs text-slate-500">Depth {formatNumber(row.totalVolume)} · Spread {formatPercent(row.spreadProxy)}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Sparkline
                            data={[row.momentum, row.depthMomentum, row.tradabilityScore]}
                            width={60}
                            height={24}
                            className="text-emerald-400"
                          />
                          <div className="text-right text-sm font-semibold text-emerald-300">{formatPercent(row.tradabilityScore)}</div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="No Candidates"
                    message="No markets qualify yet."
                    icon={ShieldAlert}
                  />
                )}
              </CardContent>
            </Card>

            <Card className="glass-panel border border-slate-800 bg-slate-900/70 backdrop-blur-xl animate-fade-in" style={{ animationDelay: '400ms' }}>
              <CardHeader>
                <CardTitle>Volume Imbalance Watchlist</CardTitle>
                <CardDescription>
                  Markets with one-sided depth can move quickly and deserve more careful sizing or staggered entries.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {topImbalanced.length ? (
                  topImbalanced.map((row, index) => (
                    <div key={`${row.marketId}-imbalance-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-slate-100">{row.marketId}</div>
                          <div className="mt-1 text-xs text-slate-500">YES {formatNumber(row.yesVolume)} · NO {formatNumber(row.noVolume)}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Sparkline
                            data={[row.yesVolume, row.noVolume, row.imbalance * 1000]}
                            width={60}
                            height={24}
                            className="text-amber-400"
                          />
                          <div className="text-right text-sm font-semibold text-amber-300">{formatPercent(row.imbalance)}</div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="No Imbalanced Markets"
                    message="No imbalanced markets are available yet."
                    icon={Waves}
                  />
                )}
              </CardContent>
            </Card>

            <Card className="glass-panel border border-slate-800 bg-slate-900/70 backdrop-blur-xl animate-fade-in" style={{ animationDelay: '500ms' }}>
              <CardHeader>
                <CardTitle>Pressure Watchlist</CardTitle>
                <CardDescription>
                  Composite pressure highlights markets where depth acceleration and imbalance could degrade execution quality quickly.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {topPressure.length ? (
                  topPressure.map((row, index) => (
                    <div key={`${row.marketId}-pressure-${index}`} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex-1">
                          <div className="text-sm font-medium text-slate-100">{row.marketId}</div>
                          <div className="mt-1 text-xs text-slate-500">Momentum {formatPercent(row.momentum)} · Depth {formatPercent(row.depthMomentum)}</div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Sparkline
                            data={[row.momentum, row.depthMomentum, row.microstructurePressure]}
                            width={60}
                            height={24}
                            className="text-rose-400"
                          />
                          <div className="text-right text-sm font-semibold text-rose-300">{formatPercent(row.microstructurePressure)}</div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <EmptyState
                    title="No Pressure Outliers"
                    message="No pressure outliers are available yet."
                    icon={Gauge}
                  />
                )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
