import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Eye,
  RefreshCw,
  ShieldAlert,
  TrendingDown,
  Copy,
  SkipForward,
  Network,
  Zap,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/widgets/StatCard";
import { Table, Column } from "@/components/enhanced/Table";
import { EmptyState } from "@/components/EmptyState";

const CLUSTER_COLORS: Record<number, string> = {
  1: "from-orange-500/20 to-red-500/20 border-orange-400/40",
  2: "from-yellow-500/20 to-orange-500/20 border-yellow-400/40",
  3: "from-emerald-500/20 to-teal-500/20 border-emerald-400/40",
  4: "from-pink-500/20 to-rose-500/20 border-destructive-400/40",
  5: "from-violet-500/20 to-purple-500/20 border-primary-400/40",
  6: "from-red-500/20 to-rose-600/20 border-red-400/40",
  7: "from-slate-500/20 to-slate-600/20 border-slate-400/40",
};

const STRATEGY_BADGE: Record<string, { label: string; cls: string }> = {
  fade: { label: "FADE", cls: "bg-gradient-to-r from-red-500 to-orange-500 text-white" },
  copy: { label: "COPY", cls: "bg-gradient-to-r from-emerald-500 to-teal-500 text-white" },
  warning: { label: "WARNING", cls: "bg-gradient-to-r from-pink-500 to-rose-500 text-white" },
  skip: { label: "SKIP", cls: "bg-gradient-to-r from-slate-500 to-slate-600 text-white" },
};

const ACTION_ICON: Record<string, React.ReactNode> = {
  fade_sell: <TrendingDown className="w-4 h-4 text-red-400" />,
  copy_buy: <Copy className="w-4 h-4 text-emerald-400" />,
  exit_now: <AlertTriangle className="w-4 h-4 text-yellow-400" />,
  skip_market: <SkipForward className="w-4 h-4 text-slate-400" />,
};

const ARB_TYPE_BADGE: Record<string, { label: string; cls: string }> = {
  sum_exceeds_one: { label: "OVERPRICED SUM", cls: "bg-gradient-to-r from-red-500 to-orange-500 text-white" },
  sum_below_one: { label: "UNDERPRICED SUM", cls: "bg-gradient-to-r from-emerald-500 to-cyan-500 text-white" },
  implication_violation: { label: "IMPLICATION", cls: "bg-gradient-to-r from-violet-500 to-purple-500 text-white" },
};

