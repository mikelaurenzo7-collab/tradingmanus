import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { trpc } from "@/lib/trpc";
import { Activity, Radar, TrendingDown, TrendingUp, Zap } from "lucide-react";
import { StatCard } from "@/components/widgets/StatCard";
import { DistributionChart } from "@/components/charts/DistributionChart";
import { PageHeader } from "@/components/PageHeader";

function formatSigned(value: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}`;
}

export default function SentimentAnalysis() {
  const [newsSentiment, setNewsSentiment] = useState(0.1);
  const [socialSentiment, setSocialSentiment] = useState(0.05);
  const [marketSentiment, setMarketSentiment] = useState(0.15);
  const [draftTopic, setDraftTopic] = useState("US election");
  const [topic, setTopic] = useState("US election");

  const canApplyTopic = draftTopic.trim().length >= 2;

  const sentimentQuery = trpc.advanced.sentiment.calculateCompositeSentiment.useQuery(
    {
      newsSentiment,
      socialSentiment,
      marketSentiment,
      topic,
    },
    {
      enabled: topic.trim().length >= 2,
    }
  );

  const composite = sentimentQuery.data;
  const overallSentiment = composite?.overallSentiment ?? 0;
  const confidence = composite?.confidence ?? 0;
  const externalSignal = composite?.externalSignal;
  const liveNews = composite?.liveNews;
  const liveSocial = composite?.liveSocial;

  const sourceCards = useMemo(
    () => [
      {
        key: "news",
        label: "News",
        description: liveNews
          ? `Blended manual conviction with ${liveNews.articleCount} live GNews headline${liveNews.articleCount === 1 ? "" : "s"}`
          : "Manual directional read from headlines and reporting",
        value: composite?.inputs.news ?? newsSentiment,
        weight: composite?.weights.news ?? 0.3,
        contribution: composite?.contributions.news ?? 0,
        color: "text-blue-400",
      },
      {
        key: "social",
        label: "Social",
        description: liveSocial
          ? `Blended manual crowd read with ${liveSocial.postCount} live Reddit post${liveSocial.postCount === 1 ? "" : "s"} from r/${liveSocial.subreddit}`
          : "Crowd positioning and social chatter",
        value: composite?.inputs.social ?? socialSentiment,
        weight: composite?.weights.social ?? 0.2,
        contribution: composite?.contributions.social ?? 0,
        color: "text-fuchsia-400",
      },
      {
        key: "market",
        label: "Market",
        description: "Price-action based directional pressure",
        value: composite?.inputs.market ?? marketSentiment,
        weight: composite?.weights.market ?? 0.2,
        contribution: composite?.contributions.market ?? 0,
        color: "text-cyan-400",
      },
      {
        key: "external",
        label: "Wikimedia Attention",
        description: `External attention momentum for “${topic}”`,
        value: composite?.inputs.external ?? 0,
        weight: composite?.weights.external ?? 0.3,
        contribution: composite?.contributions.external ?? 0,
        color: "text-emerald-400",
      },
    ],
    [composite, marketSentiment, newsSentiment, socialSentiment, topic]
  );

  const getSentimentColor = (value: number) => {
    if (value > 0.3) return "emerald";
    if (value < -0.3) return "rose";
    return "slate";
  };

  const getSentimentGradient = (value: number) => {
    if (value > 0.3) return "from-emerald-400 to-cyan-400";
    if (value < -0.3) return "from-rose-400 to-orange-400";
    return "from-amber-400 to-yellow-300";
  };

  const getSentimentLabel = (value: number) => {
    if (value > 0.45) return "Strong Bullish";
    if (value > 0.15) return "Bullish";
    if (value < -0.45) return "Strong Bearish";
    if (value < -0.15) return "Bearish";
    return "Neutral";
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <PageHeader
        icon={Radar}
        title="Sentiment Analysis"
        description="Multi-source sentiment scoring with live feeds and attention momentum"
        iconGradient="from-violet-500 to-pink-500"
        actions={
          <div className="w-full max-w-xl rounded-2xl border border-slate-800 bg-slate-900/70 p-4 backdrop-blur-xl">
            <div className="flex flex-col gap-3 sm:flex-row">
              <Input
                value={draftTopic}
                onChange={(event) => setDraftTopic(event.target.value)}
                placeholder="Enter a market topic, e.g. Fed rates or US election"
                className="border-slate-700 bg-slate-950 text-slate-100"
              />
              <Button
                type="button"
                disabled={!canApplyTopic}
                onClick={() => setTopic(draftTopic.trim())}
                className="bg-gradient-to-r from-cyan-500 to-violet-500 text-white hover:from-cyan-400 hover:to-violet-400"
              >
                Refresh Topic Signal
              </Button>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              The score now blends live GNews headlines, Reddit crowd pulse, and Wikimedia attention momentum so the stack reacts to event flow, crowd chatter, and public attention.
            </p>
          </div>
        }
      />

        {/* Summary Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-fade-in">
          <div className="laurenzo-card glass-card">
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ backgroundColor: `${overallSentiment >= 0 ? '#10b981' : '#f43f5e'}20` }}>
                {overallSentiment >= 0 ? <TrendingUp className="w-5 h-5 text-emerald-400" /> : <TrendingDown className="w-5 h-5 text-rose-400" />}
              </div>
            </div>
            <div className="text-3xl font-bold tracking-tight mb-3">
              <span className="gradient-text bg-gradient-to-r from-emerald-400 to-cyan-400">
                {overallSentiment.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Overall Score</span>
            </div>
          </div>
          <StatCard 
            label="Bullish Sources" 
            value={sourceCards.filter(s => s.value > 0.1).length} 
            color="#10b981" 
          />
          <StatCard 
            label="Bearish Sources" 
            value={sourceCards.filter(s => s.value < -0.1).length} 
            color="#f43f5e" 
          />
          <div className="laurenzo-card glass-card">
            <div className="flex items-start justify-between mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-between" style={{ backgroundColor: '#06b6d420' }}>
                <Activity className="w-5 h-5 text-cyan-400" />
              </div>
              <div className="live-dot" />
            </div>
            <div className="text-3xl font-bold tracking-tight mb-3 text-slate-100">
              {(liveNews?.articleCount ?? 0) + (liveSocial?.postCount ?? 0)}
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-400">Live Feeds</span>
            </div>
          </div>
        </div>

        <Card className="laurenzo-card glass-card border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950/90 backdrop-blur-xl animate-fade-in">
          <CardHeader>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-violet-400" />
              <CardTitle>Sentiment Distribution</CardTitle>
            </div>
            <CardDescription>
              Breakdown of source contributions to the composite score.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <DistributionChart
              data={sourceCards.map((source) => ({
                label: source.label,
                value: Math.abs(source.contribution),
                color: source.color.replace('text-', ''),
              }))}
              height={300}
            />
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3 animate-fade-in">
          <Card className="laurenzo-card glass-card border border-slate-800 bg-slate-900/70 backdrop-blur-xl lg:col-span-2">
            <CardHeader>
              <CardTitle>Manual Source Controls</CardTitle>
              <CardDescription>Adjust the in-house view and compare it with the external topic signal.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-8">
              {[
                {
                  label: "News Sentiment",
                  value: newsSentiment,
                  onChange: setNewsSentiment,
                  color: "text-blue-400",
                },
                {
                  label: "Social Sentiment",
                  value: socialSentiment,
                  onChange: setSocialSentiment,
                  color: "text-fuchsia-400",
                },
                {
                  label: "Market Sentiment",
                  value: marketSentiment,
                  onChange: setMarketSentiment,
                  color: "text-cyan-400",
                },
              ].map((source) => (
                <div key={source.label}>
                  <div className="mb-3 flex items-center justify-between">
                    <div>
                      <h3 className="text-sm font-medium text-slate-200">{source.label}</h3>
                      <p className="text-xs text-slate-500">Range from -1 bearish to +1 bullish.</p>
                    </div>
                    <div className={`text-2xl font-semibold ${source.color}`}>{formatSigned(source.value)}</div>
                  </div>
                  <Slider
                    value={[source.value]}
                    onValueChange={(value) => source.onChange(value[0] ?? 0)}
                    min={-1}
                    max={1}
                    step={0.05}
                    className="w-full"
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="laurenzo-card glass-card border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div className="live-dot" />
                <CardTitle>External Signal Stack</CardTitle>
              </div>
              <CardDescription>Independent attention momentum plus live news and crowd-pulse signals for the selected topic.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Topic</div>
                <div className="mt-2 text-lg font-medium text-slate-100">{topic}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                  <div className="live-dot" />
                  Live News Sentiment
                </div>
                <div className={`mt-2 text-3xl font-semibold gradient-text bg-gradient-to-r ${
                  (liveNews?.derivedSentiment ?? 0) > 0 ? "from-emerald-400 to-teal-400" : 
                  (liveNews?.derivedSentiment ?? 0) < 0 ? "from-rose-400 to-orange-400" : 
                  "from-slate-400 to-slate-500"
                }`}>{formatSigned(liveNews?.derivedSentiment ?? 0)}</div>
                <p className="mt-2 text-xs text-slate-500">Headline-derived tone from the latest GNews articles for this topic.</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-slate-500">
                  <div className="live-dot" />
                  Reddit Crowd Pulse
                </div>
                <div className={`mt-2 text-3xl font-semibold gradient-text bg-gradient-to-r ${
                  (composite?.inputs.social ?? socialSentiment) > 0 ? "from-emerald-400 to-teal-400" : 
                  (composite?.inputs.social ?? socialSentiment) < 0 ? "from-rose-400 to-orange-400" : 
                  "from-slate-400 to-slate-500"
                }`}>{formatSigned(composite?.inputs.social ?? socialSentiment)}</div>
                <p className="mt-2 text-xs text-slate-500">Blended from manual crowd bias and live Reddit discussion in the most relevant public subreddit.</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Attention Momentum</div>
                <div className={`mt-2 text-3xl font-semibold ${
                  (composite?.inputs.external ?? 0) > 0 ? "text-emerald-300" : 
                  (composite?.inputs.external ?? 0) < 0 ? "text-rose-300" : 
                  "text-slate-300"
                }`}>{formatSigned(composite?.inputs.external ?? 0)}</div>
                <p className="mt-2 text-xs text-slate-500">Derived from the change in recent Wikipedia attention for the selected topic.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Momentum</div>
                  <div className="mt-2 text-xl font-semibold text-slate-100">{formatSigned(externalSignal?.averageTone ?? 0)}</div>
                </div>
                <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Signal Confidence</div>
                  <div className="mt-2 text-xl font-semibold text-slate-100">{((externalSignal?.confidence ?? 0) * 100).toFixed(0)}%</div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Latest Headlines</div>
                <div className="mt-3 space-y-3">
                  {liveNews?.headlines?.length ? (
                    liveNews.headlines.slice(0, 3).map((headline) => (
                      <a
                        key={`${headline.url}-${headline.title}`}
                        href={headline.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-xl border border-slate-800 bg-slate-900/60 p-3 transition hover:border-cyan-500/50 hover:bg-slate-900"
                      >
                        <div className="text-sm font-medium text-slate-100">{headline.title}</div>
                        <div className="mt-1 text-xs text-slate-500">{headline.source} · {new Date(headline.publishedAt).toLocaleString()}</div>
                      </a>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-500">
                      No live headlines available for this topic yet.
                    </div>
                  )}
                </div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Reddit Crowd Posts</div>
                <div className="mt-3 space-y-3">
                  {liveSocial?.posts?.length ? (
                    liveSocial.posts.slice(0, 3).map((post) => (
                      <a
                        key={`${post.url}-${post.title}`}
                        href={post.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block rounded-xl border border-slate-800 bg-slate-900/60 p-3 transition hover:border-fuchsia-500/50 hover:bg-slate-900"
                      >
                        <div className="text-sm font-medium text-slate-100">{post.title}</div>
                        <div className="mt-1 text-xs text-slate-500">r/{post.subreddit} · score {post.score} · comments {post.commentCount}</div>
                      </a>
                    ))
                  ) : (
                    <div className="rounded-xl border border-dashed border-slate-800 bg-slate-900/40 p-3 text-sm text-slate-500">
                      No live Reddit crowd posts matched this topic yet.
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="laurenzo-card glass-card border border-slate-800 bg-slate-900/70 backdrop-blur-xl animate-fade-in">
          <CardHeader>
            <CardTitle>Weighted Contribution Breakdown</CardTitle>
            <CardDescription>See exactly how each source contributes to the final score.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {sourceCards.map((source, idx) => (
                <div key={source.key} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5 animate-fade-in" style={{ animationDelay: `${idx * 100}ms` }}>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h3 className="text-base font-medium text-slate-100">{source.label}</h3>
                      <p className="mt-1 text-xs text-slate-500">{source.description}</p>
                    </div>
                    <div className={`text-lg font-semibold ${source.color}`}>{formatSigned(source.value)}</div>
                  </div>
                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                      <div className="text-slate-500">Weight</div>
                      <div className="mt-1 font-medium text-slate-100">{(source.weight * 100).toFixed(0)}%</div>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-3">
                      <div className="text-slate-500">Contribution</div>
                      <div className="mt-1 font-medium text-slate-100">{formatSigned(source.contribution)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {sentimentQuery.isLoading && (
          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardContent className="flex items-center justify-center gap-3 py-10 text-slate-400">
              <Zap className="h-5 w-5 animate-spin text-cyan-400" />
              Refreshing composite sentiment, live headlines, crowd pulse, and external attention…
            </CardContent>
          </Card>
        )}

        {sentimentQuery.error && (
          <Card className="border border-rose-900/60 bg-rose-950/30 backdrop-blur-xl">
            <CardHeader>
              <CardTitle className="text-rose-300">External Signal Unavailable</CardTitle>
              <CardDescription className="text-rose-200/80">
                The local sliders still work, but the live headline, crowd-pulse, or attention sources could not be refreshed right now.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-rose-100/90">{sentimentQuery.error.message}</p>
            </CardContent>
          </Card>
        )}
    </div>
  );
}
