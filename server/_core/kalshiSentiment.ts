/**
 * Sentiment Analysis Framework for Kalshi Markets
 * Integrates news, social media, and market sentiment
 */

export interface SentimentData {
  marketId: string;
  sentiment: number; // -1 to 1 (negative to positive)
  confidence: number; // 0 to 1
  sources: {
    news: number; // -1 to 1
    social: number; // -1 to 1
    market: number; // -1 to 1
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
  sentiment: number; // -1 to 1
  relevance: number; // 0 to 1
}

/**
 * Calculate sentiment score from multiple sources
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
  return Math.max(-1, Math.min(1, weighted));
}

/**
 * Extract sentiment from news articles
 * Uses simple keyword-based approach (can be enhanced with ML)
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

    totalSentiment += Math.max(-1, Math.min(1, sentiment));
  });

  return totalSentiment / articles.length;
}

/**
 * Calculate market sentiment from price action
 * Positive if prices trending up, negative if trending down
 */
export function calculateMarketSentiment(
  priceHistory: Array<{ price: number; timestamp: number }>
): number {
  if (priceHistory.length < 2) return 0;

  const sorted = [...priceHistory].sort((a, b) => a.timestamp - b.timestamp);
  const startPrice = sorted[0].price;
  const endPrice = sorted[sorted.length - 1].price;

  const change = (endPrice - startPrice) / startPrice;
  return Math.max(-1, Math.min(1, change * 10)); // Scale to -1 to 1
}

/**
 * Integrate sentiment into signal confidence
 */
export function applySentimentBoost(
  baseConfidence: number,
  sentiment: number,
  sentimentWeight = 0.2
): number {
  const sentimentBoost = sentiment * sentimentWeight;
  return Math.max(0, Math.min(1, baseConfidence + sentimentBoost));
}

/**
 * Generate sentiment-adjusted signals
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
  }));
}
