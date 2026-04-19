import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { attributionRouter } from "./_core/attributionRouter";
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
  getAllDataConnectors,
  getDataConnectorsByMarket,
  updateDataConnectorStatus,
  getLatestMarketData,
  storeMarketData,
  getAllAccountConnectors,
  updateAccountConnectorStatus,
  createPaperTrade,
  closePaperTrade,
  getPaperTrades,
  createTradeJournalEntry,
  getTradeJournalEntry,
  getAllStrategies,
  getStrategyByName,
  createStrategy,
  recordStrategyValidation,
  recordAuditEvent,
  getAuditLog,
  getAllRiskLimits,
  getRiskLimitByType,
  setRiskLimit,
} from "./db";
import { invokeLLM } from "./_core/llm";
import { notifyOwner } from "./_core/notification";
import { syncMarketData, syncMultipleSymbols, getLatestQuoteWithQuality } from "./_core/marketDataSync";

const COOKIE_NAME = "session";

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
          const openPositions = await getOpenPositions();
          const allBots = await getAllBots();

          let closedCount = 0;
          for (const position of openPositions) {
            const closed = await closePosition(position.id, position.markPrice);
            if (closed) closedCount++;
          }

          let haltedCount = 0;
          for (const bot of allBots) {
            const updated = await updateBotStatus(bot.id, 'stopped');
            if (updated) haltedCount++;
          }

          await recordKillSwitchEvent(ctx.user.openId, input.reason, closedCount, haltedCount);

          await createAlert(
            'kill_switch',
            'critical',
            'KILL SWITCH ACTIVATED',
            `All positions flattened (${closedCount}). All bots halted (${haltedCount}). Reason: ${input.reason}`,
            `kill_switch_${Date.now()}`
          );

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

  // ============================================
  // REAL-DATA CONNECTORS (Owner-only)
  // ============================================
  connectors: router({
    dataConnectors: adminProcedure.query(async () => {
      return await getAllDataConnectors();
    }),

    dataConnectorsByMarket: adminProcedure
      .input(z.object({ market: z.enum(['stocks', 'crypto', 'prediction']) }))
      .query(async ({ input }) => {
        return await getDataConnectorsByMarket(input.market);
      }),

    updateDataConnectorStatus: adminProcedure
      .input(z.object({ connectorId: z.number(), status: z.enum(['connected', 'disconnected', 'error', 'stale']), errorMessage: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const success = await updateDataConnectorStatus(input.connectorId, input.status, input.errorMessage);
        if (success) {
          await recordAuditEvent('connector_status_updated', 'dataConnector', input.connectorId, `Status: ${input.status}`, ctx.user.openId);
        }
        return { success };
      }),

    accountConnectors: adminProcedure.query(async () => {
      return await getAllAccountConnectors();
    }),

    updateAccountConnectorStatus: adminProcedure
      .input(z.object({ connectorId: z.number(), status: z.enum(['connected', 'disconnected', 'error', 'stale']), balance: z.number().optional(), errorMessage: z.string().optional() }))
      .mutation(async ({ input, ctx }) => {
        const success = await updateAccountConnectorStatus(input.connectorId, input.status, input.balance, input.errorMessage);
        if (success) {
          await recordAuditEvent('account_connector_updated', 'accountConnector', input.connectorId, `Status: ${input.status}, Balance: ${input.balance}`, ctx.user.openId);
        }
        return { success };
      }),

    syncMarketData: adminProcedure
      .input(z.object({ symbol: z.string(), market: z.enum(['stocks', 'crypto', 'prediction']) }))
      .mutation(async ({ input, ctx }) => {
        const result = await syncMarketData(input.symbol, input.market as 'stocks' | 'crypto');
        await recordAuditEvent('market_data_synced', 'marketData', undefined, `Symbol: ${input.symbol}, Success: ${result.success}`, ctx.user.openId);
        return result;
      }),

    getLatestQuote: adminProcedure
      .input(z.object({ symbol: z.string() }))
      .query(async ({ input }) => {
        return await getLatestQuoteWithQuality(input.symbol);
      }),
  }),
  // ============================================
  // PAPER TRADING LAB (Owner-only)
  // ============================================
  paperTrading: router({
    createTrade: adminProcedure
      .input(z.object({
        symbol: z.string(),
        market: z.enum(['stocks', 'crypto', 'prediction']),
        side: z.enum(['long', 'short', 'yes', 'no']),
        quantity: z.number(),
        entryPrice: z.number(),
        entrySignal: z.string(),
        entryRationale: z.string(),
        strategyTag: z.string(),
        invalidationCondition: z.string().optional(),
        expectedHoldingPeriod: z.string().optional(),
        slippageAssumption: z.number().optional(),
        feeAssumption: z.number().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const result = await createPaperTrade(
          input.symbol,
          input.market,
          input.side,
          input.quantity,
          input.entryPrice,
          input.entrySignal,
          input.entryRationale,
          input.strategyTag,
          input.invalidationCondition,
          input.expectedHoldingPeriod,
          input.slippageAssumption,
          input.feeAssumption
        );
        if (result) {
          await recordAuditEvent('paper_trade_created', 'paperTrade', undefined, `${input.symbol} ${input.side} ${input.quantity}@${input.entryPrice}`, ctx.user.openId);
        }
        return { success: !!result };
      }),

    closeTrade: adminProcedure
      .input(z.object({ paperTradeId: z.number(), exitPrice: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const success = await closePaperTrade(input.paperTradeId, input.exitPrice);
        if (success) {
          await recordAuditEvent('paper_trade_closed', 'paperTrade', input.paperTradeId, `Exit: ${input.exitPrice}`, ctx.user.openId);
        }
        return { success };
      }),

    list: adminProcedure
      .input(z.object({ limitDays: z.number().optional() }))
      .query(async ({ input }) => {
        return await getPaperTrades(input.limitDays || 30);
      }),

    journalEntry: adminProcedure
      .input(z.object({
        paperTradeId: z.number(),
        founderView: z.string().optional(),
        systemView: z.string().optional(),
        outcome: z.string().optional(),
        attributionTags: z.string().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const success = await createTradeJournalEntry(
          input.paperTradeId,
          input.founderView,
          input.systemView,
          input.outcome,
          input.attributionTags,
          input.notes
        );
        if (success) {
          await recordAuditEvent('journal_entry_created', 'tradeJournalEntry', input.paperTradeId, input.outcome, ctx.user.openId);
        }
        return { success };
      }),

    getJournalEntry: adminProcedure
      .input(z.object({ paperTradeId: z.number() }))
      .query(async ({ input }) => {
        return await getTradeJournalEntry(input.paperTradeId);
      }),
  }),

  // ============================================
  // STRATEGY REGISTRY & VALIDATION (Owner-only)
  // ============================================
  strategies: router({
    list: adminProcedure.query(async () => {
      return await getAllStrategies();
    }),

    create: adminProcedure
      .input(z.object({
        name: z.string(),
        hypothesis: z.string(),
        marketUniverse: z.string(),
        holdingPeriod: z.string(),
        entryLogic: z.string(),
        exitLogic: z.string(),
        sizingRules: z.string(),
        allowedRegimes: z.string().optional(),
        expectedCosts: z.number().optional(),
        failureConditions: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const success = await createStrategy(
          input.name,
          input.hypothesis,
          input.marketUniverse,
          input.holdingPeriod,
          input.entryLogic,
          input.exitLogic,
          input.sizingRules,
          input.allowedRegimes,
          input.expectedCosts,
          input.failureConditions
        );
        if (success) {
          await recordAuditEvent('strategy_created', 'strategy', undefined, input.name, ctx.user.openId);
        }
        return { success };
      }),

    recordValidation: adminProcedure
      .input(z.object({
        strategyId: z.number(),
        validationPeriod: z.string(),
        outOfSampleReturn: z.number().optional(),
        postCostReturn: z.number().optional(),
        sharpeRatio: z.number().optional(),
        maxDrawdown: z.number().optional(),
        winRate: z.number().optional(),
        tradeCount: z.number().optional(),
        passedCostTest: z.boolean().optional(),
        passedConsistencyTest: z.boolean().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const success = await recordStrategyValidation(
          input.strategyId,
          input.validationPeriod,
          input.outOfSampleReturn,
          input.postCostReturn,
          input.sharpeRatio,
          input.maxDrawdown,
          input.winRate,
          input.tradeCount,
          input.passedCostTest,
          input.passedConsistencyTest,
          input.notes
        );
        if (success) {
          await recordAuditEvent('strategy_validation_recorded', 'strategyValidation', input.strategyId, input.validationPeriod, ctx.user.openId);
        }
        return { success };
      }),
  }),

  // ============================================
  // RISK CONTROLS (Owner-only)
  // ============================================
  riskControls: router({
    limits: adminProcedure.query(async () => {
      return await getAllRiskLimits();
    }),

    setLimit: adminProcedure
      .input(z.object({ limitType: z.string(), value: z.number(), period: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const success = await setRiskLimit(input.limitType, input.value, input.period);
        if (success) {
          await recordAuditEvent('risk_limit_set', 'riskLimit', undefined, `${input.limitType}: ${input.value} per ${input.period}`, ctx.user.openId);
        }
        return { success };
      }),
  }),

  // ============================================
  // AUDIT LOG (Owner-only)
  // ============================================
  audit: router({
    log: adminProcedure
      .input(z.object({ limitDays: z.number().optional() }))
      .query(async ({ input }) => {
        return await getAuditLog(input.limitDays || 30);
      }),
  }),

  // ============================================
  // Attribution & Account State
  // ============================================
  attribution: attributionRouter,
});

export type AppRouter = typeof appRouter;
