import type { ReviewerTelemetry } from "./aiToolbelt";
import { ENV } from "./env";
import type { KalshiMarket } from "./kalshiMarketData";
import type { KalshiSignal } from "./kalshiSignals";
import {
  createOpenRouterClient,
  isOpenRouterConfigured,
  type OpenRouterClient,
} from "./openRouterClient";
import { reviewSignalWithOpenRouterKalshiTeam } from "./openRouterKalshiTeam";
import { isOpenRouterTriageConfigured, runOpenRouterTriage } from "./openRouterTriage";
import { checkProfitGuardrails } from "./profitGuardrails";
import {
  classifyMarketCategory,
  type MarketCategory,
} from "./marketCategoryRouter";

const DEFAULT_MAX_SIGNALS = 12;

type TriageCandidate = {
  marketId: string;
  title: string;
  category: string;
  signalType: KalshiSignal["signalType"];
  side: KalshiSignal["side"];
  confidence: number;
  expectedValue: number;
  impliedProbability: number;
};

export type TradingReviewerOptions = {
  skipInTest?: boolean;
  logger?: Pick<Console, "warn" | "error">;
  userId?: number;
  telemetry?: ReviewerTelemetry;
  triageThresholdOverride?: number;
  openRouterApiKey?: string;
  client?: OpenRouterClient;
  // Deprecated compatibility fields retained so downstream code and tests can
  // continue compiling while the provider migration settles.
  anthropicApiKey?: string;
  anthropicModel?: string;
  anthropicTimeoutMs?: number;
  anthropicClient?: unknown;
  deskMemoryByDeskId?: Map<string, unknown>;
};

export type TradingReviewer = {
  reviewSignals(input: {
    markets: KalshiMarket[];
    signals: KalshiSignal[];
    maxSignals?: number;
  }): Promise<KalshiSignal[]>;
};

function clamp(value: number, minimum: number, maximum: number) {
  if (!Number.isFinite(value)) return minimum;
  return Math.max(minimum, Math.min(maximum, value));
}

function categoryOfSignal(
  signal: KalshiSignal,
  marketsById: Map<string, KalshiMarket>,
): MarketCategory {
  const market = marketsById.get(signal.marketId);
  if (!market) return "other";
  return classifyMarketCategory({ category: market.category, title: market.title });
}

export function createTradingReviewer(options: TradingReviewerOptions = {}): TradingReviewer {
  return {
    reviewSignals(input) {
      return reviewSignalsWithTrader(input, options);
    },
  };
}

export function isTradingReviewerConfigured(options: TradingReviewerOptions = {}) {
  if (options.client) return true;
  return isOpenRouterConfigured(options.openRouterApiKey ?? ENV.openRouterApiKey);
}

async function applyTriageFilter(
  signals: KalshiSignal[],
  marketsById: Map<string, KalshiMarket>,
  options: TradingReviewerOptions,
  logger: Pick<Console, "warn" | "error">,
): Promise<KalshiSignal[]> {
  if (!signals.length) return signals;
  if (!isOpenRouterTriageConfigured()) return signals;
  if (!isTradingReviewerConfigured(options)) return signals;

  const threshold = options.triageThresholdOverride ?? ENV.openRouterTriageThreshold;
  if (signals.length <= threshold) return signals;

  const triageInput: TriageCandidate[] = signals.map((signal) => {
    const market = marketsById.get(signal.marketId);
    return {
      marketId: signal.marketId,
      title: market?.title ?? signal.marketId,
      category: market?.category ?? "other",
      signalType: signal.signalType,
      side: signal.side,
      confidence: signal.confidence,
      expectedValue: signal.expectedValue,
      impliedProbability: signal.impliedProbability,
    };
  });

  const keep = await runOpenRouterTriage(triageInput, {
    timeoutMs: ENV.openRouterTimeoutMs,
    log: logger,
  });

  if (options.telemetry) {
    options.telemetry.triageRan = true;
    options.telemetry.triageInputCount = signals.length;
    options.telemetry.triageKeptCount = keep ? keep.size : signals.length;
  }

  if (!keep) return signals;
  const filtered = signals.filter((signal) => keep.has(signal.marketId));
  return filtered.length > 0 ? filtered : signals;
}

