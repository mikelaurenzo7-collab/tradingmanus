/**
 * Sentiment Analysis Framework for Kalshi Markets
 * Integrates news, social media, market action, and external topic attention.
 */

export interface SentimentData {
  marketId: string;
  sentiment: number;
  confidence: number;
  sources: {
    news: number;
    social: number;
    market: number;
    external?: number;
  };
  newsCount: number;
  socialMentions: number;
  lastUpdated: Date;
}

export interface NewsArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: Date;
  sentiment: number;
  relevance: number;
}

export interface SentimentWeights {
  news: number;
  social: number;
  market: number;
  external: number;
}

export interface ExternalTopicSignal {
  source: "wikimedia";
  topic: string;
  articleCount: number;
  averageTone: number;
  normalizedSentiment: number;
  confidence: number;
  queriedAt: Date;
}

export interface CompositeSentimentResult {
  overallSentiment: number;
  confidence: number;
  inputs: {
    news: number;
    social: number;
    market: number;
    external: number;
  };
  weights: SentimentWeights;
  contributions: {
    news: number;
    social: number;
    market: number;
    external: number;
  };
  externalSignal: ExternalTopicSignal | null;
}

const DEFAULT_SENTIMENT_WEIGHTS: SentimentWeights = {
  news: 0.3,
  social: 0.2,
  market: 0.2,
  external: 0.3,
};

