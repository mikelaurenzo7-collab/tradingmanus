/**
 * Strategies — Kalshi-only post-pivot view.
 *
 * The cross-platform / Polymarket / cross-bot panels were removed. What
 * remains is a curated list of Kalshi-only edge strategies + the
 * combinatorial-arbitrage scanner that already lived under the
 * `combinatorial` tRPC router.
 */

import { useState } from "react";
import { trpc } from "@/lib/trpc";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Zap,
  TrendingUp,
  ArrowLeftRight,
  Loader2,
  BarChart3,
  Layers,
  GitMerge,
  Sparkles,
  InboxIcon,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/widgets/StatCard";
import { EnhancedTable, type Column } from "@/components/enhanced/Table";
import { TableSkeleton } from "@/components/enhanced/Skeletons";
import { EmptyState } from "@/components/EmptyStates";

// ── Strategy catalog (Kalshi-only) ──────────────────────────────────────────
const KALSHI_STRATEGIES = [
  {
    id: "kalshi_mm",
    name: "Market Making",
    shortName: "MM",
    description:
      "Two-sided Avellaneda-Stoikov quoting across 50–200 markets. Captures bid/ask spread + maker rebates with inventory skewing.",
    winRate: "78–88%",
    monthlyReturn: "1–3%",
    risk: "Low",
    capital: "$10k+",
    icon: <ArrowLeftRight className="w-5 h-5 text-accent" />,
    color: "from-cyan-500/20 to-teal-500/20 border-accent-400/30",
    badge: "STABLE",
    badgeColor: "bg-accent-500/20 text-cyan-300 border-accent-400/30",
  },
  {
    id: "kalshi_combo_arb",
    name: "Combinatorial Arbitrage",
    shortName: "COMBO",
    description:
      "Detect inconsistent pricing across binary contracts that must sum to 1. Closes risk-free spread opportunities on overlapping events.",
    winRate: "80–95%",
    monthlyReturn: "1–3%",
    risk: "Very Low",
    capital: "$2k+",
    icon: <GitMerge className="w-5 h-5 text-emerald-400" />,
    color: "from-emerald-500/20 to-teal-500/20 border-emerald-400/30",
    badge: "RISK-FREE",
    badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-400/30",
  },
  {
    id: "kalshi_event",
    name: "Scheduled-Event Trading",
    shortName: "EVENT",
    description:
      "Pre-position around scheduled releases (CPI, NFP, FOMC). Tighter resolution rules + clear catalyst windows = the highest-edge desk.",
    winRate: "65–75%",
    monthlyReturn: "3–8%",
    risk: "Medium",
    capital: "$1k+",
    icon: <Sparkles className="w-5 h-5 text-amber-400" />,
    color: "from-amber-500/20 to-orange-500/20 border-amber-400/30",
    badge: "TIER 2",
    badgeColor: "bg-amber-500/20 text-amber-300 border-amber-400/30",
  },
  {
    id: "kalshi_weather",
    name: "Weather Markets",
    shortName: "WX",
    description:
      "GFS/ECMWF ensemble forecast skill vs implied probability. The cleanest edge on the platform — the highest-priority desk.",
    winRate: "70–80%",
    monthlyReturn: "3–10%",
    risk: "Low",
    capital: "$500+",
    icon: <Layers className="w-5 h-5 text-sky-400" />,
    color: "from-sky-500/20 to-cyan-500/20 border-sky-400/30",
    badge: "TIER 1",
    badgeColor: "bg-sky-500/20 text-sky-300 border-sky-400/30",
  },
];

// ── Combinatorial-arb live scan ─────────────────────────────────────────────
type CombinatorialOpp = {
  marketIds: string[];
  marketTitles: string[];
  category: string;
  expectedYesNoSum: number;
  observedYesNoSum: number;
  violation: number;
  netEdge: number;
  liquidity: number;
  description: string;
};