function applyGuardrails(
  signals: KalshiSignal[],
  logger: Pick<Console, "warn" | "error">,
  context: string,
) {
  return signals.filter((signal) => {
    const yesProbability = Number(signal.impliedProbability ?? 0.5);
    const entryPrice = signal.side === "no" ? 1 - yesProbability : yesProbability;
    const verdict = checkProfitGuardrails({
      expectedValue: signal.expectedValue,
      confidence: signal.confidence,
      count: 1,
      entryPrice,
      category: "other",
      spreadProxy: signal.metadata?.spreadProxy,
    });

    if (!verdict.approved) {
      logger.warn(
        `[ProfitGuardrails] ${context} signal ${signal.marketId} rejected: ${verdict.reason}`,
      );
    }

    return verdict.approved;
  });
}

export async function reviewSignalsWithTrader(
  input: {
    markets: KalshiMarket[];
    signals: KalshiSignal[];
    maxSignals?: number;
  },
  options: TradingReviewerOptions = {},
): Promise<KalshiSignal[]> {
  if (input.signals.length === 0) return [];
  if (process.env.NODE_ENV === "test" && options.skipInTest !== false) {
    return input.signals;
  }

  const logger = options.logger ?? console;
  if (!isTradingReviewerConfigured(options)) {
    logger.error(
      "[TradingReviewer] OPENROUTER_API_KEY missing; dropping all candidates so autonomous trading fails closed.",
    );
    return [];
  }

  const client = options.client ?? createOpenRouterClient({
    apiKey: options.openRouterApiKey ?? ENV.openRouterApiKey,
    logger,
  });

  const cappedSignals = input.signals.slice(0, input.maxSignals ?? DEFAULT_MAX_SIGNALS);
  const marketsById = new Map(input.markets.map((market) => [market.id, market]));
  const triagedSignals = await applyTriageFilter(cappedSignals, marketsById, options, logger);

  const reviewed = await Promise.all(
    triagedSignals.map(async (signal) => {
      const market = marketsById.get(signal.marketId);
      if (!market) {
        logger.warn(
          `[TradingReviewer] Missing market context for marketId=${signal.marketId}; dropping signal.`,
        );
        return null;
      }

      try {
        const review = await reviewSignalWithOpenRouterKalshiTeam(market, signal, {
          client,
          telemetry: options.telemetry,
          logger,
        });

        if (!review.approved) {
          return null;
        }

        const category = categoryOfSignal(signal, marketsById);
        const reasoning = [
          signal.reasoning,
          `Researcher pYES=${(review.impliedProbability * 100).toFixed(1)}%`,
          `Quant edge=${(review.quant.edgeFraction * 100).toFixed(1)}%`,
          `Kalshi beasts [${category}]: ${review.reasoning}`,
        ].join(" | ");

        return {
          ...signal,
          confidence: clamp(signal.confidence + review.confidenceAdjustment, 0.01, 0.99),
          impliedProbability: clamp(review.impliedProbability, 0.01, 0.99),
          expectedValue: Math.max(0, signal.expectedValue + review.expectedValueAdjustment),
          reasoning,
        } satisfies KalshiSignal;
      } catch (error) {
        if (options.telemetry) {
          options.telemetry.anthropicFailures += 1;
        }
        logger.warn(
          `[TradingReviewer] OpenRouter review failed for marketId=${signal.marketId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return null;
      }
    }),
  );

  const approvedSignals = reviewed.filter((signal): signal is KalshiSignal => Boolean(signal));
  return applyGuardrails(approvedSignals, logger, "openrouter_quartet");
}

export { categoryOfSignal };