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
} from "lucide-react";
import { toast } from "sonner";

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
      className={`border bg-gradient-to-br ${strategy.color} backdrop-blur-xl transition-all duration-300 hover:shadow-2xl hover:scale-[1.01]`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-black/20">{strategy.icon}</div>
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
          <div className="bg-black/20 rounded-lg p-2">
            <div className="text-slate-400 mb-0.5 font-semibold tracking-wide">WIN RATE</div>
            <div className="text-emerald-300 font-bold">{strategy.winRate}</div>
          </div>
          <div className="bg-black/20 rounded-lg p-2">
            <div className="text-slate-400 mb-0.5 font-semibold tracking-wide">MONTHLY</div>
            <div className="text-cyan-300 font-bold">{strategy.monthlyReturn}</div>
          </div>
          <div className="bg-black/20 rounded-lg p-2">
            <div className="text-slate-400 mb-0.5 font-semibold tracking-wide">RISK</div>
            <div className={`font-bold ${riskColor(strategy.risk)}`}>{strategy.risk}</div>
          </div>
          <div className="bg-black/20 rounded-lg p-2">
            <div className="text-slate-400 mb-0.5 font-semibold tracking-wide">CAPITAL</div>
            <div className="text-slate-300 font-bold">{strategy.capital}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ----------- Live data panels -----------

function CrossPlatformArbPanel() {
  const arbQuery = trpc.combinatorial.detectCrossPlatformArbitrage.useQuery(undefined, {
    refetchInterval: 120_000,
  });

  const opportunities = arbQuery.data?.opportunities ?? [];
  const topOpps = opportunities.slice(0, 5);

  return (
    <div className="space-y-3">
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

      {topOpps.length === 0 ? (
        <div className="text-xs text-slate-500 italic py-2">
          No cross-platform opportunities detected above threshold right now.
        </div>
      ) : (
        <div className="space-y-2">
          {topOpps.map((opp, idx) => (
            <div
              key={idx}
              className="bg-emerald-500/10 border border-emerald-400/20 rounded-lg p-3 text-xs space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-emerald-300 truncate max-w-[60%]">
                  {opp.kalshiTitle.slice(0, 60)}…
                </span>
                <Badge variant="outline" className="text-[10px] border-emerald-400/30 text-emerald-300">
                  +{(opp.netEdge * 100).toFixed(1)}pp net
                </Badge>
              </div>
              <div className="text-slate-400">
                {(() => {
                  const buyPrice = opp.buyPlatform === "kalshi" ? opp.kalshiYesPrice : opp.polymarketYesPrice;
                  const sellPrice = opp.sellPlatform === "kalshi" ? opp.kalshiYesPrice : opp.polymarketYesPrice;
                  return `Buy ${opp.buyPlatform.toUpperCase()} YES @ ${buyPrice.toFixed(2)} · Sell ${opp.sellPlatform.toUpperCase()} YES @ ${sellPrice.toFixed(2)}`;
                })()}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function YesNoMispricePanel() {
  const mispriceQuery = trpc.polymarket.detectYesNoMispricings.useQuery(undefined, {
    refetchInterval: 120_000,
  });

  const mispricings = mispriceQuery.data?.mispricings ?? [];
  const top = mispricings.slice(0, 4);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <TrendingDown className="w-4 h-4 text-cyan-400" />
        <span className="text-sm font-bold text-foreground">YES+NO Mispricings</span>
        {mispriceQuery.isFetching && <Loader2 className="w-3 h-3 animate-spin text-slate-400" />}
      </div>

      {top.length === 0 ? (
        <div className="text-xs text-slate-500 italic py-2">
          No YES+NO sum &lt; $1 opportunities detected right now.
        </div>
      ) : (
        <div className="space-y-2">
          {top.map((m, idx) => (
            <div
              key={idx}
              className="bg-cyan-500/10 border border-cyan-400/20 rounded-lg p-3 text-xs space-y-1"
            >
              <div className="flex items-center justify-between">
                <span className="font-semibold text-cyan-300 truncate max-w-[65%]">
                  {m.question.slice(0, 55)}…
                </span>
                <Badge variant="outline" className="text-[10px] border-cyan-400/30 text-cyan-300">
                  +{(m.guaranteedProfitPct * 100).toFixed(1)}%
                </Badge>
              </div>
              <div className="text-slate-400">
                YES {m.yesPrice.toFixed(3)} + NO {m.noPrice.toFixed(3)} = {m.priceSum.toFixed(3)}
              </div>
            </div>
          ))}
        </div>
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
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Bot className="w-4 h-4 text-violet-400" />
        <span className="text-sm font-bold text-foreground">Polymarket Bot — Manual Trigger</span>
      </div>

      <div className="text-xs text-slate-400 leading-relaxed">
        Runs one autonomous trading cycle: fetches live markets, generates signals, applies risk
        guardrails, and places the highest-scoring order (when live trading is armed).
      </div>

      <div className="flex items-center gap-2">
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

  return (
    <div className="space-y-4">
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
        <div className="grid grid-cols-3 gap-2 text-xs text-center">
          {[
            { label: "Kalshi", count: combinedMutation.data.kalshiCount, color: "text-cyan-400" },
            { label: "Polymarket", count: combinedMutation.data.polymarketCount, color: "text-violet-400" },
            {
              label: "Consensus",
              count: combinedMutation.data.consensusCount,
              color: "text-emerald-400",
            },
          ].map((item) => (
            <div key={item.label} className="bg-black/20 rounded-lg p-2">
              <div className={`text-lg font-bold ${item.color}`}>{item.count}</div>
              <div className="text-slate-400">{item.label}</div>
            </div>
          ))}
        </div>
      )}

      {topSignals.length === 0 && !combinedMutation.isPending && (
        <div className="text-xs text-slate-500 italic py-2">
          Click "Scan Both Bots" to fetch live signals from Kalshi and Polymarket.
        </div>
      )}

      <div className="space-y-2">
        {topSignals.map((sig, idx) => (
          <div
            key={`${sig.platform}-${sig.marketId}-${idx}`}
            className={`rounded-lg p-3 text-xs space-y-1 border ${
              sig.consensusPartner
                ? "bg-emerald-500/10 border-emerald-400/25"
                : sig.platform === "kalshi"
                  ? "bg-cyan-500/10 border-cyan-400/20"
                  : "bg-violet-500/10 border-violet-400/20"
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 truncate">
                <Badge
                  variant="outline"
                  className={`text-[10px] shrink-0 ${
                    sig.platform === "kalshi"
                      ? "border-cyan-400/30 text-cyan-300"
                      : "border-violet-400/30 text-violet-300"
                  }`}
                >
                  {sig.platform.toUpperCase()}
                </Badge>
                {sig.consensusPartner && (
                  <Badge
                    variant="outline"
                    className="text-[10px] shrink-0 border-emerald-400/30 text-emerald-300"
                  >
                    CONSENSUS ✓
                  </Badge>
                )}
                <span className="text-foreground font-semibold truncate">
                  {sig.question.length > 55
                    ? sig.question.slice(0, 55) + "…"
                    : sig.question}
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Badge
                  variant="outline"
                  className={`text-[10px] ${
                    sig.side === "yes"
                      ? "border-emerald-400/30 text-emerald-300"
                      : "border-red-400/30 text-red-300"
                  }`}
                >
                  {sig.side.toUpperCase()}
                </Badge>
                <span className="text-slate-300 font-bold">
                  {(sig.convictionScore * 100).toFixed(0)}%
                </span>
              </div>
            </div>
            <div className="text-slate-400 leading-snug">
              {sig.reasoning.length > 120
                ? sig.reasoning.slice(0, 120) + "…"
                : sig.reasoning}
            </div>
            {sig.consensusPartner && (
              <div className="text-emerald-400/80 text-[11px]">
                ↔ Corroborated by {sig.consensusPartner.platform.toUpperCase()}{" "}
                {sig.consensusPartner.signalType} ({(sig.consensusPartner.confidence * 100).toFixed(0)}% confidence)
              </div>
            )}
          </div>
        ))}
      </div>
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

  const handleExecute = async (
    opp: (typeof opportunities)[number],
    polymarketTokenIdYes: string,
    polymarketTokenIdNo: string,
  ) => {
    const key = `${opp.kalshiMarketId}-${opp.polymarketMarketId}`;
    setExecuting(key);
    try {
      const result = await executeArb.mutateAsync({
        kalshiMarketId: opp.kalshiMarketId,
        kalshiYesPrice: opp.kalshiYesPrice,
        polymarketMarketId: opp.polymarketMarketId,
        polymarketYesPrice: opp.polymarketYesPrice,
        polymarketTokenIdYes,
        polymarketTokenIdNo,
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

  return (
    <div className="space-y-3">
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

      <div className="text-xs text-slate-500 bg-yellow-500/10 border border-yellow-400/20 rounded-lg p-2">
        <AlertTriangle className="w-3 h-3 inline mr-1 text-yellow-400" />
        Execution requires valid credentials on <strong>both</strong> platforms and live trading armed.
        Sizes are intentionally small (1 Kalshi contract, $5 Polymarket). Review before using.
      </div>

      {opportunities.length === 0 ? (
        <div className="text-xs text-slate-500 italic py-2">
          No cross-platform arb opportunities above threshold right now.
        </div>
      ) : (
        <div className="space-y-2">
          {opportunities.map((opp, idx) => {
            const key = `${opp.kalshiMarketId}-${opp.polymarketMarketId}`;
            const isExec = executing === key;
            return (
              <div
                key={idx}
                className="bg-emerald-500/10 border border-emerald-400/20 rounded-lg p-3 text-xs space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-emerald-300 truncate max-w-[55%]">
                    {opp.kalshiTitle.length > 55
                      ? opp.kalshiTitle.slice(0, 55) + "…"
                      : opp.kalshiTitle}
                  </span>
                  <Badge variant="outline" className="text-[10px] border-emerald-400/30 text-emerald-300">
                    +{(opp.netEdge * 100).toFixed(1)}pp net
                  </Badge>
                </div>
                <div className="text-slate-400">
                  {(() => {
                    const buyPrice =
                      opp.buyPlatform === "kalshi" ? opp.kalshiYesPrice : opp.polymarketYesPrice;
                    const sellPrice =
                      opp.sellPlatform === "kalshi" ? opp.kalshiYesPrice : opp.polymarketYesPrice;
                    return `Buy ${opp.buyPlatform.toUpperCase()} YES @ ${(buyPrice * 100).toFixed(1)}¢ · Sell ${opp.sellPlatform.toUpperCase()} YES @ ${(sellPrice * 100).toFixed(1)}¢`;
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-slate-500 text-[11px]">
                    Similarity {(opp.confidence * 100).toFixed(0)}% · min liquidity ${opp.minLiquidity.toLocaleString()}
                  </span>
                  <div className="ml-auto">
                    <Button
                      size="sm"
                      className="text-[11px] h-6 px-2 bg-emerald-600/80 hover:bg-emerald-500 text-white"
                      disabled={isExec}
                      onClick={() =>
                        handleExecute(
                          opp,
                          `${opp.polymarketMarketId}-yes`,
                          `${opp.polymarketMarketId}-no`,
                        )
                      }
                    >
                      {isExec ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        "Execute Both Legs"
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ----------- Main page -----------

type Tab = "kalshi" | "polymarket" | "live" | "crossbot";

export default function Strategies() {
  const [tab, setTab] = useState<Tab>("kalshi");

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-4xl font-bold gradient-text mb-2">BOT STRATEGIES</h1>
        <p className="text-muted-foreground">
          Organised playbooks for the Kalshi and Polymarket autonomous trading bots.
          Each strategy is ranked by risk-adjusted return and designed for systematic,
          algorithmic execution.
        </p>
      </div>

      {/* Tab selector */}
      <div className="flex gap-2 flex-wrap">
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
                ? "bg-primary text-primary-foreground shadow-lg"
                : "bg-slate-800/50 text-slate-400 hover:text-foreground hover:bg-slate-700/50"
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
          <div className="flex items-center gap-3">
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
            {KALSHI_STRATEGIES.map((s) => (
              <StrategyCard key={s.id} strategy={s} />
            ))}
          </div>

          <Card className="border-0 bg-gradient-to-br from-slate-800/40 to-slate-900/40 backdrop-blur-xl border border-slate-700/50">
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
                  <div key={item.label} className="bg-black/20 rounded-lg p-2">
                    <div className={`text-lg font-bold ${item.color}`}>{item.pct}</div>
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
          <div className="flex items-center gap-3">
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
            {POLYMARKET_STRATEGIES.map((s) => (
              <StrategyCard key={s.id} strategy={s} />
            ))}
          </div>

          <Card className="border-0 bg-gradient-to-br from-slate-800/40 to-slate-900/40 backdrop-blur-xl border border-slate-700/50">
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
                  <div key={item.label} className="bg-black/20 rounded-lg p-2">
                    <div className={`text-lg font-bold ${item.color}`}>{item.pct}</div>
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

          <div className="grid gap-6 md:grid-cols-2">
            <Card className="border bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-400/20 backdrop-blur-xl">
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

            <Card className="border bg-gradient-to-br from-cyan-500/10 to-blue-500/10 border-cyan-400/20 backdrop-blur-xl">
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

            <Card className="border bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-400/20 backdrop-blur-xl">
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

            <Card className="border bg-gradient-to-br from-slate-700/20 to-slate-800/20 border-slate-600/30 backdrop-blur-xl">
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
                    <div key={row.label} className="flex items-center justify-between bg-black/20 rounded-lg px-3 py-2">
                      <span className="text-slate-400">{row.label}</span>
                      <span className={`font-bold ${row.color}`}>{row.range}</span>
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
          <div className="flex items-center gap-3">
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
          <Card className="border bg-gradient-to-br from-slate-800/30 to-slate-900/30 border-slate-700/40 backdrop-blur-xl">
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
                  <div key={item.title} className="bg-black/20 rounded-lg p-3 space-y-1.5">
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
            <Card className="border bg-gradient-to-br from-violet-500/10 to-purple-500/10 border-violet-400/20 backdrop-blur-xl">
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
            <Card className="border bg-gradient-to-br from-emerald-500/10 to-teal-500/10 border-emerald-400/20 backdrop-blur-xl">
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
          <Card className="border bg-gradient-to-br from-slate-800/40 to-slate-900/40 border-slate-700/50 backdrop-blur-xl">
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
