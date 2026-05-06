import { useState } from "react";
import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Zap,
  TrendingUp,
  TrendingDown,
  ArrowLeftRight,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  BarChart3,
  Network,
  Bot,
  Target,
  Activity,
  Layers,
  GitMerge,
  Sparkles,
  InboxIcon,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatCard } from "@/components/widgets/StatCard";
import { EnhancedTable, type Column } from "@/components/enhanced/Table";
import { TableSkeleton } from "@/components/enhanced/Skeletons";
import { EmptyState } from "@/components/EmptyStates";

// ----------- Strategy metadata -----------

const KALSHI_STRATEGIES = [
  {
    id: "kalshi_mm",
    name: "Market Making",
    shortName: "MM",
    description:
      "Two-sided Avellaneda-Stoikov quoting across 50-200 markets. Captures bid/ask spread + maker rebates with inventory skewing.",
    winRate: "78–88%",
    monthlyReturn: "1–3%",
    risk: "Low",
    capital: "$10k+",
    icon: <ArrowLeftRight className="w-5 h-5 text-cyan-400" />,
    color: "from-cyan-500/20 to-teal-500/20 border-cyan-400/30",
    badge: "STABLE",
    badgeColor: "bg-cyan-500/20 text-cyan-300 border-cyan-400/30",
  },
  {
    id: "kalshi_cross_arb",
    name: "Cross-Platform Arbitrage",
    shortName: "XARB",
    description:
      "Scan Kalshi ↔ Polymarket for identical events priced differently. Consistent 1.5–4.5% spreads on matched macros and sports.",
    winRate: "85–95%",
    monthlyReturn: "2–6%",
    risk: "Very Low",
    capital: "$5k–$50k+",
    icon: <Network className="w-5 h-5 text-emerald-400" />,
    color: "from-emerald-500/20 to-teal-500/20 border-emerald-400/30",
    badge: "NEAR RISK-FREE",
    badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-400/30",
  },
  {
    id: "kalshi_momentum",
    name: "Catalyst / Momentum",
    shortName: "MOM",
    description:
      "Real-time sports data alpha: ingest injury reports, live scores, and offshore lines faster than the market. Trade the probability shift.",
    winRate: "65–78%",
    monthlyReturn: "4–9%",
    risk: "Medium",
    capital: "$10k+",
    icon: <Zap className="w-5 h-5 text-yellow-400" />,
    color: "from-yellow-500/20 to-orange-500/20 border-yellow-400/30",
    badge: "SPORTS ALPHA",
    badgeColor: "bg-yellow-500/20 text-yellow-300 border-yellow-400/30",
  },
  {
    id: "kalshi_statistical",
    name: "Statistical Arbitrage",
    shortName: "STAT",
    description:
      "ML models vs market prices on macro indicators (CPI, TSA data). Trade mispricings >3–5% that crowd consensus misses.",
    winRate: "70–82%",
    monthlyReturn: "3–7%",
    risk: "Low-Med",
    capital: "$10k+",
    icon: <BarChart3 className="w-5 h-5 text-violet-400" />,
    color: "from-violet-500/20 to-purple-500/20 border-violet-400/30",
    badge: "MODEL EDGE",
    badgeColor: "bg-violet-500/20 text-violet-300 border-violet-400/30",
  },
  {
    id: "kalshi_correlation",
    name: "Logical / Correlation Arb",
    shortName: "CORR",
    description:
      "Graph-based dependency mapping across Kalshi contracts. Exploit probability violations (e.g. P(A) > P(B) when A implies B).",
    winRate: "72–85%",
    monthlyReturn: "2–5%",
    risk: "Low",
    capital: "$10k+",
    icon: <Target className="w-5 h-5 text-pink-400" />,
    color: "from-pink-500/20 to-rose-500/20 border-pink-400/30",
    badge: "MATH EDGE",
    badgeColor: "bg-pink-500/20 text-pink-300 border-pink-400/30",
  },
];

