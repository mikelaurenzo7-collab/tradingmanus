import { trpc } from "@/lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, TrendingUp, Zap, AlertTriangle, BookOpen, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function Strategies() {
  const signals = trpc.kalshi.getRecentSignals.useQuery();
  const marketsQuery = trpc.kalshi.getMarkets.useQuery({ status: "open" });
  const generateSignalsMutation = trpc.kalshi.generateSignals.useMutation();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerateSignals = async () => {
    if (!marketsQuery.data || marketsQuery.data.length === 0) {
      toast.error("No open markets available");
      return;
    }

    setIsGenerating(true);
    try {
      const marketIds = marketsQuery.data.slice(0, 10).map((m: any) => m.id);
      const result = await generateSignalsMutation.mutateAsync({
        marketIds,
        minConfidence: 0.5,
      });

      if (result.success) {
        toast.success(`Generated ${result.signals.length} strategies`);
        await signals.refetch();
      } else {
        toast.error(result.error || "Failed to generate strategies");
      }
    } catch (error) {
      console.error("Failed to generate strategies:", error);
      toast.error("Error generating strategies");
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
        return "Mispricing opportunity - fundamental probability diverges from market";
      case "momentum":
        return "Strong directional movement with volume confirmation";
      case "contrarian":
        return "Extreme condition suggesting reversal potential";
      default:
        return "Trading strategy signal";
    }
  };

  const getConfidenceBadgeColor = (confidence: number) => {
    if (confidence >= 0.8) return "bg-gradient-to-r from-cyan-500 to-cyan-600 text-black font-bold";
    if (confidence >= 0.6) return "bg-gradient-to-r from-yellow-500 to-yellow-600 text-black font-bold";
    return "bg-gradient-to-r from-orange-500 to-orange-600 text-black font-bold";
  };

  if (signals.isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Sparkles className="w-8 h-8 text-primary animate-spin" />
          <div>
            <h1 className="text-4xl font-bold gradient-text">STRATEGY REGISTRY</h1>
            <p className="text-muted-foreground mt-1">Loading strategies...</p>
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
          <h1 className="text-4xl font-bold gradient-text mb-2">STRATEGY REGISTRY</h1>
          <p className="text-muted-foreground">Validated trading strategies with confidence scoring and performance metrics</p>
        </div>
        <Button
          onClick={handleGenerateSignals}
          disabled={isGenerating || marketsQuery.isLoading}
          className="laurenzo-button whitespace-nowrap"
        >
          <BookOpen className="w-5 h-5 mr-2" />
          {isGenerating ? "Generating..." : "Generate Strategies"}
        </Button>
      </div>

      {/* Strategies Grid */}
      <div className="grid gap-6">
        {signals.data && signals.data.length > 0 ? (
          signals.data.map((signal: any) => (
            <Card
              key={signal.id}
              className="border-0 backdrop-blur-xl bg-gradient-to-br from-slate-800/40 to-slate-900/40 border border-slate-700/50 hover:border-violet-400/50 transition-all duration-300 hover:shadow-2xl"
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="p-3 rounded-xl bg-slate-700/50">
                      {getSignalIcon(signal.signalType)}
                    </div>
                    <div>
                      <CardTitle className="text-xl gradient-text capitalize">
                        {signal.signalType.replace(/_/g, " ")}
                      </CardTitle>
                      <CardDescription className="text-slate-400 mt-1">
                        {getSignalDescription(signal.signalType)}
                      </CardDescription>
                    </div>
                  </div>
                  <Badge className={`${getConfidenceBadgeColor(signal.confidence)} px-3 py-1 text-sm`}>
                    {(signal.confidence * 100).toFixed(0)}% CONF
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
          ))
        ) : (
          <Card className="border-0 bg-gradient-to-br from-slate-800/40 to-slate-900/40 backdrop-blur-xl">
            <CardContent className="pt-12 pb-12 flex flex-col items-center justify-center">
              <AlertCircle className="w-12 h-12 text-slate-500 mb-4" />
              <p className="text-lg font-semibold text-foreground mb-2">No strategies registered</p>
              <p className="text-muted-foreground text-center">Click "Generate Strategies" to analyze open markets and register validated trading strategies</p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
