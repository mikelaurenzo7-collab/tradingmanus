import { getSessionCookieOptions } from "./_core/cookies";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import {
  fetchKalshiMarkets,
  fetchKalshiMarketDetails,
} from "./_core/kalshiMarketData";
import {
  placeKalshiOrder,
  cancelKalshiOrder,
  getKalshiOrderStatus,
  getKalshiPositions,
  closeKalshiPosition,
  activateKalshiKillSwitch,
} from "./_core/kalshiExecution";
import {
  subscribeToMarketFeed,
  unsubscribeFromMarketFeed,
  getMarketFeed,
  getAllMarketFeeds,
} from "./_core/kalshiMarketFeed";
import {
  generateSignalsForMarkets,
  filterSignalsByConfidence,
  getTopSignalsForExecution,
  saveSignals,
  filterSignalsByMarketConditions,
} from "./_core/kalshiSignals";
import {
  validateKalshiCredentials,
  fetchKalshiAccountEquity,
} from "./_core/kalshiAuth";
import { getKalshiApiKey } from "./_core/env";
import { getPerformanceOverview } from "./_core/kalshiLearning";
import * as kalshiCredDb from "./db.kalshi-credentials";
import { trainingRouter } from "./training.router";
import { advancedRouter } from "./advanced.router";

import { COOKIE_NAME } from "../shared/const";

// Risk limits (hardcoded for $100 capital)
const RISK_LIMITS = {
  maxCapital: 100,
  maxLossPerTrade: 5,
  maxLossPerDay: 10,
  maxPositionSize: 20,
  maxOpenPositions: 5,
};