const POLYMARKET_STRATEGIES = [
  {
    id: "poly_mm",
    name: "Market Making",
    shortName: "MM",
    description:
      "Avellaneda-Stoikov log-odds quoting on CLOBv2. Post bid/ask around fair value with inventory skewing. Earn spread + maker rebates.",
    winRate: "78–85%",
    monthlyReturn: "1–3%",
    risk: "Low",
    capital: "$10k+",
    icon: <ArrowLeftRight className="w-5 h-5 text-cyan-400" />,
    color: "from-cyan-500/20 to-teal-500/20 border-cyan-400/30",
    badge: "STABLE",
    badgeColor: "bg-cyan-500/20 text-cyan-300 border-cyan-400/30",
  },
  {
    id: "poly_arb",
    name: "Intra + Cross-Platform Arb",
    shortName: "ARB",
    description:
      "YES+NO < $1 detection for guaranteed risk-free profit, NegRisk bundle hedging, and Polymarket ↔ Kalshi cross-platform spreads.",
    winRate: "85–95%",
    monthlyReturn: "2–6%",
    risk: "Very Low",
    capital: "$5k–$50k+",
    icon: <Network className="w-5 h-5 text-emerald-400" />,
    color: "from-emerald-500/20 to-teal-500/20 border-emerald-400/30",
    badge: "NEAR RISK-FREE",
    badgeColor: "bg-emerald-500/20 text-emerald-300 border-emerald-400/30",
  },
  {
    id: "poly_ai_arb",
    name: "AI Probability Arbitrage",
    shortName: "AI",
    description:
      "Ensemble LLMs + real-time news detect 15%+ probability shifts before the crowd prices them in. Kelly-sized entries, exit on convergence.",
    winRate: "65–75%",
    monthlyReturn: "3–8%",
    risk: "Medium",
    capital: "$10k+",
    icon: <Bot className="w-5 h-5 text-violet-400" />,
    color: "from-violet-500/20 to-purple-500/20 border-violet-400/30",
    badge: "AI EDGE",
    badgeColor: "bg-violet-500/20 text-violet-300 border-violet-400/30",
  },
  {
    id: "poly_correlation",
    name: "Correlation Arbitrage",
    shortName: "CORR",
    description:
      "Graph-based mapping of logically linked CLOB markets. Trade probability violations >3% post-fees in politics, finance, and sports.",
    winRate: "70–80%",
    monthlyReturn: "2–5%",
    risk: "Low-Med",
    capital: "$10k+",
    icon: <Target className="w-5 h-5 text-pink-400" />,
    color: "from-pink-500/20 to-rose-500/20 border-pink-400/30",
    badge: "MATH EDGE",
    badgeColor: "bg-pink-500/20 text-pink-300 border-pink-400/30",
  },
  {
    id: "poly_momentum",
    name: "Momentum / HFT",
    shortName: "MOM",
    description:
      "Sub-100ms execution on Chainlink feed lags, volume spikes, and order flow. 2–120 min momentum holds with trailing exits.",
    winRate: "60–70%",
    monthlyReturn: "8–15%",
    risk: "High",
    capital: "$20k+",
    icon: <Activity className="w-5 h-5 text-orange-400" />,
    color: "from-orange-500/20 to-red-500/20 border-orange-400/30",
    badge: "HIGH ALPHA",
    badgeColor: "bg-orange-500/20 text-orange-300 border-orange-400/30",
  },
];

// ----------- Risk badge colour -----------

function riskColor(risk: string) {
  if (risk.includes("Very Low")) return "text-emerald-400";
  if (risk.includes("Low")) return "text-cyan-400";
  if (risk.includes("Med")) return "text-yellow-400";
  if (risk.includes("High")) return "text-red-400";
  return "text-slate-400";
}

// ----------- Strategy card -----------

