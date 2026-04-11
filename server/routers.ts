import { COOKIE_NAME } from "@shared/const";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router, adminProcedure } from "./_core/trpc";
import { z } from "zod";
import {
  getLatestEquitySnapshot,
  getEquityHistory,
  getAllBots,
  getBotById,
  getBotsByMarket,
  updateBotStatus,
  getOpenPositions,
  getOpenPositionsByMarket,
  getPositionById,
  closePosition,
  getTradeHistory,
  getTradesByMarket,
  createTrade,
  getReasoningLogs,
  getReasoningLogsByMarket,
  createReasoningLog,
  getAlerts,
  createAlert,
  recordKillSwitchEvent,
  getKillSwitchHistory,
} from "./db";
import { invokeLLM } from "./_core/llm";
import { notifyOwner } from "./_core/notification";

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  // ============================================
  // DASHBOARD OVERVIEW (Owner-only)
  // ============================================
  dashboard: router({
    overview: adminProcedure.query(async () => {
      const globalSnapshot = await getLatestEquitySnapshot('global');
      const stocksSnapshot = await getLatestEquitySnapshot('stocks');
      const cryptoSnapshot = await getLatestEquitySnapshot('crypto');
      const predictionSnapshot = await getLatestEquitySnapshot('prediction');

      return {
        global: globalSnapshot,
        stocks: stocksSnapshot,
        crypto: cryptoSnapshot,
        prediction: predictionSnapshot,
      };
    }),

    equityHistory: adminProcedure
      .input(z.object({ scope: z.enum(['global', 'stocks', 'crypto', 'prediction']), limitDays: z.number().optional() }))
      .query(async ({ input }) => {
        return await getEquityHistory(input.scope, input.limitDays || 30);
      }),
  }),

  // ============================================
  // BOT MANAGEMENT (Owner-only)
  // ============================================
  bots: router({
    list: adminProcedure.query(async () => {
      return await getAllBots();
    }),

    byMarket: adminProcedure
      .input(z.object({ market: z.enum(['stocks', 'crypto', 'prediction']) }))
      .query(async ({ input }) => {
        return await getBotsByMarket(input.market);
      }),

    updateStatus: adminProcedure
      .input(z.object({ botId: z.number(), status: z.enum(['running', 'paused', 'stopped']) }))
      .mutation(async ({ input }) => {
        const success = await updateBotStatus(input.botId, input.status);
        if (success) {
          await notifyOwner({
            title: 'Bot Status Updated',
            content: `Bot ${input.botId} status changed to ${input.status}`,
          });
        }
        return { success };
      }),
  }),

  // ============================================
  // POSITIONS MANAGEMENT (Owner-only)
  // ============================================
  positions: router({
    open: adminProcedure.query(async () => {
      return await getOpenPositions();
    }),

    byMarket: adminProcedure
      .input(z.object({ market: z.enum(['stocks', 'crypto', 'prediction']) }))
      .query(async ({ input }) => {
        return await getOpenPositionsByMarket(input.market);
      }),

    close: adminProcedure
      .input(z.object({ positionId: z.number(), closingPrice: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const position = await getPositionById(input.positionId);
        if (!position) {
          return { success: false, error: 'Position not found' };
        }

        const success = await closePosition(input.positionId, input.closingPrice);
        if (success) {
          const pnl = (input.closingPrice - position.entryPrice) * position.size;
          await createAlert(
            'position_close',
            pnl > 0 ? 'info' : 'warning',
            `Position Closed: ${position.symbol}`,
            `Position ${position.symbol} closed at ${input.closingPrice}. PnL: ${pnl.toFixed(2)}`,
            `position_close_${input.positionId}_${Date.now()}`
          );
          await notifyOwner({
            title: 'Position Closed',
            content: `${position.symbol} closed at ${input.closingPrice}. PnL: ${pnl.toFixed(2)}`,
          });
        }
        return { success };
      }),
  }),

  // ============================================
  // TRADE HISTORY (Owner-only)
  // ============================================
  trades: router({
    history: adminProcedure
      .input(z.object({ limitDays: z.number().optional() }))
      .query(async ({ input }) => {
        return await getTradeHistory(input.limitDays || 30);
      }),

    byMarket: adminProcedure
      .input(z.object({ market: z.enum(['stocks', 'crypto', 'prediction']), limitDays: z.number().optional() }))
      .query(async ({ input }) => {
        return await getTradesByMarket(input.market, input.limitDays || 30);
      }),
  }),

  // ============================================
  // REASONING LOG & AI ANALYSIS (Owner-only)
  // ============================================
  reasoning: router({
    logs: adminProcedure
      .input(z.object({ limitDays: z.number().optional() }))
      .query(async ({ input }) => {
        return await getReasoningLogs(input.limitDays || 7);
      }),

    byMarket: adminProcedure
      .input(z.object({ market: z.enum(['stocks', 'crypto', 'prediction']), limitDays: z.number().optional() }))
      .query(async ({ input }) => {
        return await getReasoningLogsByMarket(input.market, input.limitDays || 7);
      }),

    generateMarketAnalysis: adminProcedure
      .input(z.object({ market: z.enum(['stocks', 'crypto', 'prediction']) }))
      .mutation(async ({ input }) => {
        try {
          const response = await invokeLLM({
            messages: [
              {
                role: 'system',
                content: `You are an expert trading analyst. Provide a concise market regime summary for ${input.market} markets. Include current conditions, key drivers, and profit-hunting opportunities. Format as JSON with fields: regimeSummary (string), opportunityTitle (string), signal (trade|hold|reduce|close|hedge).`,
              },
              {
                role: 'user',
                content: `Analyze the current ${input.market} market regime and provide trading insights.`,
              },
            ],
            response_format: {
              type: 'json_object',
            },
          });

          const content = response.choices[0].message.content;
          const analysis = typeof content === 'string' ? JSON.parse(content) : content;

          await createReasoningLog(
            null,
            input.market,
            analysis.signal || 'hold',
            0.75,
            0.85,
            `${input.market} Market Analysis`,
            analysis.regimeSummary || 'Market analysis generated',
            analysis.regimeSummary || 'Current market conditions analyzed',
            analysis.opportunityTitle || 'Market opportunity identified'
          );

          return { success: true, analysis };
        } catch (error) {
          console.error('[LLM] Failed to generate market analysis:', error);
          return { success: false, error: 'Failed to generate analysis' };
        }
      }),
  }),

  // ============================================
  // KILL SWITCH (Owner-only, Critical)
  // ============================================
  killSwitch: router({
    activate: adminProcedure
      .input(z.object({ reason: z.string() }))
      .mutation(async ({ input, ctx }) => {
        try {
          // Get all open positions and bots
          const openPositions = await getOpenPositions();
          const allBots = await getAllBots();

          // Close all positions
          let closedCount = 0;
          for (const position of openPositions) {
            const closed = await closePosition(position.id, position.markPrice);
            if (closed) closedCount++;
          }

          // Halt all bots
          let haltedCount = 0;
          for (const bot of allBots) {
            const updated = await updateBotStatus(bot.id, 'stopped');
            if (updated) haltedCount++;
          }

          // Record kill switch event
          await recordKillSwitchEvent(ctx.user.openId, input.reason, closedCount, haltedCount);

          // Create alert
          await createAlert(
            'kill_switch',
            'critical',
            'KILL SWITCH ACTIVATED',
            `All positions flattened (${closedCount}). All bots halted (${haltedCount}). Reason: ${input.reason}`,
            `kill_switch_${Date.now()}`
          );

          // Notify owner
          await notifyOwner({
            title: '🚨 KILL SWITCH ACTIVATED',
            content: `All positions flattened (${closedCount}). All bots halted (${haltedCount}). Reason: ${input.reason}`,
          });

          return { success: true, closedCount, haltedCount };
        } catch (error) {
          console.error('[KillSwitch] Activation failed:', error);
          return { success: false, error: 'Kill switch activation failed' };
        }
      }),

    history: adminProcedure
      .input(z.object({ limitDays: z.number().optional() }))
      .query(async ({ input }) => {
        return await getKillSwitchHistory(input.limitDays || 30);
      }),
  }),

  // ============================================
  // ALERTS & NOTIFICATIONS (Owner-only)
  // ============================================
  alerts: router({
    list: adminProcedure
      .input(z.object({ limitDays: z.number().optional() }))
      .query(async ({ input }) => {
        return await getAlerts(input.limitDays || 7);
      }),
  }),
});

export type AppRouter = typeof appRouter;
