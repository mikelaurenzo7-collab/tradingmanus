import { useMemo, useState } from "react";
import { Activity, BarChart3, Loader2, ShieldAlert, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { trpc } from "@/lib/trpc";

type MarketView = "all" | "liquid" | "imbalanced";

type FeedSnapshot = {
  marketId: string;
  title?: string;
  currentSnapshot?: {
    yesPrice: number;
    noPrice: number;
    yesVolume: number;
    noVolume: number;
    impliedProbability: number;
    timestamp?: number;
  };
  priceHistory?: Array<{ impliedProbability: number; timestamp: number }>;
  volumeHistory?: Array<{ yesVolume: number; noVolume: number; timestamp: number }>;
  dataQualityScore?: number;
  status?: string;
};

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
      .filter((feed) => feed?.currentSnapshot)
      .map((feed) => {
        const snapshot = feed.currentSnapshot!;
        const totalVolume = snapshot.yesVolume + snapshot.noVolume;
        const spreadProxy = Math.abs(snapshot.yesPrice + snapshot.noPrice - 1);
        const imbalance = totalVolume > 0 ? Math.abs(snapshot.yesVolume - snapshot.noVolume) / totalVolume : 0;
        const history = feed.priceHistory ?? [];
        const oldest = history[0]?.impliedProbability ?? snapshot.impliedProbability;
        const newest = history[history.length - 1]?.impliedProbability ?? snapshot.impliedProbability;
        const momentum = newest - oldest;
        const tradabilityScore = Math.max(0, Math.min(1, totalVolume / 25000)) * 0.6 + (1 - Math.min(1, spreadProxy / 0.12)) * 0.4;

        return {
          marketId: feed.marketId,
          status: feed.status ?? "unknown",
          dataQualityScore: feed.dataQualityScore ?? 0,
          yesPrice: snapshot.yesPrice,
          noPrice: snapshot.noPrice,
          impliedProbability: snapshot.impliedProbability,
          totalVolume,
          yesVolume: snapshot.yesVolume,
          noVolume: snapshot.noVolume,
          spreadProxy,
          imbalance,
          momentum,
          tradabilityScore,
        };
      })
      .filter((row) => {
        if (activeView === "liquid") return row.totalVolume >= 1500;
        if (activeView === "imbalanced") return row.imbalance >= 0.2;
        return true;
      })
      .sort((a, b) => b.tradabilityScore - a.tradabilityScore);
  }, [activeView, feedsQuery.data]);

  const summary = useMemo(() => {
    if (rows.length === 0) {
      return {
        tracked: 0,
        avgLiquidity: 0,
        avgSpread: 0,
        avgTradability: 0,
      };
    }

    return {
      tracked: rows.length,
      avgLiquidity: rows.reduce((sum, row) => sum + row.totalVolume, 0) / rows.length,
      avgSpread: rows.reduce((sum, row) => sum + row.spreadProxy, 0) / rows.length,
      avgTradability: rows.reduce((sum, row) => sum + row.tradabilityScore, 0) / rows.length,
    };
  }, [rows]);

  const topTradable = rows.slice(0, 5);
  const topImbalanced = [...rows].sort((a, b) => b.imbalance - a.imbalance).slice(0, 5);

  if (feedsQuery.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950">
        <Loader2 className="h-8 w-8 animate-spin text-cyan-400" />
      </div>
    );
  }

  if (feedsQuery.error) {
    return (
      <div className="min-h-screen bg-slate-950 p-6">
        <Card className="mx-auto max-w-3xl border border-rose-900/50 bg-rose-950/30">
          <CardHeader>
            <CardTitle className="text-rose-300">Market Analytics Unavailable</CardTitle>
            <CardDescription className="text-rose-100/80">
              The live market-feed pipeline could not be loaded for the analytics dashboard.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-sm text-rose-100/90">{feedsQuery.error.message}</CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="mb-2 bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-4xl font-bold text-transparent">
              Market Microstructure Analytics
            </h1>
            <p className="max-w-3xl text-slate-400">
              Monitor real-time order-book proxies, liquidity depth, spread quality, and volume imbalance so execution quality
              and signal selection stay grounded in tradable conditions.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {([
              ["all", "All Feeds"],
              ["liquid", "High Liquidity"],
              ["imbalanced", "Volume Imbalance"],
            ] as const).map(([value, label]) => (
              <Button
                key={value}
                type="button"
                variant={activeView === value ? "default" : "outline"}
                onClick={() => setActiveView(value)}
                className={
                  activeView === value
                    ? "bg-gradient-to-r from-cyan-500 to-violet-500 text-white"
                    : "border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800"
                }
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                <BarChart3 className="h-5 w-5 text-cyan-400" />
                Tracked Markets
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-cyan-300">{summary.tracked}</div>
              <p className="mt-2 text-sm text-slate-500">Feeds with usable live snapshots under the selected filter.</p>
            </CardContent>
          </Card>

          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                <Waves className="h-5 w-5 text-emerald-400" />
                Average Liquidity
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-emerald-300">{formatNumber(summary.avgLiquidity)}</div>
              <p className="mt-2 text-sm text-slate-500">Combined YES and NO depth proxy from live market volume snapshots.</p>
            </CardContent>
          </Card>

          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                <Activity className="h-5 w-5 text-fuchsia-400" />
                Spread Proxy
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-fuchsia-300">{formatPercent(summary.avgSpread)}</div>
              <p className="mt-2 text-sm text-slate-500">Lower is better. Values near zero imply tighter pricing around the binary midpoint.</p>
            </CardContent>
          </Card>

          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                <ShieldAlert className="h-5 w-5 text-amber-400" />
                Tradability Score
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-3xl font-semibold text-amber-300">{formatPercent(summary.avgTradability)}</div>
              <p className="mt-2 text-sm text-slate-500">Liquidity-adjusted execution score combining depth and spread quality.</p>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader>
              <CardTitle>Order-Book and Liquidity Surface</CardTitle>
              <CardDescription>
                Use live YES/NO depth, implied probability, spread proxy, and momentum to decide which markets are actually executable.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {rows.length ? (
                rows.map((row) => {
                  const yesShare = row.totalVolume > 0 ? row.yesVolume / row.totalVolume : 0;
                  const noShare = row.totalVolume > 0 ? row.noVolume / row.totalVolume : 0;

                  return (
                    <div key={row.marketId} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                        <div>
                          <div className="text-sm font-medium text-slate-100">{row.marketId}</div>
                          <div className="mt-1 text-xs uppercase tracking-[0.2em] text-slate-500">{row.status}</div>
                        </div>
                        <div className="grid gap-3 sm:grid-cols-4">
                          <div>
                            <div className="text-xs text-slate-500">Implied Probability</div>
                            <div className="mt-1 font-semibold text-cyan-300">{formatPercent(row.impliedProbability)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">Spread Proxy</div>
                            <div className="mt-1 font-semibold text-fuchsia-300">{formatPercent(row.spreadProxy)}</div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">Momentum</div>
                            <div className={`mt-1 font-semibold ${row.momentum >= 0 ? "text-emerald-300" : "text-rose-300"}`}>
                              {row.momentum >= 0 ? "+" : ""}{formatPercent(row.momentum)}
                            </div>
                          </div>
                          <div>
                            <div className="text-xs text-slate-500">Tradability</div>
                            <div className="mt-1 font-semibold text-amber-300">{formatPercent(row.tradabilityScore)}</div>
                          </div>
                        </div>
                      </div>

                      <div className="mt-4 grid gap-4 md:grid-cols-2">
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
                            <span>Quality {(row.dataQualityScore ?? 0).toFixed(2)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-950/50 p-6 text-sm text-slate-500">
                  No live market feeds are available for the selected filter yet.
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
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
                        <div>
                          <div className="text-sm font-medium text-slate-100">{row.marketId}</div>
                          <div className="mt-1 text-xs text-slate-500">Depth {formatNumber(row.totalVolume)} · Spread {formatPercent(row.spreadProxy)}</div>
                        </div>
                        <div className="text-right text-sm font-semibold text-emerald-300">{formatPercent(row.tradabilityScore)}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-500">No markets qualify yet.</div>
                )}
              </CardContent>
            </Card>

            <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
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
                        <div>
                          <div className="text-sm font-medium text-slate-100">{row.marketId}</div>
                          <div className="mt-1 text-xs text-slate-500">YES {formatNumber(row.yesVolume)} · NO {formatNumber(row.noVolume)}</div>
                        </div>
                        <div className="text-right text-sm font-semibold text-amber-300">{formatPercent(row.imbalance)}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-slate-500">No imbalanced markets are available yet.</div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
