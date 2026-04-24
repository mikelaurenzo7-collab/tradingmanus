/**
 * Advanced Features Router
 * Consolidated tRPC procedures for sentiment, portfolio, risk, and backtesting
 */

import { router, protectedProcedure, publicProcedure } from "./_core/trpc.js";
import { z } from "zod";
import * as sentiment from "./_core/kalshiSentiment";
import * as portfolio from "./_core/kalshiPortfolioOptimization";
import * as risk from "./_core/kalshiAdvancedRisk";
import * as backtest from "./_core/kalshiBacktest";

const backtestTradeSchema = z.object({
  marketId: z.string(),
  entryPrice: z.number(),
  exitPrice: z.number(),
  size: z.number(),
  entryTime: z.number(),
  exitTime: z.number(),
  pnl: z.number(),
  pnlPercent: z.number(),
  side: z.string(),
});

const backtestAnalysisInputSchema = z.object({
  trades: z.array(backtestTradeSchema),
  startingCapital: z.number().optional(),
  iterations: z.number().optional(),
  windowSize: z.number().positive(),
});

export const advancedRouter = router({
  // Sentiment Analysis
  sentiment: router({
    calculateSentiment: publicProcedure
      .input(
        z.object({
          newsSentiment: z.number().min(-1).max(1),
          socialSentiment: z.number().min(-1).max(1),
          marketSentiment: z.number().min(-1).max(1),
        })
      )
      .query(({ input }: { input: { newsSentiment: number; socialSentiment: number; marketSentiment: number } }) => {
        return sentiment.calculateSentiment(
          input.newsSentiment,
          input.socialSentiment,
          input.marketSentiment
        );
      }),

    calculateCompositeSentiment: publicProcedure
      .input(
        z.object({
          newsSentiment: z.number().min(-1).max(1),
          socialSentiment: z.number().min(-1).max(1),
          marketSentiment: z.number().min(-1).max(1),
          topic: z.string().trim().min(2).max(120).optional(),
        })
      )
      .query(async ({ input }: { input: { newsSentiment: number; socialSentiment: number; marketSentiment: number; topic?: string } }) => {
        const [externalSignal, liveNews, liveSocial] = await Promise.all([
          input.topic ? sentiment.fetchGdeltTopicSignal(input.topic) : Promise.resolve(null),
          input.topic ? sentiment.fetchLiveNewsSummary(input.topic) : Promise.resolve(null),
          input.topic ? sentiment.fetchLiveSocialSummary(input.topic) : Promise.resolve(null),
        ]);
        const blendedNewsSentiment = liveNews
          ? Math.max(-1, Math.min(1, input.newsSentiment * 0.4 + liveNews.derivedSentiment * 0.6))
          : input.newsSentiment;
        const blendedSocialSentiment = liveSocial
          ? Math.max(-1, Math.min(1, input.socialSentiment * 0.35 + liveSocial.derivedSentiment * 0.65))
          : input.socialSentiment;

        return sentiment.calculateCompositeSentiment({
          newsSentiment: blendedNewsSentiment,
          socialSentiment: blendedSocialSentiment,
          marketSentiment: input.marketSentiment,
          externalSentiment: externalSignal?.normalizedSentiment ?? 0,
          externalConfidence: externalSignal?.confidence ?? 0,
          externalSignal,
          liveNews,
          liveSocial,
        });
      }),

    extractNewsSentiment: protectedProcedure
      .input(
        z.object({
          articles: z.array(
            z.object({
              title: z.string(),
              url: z.string(),
              source: z.string(),
              publishedAt: z.date(),
              sentiment: z.number(),
              relevance: z.number(),
            })
          ),
        })
      )
      .query(({ input }: any) => {
        return sentiment.extractNewsSentiment(input.articles);
      }),

    calculateMarketSentiment: protectedProcedure
      .input(
        z.object({
          priceHistory: z.array(
            z.object({ price: z.number(), timestamp: z.number() })
          ),
        })
      )
      .query(({ input }: any) => {
        return sentiment.calculateMarketSentiment(input.priceHistory);
      }),
  }),

  // Portfolio Optimization
  portfolio: router({
    calculateKellyFraction: protectedProcedure
      .input(
        z.object({
          winProbability: z.number().min(0).max(1),
          odds: z.number().positive(),
        })
      )
      .query(({ input }: any) => {
        return portfolio.calculateKellyFraction(
          input.winProbability,
          input.odds
        );
      }),

    calculatePositionSize: protectedProcedure
      .input(
        z.object({
          equity: z.number().positive(),
          signal: z.object({
            marketId: z.string(),
            side: z.string(),
            confidence: z.number(),
            expectedValue: z.number(),
          }),
          maxPositionPercent: z.number().optional(),
        })
      )
      .query(({ input }: any) => {
        return portfolio.calculatePositionSize(
          input.equity,
          input.signal,
          input.maxPositionPercent
        );
      }),

    optimizePortfolio: protectedProcedure
      .input(
        z.object({
          signals: z.array(
            z.object({
              marketId: z.string(),
              side: z.string(),
              confidence: z.number(),
              expectedValue: z.number(),
            })
          ),
          equity: z.number().positive(),
          maxPositions: z.number().optional(),
        })
      )
      .query(({ input }: any) => {
        return portfolio.optimizePortfolio(
          input.signals,
          input.equity,
          input.maxPositions
        );
      }),

    calculateDiversificationScore: protectedProcedure
      .input(
        z.object({
          signals: z.array(
            z.object({
              marketId: z.string(),
              side: z.string(),
              confidence: z.number(),
              expectedValue: z.number(),
            })
          ),
        })
      )
      .query(({ input }: any) => {
        return portfolio.calculateDiversificationScore(input.signals);
      }),
  }),

  // Advanced Risk Management
  risk: router({
    calculateVolatility: protectedProcedure
      .input(z.object({ returns: z.array(z.number()) }))
      .query(({ input }: any) => {
        return risk.calculateVolatility(input.returns);
      }),

    calculateSharpeRatio: protectedProcedure
      .input(
        z.object({
          returns: z.array(z.number()),
          riskFreeRate: z.number().optional(),
        })
      )
      .query(({ input }: any) => {
        return risk.calculateSharpeRatio(input.returns, input.riskFreeRate);
      }),

    calculateMaxDrawdown: protectedProcedure
      .input(z.object({ equity: z.array(z.number()) }))
      .query(({ input }: any) => {
        return risk.calculateMaxDrawdown(input.equity);
      }),

    checkRiskLimits: protectedProcedure
      .input(
        z.object({
          position: z.object({
            marketId: z.string(),
            size: z.number(),
            riskAmount: z.number(),
            riskPercent: z.number(),
            maxLoss: z.number(),
            stopLoss: z.number(),
            takeProfit: z.number(),
          }),
          limits: z.object({
            maxLossPerTrade: z.number(),
            maxLossPerDay: z.number(),
            maxLossPerWeek: z.number(),
            maxDrawdown: z.number(),
            maxPositionSize: z.number(),
            maxCorrelation: z.number(),
          }),
          currentDrawdown: z.number(),
          dailyLoss: z.number(),
          weeklyLoss: z.number(),
        })
      )
      .query(({ input }: any) => {
        return risk.checkRiskLimits(
          input.position,
          input.limits,
          input.currentDrawdown,
          input.dailyLoss,
          input.weeklyLoss
        );
      }),

    generateRiskAlerts: protectedProcedure
      .input(
        z.object({
          metrics: z.object({
            volatility: z.number(),
            sharpeRatio: z.number(),
            maxDrawdown: z.number(),
            recoveryFactor: z.number(),
            profitFactor: z.number(),
            riskPerTrade: z.number(),
          }),
          limits: z.object({
            maxLossPerTrade: z.number(),
            maxLossPerDay: z.number(),
            maxLossPerWeek: z.number(),
            maxDrawdown: z.number(),
            maxPositionSize: z.number(),
            maxCorrelation: z.number(),
          }),
        })
      )
      .query(({ input }: any) => {
        return risk.generateRiskAlerts(input.metrics, input.limits);
      }),
  }),

  // Backtesting
  backtest: router({
    calculateBacktestStats: protectedProcedure
      .input(z.object({ trades: z.array(backtestTradeSchema) }))
      .query(({ input }: any) => {
        return backtest.calculateBacktestStats(input.trades);
      }),

    calculateEquityCurve: protectedProcedure
      .input(
        z.object({
          trades: z.array(backtestTradeSchema),
          startingCapital: z.number().optional(),
        })
      )
      .query(({ input }: any) => {
        return backtest.calculateEquityCurve(
          input.trades,
          input.startingCapital
        );
      }),

    monteCarloSimulation: protectedProcedure
      .input(
        z.object({
          trades: z.array(backtestTradeSchema),
          iterations: z.number().optional(),
        })
      )
      .query(({ input }: any) => {
        return backtest.monteCarloSimulation(input.trades, input.iterations);
      }),

    walkForwardValidation: protectedProcedure
      .input(
        z.object({
          trades: z.array(backtestTradeSchema),
          windowSize: z.number().positive(),
        })
      )
      .query(({ input }: any) => {
        return backtest.walkForwardValidation(input.trades, input.windowSize);
      }),

    runAnalysis: protectedProcedure
      .input(backtestAnalysisInputSchema)
      .mutation(({ input }: any) => {
        const stats = backtest.calculateBacktestStats(input.trades);
        const equityCurve = backtest.calculateEquityCurve(
          input.trades,
          input.startingCapital
        );
        const monteCarlo = backtest.monteCarloSimulation(
          input.trades,
          input.iterations
        );
        const walkForward = backtest.walkForwardValidation(
          input.trades,
          input.windowSize
        );

        return {
          stats,
          equityCurve,
          monteCarlo,
          walkForward,
        };
      }),
  }),
});