function StrategyCard({ strategy }: { strategy: (typeof KALSHI_STRATEGIES)[number] }) {
  return (
    <Card
      className={`laurenzo-card glass-card border bg-gradient-to-br ${strategy.color} backdrop-blur-xl transition-all duration-300`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-black/20 backdrop-blur">{strategy.icon}</div>
            <div>
              <CardTitle className="text-base font-bold text-foreground">
                {strategy.name}
              </CardTitle>
              <Badge
                variant="outline"
                className={`text-[10px] mt-1 px-2 py-0 ${strategy.badgeColor}`}
              >
                {strategy.badge}
              </Badge>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <CardDescription className="text-sm text-slate-300 leading-relaxed">
          {strategy.description}
        </CardDescription>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="glass-card bg-black/20 rounded-lg p-2">
            <div className="text-slate-400 mb-0.5 font-semibold tracking-wide">WIN RATE</div>
            <div className="text-emerald-300 font-bold font-mono tabular-nums">{strategy.winRate}</div>
          </div>
          <div className="glass-card bg-black/20 rounded-lg p-2">
            <div className="text-slate-400 mb-0.5 font-semibold tracking-wide">MONTHLY</div>
            <div className="text-cyan-300 font-bold font-mono tabular-nums">{strategy.monthlyReturn}</div>
          </div>
          <div className="glass-card bg-black/20 rounded-lg p-2">
            <div className="text-slate-400 mb-0.5 font-semibold tracking-wide">RISK</div>
            <div className={`font-bold ${riskColor(strategy.risk)}`}>{strategy.risk}</div>
          </div>
          <div className="glass-card bg-black/20 rounded-lg p-2">
            <div className="text-slate-400 mb-0.5 font-semibold tracking-wide">CAPITAL</div>
            <div className="text-slate-300 font-bold font-mono tabular-nums">{strategy.capital}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------- Live data panels -----------

interface CrossArbOpportunity {
  kalshiTitle: string;
  kalshiMarketId: string;
  polymarketMarketId: string;
  kalshiYesPrice: number;
  polymarketYesPrice: number;
  buyPlatform: string;
  sellPlatform: string;
  netEdge: number;
  confidence: number;
  minLiquidity: number;
}

function CrossPlatformArbPanel() {
  const arbQuery = trpc.combinatorial.detectCrossPlatformArbitrage.useQuery(undefined, {
    refetchInterval: 120_000,
  });

  const opportunities = arbQuery.data?.opportunities ?? [];
  const topOpps = opportunities.slice(0, 5);

  const columns: Column<CrossArbOpportunity>[] = [
    {
      key: 'kalshiTitle',
      header: 'Event',
      render: (val) => (
        <span className="font-semibold text-emerald-300 text-xs">
          {String(val).slice(0, 50)}…
        </span>
      ),
    },
    {
      key: 'buyPlatform',
      header: 'Trade',
      render: (_, row) => {
        const buyPrice = row.buyPlatform === "kalshi" ? row.kalshiYesPrice : row.polymarketYesPrice;
        const sellPrice = row.sellPlatform === "kalshi" ? row.kalshiYesPrice : row.polymarketYesPrice;
        return (
          <span className="text-slate-400 text-xs">
            Buy {row.buyPlatform.toUpperCase()} @ {buyPrice.toFixed(2)} · Sell {row.sellPlatform.toUpperCase()} @ {sellPrice.toFixed(2)}
          </span>
        );
      },
    },
    {
      key: 'netEdge',
      header: 'Net Edge',
      render: (val) => (
        <Badge variant="outline" className="text-[10px] border-emerald-400/30 text-emerald-300 font-mono tabular-nums">
          +{(Number(val) * 100).toFixed(1)}pp
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-bold text-foreground">Live Cross-Platform Arb</span>
          {arbQuery.isFetching && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
        </div>
        <span className="text-xs text-slate-500">
          {arbQuery.data
            ? `${arbQuery.data.kalshiMarketsScanned}K + ${arbQuery.data.polymarketMarketsScanned}P scanned`
            : ""}
        </span>
      </div>

      {arbQuery.isLoading ? (
        <TableSkeleton rows={3} />
      ) : topOpps.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="No opportunities"
          message="No cross-platform arbitrage opportunities detected above threshold right now."
        />
      ) : (
        <EnhancedTable
          columns={columns}
          data={topOpps}
          className="text-xs"
          hoverGlow={true}
        />
      )}
    </div>
  );
}

interface YesNoMispricing {
  question: string;
  yesPrice: number;
  noPrice: number;
  priceSum: number;
  guaranteedProfitPct: number;
}

function YesNoMispricePanel() {
  const mispriceQuery = trpc.polymarket.detectYesNoMispricings.useQuery(undefined, {
    refetchInterval: 120_000,
  });

  const mispricings = mispriceQuery.data?.mispricings ?? [];
  const top = mispricings.slice(0, 4);

  const columns: Column<YesNoMispricing>[] = [
    {
      key: 'question',
      header: 'Market',
      render: (val) => (
        <span className="font-semibold text-cyan-300 text-xs">
          {String(val).slice(0, 45)}…
        </span>
      ),
    },
    {
      key: 'priceSum',
      header: 'Prices',
      render: (_, row) => (
        <span className="text-slate-400 text-xs font-mono tabular-nums">
          YES {row.yesPrice.toFixed(3)} + NO {row.noPrice.toFixed(3)} = {row.priceSum.toFixed(3)}
        </span>
      ),
    },
    {
      key: 'guaranteedProfitPct',
      header: 'Profit',
      render: (val) => (
        <Badge variant="outline" className="text-[10px] border-cyan-400/30 text-cyan-300 font-mono tabular-nums">
          +{(Number(val) * 100).toFixed(1)}%
        </Badge>
      ),
    },
  ];

  return (
    <div className="space-y-4 animate-fade-in" style={{ animationDelay: '100ms' }}>
      <div className="flex items-center gap-2">
        <TrendingDown className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-bold text-foreground">YES+NO Mispricings</span>
        {mispriceQuery.isFetching && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
      </div>

      {mispriceQuery.isLoading ? (
        <TableSkeleton rows={3} />
      ) : top.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="No mispricings"
          message="No YES+NO sum < $1 opportunities detected right now."
        />
      ) : (
        <EnhancedTable
          columns={columns}
          data={top}
          className="text-xs"
          hoverGlow={true}
        />
      )}
    </div>
  );
}

function PolymarketAutonomyPanel() {
  const [isRunning, setIsRunning] = useState(false);
  const runAutonomy = trpc.polymarket.runAutonomousTrading.useMutation();
  const accountStatus = trpc.polymarket.getPolymarketAccountStatus.useQuery();

  const handleRun = async () => {
    setIsRunning(true);
    try {
      const result = await runAutonomy.mutateAsync();
      if (result.status === "executed") {
        toast.success(
          `Order placed: ${result.executedSide?.toUpperCase()} on market ${result.executedMarketId?.slice(0, 12)}…`,
        );
      } else if (result.status === "skipped") {
        toast.info(`Skipped: ${result.reason}`);
      } else if (result.status === "blocked") {
        toast.warning(`Blocked: ${result.reason}`);
      } else if (result.status === "generated_only") {
        toast.success(
          `Signals generated (${result.signalsGenerated}); no order placed — confidence or cadence gate.`,
        );
      } else {
        toast.error(`Error: ${result.reason}`);
      }
    } catch (err) {
      toast.error("Failed to run Polymarket autonomy");
    } finally {
      setIsRunning(false);
    }
  };

  const connected = accountStatus.data?.connected === true;

  return (
    <div className="space-y-4 animate-fade-in" style={{ animationDelay: '200ms' }}>
      <div className="flex items-center gap-2">
        <Bot className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-bold text-foreground">Polymarket Bot — Manual Trigger</span>
      </div>

      <div className="text-xs text-slate-400 leading-relaxed glass-card p-3">
        Runs one autonomous trading cycle: fetches live markets, generates signals, applies risk
        guardrails, and places the highest-scoring order (when live trading is armed).
      </div>

      <div className={`flex items-center gap-2 px-3 py-2 rounded-lg ${connected ? 'bg-emerald-500/10 border border-emerald-400/20' : 'bg-yellow-500/10 border border-yellow-400/20'}`}>
        {connected ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        ) : (
          <AlertTriangle className="w-4 h-4 text-yellow-400" />
        )}
        <span className={`text-xs ${connected ? "text-emerald-300" : "text-yellow-300"}`}>
          {connected ? "Polymarket account connected" : "Connect a Polymarket account first"}
        </span>
      </div>

      <Button
        className="w-full laurenzo-button text-sm"
        onClick={handleRun}
        disabled={isRunning || !connected}
      >
        {isRunning ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Running…
          </>
        ) : (
          <>
            <Zap className="w-4 h-4 mr-2" />
            Run Polymarket Autonomy
          </>
        )}
      </Button>
    </div>
  );
}

// ----------- Cross-Bot panels -----------

interface CombinedSignal {
  platform: string;
  marketId: string;
  question: string;
  side: string;
  convictionScore: number;
  reasoning: string;
  consensusPartner?: {
    platform: string;
    signalType: string;
    confidence: number;
  };
}

function CombinedSignalsPanel() {
  const [isRunning, setIsRunning] = useState(false);
  const combinedMutation = trpc.crossBot.getCombinedSignals.useMutation();

  const handleFetch = async () => {
    setIsRunning(true);
    try {
      const result = await combinedMutation.mutateAsync({
        minConfidence: 0.5,
        limit: 30,
      });
      if (result.success) {
        toast.success(
          `Found ${result.signals.length} signals (${result.consensusCount} consensus across bots)`,
        );
      } else {
        toast.error(result.error ?? "Failed to fetch combined signals");
      }
    } catch {
      toast.error("Could not fetch combined signals");
    } finally {
      setIsRunning(false);
    }
  };

  const signals = combinedMutation.data?.signals ?? [];
  const topSignals = signals.slice(0, 8);

  const columns: Column<CombinedSignal>[] = [
    {
      key: 'platform',
      header: 'Platform',
      render: (val, row) => (
        <div className="flex items-center gap-1.5">
          <Badge
            variant="outline"
            className={`text-[10px] shrink-0 ${
              String(val) === "kalshi"
                ? "border-cyan-400/30 text-cyan-300"
                : "border-violet-400/30 text-violet-300"
            }`}
          >
            {String(val).toUpperCase()}
          </Badge>
          {row.consensusPartner && (
            <Badge
              variant="outline"
              className="text-[10px] shrink-0 border-emerald-400/30 text-emerald-300"
            >
              CONSENSUS ✓
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'question',
      header: 'Event',
      render: (val) => (
        <span className="text-foreground font-semibold text-xs">
          {String(val).length > 50 ? String(val).slice(0, 50) + "…" : String(val)}
        </span>
      ),
    },
    {
      key: 'side',
      header: 'Side',
      render: (val, row) => (
        <div className="flex items-center gap-1">
          <Badge
            variant="outline"
            className={`text-[10px] ${
              String(val) === "yes"
                ? "border-emerald-400/30 text-emerald-300"
                : "border-red-400/30 text-red-300"
            }`}
          >
            {String(val).toUpperCase()}
          </Badge>
          <span className="text-slate-300 font-bold font-mono tabular-nums text-xs">
            {(row.convictionScore * 100).toFixed(0)}%
          </span>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <GitMerge className="w-4 h-4 text-violet-400" />
          <span className="text-sm font-bold text-foreground">Unified Signal View</span>
        </div>
        <Button
          size="sm"
          className="laurenzo-button text-xs"
          onClick={handleFetch}
          disabled={isRunning}
        >
          {isRunning ? (
            <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Scanning…</>
          ) : (
            <><Zap className="w-3 h-3 mr-1" />Scan Both Bots</>
          )}
        </Button>
      </div>

      {combinedMutation.data && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Kalshi", count: combinedMutation.data.kalshiCount, color: "from-cyan-500/20 to-teal-500/20 border-cyan-400/30" },
            { label: "Polymarket", count: combinedMutation.data.polymarketCount, color: "from-violet-500/20 to-purple-500/20 border-violet-400/30" },
            {
              label: "Consensus",
              count: combinedMutation.data.consensusCount,
              color: "from-emerald-500/20 to-teal-500/20 border-emerald-400/30",
            },
          ].map((item) => (
            <div key={item.label} className={`glass-card border bg-gradient-to-br ${item.color} p-3 text-center`}>
              <div className="text-lg font-bold font-mono tabular-nums text-foreground">{item.count}</div>
              <div className="text-slate-400 text-xs">{item.label}</div>
            </div>
          ))}
        </div>
      )}

      {topSignals.length === 0 && !combinedMutation.isPending ? (
        <EmptyState
          icon={InboxIcon}
          title="No signals"
          message='Click "Scan Both Bots" to fetch live signals from Kalshi and Polymarket.'
        />
      ) : combinedMutation.isPending ? (
        <TableSkeleton rows={4} />
      ) : (
        <EnhancedTable
          columns={columns}
          data={topSignals}
          className="text-xs"
          hoverGlow={true}
          onRowClick={(row) => {
            // Show reasoning in a toast when clicked
            toast.info(row.reasoning, { duration: 6000 });
          }}
        />
      )}
    </div>
  );
}

function CrossArbExecutionPanel() {
  const arbQuery = trpc.combinatorial.detectCrossPlatformArbitrage.useQuery(undefined, {
    refetchInterval: 120_000,
  });
  const executeArb = trpc.crossBot.executeCrossArb.useMutation();
  const [executing, setExecuting] = useState<string | null>(null);

  const opportunities = (arbQuery.data?.opportunities ?? []).slice(0, 5);

  const handleExecute = async (opp: (typeof opportunities)[number]) => {
    const key = `${opp.kalshiMarketId}-${opp.polymarketMarketId}`;
    setExecuting(key);
    try {
      const result = await executeArb.mutateAsync({
        kalshiMarketId: opp.kalshiMarketId,
        kalshiYesPrice: opp.kalshiYesPrice,
        polymarketMarketId: opp.polymarketMarketId,
        polymarketYesPrice: opp.polymarketYesPrice,
        buyPlatform: opp.buyPlatform,
        netEdge: opp.netEdge,
        kalshiContracts: 1,
        polymarketSizeUsdc: 5,
      });
      if (result.success) {
        toast.success("Both arb legs executed successfully");
      } else if ("reasoning" in result) {
        toast.warning(`Partial execution: ${result.reasoning}`);
      } else {
        toast.error(`Execution failed: ${result.error ?? "Unknown error"}`);
      }
    } catch (err) {
      toast.error("Failed to execute cross-arb");
    } finally {
      setExecuting(null);
    }
  };

  const columns: Column<typeof opportunities[number]>[] = [
    {
      key: 'kalshiTitle',
      header: 'Event',
      render: (val) => (
        <span className="font-semibold text-emerald-300 text-xs">
          {String(val).length > 45 ? String(val).slice(0, 45) + "…" : val}
        </span>
      ),
    },
    {
      key: 'buyPlatform',
      header: 'Trade Details',
      render: (_, row) => {
        const buyPrice = row.buyPlatform === "kalshi" ? row.kalshiYesPrice : row.polymarketYesPrice;
        const sellPrice = row.sellPlatform === "kalshi" ? row.kalshiYesPrice : row.polymarketYesPrice;
        return (
          <div className="space-y-1">
            <span className="text-slate-400 text-xs font-mono tabular-nums block">
              Buy {row.buyPlatform.toUpperCase()} @ {(buyPrice * 100).toFixed(1)}¢ · Sell {row.sellPlatform.toUpperCase()} @ {(sellPrice * 100).toFixed(1)}¢
            </span>
            <span className="text-slate-500 text-[11px] font-mono tabular-nums block">
              Similarity {(row.confidence * 100).toFixed(0)}% · min liquidity ${row.minLiquidity.toLocaleString()}
            </span>
          </div>
        );
      },
    },
    {
      key: 'netEdge',
      header: 'Edge / Action',
      render: (val, row) => {
        const key = `${row.kalshiMarketId}-${row.polymarketMarketId}`;
        const isExec = executing === key;
        return (
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="text-[10px] border-emerald-400/30 text-emerald-300 font-mono tabular-nums">
              +{(Number(val) * 100).toFixed(1)}pp
            </Badge>
            <Button
              size="sm"
              className="text-[11px] h-6 px-2 bg-emerald-600/80 hover:bg-emerald-500 text-white"
              disabled={isExec}
              onClick={(e) => {
                e.stopPropagation();
                handleExecute(row);
              }}
            >
              {isExec ? <Loader2 className="w-3 h-3 animate-spin" /> : "Execute"}
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="space-y-4 animate-fade-in" style={{ animationDelay: '100ms' }}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-emerald-400" />
          <span className="text-sm font-bold text-foreground">Cross-Platform Arb — Execute</span>
          {arbQuery.isFetching && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
        </div>
        <span className="text-xs text-slate-500">
          {arbQuery.data
            ? `${arbQuery.data.kalshiMarketsScanned}K + ${arbQuery.data.polymarketMarketsScanned}P scanned`
            : ""}
        </span>
      </div>

      <div className="text-xs text-slate-500 bg-yellow-500/10 border border-yellow-400/20 rounded-lg p-3 flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
        <span>
          Execution requires valid credentials on <strong>both</strong> platforms and live trading armed.
          Sizes are intentionally small (1 Kalshi contract, $5 Polymarket). Review before using.
        </span>
      </div>

      {arbQuery.isLoading ? (
        <TableSkeleton rows={3} />
      ) : opportunities.length === 0 ? (
        <EmptyState
          icon={InboxIcon}
          title="No opportunities"
          message="No cross-platform arb opportunities above threshold right now."
        />
      ) : (
        <EnhancedTable
          columns={columns}
          data={opportunities}
          className="text-xs"
          hoverGlow={true}
        />
      )}
    </div>
  );
}

// ----------- Main page -----------

type Tab = "kalshi" | "polymarket" | "live" | "crossbot";

export default function Strategies() {
  const [tab, setTab] = useState<Tab>("kalshi");
  
  // Queries for live metrics
  const arbQuery = trpc.combinatorial.detectCrossPlatformArbitrage.useQuery(undefined, {
    refetchInterval: 120_000,
    enabled: tab === "live",
  });
  const mispriceQuery = trpc.polymarket.detectYesNoMispricings.useQuery(undefined, {
    refetchInterval: 120_000,
    enabled: tab === "live",
  });

  return (
    <div className="space-y-8">
      <PageHeader
        icon={Sparkles}
        title="Bot Strategies"
        description="Organised playbooks for the Kalshi and Polymarket autonomous trading bots. Each strategy is ranked by risk-adjusted return and designed for systematic, algorithmic execution."
        iconGradient="from-fuchsia-500 to-violet-500"
      />

      {/* Tab selector */}
      <div className="flex gap-2 flex-wrap animate-fade-in">
        {(
          [
            { key: "kalshi", label: "Kalshi Bot", icon: <TrendingUp className="w-4 h-4" /> },
            { key: "polymarket", label: "Polymarket Bot", icon: <Activity className="w-4 h-4" /> },
            { key: "live", label: "Live Opportunities", icon: <Zap className="w-4 h-4" /> },
            { key: "crossbot", label: "Cross-Bot", icon: <Layers className="w-4 h-4" /> },
          ] as { key: Tab; label: string; icon: React.ReactNode }[]
        ).map(({ key, label, icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all duration-200 ${
              tab === key
                ? "bg-primary text-primary-foreground shadow-lg glow-primary"
                : "glass-card bg-slate-800/50 text-slate-400 hover:text-foreground hover:bg-slate-700/50"
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
      </div>

      {/* Kalshi strategies */}
      {tab === "kalshi" && (
        <div className="space-y-6">
          <div className="flex items-center gap-3 animate-fade-in">
            <div className="h-6 w-1 bg-gradient-to-b from-cyan-400 to-teal-500 rounded-full" />
            <div>
              <h2 className="text-xl font-bold text-foreground">Kalshi Bot — 5 Core Strategies</h2>
              <p className="text-sm text-slate-400 mt-0.5">
                CFTC-regulated USD-settled binary contracts. Sports dominate ~90% of volume.
                FIX 4.4 + WebSocket APIs enable sub-100ms execution.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {KALSHI_STRATEGIES.map((s, idx) => (
              <div 
                key={s.id} 
                className="animate-fade-in" 
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                <StrategyCard strategy={s} />
              </div>
            ))}
          </div>

          <Card className="glass-card border-0 bg-gradient-to-br from-slate-800/40 to-slate-900/40 backdrop-blur-xl border border-slate-700/50 animate-fade-in" style={{ animationDelay: '300ms' }}>
            <CardHeader>
              <CardTitle className="text-base gradient-text">Portfolio Allocation</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs text-center">
                {[
                  { label: "MM + Arb", pct: "40%", color: "text-cyan-400" },
                  { label: "Catalyst", pct: "30%", color: "text-yellow-400" },
                  { label: "Statistical", pct: "20%", color: "text-violet-400" },
                  { label: "Correlation", pct: "10%", color: "text-pink-400" },
                  { label: "Reserve", pct: "buffer", color: "text-slate-400" },
                ].map((item) => (
                  <div key={item.label} className="glass-card bg-black/20 rounded-lg p-2">
                    <div className={`text-lg font-bold font-mono tabular-nums ${item.color}`}>{item.pct}</div>
                    <div className="text-slate-400 mt-0.5">{item.label}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Polymarket strategies */}
      {tab === "polymarket" && (
        <div className="space-y-6">
          <div className="flex items-center gap-3 animate-fade-in">
            <div className="h-6 w-1 bg-gradient-to-b from-violet-400 to-pink-500 rounded-full" />
            <div>
              <h2 className="text-xl font-bold text-foreground">Polymarket Bot — 5 Core Strategies</h2>
              <p className="text-sm text-slate-400 mt-0.5">
                CLOBv2 with pUSD stablecoin. Off-chain matching, on-chain settlement via Polygon.
                Bots drive ~70-80% of profitable volume.
              </p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {POLYMARKET_STRATEGIES.map((s, idx) => (
              <div 
                key={s.id} 
                className="animate-fade-in" 
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                <StrategyCard strategy={s} />
              </div>
            ))}
          </div>

          <Card className="glass-card border-0 bg-gradient-to-br from-slate-800/40 to-slate-900/40 backdrop-blur-xl border border-slate-700/50 animate-fade-in" style={{ animationDelay: '300ms' }}>
            <CardHeader>
              <CardTitle className="text-base gradient-text">Portfolio Allocation</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs text-center">
                {[
                  { label: "MM + Arb", pct: "40%", color: "text-cyan-400" },
                  { label: "AI Prob", pct: "30%", color: "text-violet-400" },
                  { label: "Correlation", pct: "20%", color: "text-pink-400" },
                  { label: "Momentum", pct: "10%", color: "text-orange-400" },
                  { label: "Reserve", pct: "buffer", color: "text-slate-400" },
                ].map((item) => (
                  <div key={item.label} className="glass-card bg-black/20 rounded-lg p-2">
                    <div className={`text-lg font-bold font-mono tabular-nums ${item.color}`}>{item.pct}</div>
                    <div className="text-slate-400 mt-0.5">{item.label}</div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Live opportunities */}
      {tab === "live" && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-6 w-1 bg-gradient-to-b from-emerald-400 to-cyan-500 rounded-full" />
            <h2 className="text-xl font-bold text-foreground">Live Strategy Opportunities</h2>
          </div>

          {/* Top metrics */}
          <div className="grid gap-4 md:grid-cols-4 animate-fade-in">
            <StatCard
              label="Active Strategies"
              value={KALSHI_STRATEGIES.length + POLYMARKET_STRATEGIES.length}
              icon={<Sparkles className="w-5 h-5" />}
              color="#8864ff"
            />
            <StatCard
              label="Cross-Arb Opps"
              value={arbQuery.data?.opportunities.length ?? 0}
              icon={<Network className="w-5 h-5" />}
              color="#10b981"
              loading={arbQuery.isLoading}
            />
            <StatCard
              label="YES+NO Mispricings"
              value={mispriceQuery.data?.mispricings.length ?? 0}
              icon={<TrendingDown className="w-5 h-5" />}
              color="#06b6d4"
              loading={mispriceQuery.isLoading}
            />
            <StatCard
              label="Avg Net Edge"
              value={
                arbQuery.data?.opportunities.length
                  ? `${(
                      (arbQuery.data.opportunities.reduce((sum, o) => sum + o.netEdge, 0) /
                        arbQuery.data.opportunities.length) *
                      100
                    ).toFixed(1)}pp`
                  : "—"
              }
              icon={<Target className="w-5 h-5" />}
              color="#ec4899"
              loading={arbQuery.isLoading}
            />
          </div>

          <div className="grid gap-6 md:grid-cols-2">
            <Card className="glass-card border bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-400/20 backdrop-blur-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base gradient-text">Cross-Platform Arbitrage</CardTitle>
                <CardDescription className="text-xs text-slate-400">
                  Kalshi ↔ Polymarket: matched events with actionable price spreads
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CrossPlatformArbPanel />
              </CardContent>
            </Card>

            <Card className="glass-card border bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-400/20 backdrop-blur-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base gradient-text">YES+NO Mispricing</CardTitle>
                <CardDescription className="text-xs text-slate-400">
                  Polymarket: buy both sides for guaranteed risk-free profit at resolution
                </CardDescription>
              </CardHeader>
              <CardContent>
                <YesNoMispricePanel />
              </CardContent>
            </Card>

            <Card className="glass-card border bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-400/20 backdrop-blur-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base gradient-text">Polymarket Autonomous Bot</CardTitle>
                <CardDescription className="text-xs text-slate-400">
                  Trigger one full autonomy cycle: signals → risk gate → order placement
                </CardDescription>
              </CardHeader>
              <CardContent>
                <PolymarketAutonomyPanel />
              </CardContent>
            </Card>

            <Card className="glass-card border bg-gradient-to-br from-slate-700/20 to-slate-800/20 border-slate-600/30 backdrop-blur-xl">
              <CardHeader className="pb-3">
                <CardTitle className="text-base gradient-text">Portfolio Summary</CardTitle>
                <CardDescription className="text-xs text-slate-400">
                  Realistic net monthly returns with $50k+ capital, both bots running
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3 text-xs">
                  {[
                    { label: "Kalshi MM + Arb (base)", range: "1–6%/mo", color: "text-cyan-400" },
                    { label: "Kalshi Catalyst + Statistical", range: "3–7%/mo", color: "text-yellow-400" },
                    { label: "Polymarket MM + Arb", range: "1–6%/mo", color: "text-violet-400" },
                    { label: "Polymarket AI + Momentum", range: "3–8%/mo", color: "text-orange-400" },
                    { label: "Combined blended net (est.)", range: "2–10%/mo", color: "text-emerald-400" },
                  ].map((row) => (
                    <div key={row.label} className="flex items-center justify-between glass-card bg-black/20 rounded-lg px-3 py-2">
                      <span className="text-slate-400">{row.label}</span>
                      <span className={`font-bold font-mono tabular-nums ${row.color}`}>{row.range}</span>
                    </div>
                  ))}
                  <div className="text-slate-500 text-[11px] pt-1 border-t border-slate-700/50">
                    * Post-fees/gas estimates. Past structure ≠ future results.
                    Always back-test and paper-trade before live deployment.
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Cross-Bot strategies */}
      {tab === "crossbot" && (
        <div className="space-y-6">
          <div className="flex items-center gap-3 animate-fade-in">
            <div className="h-6 w-1 bg-gradient-to-b from-violet-400 to-emerald-500 rounded-full" />
            <div>
              <h2 className="text-xl font-bold text-foreground">Cross-Bot Strategies</h2>
              <p className="text-sm text-slate-400 mt-0.5">
                Coordinate the Kalshi and Polymarket bots together: unified signal view with
                cross-platform consensus detection, and one-click cross-arb execution.
              </p>
            </div>
          </div>

          {/* How it works */}
          <Card className="glass-card border bg-gradient-to-br from-slate-800/30 to-slate-900/30 border-slate-700/40 backdrop-blur-xl animate-fade-in" style={{ animationDelay: '100ms' }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm gradient-text">How Cross-Bot Strategies Work</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-3 text-xs">
                {[
                  {
                    icon: <GitMerge className="w-4 h-4 text-violet-400" />,
                    title: "Consensus Detection",
                    body: "When both bots independently fire signals on the same event in the same direction, conviction is boosted — both agree the market is mispriced.",
                  },
                  {
                    icon: <Network className="w-4 h-4 text-emerald-400" />,
                    title: "Cross-Platform Arbitrage",
                    body: "Kalshi and Polymarket price identical events differently. Buy the cheap side on one platform and hedge the expensive side on the other for near risk-free edge.",
                  },
                  {
                    icon: <Layers className="w-4 h-4 text-cyan-400" />,
                    title: "Coordinated Execution",
                    body: "The cross-bot executor places both legs of an arbitrage trade concurrently, minimising the window during which only one leg is open.",
                  },
                ].map((item) => (
                  <div key={item.title} className="glass-card bg-black/20 rounded-lg p-3 space-y-1.5">
                    <div className="flex items-center gap-2">
                      {item.icon}
                      <span className="font-semibold text-foreground">{item.title}</span>
                    </div>
                    <p className="text-slate-400 leading-relaxed">{item.body}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-6 md:grid-cols-2">
            {/* Combined signals */}
            <Card className="glass-card border bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-400/20 backdrop-blur-xl animate-fade-in" style={{ animationDelay: '200ms' }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base gradient-text">Combined Signal Scan</CardTitle>
                <CardDescription className="text-xs text-slate-400">
                  Signals from both bots merged into one ranked list with consensus highlighting
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CombinedSignalsPanel />
              </CardContent>
            </Card>

            {/* Cross-arb execution */}
            <Card className="glass-card border bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-400/20 backdrop-blur-xl animate-fade-in" style={{ animationDelay: '300ms' }}>
              <CardHeader className="pb-3">
                <CardTitle className="text-base gradient-text">Cross-Arb Executor</CardTitle>
                <CardDescription className="text-xs text-slate-400">
                  Live Kalshi ↔ Polymarket opportunities — execute both legs in one action
                </CardDescription>
              </CardHeader>
              <CardContent>
                <CrossArbExecutionPanel />
              </CardContent>
            </Card>
          </div>

          {/* Requirements */}
          <Card className="glass-card border bg-gradient-to-br from-slate-800/40 to-slate-900/40 border-slate-700/50 backdrop-blur-xl animate-fade-in" style={{ animationDelay: '400ms' }}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-slate-300">Prerequisites</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2 md:grid-cols-2 text-xs text-slate-400">
                {[
                  "Kalshi account connected (Connect page)",
                  "Polymarket account connected (Connect page)",
                  "Live trading armed in Trading Autonomy",
                  "Sufficient balance on both platforms",
                  "Review arb reasoning before executing",
                  "Back-test before scaling size",
                ].map((req) => (
                  <div key={req} className="flex items-center gap-2">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    {req}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
