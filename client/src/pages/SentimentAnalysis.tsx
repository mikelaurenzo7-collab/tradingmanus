import { useState } from "react";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { trpc } from "@/lib/trpc";
import { TrendingUp, TrendingDown, Zap } from "lucide-react";

export default function SentimentAnalysis() {
  const [newsSentiment, setNewsSentiment] = useState(0);
  const [socialSentiment, setSocialSentiment] = useState(0);
  const [marketSentiment, setMarketSentiment] = useState(0);

  const sentimentQuery = trpc.advanced.sentiment.calculateSentiment.useQuery(
    {
      newsSentiment,
      socialSentiment,
      marketSentiment,
    },
    { enabled: true }
  );

  const overallSentiment = sentimentQuery.data ?? 0;

  const getSentimentColor = (value: number) => {
    if (value > 0.3) return "from-green-500 to-emerald-500";
    if (value < -0.3) return "from-red-500 to-pink-500";
    return "from-yellow-500 to-orange-500";
  };

  const getSentimentLabel = (value: number) => {
    if (value > 0.3) return "Bullish";
    if (value < -0.3) return "Bearish";
    return "Neutral";
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-4xl font-bold bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-transparent mb-2">
            Sentiment Analysis
          </h1>
          <p className="text-slate-400">Monitor market sentiment from multiple sources</p>
        </div>

        {/* Overall Sentiment Card */}
        <Card className="mb-8 border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Overall Market Sentiment</CardTitle>
            <CardDescription>Composite sentiment score from all sources</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="flex-1">
                <div className={`text-5xl font-bold bg-gradient-to-r ${getSentimentColor(overallSentiment)} bg-clip-text text-transparent mb-2`}>
                  {overallSentiment.toFixed(2)}
                </div>
                <p className="text-lg text-slate-400">
                  {getSentimentLabel(overallSentiment)}
                </p>
              </div>
              <div className="text-6xl">
                {overallSentiment > 0 ? (
                  <TrendingUp className="text-green-500" />
                ) : (
                  <TrendingDown className="text-red-500" />
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Sentiment Sliders */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          {/* News Sentiment */}
          <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-lg">News Sentiment</CardTitle>
              <CardDescription>Sentiment from news articles</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div className="text-3xl font-bold text-blue-400 mb-2">
                  {newsSentiment.toFixed(2)}
                </div>
                <Slider
                  value={[newsSentiment]}
                  onValueChange={(value) => setNewsSentiment(value[0])}
                  min={-1}
                  max={1}
                  step={0.1}
                  className="w-full"
                />
              </div>
              <p className="text-xs text-slate-500">Range: -1 (Bearish) to +1 (Bullish)</p>
            </CardContent>
          </Card>

          {/* Social Sentiment */}
          <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-lg">Social Sentiment</CardTitle>
              <CardDescription>Sentiment from social media</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div className="text-3xl font-bold text-purple-400 mb-2">
                  {socialSentiment.toFixed(2)}
                </div>
                <Slider
                  value={[socialSentiment]}
                  onValueChange={(value) => setSocialSentiment(value[0])}
                  min={-1}
                  max={1}
                  step={0.1}
                  className="w-full"
                />
              </div>
              <p className="text-xs text-slate-500">Range: -1 (Bearish) to +1 (Bullish)</p>
            </CardContent>
          </Card>

          {/* Market Sentiment */}
          <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-lg">Market Sentiment</CardTitle>
              <CardDescription>Sentiment from price action</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="mb-4">
                <div className="text-3xl font-bold text-cyan-400 mb-2">
                  {marketSentiment.toFixed(2)}
                </div>
                <Slider
                  value={[marketSentiment]}
                  onValueChange={(value) => setMarketSentiment(value[0])}
                  min={-1}
                  max={1}
                  step={0.1}
                  className="w-full"
                />
              </div>
              <p className="text-xs text-slate-500">Range: -1 (Bearish) to +1 (Bullish)</p>
            </CardContent>
          </Card>
        </div>

        {/* Sentiment Breakdown */}
        <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Sentiment Breakdown</CardTitle>
            <CardDescription>Weighted sentiment analysis from all sources</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <h3 className="font-semibold text-slate-300 mb-4">News Sentiment</h3>
                <div className="text-3xl font-bold text-blue-400">{newsSentiment.toFixed(2)}</div>
                <p className="text-sm text-slate-500 mt-2">Weight: 40%</p>
              </div>
              <div>
                <h3 className="font-semibold text-slate-300 mb-4">Social Sentiment</h3>
                <div className="text-3xl font-bold text-purple-400">{socialSentiment.toFixed(2)}</div>
                <p className="text-sm text-slate-500 mt-2">Weight: 30%</p>
              </div>
              <div>
                <h3 className="font-semibold text-slate-300 mb-4">Market Sentiment</h3>
                <div className="text-3xl font-bold text-cyan-400">{marketSentiment.toFixed(2)}</div>
                <p className="text-sm text-slate-500 mt-2">Weight: 30%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Loading State */}
        {sentimentQuery.isLoading && (
          <Card className="border border-slate-700 bg-gradient-to-br from-slate-800/50 to-slate-900/50 backdrop-blur-xl">
            <CardContent className="pt-6">
            <div className="flex items-center justify-center">
              <Zap className="animate-spin text-cyan-400 mr-2" />
              <span className="text-slate-400">Calculating sentiment...</span>
            </div>
          </CardContent>
        </Card>
        )}
      </div>
    </div>
  );
}