export default function ClusterMonitor() {
  const [showAllClusters, setShowAllClusters] = useState(false);
  const [activeTab, setActiveTab] = useState<"clusters" | "activity" | "arbitrage">("clusters");

  const clustersQuery = trpc.polymarket.getKnownClusters.useQuery();
  const activityQuery = trpc.polymarket.detectClusterActivity.useQuery(undefined, {
    refetchInterval: 60_000, // refresh every minute
  });
  const polyArbQuery = trpc.combinatorial.detectPolymarketArbitrage.useQuery(undefined, {
    refetchInterval: 120_000,
  });
  const kalshiArbQuery = trpc.combinatorial.detectKalshiArbitrage.useQuery(undefined, {
    refetchInterval: 120_000,
  });

  const handleRefreshActivity = async () => {
    try {
      await Promise.all([activityQuery.refetch(), polyArbQuery.refetch(), kalshiArbQuery.refetch()]);
      toast.success("Activity data refreshed");
    } catch {
      toast.error("Failed to refresh activity data");
    }
  };

  const clusters = clustersQuery.data ?? [];
  const visibleClusters = showAllClusters ? clusters : clusters.slice(0, 4);

  const activity = activityQuery.data;
  const polyArb = polyArbQuery.data?.opportunities ?? [];
  const kalshiArb = kalshiArbQuery.data?.opportunities ?? [];
  const allArb = [...polyArb.map((o: any) => ({ ...o, platform: "Polymarket" })), ...kalshiArb.map((o: any) => ({ ...o, platform: "Kalshi" }))];

  const clusterSignals = activity?.clusterSignals ?? [];
  const recommendations = activity?.recommendations ?? [];
  const actionableRecs = recommendations.filter((r: any) => r.action !== "skip_market");
  const warnings = recommendations.filter((r: any) => r.action === "skip_market");

  return (
    <div className="space-y-8">
      <PageHeader
        icon={Network}
        title="Cluster Monitor"
        description="Wash-trading detection and cluster analysis · Fade strategies · Combinatorial arbitrage"
        iconColor="text-destructive"
        actions={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-sm text-slate-400">
              <div className="live-dot" />
              <span>Real-time monitoring</span>
            </div>
            <Button onClick={handleRefreshActivity} variant="outline" size="sm" className="gap-2">
              <RefreshCw className={`w-4 h-4 ${activityQuery.isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        }
      />

      <p className="text-xs text-muted-foreground -mt-4 animate-fade-in">
        Based on Columbia University "Network-Based Detection of Wash Trading" (SSRN, Nov 2025)
      </p>

      {/* Tab navigation */}
      <div className="flex gap-2 border-b border-slate-700/50 pb-2">
        {(["clusters", "activity", "arbitrage"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-t-lg text-sm font-semibold capitalize transition-colors ${
              activeTab === tab
                ? "bg-primary-500/20 text-violet-300 border border-primary-400/40 border-b-0"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {tab === "clusters" && <span>Known Clusters</span>}
            {tab === "activity" && (
              <span className="flex items-center gap-1">
                Live Activity
                {clusterSignals.length > 0 && (
                  <span className="bg-red-500 text-white text-xs px-1.5 rounded-full">{clusterSignals.length}</span>
                )}
              </span>
            )}
            {tab === "arbitrage" && (
              <span className="flex items-center gap-1">
                Arbitrage
                {allArb.length > 0 && (
                  <span className="bg-emerald-500 text-white text-xs px-1.5 rounded-full">{allArb.length}</span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── CLUSTERS TAB ── */}
      {activeTab === "clusters" && (
        <div className="space-y-6 animate-fade-in">
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Total Clusters" value={clusters.length} color="#64748b" />
            <StatCard 
              label="High Risk" 
              value={clusters.filter((c: any) => c.strategy === 'fade' || c.strategy === 'warning').length} 
              color="#ef4444" 
            />
            <StatCard 
              label="Flagged Markets" 
              value={clusters.reduce((sum: number, c: any) => sum + (c.marketCategories?.length ?? 0), 0)} 
              color="#fbbf24" 
            />
            <div className="data-card glass-panel">
              <div className="flex items-start justify-between mb-4">
                <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: '#10b98120' }}>
                  <Eye className="w-5 h-5 text-emerald-400" />
                </div>
                <div className="live-dot" />
              </div>
              <div className="text-3xl font-bold tracking-tight mb-3 text-slate-100">
                {clustersQuery.isFetching ? "..." : "Active"}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-400">Last Scan</span>
              </div>
            </div>
          </div>

          <p className="text-slate-400 text-sm">
            Seven documented wash-trading clusters on Polymarket. Cluster strategies: <strong className="text-red-400">Fade</strong> (pump then retrace), <strong className="text-emerald-400">Copy</strong> (mirror entries), <strong className="stat-decrease">Warning</strong> (skip market), <strong className="text-slate-400">Skip</strong> (legitimate actors).
          </p>
          <div className="grid md:grid-cols-2 gap-4">
            {visibleClusters.map((c: any) => {
              const badge = STRATEGY_BADGE[c.strategy] ?? STRATEGY_BADGE.skip!;
              const colors = CLUSTER_COLORS[c.id] ?? CLUSTER_COLORS[7]!;
              const isHighSeverity = c.strategy === 'fade' || c.strategy === 'warning';
              return (
                <Card key={c.id} className={`data-card glass-panel border bg-gradient-to-br ${colors} backdrop-blur-xl ${isHighSeverity ? 'glow-destructive' : ''} animate-fade-in`} style={{ animationDelay: `${visibleClusters.indexOf(c) * 50}ms` }}>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg bg-slate-900/50 flex items-center justify-center text-sm font-bold text-slate-300">
                          #{c.id}
                        </div>
                        <CardTitle className="text-base text-slate-100">{c.name}</CardTitle>
                      </div>
                      <Badge className={`${badge.cls} px-2 py-0.5 text-xs`}>{badge.label}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <p className="text-sm text-slate-300 leading-relaxed">{c.description}</p>
                    <div className="flex flex-wrap gap-2 text-xs">
                      {c.weekendBiased && (
                        <span className="bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-full border border-yellow-500/30">
                          Weekend active
                        </span>
                      )}
                      {c.shortWindow && (
                        <span className="bg-accent-500/20 text-cyan-300 px-2 py-0.5 rounded-full border border-accent-500/30">
                          ≤ 5-min markets
                        </span>
                      )}
                      {c.marketCategories.map((cat: string) => (
                        <span key={cat} className="bg-slate-700/50 text-slate-300 px-2 py-0.5 rounded-full border border-slate-600/50 capitalize">
                          {cat}
                        </span>
                      ))}
                    </div>
                    {c.walletAddresses.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-xs text-slate-500 font-semibold">KNOWN WALLETS</p>
                        {c.walletAddresses.map((addr: string) => (
                          <p key={addr} className="text-xs font-mono text-slate-400 bg-slate-900/40 px-2 py-1 rounded truncate">
                            {addr}
                          </p>
                        ))}
                      </div>
                    )}
                    <div className="text-xs text-slate-400">
                      Entry range: {c.entryPriceRangeCents[0]}–{c.entryPriceRangeCents[1]}¢
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
          {clusters.length > 4 && (
            <Button
              variant="ghost"
              onClick={() => setShowAllClusters(!showAllClusters)}
              className="text-slate-400 hover:text-slate-200 gap-2"
            >
              {showAllClusters ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {showAllClusters ? "Show fewer" : `Show all ${clusters.length} clusters`}
            </Button>
          )}
        </div>
      )}

      {/* ── ACTIVITY TAB ── */}
      {activeTab === "activity" && (
        <div className="space-y-6 animate-fade-in">
          {/* Summary stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Markets Scanned" value={activity?.marketsScanned ?? 0} color="#06b6d4" />
            <StatCard label="Cluster Signals" value={clusterSignals.length} color="#fbbf24" />
            <StatCard label="Actionable Trades" value={actionableRecs.length} color="#10b981" />
            <StatCard label="Volume Warnings" value={warnings.length} color="#ec4899" />
          </div>

          {/* Actionable recommendations */}
          {actionableRecs.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <Zap className="w-5 h-5 text-yellow-400" />
                <h2 className="text-xl font-bold gradient-text">ACTIONABLE SIGNALS</h2>
              </div>
              {actionableRecs.map((rec: any, idx: number) => (
                <Card key={`${rec.marketId}-${idx}`} className="data-card glass-panel glow-primary border-slate-700/50 animate-fade-in" style={{ animationDelay: `${idx * 75}ms` }}>
                  <CardContent className="pt-4">
                    <div className="flex items-start justify-between gap-4 flex-wrap">
                      <div className="flex items-center gap-3">
                        {ACTION_ICON[rec.action]}
                        <div>
                          <p className="font-semibold text-slate-100">{rec.action.replace(/_/g, " ").toUpperCase()}</p>
                          <p className="text-sm text-slate-400 mt-0.5 truncate max-w-md">{rec.question}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Badge className={`${rec.side === "yes" ? "bg-accent-500/20 text-cyan-300 border-accent-500/40" : "bg-destructive-500/20 text-pink-300 border-destructive-500/40"} border px-2 py-0.5 text-xs`}>
                          {rec.side.toUpperCase()}
                        </Badge>
                        {rec.suggestedLimitPrice > 0 && (
                          <span className="text-sm font-mono text-slate-200">
                            @ {(rec.suggestedLimitPrice * 100).toFixed(1)}¢
                          </span>
                        )}
                        <span className="text-xs text-slate-400">
                          {(rec.confidence * 100).toFixed(0)}% conf
                        </span>
                      </div>
                    </div>
                    <p className="text-sm text-slate-400 mt-3 bg-slate-900/40 p-3 rounded-lg border border-slate-700/50">
                      {rec.reasoning}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Volume warnings */}
          {warnings.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 stat-decrease" />
                <h2 className="text-xl font-bold text-pink-300">VOLUME WARNINGS</h2>
              </div>
              {warnings.map((rec: any, idx: number) => (
                <Card key={`warn-${rec.marketId}-${idx}`} className="data-card glass-panel glow-destructive border-destructive-400/30 animate-fade-in" style={{ animationDelay: `${idx * 75}ms` }}>
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="w-5 h-5 stat-decrease flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="font-semibold text-pink-200">Skip Market – Fake Volume</p>
                        <p className="text-sm text-slate-400 mt-0.5 truncate max-w-md">{rec.question}</p>
                        <p className="text-sm text-slate-400 mt-2">{rec.reasoning}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* No activity */}
          {clusterSignals.length === 0 && !activityQuery.isFetching && (
            <EmptyState
              icon={Eye}
              title="No cluster activity detected"
              description="No wash-trading cluster patterns matched current market conditions. The monitor refreshes every 60 seconds."
              iconGradient="from-slate-500/20 to-slate-600/20"
            />
          )}
        </div>
      )}

      {/* ── ARBITRAGE TAB ── */}
      {activeTab === "arbitrage" && (
        <div className="space-y-6 animate-fade-in">
          <div className="space-y-2">
            <p className="text-slate-400 text-sm">
              Cross-market combinatorial arbitrage. Detects when related YES/NO markets violate logical constraints (sum ≠ $1) or implication rules.
              Based on arXiv:2508.03474 — $39.7M extracted from Polymarket in 12 months via these methods.
            </p>
          </div>

          {allArb.length === 0 && !polyArbQuery.isFetching && !kalshiArbQuery.isFetching && (
            <EmptyState
              icon={Network}
              title="No combinatorial arbitrage found"
              description="Markets appear to be correctly priced relative to each other. The scanner refreshes every 2 minutes."
              iconGradient="from-emerald-500/20 to-teal-500/20"
            />
          )}

          {allArb.map((opp: any, idx: number) => {
            const typeBadge = ARB_TYPE_BADGE[opp.type] ?? ARB_TYPE_BADGE.sum_exceeds_one!;
            return (
              <Card key={idx} className="data-card glass-panel glow-primary border-emerald-400/30 animate-fade-in" style={{ animationDelay: `${idx * 100}ms` }}>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div className="flex items-center gap-3">
                      <Network className="w-5 h-5 text-emerald-400" />
                      <div>
                        <CardTitle className="text-base text-emerald-200">
                          {opp.platform} · {(opp.guaranteedProfit * 100).toFixed(1)}¢ guaranteed profit
                        </CardTitle>
                        <CardDescription className="text-slate-400 mt-0.5">
                          {opp.markets.length} related markets · {(opp.impliedProbabilitySum * 100).toFixed(1)}¢ sum
                        </CardDescription>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge className={`${typeBadge.cls} px-2 py-0.5 text-xs`}>{typeBadge.label}</Badge>
                      <Badge variant="outline" className="border-emerald-400/50 text-emerald-300 text-xs">
                        {(opp.confidence * 100).toFixed(0)}% conf
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Trades */}
                  <div className="grid md:grid-cols-2 gap-3">
                    {opp.trades.map((trade: any, ti: number) => (
                      <div key={ti} className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50 space-y-1">
                        <p className="text-xs text-slate-400 font-semibold uppercase tracking-wide">Trade {ti + 1}</p>
                        <p className="text-sm text-slate-200 truncate">{trade.title}</p>
                        <div className="flex items-center gap-2">
                          <Badge className={`${trade.side === "yes" ? "bg-accent-500/20 text-cyan-300 border-accent-500/40" : "bg-destructive-500/20 text-pink-300 border-destructive-500/40"} border text-xs px-2 py-0.5`}>
                            {trade.side.toUpperCase()}
                          </Badge>
                          <span className="text-sm font-mono text-slate-200">
                            @ {(trade.currentPrice * 100).toFixed(1)}¢
                          </span>
                          <span className="text-xs text-emerald-400">
                            +{(trade.expectedProfitPerDollar * 100).toFixed(1)}% EV
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  <p className="text-sm text-slate-400 bg-slate-900/40 p-3 rounded-lg border border-slate-700/50">
                    {opp.reasoning}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
