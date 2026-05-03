import { useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { trpc } from "@/lib/trpc";
import { Activity, Radar, TrendingDown, TrendingUp, Zap } from "lucide-react";

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
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="mb-2 bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400 bg-clip-text text-4xl font-bold text-transparent">
              Sentiment Analysis
            </h1>
            <p className="text-slate-400 max-w-3xl">
              Blend internal conviction with an external topic-tone feed so the trading stack reacts to real-world narrative pressure,
              not only manual sliders.
            </p>
          </div>

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
        </div>

        <Card className="border border-slate-800 bg-gradient-to-br from-slate-900/90 to-slate-950/90 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Composite Sentiment Score</CardTitle>
            <CardDescription>
              Weighted view across news, social, market action, and external topic attention.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <div className={`text-6xl font-bold bg-gradient-to-r ${getSentimentColor(overallSentiment)} bg-clip-text text-transparent`}>
                      {overallSentiment.toFixed(2)}
                    </div>
                    <p className="mt-2 text-lg text-slate-300">{getSentimentLabel(overallSentiment)}</p>
                    <p className="mt-1 text-sm text-slate-500">Current topic: {topic}</p>
                  </div>
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
                    {overallSentiment >= 0 ? (
                      <TrendingUp className="h-12 w-12 text-emerald-400" />
                    ) : (
                      <TrendingDown className="h-12 w-12 text-rose-400" />
                    )}
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
                <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                  <div className="flex items-center gap-3 text-slate-300">
                    <Radar className="h-5 w-5 text-cyan-400" />
                    Confidence
                  </div>
                  <div className="mt-3 text-4xl font-semibold text-cyan-300">{(confidence * 100).toFixed(0)}%</div>
                  <p className="mt-2 text-sm text-slate-500">Higher when source agreement and external coverage depth improve.</p>
                </div>
                <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                  <div className="flex items-center gap-3 text-slate-300">
                    <Activity className="h-5 w-5 text-emerald-400" />
                    Live Headline Count
                  </div>
                  <div className="mt-3 text-4xl font-semibold text-emerald-300">{liveNews?.articleCount ?? 0}</div>
                  <p className="mt-2 text-sm text-slate-500">Recent GNews headlines blended into the news component for the selected topic.</p>
                </div>
                <div className="rounded-3xl border border-slate-800 bg-slate-950/70 p-6">
                  <div className="flex items-center gap-3 text-slate-300">
                    <Activity className="h-5 w-5 text-fuchsia-400" />
                    Live Social Mentions
                  </div>
                  <div className="mt-3 text-4xl font-semibold text-fuchsia-300">{liveSocial?.mentions ?? 0}</div>
                  <p className="mt-2 text-sm text-slate-500">Topic-matching Reddit posts currently influencing the crowd-pulse component.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl lg:col-span-2">
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

          <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
            <CardHeader>
              <CardTitle>External Signal Stack</CardTitle>
              <CardDescription>Independent attention momentum plus live news and crowd-pulse signals for the selected topic.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Topic</div>
                <div className="mt-2 text-lg font-medium text-slate-100">{topic}</div>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Live News Sentiment</div>
                <div className="mt-2 text-3xl font-semibold text-blue-300">{formatSigned(liveNews?.derivedSentiment ?? 0)}</div>
                <p className="mt-2 text-xs text-slate-500">Headline-derived tone from the latest GNews articles for this topic.</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Reddit Crowd Pulse</div>
                <div className="mt-2 text-3xl font-semibold text-fuchsia-300">{formatSigned(composite?.inputs.social ?? socialSentiment)}</div>
                <p className="mt-2 text-xs text-slate-500">Blended from manual crowd bias and live Reddit discussion in the most relevant public subreddit.</p>
              </div>
              <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
                <div className="text-xs uppercase tracking-[0.2em] text-slate-500">Attention Momentum</div>
                <div className="mt-2 text-3xl font-semibold text-emerald-300">{formatSigned(composite?.inputs.external ?? 0)}</div>
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

        <Card className="border border-slate-800 bg-slate-900/70 backdrop-blur-xl">
          <CardHeader>
            <CardTitle>Weighted Contribution Breakdown</CardTitle>
            <CardDescription>See exactly how each source contributes to the final score.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {sourceCards.map((source) => (
                <div key={source.key} className="rounded-2xl border border-slate-800 bg-slate-950/70 p-5">
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