function CombinatorialScanner() {
  const [filter, setFilter] = useState<"all" | "high">("all");

  const arbQuery = trpc.combinatorial.detectKalshiArbitrage.useQuery(
    undefined,
    { refetchInterval: 60_000 },
  );

  const ops = (arbQuery.data?.opportunities ?? []) as unknown as CombinatorialOpp[];
  const filtered = ops.filter((o) =>
    filter === "high" ? o.netEdge >= 0.05 : true,
  );

  const columns: Column<CombinatorialOpp>[] = [
    {
      key: "category",
      header: "Category",
      render: (_value, o) => (
        <Badge variant="outline" className="capitalize">
          {o.category}
        </Badge>
      ),
    },
    {
      key: "marketTitles",
      header: "Markets",
      render: (_value, o) => (
        <div className="text-xs space-y-1">
          {o.marketTitles.slice(0, 3).map((t: string, i: number) => (
            <div key={i} className="truncate max-w-[280px]">
              {t}
            </div>
          ))}
          {o.marketTitles.length > 3 && (
            <div className="text-muted-foreground">
              +{o.marketTitles.length - 3} more
            </div>
          )}
        </div>
      ),
    },
    {
      key: "violation",
      header: "Violation",
      render: (_value, o) => (
        <span className="font-mono">{(o.violation * 100).toFixed(1)}%</span>
      ),
    },
    {
      key: "netEdge",
      header: "Net Edge",
      render: (_value, o) => (
        <span className="font-mono text-emerald-400">
          {(o.netEdge * 100).toFixed(2)}%
        </span>
      ),
    },
    {
      key: "liquidity",
      header: "Liquidity",
      render: (_value, o) => (
        <span className="font-mono">${o.liquidity.toLocaleString()}</span>
      ),
    },
  ];

  return (
    <Card className="glass-panel">
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <GitMerge className="w-5 h-5 text-emerald-400" /> Combinatorial
              Arbitrage Scan
            </CardTitle>
            <CardDescription>
              Live scan across Kalshi binary contracts where YES + NO {">>"} 1.
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant={filter === "all" ? "default" : "outline"}
              onClick={() => setFilter("all")}
            >
              All
            </Button>
            <Button
              size="sm"
              variant={filter === "high" ? "default" : "outline"}
              onClick={() => setFilter("high")}
            >
              ≥ 5% edge
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {arbQuery.isLoading ? (
          <TableSkeleton />
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={InboxIcon}
            title="No arbitrage opportunities right now"
            message="The combinatorial scanner found no markets violating the YES + NO constraint enough to clear the net-edge floor."
          />
        ) : (
          <EnhancedTable data={filtered} columns={columns} />
        )}
      </CardContent>
    </Card>
  );
}

// ── Page ────────────────────────────────────────────────────────────────────
export default function Strategies() {
  return (
    <div className="space-y-6 px-6 py-6">
      <PageHeader
        icon={Zap}
        title="Strategies"
        description="Curated Kalshi edge strategies + live combinatorial-arb scanner."
        iconColor="text-primary"
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {KALSHI_STRATEGIES.map((s) => (
          <Card
            key={s.id}
            className={`glass-panel border-l-4 bg-gradient-to-br ${s.color}`}
          >
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                {s.icon}
                <Badge className={s.badgeColor} variant="outline">
                  {s.badge}
                </Badge>
              </div>
              <CardTitle className="text-base mt-2">{s.name}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-xs">
              <p className="text-muted-foreground">{s.description}</p>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <StatCard
                  label="Win rate"
                  value={s.winRate}
                  icon={<TrendingUp className="h-3.5 w-3.5" />}
                />
                <StatCard
                  label="Mo return"
                  value={s.monthlyReturn}
                  icon={<BarChart3 className="h-3.5 w-3.5" />}
                />
                <StatCard
                  label="Risk"
                  value={s.risk}
                  icon={<Loader2 className="h-3.5 w-3.5" />}
                />
                <StatCard
                  label="Capital"
                  value={s.capital}
                  icon={<Sparkles className="h-3.5 w-3.5" />}
                />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <CombinatorialScanner />
    </div>
  );
}
