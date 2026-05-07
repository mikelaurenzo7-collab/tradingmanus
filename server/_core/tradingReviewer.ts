import { createOpenRouterClient } from "./openrouterClient";
import { createGrokChatCompletion, extractGrokText } from "./grokClient";
import type { KalshiMarket } from "./kalshiMarketData";
import type { KalshiSignal } from "./kalshiSignals";
import { ENV } from "./env";
import { z } from "zod";
import {
  buildCachedSystemPrompt,
  buildExtendedThinking,
  buildMemorySystemBlock,
  buildToolList,
  callAnthropicWithTimeout,
  extractAnthropicText,
  extractCitations,
  formatCitationsForReasoning,
  getTriageThreshold,
  isHighStakes,
  isTriageEnabled,
  recordAnthropicResponseTelemetry,
  runHaikuTriage,
  selectAnthropicModel,
  type CitationSummary,
  type ReviewerTelemetry,
  type StakesContext,
  type TriageCandidate,
} from "./aiToolbelt";
import {
  classifyMarketCategory,
  groupByCategory,
  type MarketCategory,
} from "./marketCategoryRouter";
import { getCategoryPersona, type CategoryPersona } from "./categoryPersonas";
import { getGrokPersona, type GrokPersona } from "./grokPersonas";
import { checkProfitGuardrails } from "./profitGuardrails";
import {
  formatDeskMemoryForPrompt,
  getDeskMemoryBatch,
  type DeskMemoryRecord,
} from "../db.desk-memory";

// ... (rest of file unchanged up to the reviewSignalsWithTrader function)

// In the final filtering step of reviewSignalsWithTrader, add profit guardrails
// (this is the key profitability enforcement)

export async function reviewSignalsWithTrader(
  input: {
    markets: KalshiMarket[];
    signals: KalshiSignal[];
    maxSignals?: number;
  },
  options: TradingReviewerOptions = {}
): Promise<KalshiSignal[]> {
  if (input.signals.length === 0) return [];
  if (process.env.NODE_ENV === "test" && options.skipInTest !== false) {
    return input.signals;
  }

  const logger = options.logger ?? console;
  if (!isTradingReviewerConfigured(options)) {
    logger.error(
      "[TradingReviewer] AI reviewer not configured (need OPENROUTER_API_KEY or XAI_API_KEY); dropping all candidates.",
    );
    return [];
  }

  const cap = input.maxSignals ?? DEFAULT_MAX_SIGNALS;
  const cappedSignals = input.signals.slice(0, cap);
  const marketsById = new Map(input.markets.map((market) => [market.id, market]));

  const triagedSignals = await applyTriageFilter(cappedSignals, marketsById, options, logger);

  // Solo Grok path
  if (options.forceGrokSolo || ENV.enableGrokSolo) {
    if (!ENV.xaiApiKey) {
      logger.error("[TradingReviewer] ENABLE_GROK_SOLO true but no XAI_API_KEY; falling back to Claude.");
    } else {
      const grokPersona = getGrokPersona("kalshi", "other");
      const stakes = stakesForSignals(triagedSignals);
      const memorySnippet = options.userId ? formatDeskMemoryForPrompt((await loadDeskMemoryForBuckets(new Map([["other", triagedSignals]]), options)).get(grokPersona.id) ?? null) : null;
      const reviewed = await runCategoryReview(
        triagedSignals,
        marketsById,
        options,
        grokPersona,
        stakes,
        logger,
        memorySnippet,
      );
      // Apply profit guardrails to Grok-reviewed signals
      return reviewed.filter((s) => {
        const check = checkProfitGuardrails({
          expectedValue: s.expectedValue,
          confidence: s.confidence,
          isTeamMode: false,
        });
        if (!check.approved) {
          logger.warn(`[ProfitGuardrails] Grok solo signal ${s.marketId} rejected: ${check.reason}`);
        }
        return check.approved;
      });
    }
  }

  if (!ENV.enableAiCategoryRouting) {
    const reviewed = await runCategoryReview(
      triagedSignals,
      marketsById,
      options,
      undefined,
      stakesForSignals(triagedSignals),
      logger,
    );
    return reviewed.filter((s) => {
      const check = checkProfitGuardrails({
        expectedValue: s.expectedValue,
        confidence: s.confidence,
        isTeamMode: ENV.enableGrokTeam,
      });
      if (!check.approved) logger.warn(`[ProfitGuardrails] Signal ${s.marketId} rejected: ${check.reason}`);
      return check.approved;
    });
  }

  const buckets = groupByCategory(triagedSignals, (signal) => {
    const market = marketsById.get(signal.marketId);
    return { category: market?.category, title: market?.title };
  });

  const memoryByDeskId = await loadDeskMemoryForBuckets(buckets, options);

  const batches = await Promise.all(
    Array.from(buckets.entries()).map(async ([category, batchSignals]) => {
      const persona = getCategoryPersona("kalshi", category);
      const stakes = stakesForSignals(batchSignals);
      const memorySnippet = formatDeskMemoryForPrompt(memoryByDeskId.get(persona.id) ?? null);
      const reviewed = await runCategoryReview(
        batchSignals,
        marketsById,
        options,
        persona,
        stakes,
        logger,
        memorySnippet,
      );
      // Profit guardrails + optional Grok team confirmation
      return reviewed.filter((s) => {
        const check = checkProfitGuardrails({
          expectedValue: s.expectedValue,
          confidence: s.confidence,
          isTeamMode: ENV.enableGrokTeam,
          // If Grok reviewed this in team mode, we could pass grokApproved here
        });
        if (!check.approved) {
          logger.warn(`[ProfitGuardrails] ${category} signal ${s.marketId} rejected: ${check.reason}`);
        }
        return check.approved;
      });
    }),
  );

  const approved = new Map<string, KalshiSignal>();
  for (const batch of batches) {
    for (const signal of batch) {
      approved.set(signal.marketId, signal);
    }
  }
  return triagedSignals
    .map((signal) => approved.get(signal.marketId))
    .filter((signal): signal is KalshiSignal => Boolean(signal));
}

export { categoryOfSignal };
