import { getSessionCookieOptions } from "./_core/cookies";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { z } from "zod";
import * as db from "./db";
import { fetchKalshiMarkets, fetchKalshiMarketDetails } from "./_core/kalshiMarketData";
import { placeKalshiOrder, cancelKalshiOrder, getKalshiOrderStatus, getKalshiPositions, closeKalshiPosition, activateKalshiKillSwitch } from "./_core/kalshiExecution";

const COOKIE_NAME = "session";

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
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  kalshi: router({
    // Market data
    getMarkets: protectedProcedure
      .input(z.object({ category: z.string().optional(), status: z.enum(["open", "closed", "resolved"]).optional() }).optional())
      .query(async ({ input }) => {
        try {
          const markets = await fetchKalshiMarkets(input || {});
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
          return await fetchKalshiMarketDetails(input.marketId);
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
          const orderExposure = Number(input.quantity) * Number(input.limitPrice);

          if (openPositions.length >= RISK_LIMITS.maxOpenPositions) {
            return {
              success: false,
              error: `Open position limit reached (${RISK_LIMITS.maxOpenPositions})`,
            };
          }

          if (orderExposure > RISK_LIMITS.maxPositionSize) {
            return {
              success: false,
              error: `Order exceeds max position size of $${RISK_LIMITS.maxPositionSize}`,
            };
          }

          if (orderExposure > RISK_LIMITS.maxLossPerTrade) {
            return {
              success: false,
              error: `Order exceeds max per-trade risk of $${RISK_LIMITS.maxLossPerTrade}`,
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

          const result = await placeKalshiOrder(process.env.KALSHI_API_KEY || "", input.marketId, input.side, input.quantity, input.limitPrice);

          if (result.success) {
            await db.logAuditEvent("kalshi_order_placed", JSON.stringify(input), ctx.user!.openId);
          } else {
            await db.logAuditEvent("kalshi_order_blocked_or_failed", JSON.stringify({ ...input, reason: result.error ?? "unknown" }), ctx.user!.openId);
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
          const result = await cancelKalshiOrder(process.env.KALSHI_API_KEY || "", input.orderId);

          if (result.success) {
            await db.logAuditEvent("kalshi_order_cancelled", input.orderId, ctx.user!.openId);
          }

          return result;
        } catch (error) {
          console.error("[Kalshi] Cancel order error:", error);
          return { success: false, error: String(error) };
        }
      }),

    getOrderStatus: protectedProcedure
      .input(z.object({ orderId: z.string() }))
      .query(async ({ input }) => {
        try {
          return await getKalshiOrderStatus(process.env.KALSHI_API_KEY || "", input.orderId);
        } catch (error) {
          console.error("[Kalshi] Get order status error:", error);
          return null;
        }
      }),

    // Positions
    getPositions: protectedProcedure.query(async () => {
      try {
        return await getKalshiPositions();
      } catch (error) {
        console.error("[Kalshi] Get positions error:", error);
        return [];
      }
    }),

    closePosition: protectedProcedure
      .input(z.object({ positionId: z.number(), marketId: z.string(), currentPrice: z.number() }))
      .mutation(async ({ input, ctx }) => {
        try {
          const result = await closeKalshiPosition(process.env.KALSHI_API_KEY || "", input.positionId, input.marketId, input.currentPrice);

          if (result.success) {
            await db.logAuditEvent("kalshi_position_closed", JSON.stringify(input), ctx.user!.openId);
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
          await db.logAuditEvent("kalshi_capital_initialized", `$${input.amount}`, ctx.user!.openId);
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
        const result = await activateKalshiKillSwitch(process.env.KALSHI_API_KEY || "");
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
  }),
});

export type AppRouter = typeof appRouter;
