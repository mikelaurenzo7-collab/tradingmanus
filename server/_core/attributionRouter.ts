/**
 * Attribution and Account State tRPC Router
 */

import { router, protectedProcedure } from "./trpc";
import { z } from "zod";
import { fetchAccountStateWithFallback } from "./accountStateAdapter";
import { analyzeTradeAttribution, generateAttributionSummary } from "./postTradeAttribution";

export const attributionRouter = router({
  /**
   * Fetch account state from connected broker
   */
  getAccountState: protectedProcedure
    .input(
      z.object({
        connectorType: z.enum(["alpaca", "ib", "kraken"]),
        apiKey: z.string().optional(),
        apiSecret: z.string().optional(),
        baseUrl: z.string().optional(),
        accountId: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      try {
        const state = await fetchAccountStateWithFallback({
          type: input.connectorType,
          apiKey: input.apiKey,
          apiSecret: input.apiSecret,
          baseUrl: input.baseUrl,
          accountId: input.accountId,
        });

        if (!state) {
          return {
            success: false,
            error: "Failed to fetch account state",
          };
        }

        return {
          success: true,
          data: state,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

  /**
   * Analyze a single trade for attribution
   */
  analyzeTrade: protectedProcedure
    .input(z.object({ tradeId: z.number() }))
    .query(async ({ input }) => {
      try {
        const attribution = await analyzeTradeAttribution(input.tradeId);

        if (!attribution) {
          return {
            success: false,
            error: "Trade not found or analysis failed",
          };
        }

        return {
          success: true,
          data: attribution,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),

  /**
   * Generate attribution summary for date range
   */
  getAttributionSummary: protectedProcedure
    .input(
      z.object({
        startDate: z.date(),
        endDate: z.date(),
      })
    )
    .query(async ({ input }) => {
      try {
        const summary = await generateAttributionSummary(input.startDate, input.endDate);

        if (!summary) {
          return {
            success: false,
            error: "Failed to generate attribution summary",
          };
        }

        return {
          success: true,
          data: summary,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        };
      }
    }),
});