export const appRouter = router({
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  training: trainingRouter,
  advanced: advancedRouter,

  kalshi: router({
    // Market data
    getMarkets: protectedProcedure
      .input(
        z
          .object({
            category: z.string().optional(),
            status: z.enum(["open", "closed", "resolved"]).optional(),
          })
          .optional()
      )
      .query(async ({ input }) => {
        try {
          const markets = await fetchKalshiMarkets(input || {});
          await Promise.all(
            markets.map(market => db.upsertKalshiMarket(market))
          );
          return markets;
        } catch (error) {
          console.error("[Kalshi] Get markets error:", error);
          return [];
        }
      }),

    getMarketDetails: protectedProcedure
      .input(z.object({ marketId: z.string() }))
      .query(async ({ input }) => {
        try {
          const market = await fetchKalshiMarketDetails(input.marketId);
          if (market) {
            await db.upsertKalshiMarket(market);
          }
          return market;
        } catch (error) {
          console.error("[Kalshi] Get market details error:", error);
          return null;
        }
      }),

    // Orders
    placeOrder: protectedProcedure
      .input(
        z.object({
          marketId: z.string(),
          side: z.enum(["yes", "no"]),
          quantity: z.number(),
          limitPrice: z.number(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          const capital = await db.getKalshiCapital();
          const openPositions = await db.getOpenKalshiPositions();
          const todayRealizedLoss = await db.getTodayRealizedLoss();
          // Risk exposure: quantity * limitPrice (limitPrice is 0-1, so max exposure is quantity)
          const orderExposure = Math.max(
            Number(input.quantity) * Number(input.limitPrice),
            Number(input.quantity) * (1 - Number(input.limitPrice))
          );

          if (openPositions.length >= RISK_LIMITS.maxOpenPositions) {
            return {
              success: false,
              error: `Open position limit reached (${RISK_LIMITS.maxOpenPositions})`,
            };
          }

          // Position size check: total capital at risk
          if (Number(input.quantity) > RISK_LIMITS.maxPositionSize) {
            return {
              success: false,
              error: `Order quantity exceeds max position size of $${RISK_LIMITS.maxPositionSize}`,
            };
          }

          // Max loss check: worst-case loss on this trade
          const maxLossOnTrade = Math.min(
            orderExposure,
            Number(input.quantity) * (1 - Number(input.limitPrice))
          );
          if (maxLossOnTrade > RISK_LIMITS.maxLossPerTrade) {
            return {
              success: false,
              error: `Order max loss of $${maxLossOnTrade.toFixed(2)} exceeds max per-trade risk of $${RISK_LIMITS.maxLossPerTrade}`,
            };
          }

          if (todayRealizedLoss >= RISK_LIMITS.maxLossPerDay) {
            return {
              success: false,
              error: `Daily loss limit reached ($${RISK_LIMITS.maxLossPerDay})`,
            };
          }

          if (capital && orderExposure > Number(capital.currentBalance ?? 0)) {
            return {
              success: false,
              error: "Order exceeds available capital",
            };
          }

          const result = await placeKalshiOrder(
            ctx.user!.id || 1,
            input.marketId,
            input.side,
            input.quantity,
            input.limitPrice
          );

          if (result.success) {
            await db.logAuditEvent(
              "kalshi_order_placed",
              JSON.stringify(input),
              ctx.user!.openId
            );
          } else {
            await db.logAuditEvent(
              "kalshi_order_blocked_or_failed",
              JSON.stringify({ ...input, reason: result.error ?? "unknown" }),
              ctx.user!.openId
            );
          }

          return result;
        } catch (error) {
          console.error("[Kalshi] Place order error:", error);
          return { success: false, error: String(error) };
        }
      }),

    cancelOrder: protectedProcedure
      .input(z.object({ orderId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        try {
          const result = await cancelKalshiOrder(
            ctx.user!.id || 1,
            input.orderId
          );

          if (result.success) {
            await db.logAuditEvent(
              "kalshi_order_cancelled",
              input.orderId,
              ctx.user!.openId
            );
          }

          return result;
        } catch (error) {
          console.error("[Kalshi] Cancel order error:", error);
          return { success: false, error: String(error) };
        }
      }),

    getOrderStatus: protectedProcedure
      .input(z.object({ orderId: z.string() }))
      .query(async ({ input, ctx }) => {
        try {
          return await getKalshiOrderStatus(
            ctx.user!.id || 1,
            input.orderId
          );
        } catch (error) {
          console.error("[Kalshi] Get order status error:", error);
          return null;
        }
      }),

    // Positions
    getPositions: protectedProcedure.query(async () => {
      try {
        return await db.getOpenKalshiPositions();
      } catch (error) {
        console.error("[Kalshi] Get positions error:", error);
        return [];
      }
    }),

    getTradeHistory: protectedProcedure
      .input(
        z.object({ limit: z.number().min(1).max(200).optional() }).optional()
      )
      .query(async ({ input }) => {
        try {
          return await db.getKalshiTradeHistory(input?.limit ?? 50);
        } catch (error) {
          console.error("[Kalshi] Get trade history error:", error);
          return [];
        }
      }),

    closePosition: protectedProcedure
      .input(
        z.object({
          positionId: z.number(),
          marketId: z.string(),
          currentPrice: z.number(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          const result = await closeKalshiPosition(
            ctx.user!.id || 1,
            input.positionId,
            input.marketId,
            input.currentPrice
          );

          if (result.success) {
            await db.logAuditEvent(
              "kalshi_position_closed",
              JSON.stringify(input),
              ctx.user!.openId
            );
          }

          return result;
        } catch (error) {
          console.error("[Kalshi] Close position error:", error);
          return { success: false, error: String(error) };
        }
      }),

    // Capital management
    getCapital: protectedProcedure.query(async () => {
      try {
        return await db.getKalshiCapital();
      } catch (error) {
        console.error("[Kalshi] Get capital error:", error);
        return null;
      }
    }),

    initializeCapital: protectedProcedure
      .input(z.object({ amount: z.number().default(100) }))
      .mutation(async ({ input, ctx }) => {
        try {
          await db.initializeKalshiCapital(input.amount);
          await db.logAuditEvent(
            "kalshi_capital_initialized",
            `$${input.amount}`,
            ctx.user!.openId
          );
          return { success: true };
        } catch (error) {
          console.error("[Kalshi] Initialize capital error:", error);
          return { success: false, error: String(error) };
        }
      }),

    // Signals
    getRecentSignals: protectedProcedure.query(async () => {
      try {
        return await db.getRecentSignals(20);
      } catch (error) {
        console.error("[Kalshi] Get signals error:", error);
        return [];
      }
    }),

    // Audit log
    getAuditLog: protectedProcedure.query(async () => {
      try {
        return await db.getAuditLog(7);
      } catch (error) {
        console.error("[Kalshi] Get audit log error:", error);
        return [];
      }
    }),

    // Risk controls
    killSwitch: protectedProcedure.mutation(async ({ ctx }) => {
      try {
          const result = await activateKalshiKillSwitch(
            ctx.user!.id || 1
          );
        await db.logAuditEvent(
          "kalshi_kill_switch_activated",
          JSON.stringify({
            totalPositions: result.totalPositions,
            closedPositions: result.closedPositions,
            failedPositions: result.failedPositions,
          }),
          ctx.user!.openId
        );
        return result;
      } catch (error) {
        console.error("[Kalshi] Kill switch error:", error);
        return {
          success: false,
          totalPositions: 0,
          closedPositions: 0,
          failedPositions: 0,
          results: [],
          error: String(error),
        };
      }
    }),

    getRiskLimits: protectedProcedure.query(async () => RISK_LIMITS),

    // Phase 2: Market Feed Subscriptions
    subscribeMarketFeed: protectedProcedure
      .input(z.object({ marketId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        try {
          const feed = await subscribeToMarketFeed(input.marketId);
          if (feed) {
            await db.logAuditEvent(
              "kalshi_market_feed_subscribed",
              input.marketId,
              ctx.user!.openId
            );
            return { success: true, feed };
          }
          return {
            success: false,
            error: "Failed to subscribe to market feed",
          };
        } catch (error) {
          console.error("[Kalshi] Subscribe market feed error:", error);
          return { success: false, error: String(error) };
        }
      }),

    unsubscribeMarketFeed: protectedProcedure
      .input(z.object({ marketId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        try {
          unsubscribeFromMarketFeed(input.marketId);
          await db.logAuditEvent(
            "kalshi_market_feed_unsubscribed",
            input.marketId,
            ctx.user!.openId
          );
          return { success: true };
        } catch (error) {
          console.error("[Kalshi] Unsubscribe market feed error:", error);
          return { success: false, error: String(error) };
        }
      }),

    getMarketFeed: protectedProcedure
      .input(z.object({ marketId: z.string() }))
      .query(async ({ input }) => {
        try {
          return getMarketFeed(input.marketId);
        } catch (error) {
          console.error("[Kalshi] Get market feed error:", error);
          return null;
        }
      }),

    getAllMarketFeeds: protectedProcedure.query(async () => {
      try {
        return getAllMarketFeeds();
      } catch (error) {
        console.error("[Kalshi] Get all market feeds error:", error);
        return [];
      }
    }),

    // Phase 5: Signal Generation
    generateSignals: protectedProcedure
      .input(
        z.object({
          marketIds: z.array(z.string()),
          minConfidence: z.number().min(0).max(1).optional().default(0.5),
          fundamentalProbabilities: z.record(z.string(), z.number()).optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          const markets = await Promise.all(
            input.marketIds.map(id => db.getKalshiMarket(id))
          );
          const validMarkets = markets.filter((m): m is any => m !== null);

          if (validMarkets.length === 0) {
            return {
              success: false,
              signals: [],
              error: "No valid markets found",
            };
          }

          const feeds = new Map();
          for (const marketId of input.marketIds) {
            const feed = getMarketFeed(marketId);
            if (feed) feeds.set(marketId, feed);
          }

          const fundamentalProbs = input.fundamentalProbabilities
            ? new Map(Object.entries(input.fundamentalProbabilities))
            : undefined;
          const sentimentContexts = new Map(
            validMarkets.map((market) => [
              market.id,
              {
                topic: market.title,
                marketSentiment: Math.max(-1, Math.min(1, (market.impliedProbability - 0.5) * 2)),
              },
            ])
          );
          const allSignals = await generateSignalsForMarkets(
            validMarkets,
            feeds,
            fundamentalProbs,
            sentimentContexts
          );
          const confidenceFilteredSignals = filterSignalsByConfidence(
            allSignals,
            input.minConfidence
          );
          const filteredSignals = filterSignalsByMarketConditions(
            confidenceFilteredSignals,
            feeds,
            0.35
          );

          await saveSignals(filteredSignals);
          await db.logAuditEvent(
            "kalshi_signals_generated",
            JSON.stringify({
              count: filteredSignals.length,
              minConfidence: input.minConfidence,
            }),
            ctx.user!.openId
          );

          return { success: true, signals: filteredSignals };
        } catch (error) {
          console.error("[Kalshi] Generate signals error:", error);
          return { success: false, signals: [], error: String(error) };
        }
      }),

    getTopSignals: protectedProcedure
      .input(
        z.object({
          topN: z.number().min(1).max(20).optional().default(5),
          minExecutionScore: z.number().min(0).max(1).optional().default(0.6),
        })
      )
      .query(async ({ input }) => {
        try {
          const recentSignals = await db.getRecentSignals(50);
          return getTopSignalsForExecution(
            recentSignals,
            input.topN,
            input.minExecutionScore
          );
        } catch (error) {
          console.error("[Kalshi] Get top signals error:", error);
          return [];
        }
      }),

    getSignalHistory: protectedProcedure
      .input(
        z.object({ limit: z.number().min(1).max(200).optional().default(50) })
      )
      .query(async ({ input }) => {
        try {
          return await db.getRecentSignals(input.limit);
        } catch (error) {
          console.error("[Kalshi] Get signal history error:", error);
          return [];
        }
      }),

    getPerformanceOverview: protectedProcedure.query(async () => {
      try {
        return await getPerformanceOverview();
      } catch (error) {
        console.error("[Kalshi] Get performance overview error:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to load performance overview",
          cause: error,
        });
      }
    }),

    // Kalshi account connection
    connectKalshiAccount: protectedProcedure
      .input(z.object({ apiKey: z.string(), privateKey: z.string() }))
      .mutation(async ({ input, ctx }) => {
        try {
          const validation = await validateKalshiCredentials(
            input.apiKey,
            input.privateKey
          );
          if (!validation.valid) {
            return {
              success: false,
              error:
                validation.error ||
                "Kalshi rejected these credentials. Confirm you pasted the API Key ID and the matching private key file contents.",
            };
          }

          const equityResult = await fetchKalshiAccountEquity(
            input.apiKey,
            input.privateKey
          );
          if (equityResult.error) {
            return {
              success: false,
              error: `Kalshi accepted the key pair but the account balance check failed: ${equityResult.error}`,
            };
          }

          const userId = ctx.user!.id || 1;

          try {
            await kalshiCredDb.saveKalshiCredentials(
              userId,
              input.apiKey,
              input.privateKey,
              equityResult.equity
            );
            await db.updateKalshiCapital({ currentBalance: equityResult.equity });
            await db.logAuditEvent(
              "kalshi_account_connected",
              `Equity: $${equityResult.equity}`,
              ctx.user!.openId
            );
          } catch (storageError) {
            console.error("[Kalshi] Failed to persist validated credentials:", storageError);
            return {
              success: false,
              error:
                "Your Kalshi credentials were validated, but the dashboard could not save the connection state. Please retry in a moment.",
            };
          }

          return {
            success: true,
            equity: equityResult.equity,
            mode: equityResult.mode ?? validation.mode,
          };
        } catch (error) {
          console.error("[Kalshi] Connect account error:", error);
          return {
            success: false,
            error:
              error instanceof Error
                ? error.message
                : "Unexpected error while connecting your Kalshi account",
          };
        }
      }),

    getKalshiAccountStatus: protectedProcedure.query(async ({ ctx }) => {
      try {
        const userId = ctx.user!.id || 1;
        const creds = await kalshiCredDb.getKalshiCredentials(userId);
        if (!creds) {
          return { connected: false, equity: 0, status: "disconnected" };
        }
        return {
          connected: creds.accountStatus === "connected",
          equity: creds.accountEquity,
          status: creds.accountStatus,
          lastSyncedAt: creds.lastSyncedAt,
        };
      } catch (error) {
        console.error("[Kalshi] Get account status error:", error);
        return {
          connected: false,
          equity: 0,
          status: "error",
          error: String(error),
        };
      }
    }),

    disconnectKalshiAccount: protectedProcedure.mutation(async ({ ctx }) => {
      try {
        const userId = ctx.user!.id || 1;
        await kalshiCredDb.deleteKalshiCredentials(userId);
        await db.logAuditEvent(
          "kalshi_account_disconnected",
          "",
          ctx.user!.openId
        );
        return { success: true };
      } catch (error) {
        console.error("[Kalshi] Disconnect account error:", error);
        return { success: false, error: String(error) };
      }
    }),
  }),
});

export type AppRouter = typeof appRouter;
