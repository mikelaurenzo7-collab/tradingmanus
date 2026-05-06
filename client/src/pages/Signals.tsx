import { trpc } from "@/lib/trpc";
import { RefreshCw, Radar, Target, Zap, Activity } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { SignalReviewCard } from "@/components/widgets/SignalReviewCard";
import { MarketCard } from "@/components/widgets/MarketCard";
import { EmptyState } from "@/components/EmptyStates";
import { SignalCardSkeleton } from "@/components/enhanced/Skeletons";

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

  // Helper to derive market title from signal or market data
  const getMarketTitle = (signal: any): string => {
    // Try to find the market in marketsQuery data
    const market = marketsQuery.data?.find((m: any) => m.id === signal.marketId);
    return market?.title || signal.marketId || "Unknown Market";
  };

  // Helper to derive liquidity level from volume
  const getLiquidity = (totalVolume: number): "high" | "medium" | "low" => {
    if (totalVolume >= 1000) return "high";
    if (totalVolume >= 100) return "medium";
    return "low";
  };

  if (signals.isLoading || topSignals.isLoading) {
    return (
      <div className="space-y-8">
        <PageHeader
          icon={Radar}
          title="Signal Registry"
          description="Real-time market signals with confidence scoring and execution readiness"
          iconColor="text-accent"
          actions={
            <Button disabled className="bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-all gap-2 whitespace-nowrap" size="sm">
              <RefreshCw className="w-4 h-4" />
              Generate Signals
            </Button>
          }
        />
        <div className="grid gap-6 lg:grid-cols-3 md:grid-cols-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <SignalCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-fade-in">
      <PageHeader
        icon={Radar}
        title="Signal Registry"
        description="Real-time market signals with confidence scoring and execution readiness"
        iconColor="text-accent"
        actions={
          <Button
            onClick={handleGenerateSignals}
            disabled={isGenerating || generateSignalsMutation.isPending}
            className="bg-gradient-to-r from-primary to-accent hover:opacity-90 transition-all gap-2 whitespace-nowrap"
            size="sm"
          >
            <RefreshCw className={`w-4 h-4 ${isGenerating ? "animate-spin" : ""}`} />
            {isGenerating ? "Generating…" : "Generate Signals"}
          </Button>
        }
      />

      {/* Top Execution-Ready Signals */}
      {topSignals.data && topSignals.data.length > 0 ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-accent" />
            <h2 className="text-2xl font-bold gradient-text">TOP EXECUTION SIGNALS</h2>
          </div>
          <div className="grid gap-6 lg:grid-cols-3 md:grid-cols-2">
            {topSignals.data.map((signal: any) => (
              <SignalReviewCard
                key={signal.id}
                signalId={signal.id}
                marketTitle={getMarketTitle(signal)}
                confidence={signal.confidence}
                expectedValue={signal.expectedValue}
                reasoning={signal.reasoning}
                side={signal.side}
                suggestedPrice={signal.marketPrice}
                className="glass-panel"
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* All Recent Signals */}
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" />
          <h2 className="text-2xl font-bold gradient-text">RECENT SIGNALS</h2>
        </div>
        {signals.data && signals.data.length > 0 ? (
          <div className="grid gap-6">
            {signals.data.map((signal: any, idx: number) => (
              <div
                key={signal.id}
                className="animate-fade-in"
                style={{ animationDelay: `${idx * 50}ms` }}
              >
                <SignalReviewCard
                  signalId={signal.id}
                  marketTitle={getMarketTitle(signal)}
                  confidence={signal.confidence}
                  expectedValue={signal.expectedValue}
                  reasoning={signal.reasoning}
                  side={signal.side}
                  suggestedPrice={signal.marketPrice}
                  className="glass-panel"
                />
              </div>
            ))}
          </div>
        ) : (
          <div className="glass-panel">
            <EmptyState
              icon={Zap}
              title="No signals generated yet"
              message="Click 'Generate Signals' to analyze open markets and discover trading opportunities"
            />
          </div>
        )}
      </div>

      {/* Actionable Markets */}
      {actionableMarkets.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-primary" />
            <h2 className="text-2xl font-bold gradient-text">ACTIONABLE MARKETS</h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-3 md:grid-cols-2">
            {actionableMarkets.slice(0, 12).map((market: any, idx: number) => {
              const totalVolume = Number(market.yesVolume ?? 0) + Number(market.noVolume ?? 0);
              return (
                <div
                  key={market.id}
                  className="animate-fade-in"
                  style={{ animationDelay: `${idx * 30}ms` }}
                >
                  <MarketCard
                    marketId={market.id}
                    title={market.title || market.id}
                    yesPrice={Number(market.yesPrice ?? 0)}
                    noPrice={Number(market.noPrice ?? 0)}
                    volume={totalVolume}
                    liquidity={getLiquidity(totalVolume)}
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
