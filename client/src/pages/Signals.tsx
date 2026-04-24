import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, TrendingUp, Zap, AlertTriangle, RefreshCw, Sparkles, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";

export default function Signals() {
  const signals = trpc.kalshi.getRecentSignals.useQuery();
  const topSignals = trpc.kalshi.getTopSignals.useQuery({ topN: 5, minExecutionScore: 0.6 });
  const generateSignalsMutation = trpc.kalshi.generateSignals.useMutation();
  const marketsQuery = trpc.kalshi.getMarkets.useQuery({ status: "open" });
  const [isGenerating, setIsGenerating] = useState(false);

  const actionableMarkets = (marketsQuery.data ?? [])
    .filter((market: any) => {
      const yesPrice = Number(market.yesPrice ?? 0);
      const noPrice = Number(market.noPrice ?? 0);
      const impliedProbability = Number(market.impliedProbability ?? 0.5);
      const totalVolume = Number(market.yesVolume ?? 0) + Number(market.noVolume ?? 0);

      return (
        Number.isFinite(yesPrice) &&
        Number.isFinite(noPrice) &&
        Number.isFinite(impliedProbability) &&
        yesPrice > 0.01 &&
        yesPrice < 0.99 &&
        noPrice > 0.01 &&
        noPrice < 0.99 &&
        impliedProbability > 0.01 &&
        impliedProbability < 0.99 &&
        totalVolume >= 25
      );
    })
    .sort((a: any, b: any) => (Number(b.yesVolume ?? 0) + Number(b.noVolume ?? 0)) - (Number(a.yesVolume ?? 0) + Number(a.noVolume ?? 0)));

  const handleGenerateSignals = async () => {
    setIsGenerating(true);
    try {
      if (!marketsQuery.data || marketsQuery.data.length === 0) {
        toast.error("Open markets are still loading");
        return;
      }

      if (actionableMarkets.length === 0) {
        toast.error("No actionable open markets are available right now. Try again after market data refreshes.");
        await signals.refetch();
        await topSignals.refetch();
        return;
      }

      const marketIds = actionableMarkets.slice(0, 12).map((m: any) => m.id);
      const result = await generateSignalsMutation.mutateAsync({
        marketIds,
        minConfidence: 0.5,
      });

      if (result.success) {
        toast.success(`Generated ${result.signals.length} signals`);
        await signals.refetch();
        await topSignals.refetch();
      } else {
        toast.error(result.error || "Failed to generate signals");
        await signals.refetch();
        await topSignals.refetch();
      }
    } catch (error) {
      console.error("Failed to generate signals:", error);
      toast.error("Error generating signals");
    } finally {
      setIsGenerating(false);
    }
  };

  const getSignalIcon = (signalType: string) => {
    switch (signalType) {
      case "value_play":
        return <TrendingUp className="w-5 h-5 text-cyan-400" />;
      case "momentum":
        return <Zap className="w-5 h-5 text-yellow-400" />;
      case "contrarian":
        return <AlertTriangle className="w-5 h-5 text-pink-400" />;
      default:
        return <TrendingUp className="w-5 h-5 text-primary" />;
    }
  };

  const getSignalDescription = (signalType: string) => {
    switch (signalType) {
      case "value_play":
        return "Market mispricing detected - fundamental vs market probability divergence";
      case "momentum":
        return "Strong directional movement with volume confirmation";
      case "contrarian":
        return "Extreme market condition suggesting reversal opportunity";
      default:
        return "Trading signal generated";
    }
  };

  const getConfidenceBadgeColor = (confidence: number) => {
    if (confidence >= 0.8) return "bg-gradient-to-r from-cyan-500 to-cyan-600 text-black font-bold";
    if (confidence >= 0.6) return "bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold";
    return "bg-gradient-to-r from-orange-500 to-orange-600 text-black font-bold";
  };

  const renderSignalCard = (signal: any, featured = false) => (
    <Card
      key={signal.id}
      className={`border-0 backdrop-blur-xl transition-all duration-300 hover:shadow-2xl ${
        featured
          ? "bg-gradient-to-br from-violet-500/20 via-transparent to-pink-500/20 border-2 border-violet-400/30"
          : "bg-gradient-to-br from-slate-800/40 to-slate-900/40 border border-slate-700/50 hover:border-violet-400/50"
      }`}
    >
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-xl ${featured ? "bg-violet-500/20" : "bg-slate-700/50"}`}>
              {getSignalIcon(signal.signalType)}
            </div>
            <div>
              <CardTitle className="text-lg gradient-text capitalize">
                {signal.signalType.replace(/_/g, " ")}
              </CardTitle>
              <CardDescription className="text-slate-400 mt-1">
                {getSignalDescription(signal.signalType)}
              </CardDescription>
            </div>
          </div>
          <Badge className={`${getConfidenceBadgeColor(signal.confidence)} px-3 py-1 text-sm`}>
            {(signal.confidence * 100).toFixed(0)}%
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
              <div className="text-xs text-slate-400 mb-1 tracking-wide font-semibold">MARKET</div>
              <div className="text-sm font-mono text-foreground">{signal.marketId}</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
              <div className="text-xs text-slate-400 mb-1 tracking-wide font-semibold">SIDE</div>
              <div className={`text-sm font-bold ${signal.side === "yes" ? "text-cyan-400" : "text-pink-400"}`}>
                {signal.side.toUpperCase()}
              </div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
              <div className="text-xs text-slate-400 mb-1 tracking-wide font-semibold">IMPLIED PROB</div>
              <div className="text-sm font-bold text-cyan-300">{(signal.impliedProbability * 100).toFixed(1)}%</div>
            </div>
            <div className="bg-slate-900/50 rounded-lg p-3 border border-slate-700/50">
              <div className="text-xs text-slate-400 mb-1 tracking-wide font-semibold">MARKET PRICE</div>
              <div className="text-sm font-bold text-cyan-300">${signal.marketPrice.toFixed(2)}</div>
            </div>
          </div>

          <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-slate-400 tracking-wide font-semibold">EXPECTED VALUE</div>
              <div className={`text-lg font-bold ${signal.expectedValue > 0 ? "text-cyan-400" : "text-pink-400"}`}>
                ${signal.expectedValue.toFixed(4)}
              </div>
            </div>
          </div>

          <div className="bg-slate-900/50 rounded-lg p-4 border border-slate-700/50">
            <div className="text-xs text-slate-400 mb-2 tracking-wide font-semibold">REASONING</div>
            <div className="text-sm text-slate-300 leading-relaxed font-mono">{signal.reasoning}</div>
          </div>

          <div className="text-xs text-slate-500 pt-2 border-t border-slate-700/50">
            Generated: {new Date(signal.createdAt).toLocaleString()}
          </div>
        </div>
      </CardContent>
    </Card>
  );

  if (signals.isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Sparkles className="w-8 h-8 text-primary animate-spin" />
          <div>
            <h1 className="text-4xl font-bold gradient-text">SIGNAL REGISTRY</h1>
            <p className="text-muted-foreground mt-1">Analyzing markets...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold gradient-text mb-2">SIGNAL REGISTRY</h1>
          <p className="text-muted-foreground">Real-time market signals with confidence scoring and execution readiness</p>
        </div>
        <Button
          onClick={handleGenerateSignals}
          disabled={isGenerating || generateSignalsMutation.isPending}
          className="laurenzo-button whitespace-nowrap"
        >
          <RefreshCw className={`w-5 h-5 mr-2 ${isGenerating ? "animate-spin" : ""}`} />
          {isGenerating ? "Generating..." : "Generate Signals"}
        </Button>
      </div>

      {/* Top Execution-Ready Signals */}
      {topSignals.data && topSignals.data.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-cyan-400" />
            <h2 className="text-2xl font-bold gradient-text">TOP EXECUTION SIGNALS</h2>
          </div>
          <div className="grid gap-4">
            {topSignals.data.map((signal: any, idx: number) => (
              <div key={signal.id} className="relative">
                {idx === 0 && (
                  <div className="absolute -inset-0.5 bg-gradient-to-r from-cyan-500 to-pink-500 rounded-2xl opacity-20 blur-lg" />
                )}
                <div className="relative">
                  {renderSignalCard(signal, idx === 0)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* All Recent Signals */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" />
          <h2 className="text-2xl font-bold gradient-text">ALL RECENT SIGNALS</h2>
        </div>
        <div className="grid gap-4">
          {signals.data && signals.data.length > 0 ? (
            signals.data.map((signal: any) => renderSignalCard(signal))
          ) : (
            <Card className="border-0 bg-gradient-to-br from-slate-800/40 to-slate-900/40 backdrop-blur-xl">
              <CardContent className="pt-12 pb-12 flex flex-col items-center justify-center">
                <AlertCircle className="w-12 h-12 text-slate-500 mb-4" />
                <p className="text-lg font-semibold text-foreground mb-2">No signals generated yet</p>
                <p className="text-muted-foreground text-center">Click "Generate Signals" to analyze open markets and discover trading opportunities</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