function clampSentiment(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

function clampUnit(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function normalizeWeights(weights: SentimentWeights): SentimentWeights {
  const safeWeights = {
    news: Math.max(0, weights.news),
    social: Math.max(0, weights.social),
    market: Math.max(0, weights.market),
    external: Math.max(0, weights.external),
  };
  const total = safeWeights.news + safeWeights.social + safeWeights.market + safeWeights.external;

  if (total <= 0) {
    return DEFAULT_SENTIMENT_WEIGHTS;
  }

  return {
    news: safeWeights.news / total,
    social: safeWeights.social / total,
    market: safeWeights.market / total,
    external: safeWeights.external / total,
  };
}

function slugifyTopic(topic: string) {
  return topic
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[?&#%]/g, "")
    .slice(0, 120);
}

function formatDateForWikimedia(date: Date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/**
 * Calculate sentiment score from three local sources.
 */
export function calculateSentiment(
  newsSentiment: number,
  socialSentiment: number,
  marketSentiment: number,
  weights = { news: 0.4, social: 0.3, market: 0.3 }
): number {
  const weighted =
    newsSentiment * weights.news +
    socialSentiment * weights.social +
    marketSentiment * weights.market;
  return clampSentiment(weighted);
}

/**
 * Calculate a richer four-source sentiment score with contribution details.
 */
export function calculateCompositeSentiment(params: {
  newsSentiment: number;
  socialSentiment: number;
  marketSentiment: number;
  externalSentiment?: number;
  externalConfidence?: number;
  weights?: Partial<SentimentWeights>;
  externalSignal?: ExternalTopicSignal | null;
}): CompositeSentimentResult {
  const weights = normalizeWeights({
    ...DEFAULT_SENTIMENT_WEIGHTS,
    ...(params.weights ?? {}),
  });

  const inputs = {
    news: clampSentiment(params.newsSentiment),
    social: clampSentiment(params.socialSentiment),
    market: clampSentiment(params.marketSentiment),
    external: clampSentiment(params.externalSentiment ?? 0),
  };

  const contributions = {
    news: inputs.news * weights.news,
    social: inputs.social * weights.social,
    market: inputs.market * weights.market,
    external: inputs.external * weights.external,
  };

  const overallSentiment = clampSentiment(
    contributions.news + contributions.social + contributions.market + contributions.external
  );

  const directionalStrength =
    Math.abs(inputs.news) * weights.news +
    Math.abs(inputs.social) * weights.social +
    Math.abs(inputs.market) * weights.market +
    Math.abs(inputs.external) * weights.external;

  const externalConfidence = clampUnit(params.externalConfidence ?? params.externalSignal?.confidence ?? 0);
  const confidence = clampUnit(directionalStrength * 0.75 + externalConfidence * 0.25);

  return {
    overallSentiment,
    confidence,
    inputs,
    weights,
    contributions,
    externalSignal: params.externalSignal ?? null,
  };
}

/**
 * Fetch recent topic attention from Wikimedia pageviews and convert it to a bounded signal.
 * The external sentiment is based on recent attention momentum for the topic article.
 */
export async function fetchGdeltTopicSignal(topic: string): Promise<ExternalTopicSignal | null> {
  const cleanTopic = topic.trim();
  if (!cleanTopic) {
    return null;
  }

  const article = slugifyTopic(cleanTopic);
  const end = new Date();
  const start = new Date(end.getTime() - 13 * 24 * 60 * 60 * 1000);
  const startDate = formatDateForWikimedia(start);
  const endDate = formatDateForWikimedia(end);
  const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/all-agents/${encodeURIComponent(article)}/daily/${startDate}/${endDate}`;

  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "nexus-omega-dashboard/1.0 (sentiment analysis)",
      },
    });

    if (!response.ok) {
      return {
        source: "wikimedia",
        topic: cleanTopic,
        articleCount: 0,
        averageTone: 0,
        normalizedSentiment: 0,
        confidence: 0,
        queriedAt: new Date(),
      };
    }

    const payload = (await response.json()) as {
      items?: Array<{ views?: number }>;
    };

    const views = Array.isArray(payload.items)
      ? payload.items.map((item) => Math.max(0, Number(item.views ?? 0))).filter((value) => Number.isFinite(value))
      : [];

    if (views.length < 4) {
      return {
        source: "wikimedia",
        topic: cleanTopic,
        articleCount: views[views.length - 1] ?? 0,
        averageTone: 0,
        normalizedSentiment: 0,
        confidence: 0,
        queriedAt: new Date(),
      };
    }

    const splitIndex = Math.floor(views.length / 2);
    const priorWindow = views.slice(0, splitIndex);
    const recentWindow = views.slice(splitIndex);
    const priorAverage = priorWindow.reduce((sum, value) => sum + value, 0) / Math.max(1, priorWindow.length);
    const recentAverage = recentWindow.reduce((sum, value) => sum + value, 0) / Math.max(1, recentWindow.length);
    const momentum = priorAverage > 0 ? (recentAverage - priorAverage) / priorAverage : 0;
    const normalizedSentiment = clampSentiment(momentum * 2.5);
    const confidence = clampUnit(Math.min(1, Math.log10(recentAverage + 1) / 4));

    return {
      source: "wikimedia",
      topic: cleanTopic,
      articleCount: Math.round(recentAverage),
      averageTone: momentum,
      normalizedSentiment,
      confidence,
      queriedAt: new Date(),
    };
  } catch (error) {
    console.error("[Sentiment] Wikimedia topic fetch failed:", error);
    return null;
  }
}

/**
 * Extract sentiment from news articles.
 */
export function extractNewsSentiment(articles: NewsArticle[]): number {
  if (articles.length === 0) return 0;

  const positiveKeywords = [
    "bullish",
    "surge",
    "gain",
    "breakthrough",
    "outperform",
    "rally",
    "strong",
    "record",
    "profit",
    "success",
  ];
  const negativeKeywords = [
    "bearish",
    "crash",
    "loss",
    "decline",
    "underperform",
    "weak",
    "fail",
    "risk",
    "concern",
    "warning",
  ];

  let totalSentiment = 0;
  articles.forEach((article) => {
    const titleLower = article.title.toLowerCase();
    let sentiment = 0;

    positiveKeywords.forEach((keyword) => {
      if (titleLower.includes(keyword)) sentiment += 0.1;
    });

    negativeKeywords.forEach((keyword) => {
      if (titleLower.includes(keyword)) sentiment -= 0.1;
    });

    totalSentiment += clampSentiment(sentiment);
  });

  return totalSentiment / articles.length;
}

/**
 * Calculate market sentiment from price action.
 */
export function calculateMarketSentiment(
  priceHistory: Array<{ price: number; timestamp: number }>
): number {
  if (priceHistory.length < 2) return 0;

  const sorted = [...priceHistory].sort((a, b) => a.timestamp - b.timestamp);
  const startPrice = sorted[0].price;
  const endPrice = sorted[sorted.length - 1].price;

  if (!Number.isFinite(startPrice) || !Number.isFinite(endPrice) || startPrice === 0) {
    return 0;
  }

  const change = (endPrice - startPrice) / startPrice;
  return clampSentiment(change * 10);
}

/**
 * Integrate sentiment into signal confidence.
 */
export function applySentimentBoost(
  baseConfidence: number,
  sentiment: number,
  sentimentWeight = 0.2
): number {
  const sentimentBoost = sentiment * sentimentWeight;
  return clampUnit(baseConfidence + sentimentBoost);
}

/**
 * Generate sentiment-adjusted signals.
 */
export function generateSentimentSignals(
  marketId: string,
  sentiment: SentimentData,
  baseSignals: Array<{ side: string; confidence: number }>
) {
  return baseSignals.map((signal) => ({
    ...signal,
    confidence: applySentimentBoost(signal.confidence, sentiment.sentiment),
    sentimentAdjusted: true,
    sentimentScore: sentiment.sentiment,
    marketId,
  }));
}
