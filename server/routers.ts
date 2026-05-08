import { getSessionCookieOptions } from "./_core/cookies";
import { publicProcedure, router, protectedProcedure } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import * as db from "./db";
import {
  createOwnerSessionToken,
  createOwnerRefreshToken,
  createSessionTokenForUser,
  hashAccountPassword,
  refreshAccessToken,
  ensureOwnerUser,
  validateOwnerCredentials,
  verifyAccountPassword,
} from "./_core/auth";
import {
  generateTwoFactorSecret,
  verifyTwoFactorToken,
  generateBackupCodes,
  hashBackupCode,
  verifyBackupCode,
} from "./_core/twoFactor";
import { logger, logAudit } from "./_core/logger";
import { ENV } from "./_core/env";
import crypto from "crypto";
import {
  fetchKalshiMarkets,
  fetchKalshiMarketDetails,
} from "./_core/kalshiMarketData";
import {
  placeKalshiOrder,
  cancelKalshiOrder,
  getKalshiOrderStatus,
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
import { reviewSignalsWithTrader } from "./_core/tradingReviewer";
import {
  validateKalshiCredentials,
  fetchKalshiAccountEquity,
} from "./_core/kalshiAuth";
import { getPerformanceOverview } from "./_core/kalshiLearning";
import { getPnlSummary } from "./_core/paperPnlSummary";
import { runExitStrategyBacktest } from "./_core/backtestExits";
import {
  calculateSharpeBySource,
  identifyLosingPatterns,
} from "./_core/performanceAttribution";
import {
  validateRiskParameters,
  estimateImpactOnRecentRuns,
  applyRiskParameters,
  getRiskParameterHistory,
  DEFAULT_RISK_PARAMETERS,
  type RiskParameters,
} from "./_core/riskTuningHelper";
import * as kalshiCredDb from "./db.kalshi-credentials";
import * as tradingPreferencesDb from "./db.trading-preferences";
import {
  detectAllCombinatorialArbitrage,
  type ArbitrageMarket,
} from "./_core/kalshiCombinatorial";
import { trainingRouter } from "./training.router";
import { advancedRouter } from "./advanced.router";
import { chatRouter } from "./chat.router";
import {
  applyMarketImpactGuardrails,
  calculateKalshiBuyOrderRisk,
  MAX_KALSHI_ORDER_CONTRACTS,
} from "./_core/kalshiRisk";
import { withUserLock } from "./_core/userMutex";
import { alertKillSwitchPartialFailure } from "./_core/alerting";

import {
  COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  ONE_DAY_MS,
  SEVEN_DAYS_MS,
} from "../shared/const";

// Risk limits anchored to live capital plus static guardrails
const BASE_RISK_LIMITS = {
  maxLossPerTrade: 5,
  maxLossPerDay: 10,
  maxPositionSize: 20,
  maxOpenPositions: 5,
};

function clampRiskLimit(value: number, minimum: number, maximum: number) {
  return Math.max(
    minimum,
    Math.min(maximum, Number.isFinite(value) ? value : minimum)
  );
}

function getRequiredUserId(ctx: { user: { id?: number | null } }) {
  if (!Number.isInteger(ctx.user.id) || Number(ctx.user.id) <= 0) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Invalid authenticated user context.",
    });
  }

  return Number(ctx.user.id);
}

const tradingPreferencesInput = z.object({
  autonomyMode: z.enum([
    "manual",
    "fully_autonomous",
  ]),
  liveTradingEnabled: z.boolean(),
  paperTradeMode: z.boolean().optional(),
  executionCadence: z.enum([
    "manual_only",
    "hourly_watch",
    "continuous_watch",
  ]),
  riskPosture: z.enum(["conservative", "balanced", "aggressive"]),
  minSignalConfidence: z.number().min(0.5).max(0.99),
  maxOrderNotional: z.number().min(1).max(250),
  maxDailyOrders: z.number().int().min(1).max(48),
  requireApprovalAbove: z.number().min(1).max(500),
});

function parseAuditDetails(details: string | null | undefined) {
  if (!details) {
    return null;
  }

  try {
    return JSON.parse(details) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseDecisionDetails(details: Record<string, unknown> | null): {
  marketId: string | null;
  side: "yes" | "no" | null;
  confidence: number | null;
  executionScore: number | null;
  expectedValue: number | null;
  limitPrice: number | null;
  quantity: number | null;
  availableCapital: number | null;
  maxBudget: number | null;
  orderExposure: number | null;
  maxLossOnTrade: number | null;
  reasoning: string | null;
  blockedBy: string | null;
} | null {
  const decision = details?.decision;
  if (!decision || typeof decision !== "object") {
    return null;
  }

  const raw = decision as Record<string, unknown>;
  const readNumber = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const readText = (value: unknown) =>
    typeof value === "string" ? value : null;
  const side = raw.side === "yes" || raw.side === "no" ? raw.side : null;

  return {
    marketId: readText(raw.marketId),
    side,
    confidence: readNumber(raw.confidence),
    executionScore: readNumber(raw.executionScore),
    expectedValue: readNumber(raw.expectedValue),
    limitPrice: readNumber(raw.limitPrice),
    quantity: readNumber(raw.quantity),
    availableCapital: readNumber(raw.availableCapital),
    maxBudget: readNumber(raw.maxBudget),
    orderExposure: readNumber(raw.orderExposure),
    maxLossOnTrade: readNumber(raw.maxLossOnTrade),
    reasoning: readText(raw.reasoning),
    blockedBy: readText(raw.blockedBy),
  };
}

function isOrderPlacedFlag(value: unknown) {
  return Number(value ?? 0) === 1;
}

function buildAutonomyActivitySummary(runs: Array<any>) {
  const recentRuns = runs.slice(0, 8);
  const lastRun = recentRuns[0] ?? null;
  const lastRunDecisionPayload = parseAuditDetails(lastRun?.decision);
  const candidateSetPayload = parseAuditDetails(lastRun?.candidateSet);
  const rejectedCandidatesPayload = parseAuditDetails(
    lastRun?.rejectedCandidates
  );
  const lastRunDecision = parseDecisionDetails(
    lastRunDecisionPayload ? { decision: lastRunDecisionPayload } : null
  );

  return {
    lastRun: lastRun
      ? {
          runId: typeof lastRun.runId === "string" ? lastRun.runId : null,
          eventType: `scheduled_autonomy_run_${lastRun.status}`,
          status: String(lastRun.status),
          createdAt: lastRun.startedAt,
          completedAt: lastRun.completedAt ?? null,
          reason: typeof lastRun.reason === "string" ? lastRun.reason : null,
          signalsGenerated: Number(lastRun.signalsGenerated ?? 0),
          executionCandidates: Number(lastRun.executionCandidates ?? 0),
          candidateMarketId:
            typeof lastRun.candidateMarketId === "string"
              ? lastRun.candidateMarketId
              : null,
          executedMarketId:
            typeof lastRun.executedMarketId === "string"
              ? lastRun.executedMarketId
              : null,
          autonomyMode:
            typeof lastRun.autonomyMode === "string"
              ? lastRun.autonomyMode
              : null,
          executionCadence:
            typeof lastRun.executionCadence === "string"
              ? lastRun.executionCadence
              : null,
          triggerSource:
            typeof lastRun.triggerSource === "string"
              ? lastRun.triggerSource
              : null,
          reconciliationStatus:
            typeof lastRun.reconciliationStatus === "string"
              ? lastRun.reconciliationStatus
              : null,
          reconciliationReason:
            typeof lastRun.reconciliationReason === "string"
              ? lastRun.reconciliationReason
              : null,
          decision: lastRunDecision,
          candidateSet: Array.isArray(candidateSetPayload)
            ? candidateSetPayload
            : [],
          rejectedCandidates: Array.isArray(rejectedCandidatesPayload)
            ? rejectedCandidatesPayload
            : [],
        }
      : null,
    lastOrder:
      lastRun && isOrderPlacedFlag(lastRun.orderPlaced)
        ? {
            eventType:
              String(lastRun.status) === "executed"
                ? "scheduled_autonomy_order_placed"
                : "scheduled_autonomy_order_blocked_or_failed",
            createdAt: lastRun.completedAt ?? lastRun.startedAt,
            marketId:
              typeof lastRun.executedMarketId === "string"
                ? lastRun.executedMarketId
                : typeof lastRun.candidateMarketId === "string"
                  ? lastRun.candidateMarketId
                  : null,
            side: lastRunDecision?.side ?? null,
            quantity: lastRunDecision?.quantity ?? null,
            limitPrice: lastRunDecision?.limitPrice ?? null,
            confidence: lastRunDecision?.confidence ?? null,
            executionScore: lastRunDecision?.executionScore ?? null,
            reason: typeof lastRun.reason === "string" ? lastRun.reason : null,
            expectedValue: lastRunDecision?.expectedValue ?? null,
            reasoning: lastRunDecision?.reasoning ?? null,
            availableCapital: lastRunDecision?.availableCapital ?? null,
            maxBudget: lastRunDecision?.maxBudget ?? null,
            orderExposure: lastRunDecision?.orderExposure ?? null,
            maxLossOnTrade: lastRunDecision?.maxLossOnTrade ?? null,
          }
        : null,
    recentActivity: recentRuns.map(run => ({
      id: run.id,
      eventType: `scheduled_autonomy_run_${run.status}`,
      createdAt: run.startedAt,
      details: {
        runId: run.runId,
        reason: run.reason,
        status: run.status,
        signalsGenerated: Number(run.signalsGenerated ?? 0),
        executionCandidates: Number(run.executionCandidates ?? 0),
        orderPlaced: isOrderPlacedFlag(run.orderPlaced),
        reconciliationStatus: run.reconciliationStatus,
        reconciliationReason: run.reconciliationReason,
      },
      rawDetails: JSON.stringify({
        runId: run.runId,
        reason: run.reason,
        status: run.status,
        signalsGenerated: Number(run.signalsGenerated ?? 0),
        executionCandidates: Number(run.executionCandidates ?? 0),
        orderPlaced: isOrderPlacedFlag(run.orderPlaced),
        reconciliationStatus: run.reconciliationStatus,
        reconciliationReason: run.reconciliationReason,
      }),
    })),
  };
}

async function getDynamicRiskLimits(userId: number) {
  const scopedUserId = getRequiredUserId({ user: { id: userId } });
  const capital = await db.getKalshiCapital(scopedUserId);
  const maxCapital = Math.max(
    0,
    Number(capital?.currentBalance ?? capital?.startingBalance ?? 0)
  );

  if (maxCapital <= 0) {
    return {
      maxCapital,
      maxLossPerTrade: 0,
      maxLossPerDay: 0,
      maxPositionSize: 0,
      maxOpenPositions: 0,
    };
  }

  return {
    maxCapital,
    maxLossPerTrade: clampRiskLimit(
      maxCapital * 0.05,
      1,
      BASE_RISK_LIMITS.maxLossPerTrade
    ),
    maxLossPerDay: clampRiskLimit(
      maxCapital * 0.1,
      2,
      BASE_RISK_LIMITS.maxLossPerDay
    ),
    maxPositionSize: clampRiskLimit(
      maxCapital * 0.2,
      2,
      BASE_RISK_LIMITS.maxPositionSize
    ),
    maxOpenPositions: BASE_RISK_LIMITS.maxOpenPositions,
  };
}

export const appRouter = router({
  auth: router({
    me: publicProcedure.query(opts => opts.ctx.user),
    login: publicProcedure
      .input(
        z.object({
          email: z.string().min(1),
          password: z.string().min(1),
          twoFactorToken: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const ownerCredentialsValid = validateOwnerCredentials(
          input.email,
          input.password
        );
        let user = ownerCredentialsValid
          ? await ensureOwnerUser()
          : await db.getUserByEmail(input.email);

        if (!ownerCredentialsValid) {
          const accountCredentialsValid = verifyAccountPassword(
            input.password,
            user?.passwordHash
          );
          if (!user || !accountCredentialsValid) {
            logAudit({
              action: "login_failed",
              resource: "auth",
              details: { email: input.email, reason: "invalid_credentials" },
              success: false,
            });
            throw new TRPCError({
              code: "UNAUTHORIZED",
              message: "Invalid email or password.",
            });
          }

          // Subscription entitlement gate removed — single-tenant deployment
          // has no paid-tier requirement, the owner is always entitled.
          await db.updateUser(user.id, { lastSignedIn: new Date() });
          user = (await db.getUserById(user.id)) ?? user;
        }

        // Check if 2FA is enabled
        if (user.twoFactorEnabled === 1) {
          if (!input.twoFactorToken) {
            return {
              requiresTwoFactor: true,
              message: "Two-factor authentication required",
            };
          }

          // Verify 2FA token
          const isValid = user.twoFactorSecret
            ? verifyTwoFactorToken(input.twoFactorToken, user.twoFactorSecret)
            : false;

          if (!isValid) {
            // Try backup codes
            let backupCodeValid = false;
            if (user.backupCodesHash) {
              try {
                const backupCodes = JSON.parse(
                  user.backupCodesHash
                ) as string[];
                for (let i = 0; i < backupCodes.length; i++) {
                  if (verifyBackupCode(input.twoFactorToken, backupCodes[i])) {
                    // Remove used backup code
                    backupCodes.splice(i, 1);
                    await db.updateUser(user.id, {
                      backupCodesHash: JSON.stringify(backupCodes),
                    });
                    backupCodeValid = true;
                    logger.info(
                      { userId: user.id },
                      "Backup code used for authentication"
                    );
                    break;
                  }
                }
              } catch (error) {
                logger.error({ error }, "Failed to parse backup codes");
              }
            }

            if (!backupCodeValid) {
              logAudit({
                action: "login_failed_2fa",
                userId: user.id,
                openId: user.openId,
                resource: "auth",
                details: { reason: "invalid_2fa_token" },
                success: false,
              });
              throw new TRPCError({
                code: "UNAUTHORIZED",
                message: "Invalid two-factor authentication code.",
              });
            }
          }
        }

        // Generate tokens
        const sessionToken = ownerCredentialsValid
          ? await createOwnerSessionToken()
          : await createSessionTokenForUser(user, "access");
        const refreshToken = ownerCredentialsValid
          ? await createOwnerRefreshToken()
          : await createSessionTokenForUser(user, "refresh");
        const cookieOptions = getSessionCookieOptions(ctx.req);

        // Set session cookie (24 hours)
        ctx.res.cookie(COOKIE_NAME, sessionToken, {
          ...cookieOptions,
          maxAge: ONE_DAY_MS,
        });

        // Set refresh token cookie (7 days)
        ctx.res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
          ...cookieOptions,
          maxAge: SEVEN_DAYS_MS,
        });

        logAudit({
          action: "login_success",
          userId: user.id,
          openId: user.openId,
          resource: "auth",
          success: true,
        });

        return { user, requiresTwoFactor: false };
      }),

    register: publicProcedure
      .input(
        z.object({
          name: z.string().trim().min(1).max(120),
          email: z.string().trim().email().max(320),
          password: z.string().min(12).max(256),
          subscriptionTier: z
            .enum(["starter", "pro", "fund"])
            .default("starter"),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const normalizedEmail = input.email.trim().toLowerCase();
        const existingUser = await db.getUserByEmail(normalizedEmail);
        if (existingUser) {
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "An account already exists for that email. Sign in or use the billing portal.",
          });
        }

        const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        const user = await db.createUserAccount({
          openId: `user:${crypto.randomUUID()}`,
          name: input.name.trim(),
          email: normalizedEmail,
          passwordHash: hashAccountPassword(input.password),
          subscriptionTier: input.subscriptionTier,
          subscriptionStatus: "trialing",
          subscriptionCurrentPeriodEnd: trialEndsAt,
        });

        if (!user) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Account could not be created.",
          });
        }

        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(
          COOKIE_NAME,
          await createSessionTokenForUser(user, "access"),
          {
            ...cookieOptions,
            maxAge: ONE_DAY_MS,
          }
        );
        ctx.res.cookie(
          REFRESH_COOKIE_NAME,
          await createSessionTokenForUser(user, "refresh"),
          {
            ...cookieOptions,
            maxAge: SEVEN_DAYS_MS,
          }
        );

        logAudit({
          action: "account_registered",
          userId: user.id,
          openId: user.openId,
          resource: "auth",
          details: {
            subscriptionTier: input.subscriptionTier,
            subscriptionStatus: "trialing",
          },
          success: true,
        });

        return {
          user,
          trialEndsAt,
        };
      }),

    refreshToken: publicProcedure.mutation(async ({ ctx }) => {
      const refreshToken = ctx.req.cookies?.[REFRESH_COOKIE_NAME];
      if (!refreshToken) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Refresh token not found",
        });
      }

      const newAccessToken = await refreshAccessToken(refreshToken);
      if (!newAccessToken) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "Invalid or expired refresh token",
        });
      }

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.cookie(COOKIE_NAME, newAccessToken, {
        ...cookieOptions,
        maxAge: ONE_DAY_MS,
      });

      return { success: true };
    }),

    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      ctx.res.clearCookie(REFRESH_COOKIE_NAME, {
        ...cookieOptions,
        maxAge: -1,
      });

      if (ctx.user) {
        logAudit({
          action: "logout",
          userId: ctx.user.id,
          openId: ctx.user.openId,
          resource: "auth",
          success: true,
        });
      }

      return { success: true } as const;
    }),

    // 2FA Management
    setup2FA: protectedProcedure.mutation(async ({ ctx }) => {
      const userId = getRequiredUserId(ctx);
      const user = await db.getUserById(userId);

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      if (user.twoFactorEnabled === 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Two-factor authentication is already enabled",
        });
      }

      const twoFactorData = await generateTwoFactorSecret(user.email || "");

      // Store the secret temporarily (not enabled yet)
      await db.updateUser(userId, {
        twoFactorSecret: twoFactorData.secret,
      });

      logAudit({
        action: "2fa_setup_initiated",
        userId,
        openId: user.openId,
        resource: "auth",
        success: true,
      });

      return {
        secret: twoFactorData.secret,
        qrCodeDataUrl: twoFactorData.qrCodeDataUrl,
        otpauthUrl: twoFactorData.otpauthUrl,
      };
    }),

    verify2FA: protectedProcedure
      .input(z.object({ token: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const userId = getRequiredUserId(ctx);
        const user = await db.getUserById(userId);

        if (!user || !user.twoFactorSecret) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Two-factor setup not initiated",
          });
        }

        const isValid = verifyTwoFactorToken(input.token, user.twoFactorSecret);

        if (!isValid) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid verification code",
          });
        }

        // Generate backup codes
        const backupCodes = generateBackupCodes(10);
        const hashedCodes = backupCodes.map(code => hashBackupCode(code));

        // Enable 2FA
        await db.updateUser(userId, {
          twoFactorEnabled: 1,
          backupCodesHash: JSON.stringify(hashedCodes),
        });

        logAudit({
          action: "2fa_enabled",
          userId,
          openId: user.openId,
          resource: "auth",
          success: true,
        });

        return {
          success: true,
          backupCodes, // Return plaintext codes only once
        };
      }),

    disable2FA: protectedProcedure
      .input(z.object({ token: z.string() }))
      .mutation(async ({ input, ctx }) => {
        const userId = getRequiredUserId(ctx);
        const user = await db.getUserById(userId);

        if (!user || user.twoFactorEnabled !== 1 || !user.twoFactorSecret) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Two-factor authentication is not enabled",
          });
        }

        const isValid = verifyTwoFactorToken(input.token, user.twoFactorSecret);

        if (!isValid) {
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "Invalid verification code",
          });
        }

        // Disable 2FA
        await db.updateUser(userId, {
          twoFactorEnabled: 0,
          twoFactorSecret: null,
          backupCodesHash: null,
        });

        logAudit({
          action: "2fa_disabled",
          userId,
          openId: user.openId,
          resource: "auth",
          success: true,
        });

        return { success: true };
      }),

    get2FAStatus: protectedProcedure.query(async ({ ctx }) => {
      const userId = getRequiredUserId(ctx);
      const user = await db.getUserById(userId);

      if (!user) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "User not found",
        });
      }

      return {
        enabled: user.twoFactorEnabled === 1,
        hasBackupCodes: !!user.backupCodesHash,
      };
    }),
  }),

  training: trainingRouter,
  advanced: advancedRouter,

  kalshi: router({
    /**
     * Live guardrails snapshot — surfaces all percentage thresholds in
     * dollar terms based on the operator's current Kalshi balance.
     * Drives the dashboard's "Guardrails Status" tab so the operator can
     * see how thresholds scale as they deposit more capital.
     */
    getGuardrailsSnapshot: protectedProcedure.query(async ({ ctx }) => {
      const { ENV } = await import("./_core/env");
      // Use the AUTHENTICATED USER'S Kalshi credentials, not process-level
      // KALSHI_KEY_ID. The rest of this router's capital paths do the same;
      // without this, the snapshot reads someone else's account or 0.
      const userId = Number(ctx.user?.id ?? 0);
      let capitalUsd = 0;
      if (userId > 0) {
        try {
          const creds = await kalshiCredDb.getKalshiCredentials(userId);
          // Narrow against the union {needsReauth} | {apiKey, privateKey, ...}
          if (creds && !("needsReauth" in creds && creds.needsReauth)) {
            const decrypted = creds as {
              apiKey?: string;
              privateKey?: string;
            };
            if (decrypted.apiKey && decrypted.privateKey) {
              const equityResult = await fetchKalshiAccountEquity(
                decrypted.apiKey,
                decrypted.privateKey,
              );
              if (!equityResult.error) {
                capitalUsd = Number(equityResult.equity ?? 0);
              }
            }
          }
        } catch {
          // best-effort: fall through with 0 so the snapshot still renders
          capitalUsd = 0;
        }
      }

      const tier =
        capitalUsd > ENV.scannerCapHighTierUsd
          ? "high"
          : capitalUsd > ENV.scannerCapMidTierUsd
            ? "mid"
            : "low";
      const maxAnalysesPerDay =
        tier === "high"
          ? ENV.scannerMaxAnalysesPerDayHighTier
          : tier === "mid"
            ? ENV.scannerMaxAnalysesPerDayMidTier
            : ENV.scannerMaxAnalysesPerDay;

      return {
        capitalUsd,
        kelly: {
          fraction: ENV.profitGuardrails.kellyFraction,
          minPctOfCapital: ENV.profitGuardrails.kellyMinPctOfCapital,
          maxPctOfCapital: ENV.profitGuardrails.kellyMaxPctOfCapital,
          minDollarsPerPosition:
            capitalUsd * ENV.profitGuardrails.kellyMinPctOfCapital,
          maxDollarsPerPosition:
            capitalUsd * ENV.profitGuardrails.kellyMaxPctOfCapital,
        },
        ev: {
          minNetEv: ENV.profitGuardrails.minNetEv,
          minConfidence: ENV.profitGuardrails.minConfidenceAfterAdjust,
        },
        exposure: {
          maxPortfolioPct: ENV.profitGuardrails.maxPortfolioExposurePct,
          maxPortfolioUsd:
            capitalUsd * ENV.profitGuardrails.maxPortfolioExposurePct,
          maxCorrelatedGroupPct:
            ENV.profitGuardrails.maxCorrelatedGroupPct,
          maxCorrelatedGroupUsd:
            capitalUsd * ENV.profitGuardrails.maxCorrelatedGroupPct,
        },
        drawdown: {
          dailyPauseFrac: ENV.profitGuardrails.dailyDrawdownPauseFrac,
          dailyPauseUsd:
            capitalUsd * ENV.profitGuardrails.dailyDrawdownPauseFrac,
          weeklyPauseFrac: ENV.profitGuardrails.weeklyDrawdownPauseFrac,
          weeklyPauseUsd:
            capitalUsd * ENV.profitGuardrails.weeklyDrawdownPauseFrac,
          coldStreakLossCount:
            ENV.profitGuardrails.coldStreakLossCount,
          coldStreakMinRealizedEdgePct:
            ENV.profitGuardrails.coldStreakMinRealizedEdgePct,
        },
        ensemble: {
          highStakesPctOfCapital: ENV.highStakesPctOfCapital,
          highStakesUsd: capitalUsd * ENV.highStakesPctOfCapital,
          catastrophicPctOfCapital: ENV.catastrophicPctOfCapital,
          catastrophicUsd: capitalUsd * ENV.catastrophicPctOfCapital,
          highStakesResolutionMinutes: ENV.highStakesResolutionMinutes,
          anthropicConfigured: ENV.anthropicApiKey.length > 0,
        },
        scanner: {
          tier,
          baseAnalysesPerDay: ENV.scannerBaseAnalysesPerDay,
          maxAnalysesPerDay,
          midTierUsd: ENV.scannerCapMidTierUsd,
          highTierUsd: ENV.scannerCapHighTierUsd,
        },
      };
    }),

    /**
     * Rolling AI-spend summary — answers "is the system paying for itself?"
     * Pulls actual reviewer telemetry from the audit log and joins with
     * realized P&L from closed positions over the same window.
     *
     * Returns:
     *   - aiSpendUsd: total reviewer cost over the window
     *   - realizedPnlUsd: closed-position P&L over the window (Kalshi only)
     *   - feeEstimateUsd: rough Kalshi-fee accrual estimate
     *   - netUsd: realized - (ai + fees) — positive means the system is
     *     paying for itself + earning surplus
     *   - dailyBreakdown: per-day rows so the dashboard can chart it
     */
    getAiSpendSummary: protectedProcedure
      .input(
        (await import("zod")).z
          .object({
            days: (await import("zod")).z
              .number()
              .int()
              .min(1)
              .max(90)
              .default(7),
          })
          .optional(),
      )
      .query(async ({ ctx, input }) => {
        const days = input?.days ?? 7;
        const userId = Number(ctx.user?.id ?? 0);
        if (userId <= 0) {
          return {
            windowDays: days,
            aiSpendUsd: 0,
            realizedPnlUsd: 0,
            feeEstimateUsd: 0,
            netUsd: 0,
            payingForItself: false,
            dailyBreakdown: [] as Array<{
              date: string;
              aiSpendUsd: number;
              realizedPnlUsd: number;
              feeEstimateUsd: number;
              netUsd: number;
            }>,
          };
        }

        const { ENV } = await import("./_core/env");
        const { getDb } = await import("./db");
        const { auditLog, kalshiPositions } = await import(
          "../drizzle/schema"
        );
        const { and, eq, gte, sql } = await import("drizzle-orm");
        const database = await getDb();

        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

        let aiSpendByDay = new Map<string, number>();
        let realizedByDay = new Map<string, number>();
        let feesByDay = new Map<string, number>();

        if (database) {
          // 1. AI spend from kalshi_ensemble_review audit events
          //    (totalAiCostUsd field captures Sonnet + Opus per-signal cost).
          const aiRows = await database
            .select({
              createdAt: auditLog.createdAt,
              details: auditLog.details,
            })
            .from(auditLog)
            .where(
              and(
                eq(auditLog.eventType, "kalshi_ensemble_review"),
                gte(auditLog.createdAt, cutoff),
              ),
            );
          for (const row of aiRows) {
            const day = new Date(row.createdAt).toISOString().slice(0, 10);
            try {
              const parsed = JSON.parse(String(row.details ?? "{}")) as {
                totalAiCostUsd?: number;
              };
              const cost = Number(parsed.totalAiCostUsd ?? 0);
              if (Number.isFinite(cost)) {
                aiSpendByDay.set(day, (aiSpendByDay.get(day) ?? 0) + cost);
              }
            } catch {
              // skip malformed rows
            }
          }

          // 2. Realized P&L from closed positions in the window.
          const closedRows = await database
            .select({
              closedAt: kalshiPositions.closedAt,
              realizedPnl: kalshiPositions.realizedPnl,
              entryPrice: kalshiPositions.entryPrice,
              quantity: kalshiPositions.quantity,
            })
            .from(kalshiPositions)
            .where(
              and(
                eq(kalshiPositions.userId, userId),
                eq(kalshiPositions.positionStatus, "closed"),
                gte(kalshiPositions.closedAt, cutoff),
              ),
            );
          const KALSHI_FEE_MULT_TWO_LEG =
            (ENV.kalshiMakerFeeMultiplier + ENV.kalshiTakerFeeMultiplier) /
            2; // very rough — exits hit taker, entries hit maker on average
          for (const row of closedRows) {
            const day = row.closedAt
              ? new Date(row.closedAt).toISOString().slice(0, 10)
              : null;
            if (!day) continue;
            realizedByDay.set(
              day,
              (realizedByDay.get(day) ?? 0) + Number(row.realizedPnl ?? 0),
            );
            // Rough round-trip fee estimate: 2 × multiplier × notional ×
            // p × (1-p) at entry. We don't have exit-fill data here so use
            // entry as a proxy.
            const entry = Number(row.entryPrice ?? 0);
            const qty = Number(row.quantity ?? 0);
            const notional = entry * qty;
            const fee = 2 * KALSHI_FEE_MULT_TWO_LEG * notional * entry * (1 - entry);
            feesByDay.set(day, (feesByDay.get(day) ?? 0) + Math.max(0, fee));
          }
          // suppress unused warning
          void sql;
        }

        // Aggregate
        const allDays = new Set<string>([
          ...aiSpendByDay.keys(),
          ...realizedByDay.keys(),
          ...feesByDay.keys(),
        ]);
        const dailyBreakdown = Array.from(allDays)
          .sort()
          .map((date) => {
            const ai = aiSpendByDay.get(date) ?? 0;
            const pnl = realizedByDay.get(date) ?? 0;
            const fees = feesByDay.get(date) ?? 0;
            return {
              date,
              aiSpendUsd: Number(ai.toFixed(4)),
              realizedPnlUsd: Number(pnl.toFixed(4)),
              feeEstimateUsd: Number(fees.toFixed(4)),
              netUsd: Number((pnl - ai - fees).toFixed(4)),
            };
          });

        const totalAi = dailyBreakdown.reduce(
          (a, d) => a + d.aiSpendUsd,
          0,
        );
        const totalPnl = dailyBreakdown.reduce(
          (a, d) => a + d.realizedPnlUsd,
          0,
        );
        const totalFees = dailyBreakdown.reduce(
          (a, d) => a + d.feeEstimateUsd,
          0,
        );
        const netUsd = totalPnl - totalAi - totalFees;

        return {
          windowDays: days,
          aiSpendUsd: Number(totalAi.toFixed(4)),
          realizedPnlUsd: Number(totalPnl.toFixed(4)),
          feeEstimateUsd: Number(totalFees.toFixed(4)),
          netUsd: Number(netUsd.toFixed(4)),
          payingForItself: netUsd >= 0,
          dailyBreakdown,
        };
      }),

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
          logger.error({ err: error }, "[Kalshi] Get markets error");
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
          logger.error({ err: error }, "[Kalshi] Get market details error");
          return null;
        }
      }),

    // Orders
    placeOrder: protectedProcedure
      .input(
        z.object({
          marketId: z.string(),
          side: z.enum(["yes", "no"]),
          quantity: z.number().int().min(1).max(MAX_KALSHI_ORDER_CONTRACTS),
          limitPrice: z.number().min(0.01).max(0.99),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          const userId = getRequiredUserId(ctx);
          // Serialise the check-and-execute block per user so two concurrent
          // requests can't both pass risk checks against stale state and then
          // both submit orders (TOCTOU race).
          return await withUserLock(userId, async () => {
            const [
              capital,
              openPositions,
              todayRealizedLoss,
              riskLimits,
              preferences,
              todayOrderCount,
            ] = await Promise.all([
              db.getKalshiCapital(userId),
              db.getOpenKalshiPositions(userId),
              db.getTodayRealizedLoss(userId),
              getDynamicRiskLimits(userId),
              tradingPreferencesDb.getTradingPreferences(userId),
              db.getTodayKalshiOrderCount(userId),
            ]);
            let marketDetails: Awaited<
              ReturnType<typeof fetchKalshiMarketDetails>
            > = null;
            try {
              marketDetails = await fetchKalshiMarketDetails(input.marketId);
            } catch (marketErr) {
              logger.warn(
                { err: marketErr, marketId: input.marketId },
                "[Kalshi] market detail lookup failed for market-impact sizing; proceeding with default liquidity assumptions"
              );
            }

            const totalVolumeContracts = Math.max(
              0,
              Number(marketDetails?.yesVolume ?? 0) +
                Number(marketDetails?.noVolume ?? 0)
            );
            const liquidityUnavailable = totalVolumeContracts <= 0;
            const dailyVolumeUsd = liquidityUnavailable
              ? Math.max(input.limitPrice * 50, 1)
              : totalVolumeContracts * input.limitPrice;
            const marketImpact = applyMarketImpactGuardrails({
              quantity: input.quantity,
              limitPrice: input.limitPrice,
              side: input.side,
              dailyVolumeUsd,
              expectedValue: 0,
            });
            const impactAdjustedQuantity = marketImpact.shouldBlockOrder
              ? 0
              : marketImpact.recommendedQuantity;

            if (impactAdjustedQuantity < 1) {
              await db.logAuditEvent(
                "kalshi_order_blocked_market_impact",
                JSON.stringify({
                  ...input,
                  impactAdjustedQuantity,
                  estimatedMarketImpact: marketImpact.estimatedMarketImpact,
                  impactBps: marketImpact.impactBps,
                  expectedSlippageUsd: marketImpact.expectedSlippageUsd,
                  simulated: ctx.paperTradeMode,
                }),
                ctx.user!.openId
              );

              return {
                success: false,
                error: "Order blocked by market-impact guardrail",
              };
            }

            if (impactAdjustedQuantity < input.quantity) {
              await db.logAuditEvent(
                "kalshi_order_sized_by_market_impact",
                JSON.stringify({
                  ...input,
                  liquidityUnavailable,
                  impactAdjustedQuantity,
                  estimatedMarketImpact: marketImpact.estimatedMarketImpact,
                  impactBps: marketImpact.impactBps,
                  expectedSlippageUsd: marketImpact.expectedSlippageUsd,
                  simulated: ctx.paperTradeMode,
                }),
                ctx.user!.openId
              );
            }

            const orderRisk = calculateKalshiBuyOrderRisk({
              ...input,
              quantity: impactAdjustedQuantity,
            });
            const orderExposure = orderRisk.orderExposure;
            const maxLossOnTrade = orderRisk.maxLossOnTrade;

            if (todayOrderCount >= preferences.maxDailyOrders) {
              return {
                success: false,
                error: `Daily order cap reached (${preferences.maxDailyOrders})`,
              };
            }

            if (orderExposure > preferences.maxOrderNotional) {
              return {
                success: false,
                error: `Order exposure of $${orderExposure.toFixed(2)} exceeds your configured max order notional of $${preferences.maxOrderNotional}`,
              };
            }

            if (openPositions.length >= riskLimits.maxOpenPositions) {
              return {
                success: false,
                error: `Open position limit reached (${riskLimits.maxOpenPositions})`,
              };
            }

            // Position size check: total capital at risk
            if (orderExposure > riskLimits.maxPositionSize) {
              return {
                success: false,
                error: `Order exposure exceeds max position size of $${riskLimits.maxPositionSize}`,
              };
            }

            // Max loss check: worst-case loss on this trade
            if (maxLossOnTrade > riskLimits.maxLossPerTrade) {
              return {
                success: false,
                error: `Order max loss of $${maxLossOnTrade.toFixed(2)} exceeds max per-trade risk of $${riskLimits.maxLossPerTrade}`,
              };
            }

            if (todayRealizedLoss >= riskLimits.maxLossPerDay) {
              return {
                success: false,
                error: `Daily loss limit reached ($${riskLimits.maxLossPerDay})`,
              };
            }

            if (
              capital &&
              orderExposure > Number(capital.currentBalance ?? 0)
            ) {
              return {
                success: false,
                error: "Order exceeds available capital",
              };
            }

            const result = await placeKalshiOrder(
              userId,
              input.marketId,
              input.side,
              orderRisk.quantity,
              orderRisk.limitPrice
            );

            if (result.success) {
              await db.logAuditEvent(
                "kalshi_order_placed",
                JSON.stringify({
                  marketId: input.marketId,
                  side: input.side,
                  quantity: orderRisk.quantity,
                  limitPrice: orderRisk.limitPrice,
                  orderExposure,
                  maxLossOnTrade,
                  simulated: ctx.paperTradeMode,
                }),
                ctx.user!.openId
              );
            } else {
              await db.logAuditEvent(
                "kalshi_order_blocked_or_failed",
                JSON.stringify({
                  marketId: input.marketId,
                  side: input.side,
                  quantity: orderRisk.quantity,
                  limitPrice: orderRisk.limitPrice,
                  orderExposure,
                  maxLossOnTrade,
                  reason: result.error ?? "unknown",
                  simulated: ctx.paperTradeMode,
                }),
                ctx.user!.openId
              );
            }

            return result;
          }); // end withUserLock
        } catch (error) {
          logger.error({ err: error }, "[Kalshi] Place order error");
          return { success: false, error: String(error) };
        }
      }),

    cancelOrder: protectedProcedure
      .input(z.object({ orderId: z.string() }))
      .mutation(async ({ input, ctx }) => {
        try {
          // Pass openId so audit events inside cancelKalshiOrder use the
          // authenticated user's identity rather than a numeric fallback.
          // Audit logging (success + failure) is handled inside cancelKalshiOrder.
          const result = await cancelKalshiOrder(
            getRequiredUserId(ctx),
            input.orderId,
            undefined,
            ctx.user!.openId
          );

          return result;
        } catch (error) {
          logger.error({ err: error }, "[Kalshi] Cancel order error");
          return { success: false, error: String(error) };
        }
      }),

    getOrderStatus: protectedProcedure
      .input(z.object({ orderId: z.string() }))
      .query(async ({ input, ctx }) => {
        try {
          return await getKalshiOrderStatus(
            getRequiredUserId(ctx),
            input.orderId
          );
        } catch (error) {
          logger.error({ err: error }, "[Kalshi] Get order status error");
          return null;
        }
      }),

    // Positions
    getPositions: protectedProcedure.query(async ({ ctx }) => {
      try {
        return await db.getOpenKalshiPositions(getRequiredUserId(ctx));
      } catch (error) {
        logger.error({ err: error }, "[Kalshi] Get positions error");
        return [];
      }
    }),

    getTradeHistory: protectedProcedure
      .input(
        z.object({ limit: z.number().min(1).max(200).optional() }).optional()
      )
      .query(async ({ input, ctx }) => {
        try {
          return await db.getKalshiTradeHistory(
            input?.limit ?? 50,
            getRequiredUserId(ctx)
          );
        } catch (error) {
          logger.error({ err: error }, "[Kalshi] Get trade history error");
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
          // Pass openId so audit events inside closeKalshiPosition use the
          // authenticated user's identity rather than a numeric fallback.
          // Audit logging (success + failure) is handled inside closeKalshiPosition.
          const result = await closeKalshiPosition(
            getRequiredUserId(ctx),
            input.positionId,
            input.marketId,
            input.currentPrice,
            undefined,
            ctx.user!.openId
          );

          return result;
        } catch (error) {
          logger.error({ err: error }, "[Kalshi] Close position error");
          return { success: false, error: String(error) };
        }
      }),

    // Capital management
    getCapital: protectedProcedure.query(async ({ ctx }) => {
      try {
        const userId = getRequiredUserId(ctx);
        const creds = await kalshiCredDb.getKalshiCredentials(userId);
        if (!creds) return null;
        if ("needsReauth" in creds && creds.needsReauth) return null;
        if (creds.accountStatus !== "connected") {
          return null;
        }

        const equityResult = await fetchKalshiAccountEquity(
          creds.apiKey,
          creds.privateKey
        );
        if (equityResult.error) {
          return null;
        }

        const [, capital] = await Promise.all([
          kalshiCredDb.updateKalshiAccountEquity(userId, equityResult.equity),
          db.syncKalshiCapitalWithLiveEquity(equityResult.equity, userId),
        ]);

        return capital;
      } catch (error) {
        logger.error({ err: error }, "[Kalshi] Get capital error");
        return null;
      }
    }),

    initializeCapital: protectedProcedure
      .input(z.object({ amount: z.number().default(0) }))
      .mutation(async ({ input, ctx }) => {
        try {
          await db.initializeKalshiCapital(
            input.amount,
            getRequiredUserId(ctx)
          );
          await db.logAuditEvent(
            "kalshi_capital_initialized",
            `$${input.amount}`,
            ctx.user!.openId
          );
          return { success: true };
        } catch (error) {
          logger.error({ err: error }, "[Kalshi] Initialize capital error");
          return { success: false, error: String(error) };
        }
      }),

    withdrawCapital: protectedProcedure
      .input(z.object({ amount: z.number().min(0.01) }))
      .mutation(async ({ input, ctx }) => {
        // Block all withdrawals during paper trading mode
        if (ctx.paperTradeMode) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Cannot withdraw during paper trading mode. Switch to real mode first.",
          });
        }

        // Future implementation: actual withdrawal logic would go here
        // For now, this is a placeholder that only enforces paper mode blocking
        throw new TRPCError({
          code: "NOT_IMPLEMENTED",
          message: "Fund withdrawals are not yet implemented.",
        });
      }),

    // Signals
    getRecentSignals: protectedProcedure.query(async ({ ctx }) => {
      try {
        return await db.getRecentSignals(20, getRequiredUserId(ctx));
      } catch (error) {
        logger.error({ err: error }, "[Kalshi] Get signals error");
        return [];
      }
    }),

    // Audit log
    getAuditLog: protectedProcedure.query(async ({ ctx }) => {
      try {
        return await db.getAuditLog(7, ctx.user!.openId);
      } catch (error) {
        logger.error({ err: error }, "[Kalshi] Get audit log error");
        return [];
      }
    }),

    getSchedulerHeartbeat: protectedProcedure.query(async () => {
      // Lightweight read of in-memory scheduler state.  Designed to be polled
      // by the dashboard every 5–10 s so the user can see live what the bot
      // is doing between autonomy_runs writes.  No DB call.
      const { getAllSchedulerSnapshots } = await import("./_core/schedulerHeartbeat");
      return getAllSchedulerSnapshots();
    }),

    getAutonomyActivity: protectedProcedure.query(async ({ ctx }) => {
      try {
        const runs = await db.getRecentAutonomyRuns(getRequiredUserId(ctx), 8);
        return buildAutonomyActivitySummary(runs);
      } catch (error) {
        logger.error({ err: error }, "[Kalshi] Get autonomy activity error");
        return {
          lastRun: null,
          lastOrder: null,
          recentActivity: [],
        };
      }
    }),

    getRecentAutonomyRuns: protectedProcedure
      .input(
        z
          .object({
            limit: z.number().int().min(1).max(50).optional().default(20),
          })
          .optional()
      )
      .query(async ({ input, ctx }) => {
        try {
          return await db.getRecentAutonomyRuns(
            getRequiredUserId(ctx),
            input?.limit ?? 20
          );
        } catch (error) {
          logger.error(
            { err: error },
            "[Kalshi] Get recent autonomy runs error"
          );
          return [];
        }
      }),

    getAutonomyRunDetail: protectedProcedure
      .input(z.object({ runId: z.string().min(1).max(64) }))
      .query(async ({ input, ctx }) => {
        try {
          const run = await db.getAutonomyRunDetail(
            input.runId,
            getRequiredUserId(ctx)
          );
          if (!run) return null;

          const auditDetails = parseAuditDetails(run.decision as string | null);
          const candidateSetPayload = parseAuditDetails(
            run.candidateSet as string | null
          );
          const rejectedCandidatesPayload = parseAuditDetails(
            run.rejectedCandidates as string | null
          );
          const decision = parseDecisionDetails(
            auditDetails ? { decision: auditDetails } : null
          );

          return {
            runId: run.runId,
            status: run.status,
            reason: run.reason,
            startedAt: run.startedAt,
            completedAt: run.completedAt ?? null,
            autonomyMode: run.autonomyMode,
            executionCadence: run.executionCadence,
            triggerSource: run.triggerSource,
            signalsGenerated: Number(run.signalsGenerated ?? 0),
            executionCandidates: Number(run.executionCandidates ?? 0),
            orderPlaced: isOrderPlacedFlag(run.orderPlaced),
            orderId: typeof run.orderId === "string" ? run.orderId : null,
            executedMarketId:
              typeof run.executedMarketId === "string"
                ? run.executedMarketId
                : null,
            candidateMarketId:
              typeof run.candidateMarketId === "string"
                ? run.candidateMarketId
                : null,
            reconciliationStatus:
              typeof run.reconciliationStatus === "string"
                ? run.reconciliationStatus
                : null,
            reconciliationReason:
              typeof run.reconciliationReason === "string"
                ? run.reconciliationReason
                : null,
            appliedGuardrails: parseAuditDetails(
              run.appliedGuardrails as string | null
            ),
            decision,
            candidateSet: Array.isArray(candidateSetPayload)
              ? candidateSetPayload
              : [],
            rejectedCandidates: Array.isArray(rejectedCandidatesPayload)
              ? rejectedCandidatesPayload
              : [],
          };
        } catch (error) {
          logger.error(
            { err: error },
            "[Kalshi] Get autonomy run detail error"
          );
          return null;
        }
      }),

    // Risk controls
    killSwitch: protectedProcedure.mutation(async ({ ctx }) => {
      try {
        const userId = getRequiredUserId(ctx);
        const preferences =
          await tradingPreferencesDb.getTradingPreferences(userId);
        await tradingPreferencesDb.saveTradingPreferences(userId, {
          ...preferences,
          liveTradingEnabled: false,
        });
        const result = await activateKalshiKillSwitch(userId);
        await db.logAuditEvent(
          "kalshi_kill_switch_activated",
          JSON.stringify({
            totalPositions: result.totalPositions,
            closedPositions: result.closedPositions,
            failedPositions: result.failedPositions,
          }),
          ctx.user!.openId
        );
        if (result.failedPositions > 0) {
          const failedMarketIds = result.results
            .filter(r => !r.success)
            .map(r => r.marketId);
          void alertKillSwitchPartialFailure(userId, {
            totalPositions: result.totalPositions,
            closedPositions: result.closedPositions,
            failedPositions: result.failedPositions,
            failedMarketIds,
          });
        }
        return result;
      } catch (error) {
        logger.error({ err: error }, "[Kalshi] Kill switch error");
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

    getRiskLimits: protectedProcedure.query(async ({ ctx }) =>
      getDynamicRiskLimits(getRequiredUserId(ctx))
    ),

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
          logger.error({ err: error }, "[Kalshi] Subscribe market feed error");
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
          logger.error(
            { err: error },
            "[Kalshi] Unsubscribe market feed error"
          );
          return { success: false, error: String(error) };
        }
      }),

    getMarketFeed: protectedProcedure
      .input(z.object({ marketId: z.string() }))
      .query(async ({ input }) => {
        try {
          return getMarketFeed(input.marketId);
        } catch (error) {
          logger.error({ err: error }, "[Kalshi] Get market feed error");
          return null;
        }
      }),

    getAllMarketFeeds: protectedProcedure.query(async () => {
      try {
        return getAllMarketFeeds();
      } catch (error) {
        logger.error({ err: error }, "[Kalshi] Get all market feeds error");
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
        const userId = getRequiredUserId(ctx);
        try {
          const markets = await Promise.all(
            input.marketIds.map(id => db.getKalshiMarket(id))
          );
          const validMarkets = markets.filter((m): m is any => {
            if (!m) return false;

            const yesPrice = Number(m.yesPrice ?? 0);
            const noPrice = Number(m.noPrice ?? 0);
            const impliedProbability = Number(m.impliedProbability ?? 0.5);

            return (
              Number.isFinite(yesPrice) &&
              Number.isFinite(noPrice) &&
              Number.isFinite(impliedProbability) &&
              yesPrice > 0.01 &&
              yesPrice < 0.99 &&
              noPrice > 0.01 &&
              noPrice < 0.99 &&
              impliedProbability > 0.01 &&
              impliedProbability < 0.99
            );
          });

          if (validMarkets.length === 0) {
            return {
              success: false,
              signals: [],
              error: "No actionable markets found from the selected set",
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
            validMarkets.map(market => [
              market.id,
              {
                topic: market.title,
                marketSentiment: Math.max(
                  -1,
                  Math.min(1, (market.impliedProbability - 0.5) * 2)
                ),
              },
            ])
          );
          const allSignals = await generateSignalsForMarkets(
            validMarkets,
            feeds,
            fundamentalProbs,
            sentimentContexts,
            userId
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

          // Claude makes the final go/no-go on each candidate before persistence.
          const reviewedSignals = await reviewSignalsWithTrader({
            markets: validMarkets,
            signals: filteredSignals,
            maxSignals: 12,
          });

          await saveSignals(reviewedSignals, getRequiredUserId(ctx));
          await db.logAuditEvent(
            "kalshi_signals_generated",
            JSON.stringify({
              count: reviewedSignals.length,
              heuristicCount: filteredSignals.length,
              minConfidence: input.minConfidence,
            }),
            ctx.user!.openId
          );

          return { success: true, signals: reviewedSignals };
        } catch (error) {
          logger.error({ err: error }, "[Kalshi] Generate signals error");
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
      .query(async ({ input, ctx }) => {
        try {
          const recentSignals = await db.getRecentSignals(
            50,
            getRequiredUserId(ctx)
          );
          return getTopSignalsForExecution(
            recentSignals,
            input.topN,
            input.minExecutionScore
          );
        } catch (error) {
          logger.error({ err: error }, "[Kalshi] Get top signals error");
          return [];
        }
      }),

    getSignalHistory: protectedProcedure
      .input(
        z.object({ limit: z.number().min(1).max(200).optional().default(50) })
      )
      .query(async ({ input, ctx }) => {
        try {
          return await db.getRecentSignals(input.limit, getRequiredUserId(ctx));
        } catch (error) {
          logger.error({ err: error }, "[Kalshi] Get signal history error");
          return [];
        }
      }),

    getPerformanceOverview: protectedProcedure.query(async ({ ctx }) => {
      try {
        return await getPerformanceOverview(getRequiredUserId(ctx));
      } catch (error) {
        logger.error({ err: error }, "[Kalshi] Get performance overview error");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to load performance overview",
          cause: error,
        });
      }
    }),

    /**
     * Cross-platform realised P&L over a recent window (default 7 days).
     * The single number an operator needs while validating in paper mode:
     * "did the bot make money this week?".  Combines closed Kalshi and
     * Polymarket positions; the same query reflects real P&L when
     * PAPER_TRADE_MODE is off.
     */
    getPnlSummary: protectedProcedure
      .input(z.object({ windowDays: z.number().int().min(1).max(90).default(7) }).optional())
      .query(async ({ ctx, input }) => {
        try {
          return await getPnlSummary(getRequiredUserId(ctx), input?.windowDays ?? 7);
        } catch (error) {
          logger.error({ err: error }, "[Pnl] Get P&L summary error");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to load P&L summary",
            cause: error,
          });
        }
      }),

    /**
     * Replays the exit strategy against historical kalshiMarketSnapshots so
     * the operator can see win-rate / Sharpe / max-drawdown for the exit
     * pipeline before committing real capital.  Limited to OWNER_EMAIL —
     * it's an expensive query that grows with windowDays * snapshots.
     */
    runExitBacktest: protectedProcedure
      .input(
        z
          .object({
            windowDays: z.number().int().min(1).max(180).default(30),
            sides: z
              .array(z.enum(["yes", "no"]))
              .default(["yes", "no"]),
            entryPolicy: z
              .object({
                kind: z.enum(["first", "every-n"]).default("first"),
                stride: z.number().int().min(1).max(100).optional(),
              })
              .default({ kind: "first" }),
            initialRiskUsd: z.number().min(1).max(10000).default(100),
          })
          .optional(),
      )
      .mutation(async ({ input }) => {
        try {
          return await runExitStrategyBacktest({
            windowDays: input?.windowDays ?? 30,
            sides: input?.sides,
            entryPolicy: input?.entryPolicy,
            initialRiskUsd: input?.initialRiskUsd,
          });
        } catch (error) {
          logger.error({ err: error }, "[Backtest] exit-strategy backtest failed");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Backtest failed.  See server logs.",
            cause: error,
          });
        }
      }),

    getAttributionAnalysis: protectedProcedure
      .input(
        z
          .object({
            limit: z.number().min(10).max(1000).optional().default(250),
          })
          .optional()
      )
      .query(async ({ input, ctx }) => {
        try {
          const rows = await db.getPerformanceAttributionHistory(
            getRequiredUserId(ctx),
            "kalshi",
            input?.limit ?? 250
          );
          const normalized = rows.map((row: any) => ({
            totalPnl: Number(row.totalPnl ?? 0),
            signalAlpha: Number(row.signalAlpha ?? 0),
            execution: Number(row.execution ?? 0),
            timing: Number(row.timing ?? 0),
            luck: Number(row.luck ?? 0),
            signalType: String(row.signalType ?? "unknown"),
            category: String(row.category ?? "unknown"),
          }));

          const sharpeBySource = calculateSharpeBySource(normalized);
          const losingPatterns = identifyLosingPatterns(normalized);

          return {
            count: normalized.length,
            totals: normalized.reduce(
              (
                acc: {
                  totalPnl: number;
                  signalAlpha: number;
                  execution: number;
                  timing: number;
                  luck: number;
                },
                row: {
                  totalPnl: number;
                  signalAlpha: number;
                  execution: number;
                  timing: number;
                  luck: number;
                }
              ) => {
                acc.totalPnl += row.totalPnl;
                acc.signalAlpha += row.signalAlpha;
                acc.execution += row.execution;
                acc.timing += row.timing;
                acc.luck += row.luck;
                return acc;
              },
              { totalPnl: 0, signalAlpha: 0, execution: 0, timing: 0, luck: 0 }
            ),
            sharpeBySource,
            losingPatterns,
            rows: normalized,
          };
        } catch (error) {
          logger.error(
            { err: error },
            "[Kalshi] Get attribution analysis error"
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to load attribution analysis",
            cause: error,
          });
        }
      }),

    getEquityCurve: protectedProcedure
      .input(
        z
          .object({
            days: z.number().int().min(7).max(365).optional().default(30),
          })
          .optional()
      )
      .query(async ({ input, ctx }) => {
        try {
          const userId = getRequiredUserId(ctx);
          const days = input?.days ?? 30;
          const [overview, dailyPnl] = await Promise.all([
            getPerformanceOverview(userId),
            db.getKalshiEquityCurve(userId, days),
          ]);

          const startingBalance = Number(overview?.startingBalance ?? 0);
          const currentBalance = Number(overview?.currentBalance ?? 0);

          // Build cumulative-equity series: starting balance → cumulative
          // realized PnL by day → final point at currentBalance (today).
          const today = new Date();
          const todayKey = new Date(
            Date.UTC(
              today.getUTCFullYear(),
              today.getUTCMonth(),
              today.getUTCDate()
            )
          )
            .toISOString()
            .split("T")[0];

          const points: Array<{ date: string; equity: number }> = [];
          if (dailyPnl.length === 0) {
            // No closed trades yet — return a trivial flat series so the
            // chart can render the current balance honestly.
            const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
              .toISOString()
              .split("T")[0];
            points.push({ date: startDate, equity: startingBalance });
            points.push({ date: todayKey, equity: currentBalance });
            return {
              points,
              startingBalance,
              currentBalance,
              hasHistory: false,
            };
          }

          // Anchor the curve at the day before the first close so the
          // initial equity is plotted as the starting balance.
          const firstDate = new Date(`${dailyPnl[0].date}T00:00:00Z`);
          const anchorDate = new Date(firstDate.getTime() - 24 * 60 * 60 * 1000)
            .toISOString()
            .split("T")[0];
          points.push({ date: anchorDate, equity: startingBalance });

          let runningEquity = startingBalance;
          for (const row of dailyPnl) {
            runningEquity += row.realizedPnl;
            points.push({ date: row.date, equity: runningEquity });
          }

          // Always close the curve at "today" with the live current
          // balance so the chart reflects unrealized PnL movement too.
          if (points[points.length - 1].date !== todayKey) {
            points.push({ date: todayKey, equity: currentBalance });
          } else {
            points[points.length - 1] = {
              date: todayKey,
              equity: currentBalance,
            };
          }

          return { points, startingBalance, currentBalance, hasHistory: true };
        } catch (error) {
          logger.error({ err: error }, "[Kalshi] Get equity curve error");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to load equity curve",
            cause: error,
          });
        }
      }),

    getActivityHeatmap: protectedProcedure
      .input(
        z
          .object({
            days: z.number().int().min(7).max(365).optional().default(90),
          })
          .optional()
      )
      .query(async ({ input, ctx }) => {
        try {
          const userId = getRequiredUserId(ctx);
          const buckets = await db.getKalshiActivityHeatmap(
            userId,
            input?.days ?? 90
          );
          return { buckets };
        } catch (error) {
          logger.error({ err: error }, "[Kalshi] Get activity heatmap error");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to load activity heatmap",
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

          const userId = getRequiredUserId(ctx);

          try {
            await kalshiCredDb.saveKalshiCredentials(
              userId,
              input.apiKey,
              input.privateKey,
              equityResult.equity
            );
            await db.syncKalshiCapitalWithLiveEquity(
              equityResult.equity,
              userId
            );
            await db.logAuditEvent(
              "kalshi_account_connected",
              `Equity: $${equityResult.equity}`,
              ctx.user!.openId
            );
          } catch (storageError) {
            logger.error(
              { err: storageError },
              "[Kalshi] Failed to persist validated credentials"
            );
            const GENERIC_STORAGE_MESSAGE =
              "Your Kalshi credentials were validated, but the dashboard could not save the connection state. Please retry in a moment.";
            // Only forward our own known-safe message (encryption mismatch).
            // All other errors (DB driver messages, constraint names, etc.)
            // use the generic fallback so internals never reach the client.
            const storageMessage =
              storageError instanceof Error &&
              storageError.message.startsWith("Credentials could not be securely stored:")
                ? storageError.message
                : GENERIC_STORAGE_MESSAGE;
            return {
              success: false,
              error: storageMessage,
            };
          }

          return {
            success: true,
            equity: equityResult.equity,
            mode: equityResult.mode ?? validation.mode,
          };
        } catch (error) {
          logger.error({ err: error }, "[Kalshi] Connect account error");
          return {
            success: false,
            error: "Failed to connect Kalshi account. Check your API key and try again.",
          };
        }
      }),

    getKalshiAccountStatus: protectedProcedure.query(async ({ ctx }) => {
      try {
        const userId = getRequiredUserId(ctx);
        const [creds, preferences] = await Promise.all([
          kalshiCredDb.getKalshiCredentials(userId),
          tradingPreferencesDb.getTradingPreferences(userId),
        ]);
        if (!creds) {
          return {
            connected: false,
            equity: 0,
            status: "disconnected",
            tradingPreferences: preferences,
          };
        }

        // Credentials exist but cannot be decrypted — encryption secret mismatch.
        // Prompt the user to re-authenticate rather than showing a generic error.
        if ("needsReauth" in creds && creds.needsReauth) {
          return {
            connected: false,
            equity: 0,
            status: "disconnected",
            needsReauth: true,
            reauthMessage:
              "Your Kalshi credentials could not be decrypted. This happens when the server's encryption secret changes. Please reconnect your Kalshi account.",
            tradingPreferences: preferences,
          };
        }

        if (creds.accountStatus !== "connected") {
          return {
            connected: false,
            equity: 0,
            status: creds.accountStatus,
            lastSyncedAt: creds.lastSyncedAt,
            tradingPreferences: preferences,
          };
        }

        const equityResult = await fetchKalshiAccountEquity(
          creds.apiKey,
          creds.privateKey
        );
        if (equityResult.error) {
          return {
            connected: true,
            equity: 0,
            status: "error",
            lastSyncedAt: creds.lastSyncedAt,
            error: equityResult.error,
            tradingPreferences: preferences,
          };
        }

        await Promise.all([
          kalshiCredDb.updateKalshiAccountEquity(userId, equityResult.equity),
          db.syncKalshiCapitalWithLiveEquity(equityResult.equity, userId),
        ]);

        return {
          connected: true,
          equity: equityResult.equity,
          status: "connected",
          lastSyncedAt: new Date(),
          tradingPreferences: preferences,
        };
      } catch (error) {
        logger.error({ err: error }, "[Kalshi] Get account status error");
        return {
          connected: false,
          equity: 0,
          status: "error",
          error: String(error),
          tradingPreferences: tradingPreferencesDb.DEFAULT_TRADING_PREFERENCES,
        };
      }
    }),

    getTradingPreferences: protectedProcedure.query(async ({ ctx }) => {
      try {
        const userId = getRequiredUserId(ctx);
        return await tradingPreferencesDb.getTradingPreferences(userId);
      } catch (error) {
        logger.error({ err: error }, "[Kalshi] Get trading preferences error");
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Unable to load trading preferences",
          cause: error,
        });
      }
    }),

    updateTradingPreferences: protectedProcedure
      .input(tradingPreferencesInput)
      .mutation(async ({ ctx, input }) => {
        try {
          const userId = getRequiredUserId(ctx);
          const currentPreferences =
            await tradingPreferencesDb.getTradingPreferences(userId);

          if (currentPreferences.liveTradingEnabled) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Disarm live trading before changing autonomy policy settings.",
            });
          }

          if (input.liveTradingEnabled) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Save policy changes while disarmed, then use the arm live trading action.",
            });
          }

          const saved = await tradingPreferencesDb.saveTradingPreferences(
            userId,
            input
          );
          await db.logAuditEvent(
            "trading_preferences_updated",
            JSON.stringify({
              autonomyMode: saved.autonomyMode,
              liveTradingEnabled: saved.liveTradingEnabled,
              executionCadence: saved.executionCadence,
              riskPosture: saved.riskPosture,
            }),
            ctx.user!.openId
          );

          return {
            success: true,
            preferences: saved,
          };
        } catch (error) {
          if (error instanceof TRPCError) {
            throw error;
          }
          logger.error(
            { err: error },
            "[Kalshi] Update trading preferences error"
          );
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to save trading preferences",
            cause: error,
          });
        }
      }),

    setTradingActivation: protectedProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        try {
          const userId = getRequiredUserId(ctx);
          const [creds, preferences] = await Promise.all([
            kalshiCredDb.getKalshiCredentials(userId),
            tradingPreferencesDb.getTradingPreferences(userId),
          ]);

          if (!input.enabled) {
            const saved = await tradingPreferencesDb.saveTradingPreferences(
              userId,
              {
                ...preferences,
                liveTradingEnabled: false,
              }
            );
            await db.logAuditEvent(
              "live_trading_disarmed",
              `Mode: ${saved.autonomyMode}`,
              ctx.user!.openId
            );
            return { success: true, preferences: saved };
          }

          if (
            !creds ||
            ("needsReauth" in creds && creds.needsReauth) ||
            creds.accountStatus !== "connected"
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: !creds
                ? "Connect a live Kalshi account before arming live trading."
                : "needsReauth" in creds && creds.needsReauth
                  ? "Your Kalshi credentials need to be re-entered before arming live trading. Please reconnect your Kalshi account."
                  : "Connect a live Kalshi account before arming live trading.",
            });
          }

          if (Number(creds.accountEquity ?? 0) <= 0) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Fund the connected Kalshi account before arming live trading.",
            });
          }

          if (preferences.autonomyMode === "manual") {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Manual mode keeps live trading disarmed. Choose another autonomy mode first.",
            });
          }

          // Live autonomous trading is open to every authenticated user.
          // Paper-mode is opt-in via PAPER_TRADE_MODE=true (env-level
          // global override) or by leaving liveTradingEnabled=false in
          // Trading Preferences.  The previous `betaAccessLevel='none'`
          // gate has been removed; the column + getUserBetaAccessLevel
          // helper stay in case beta-tier features come back later.
          //
          // Per-user safety still depends on:
          //   - withUserLock around the order-placement path (TOCTOU)
          //   - getEffectivePaperTradeMode (owner=live, others=paper unless
          //     explicitly graduated; PAPER_TRADE_MODE=true forces all paper)
          //   - profitGuardrails (EV/confidence floors, exposure caps)
          //   - per-user max-order-notional + max-daily-orders in TP

          const saved = await tradingPreferencesDb.saveTradingPreferences(
            userId,
            {
              ...preferences,
              liveTradingEnabled: true,
            }
          );
          await db.logAuditEvent(
            "live_trading_armed",
            `Mode: ${saved.autonomyMode}`,
            ctx.user!.openId
          );

          return { success: true, preferences: saved };
        } catch (error) {
          if (error instanceof TRPCError) {
            throw error;
          }
          logger.error({ err: error }, "[Kalshi] Set trading activation error");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to update live trading activation",
            cause: error,
          });
        }
      }),

    setAggressiveMode: protectedProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const userId = getRequiredUserId(ctx);
        const existing = await tradingPreferencesDb.getTradingPreferences(userId);

        if (input.enabled) {
          // Require connected Kalshi credentials before flipping the master
          // switch on — Aggressive Mode immediately enables live trading.
          const creds = await kalshiCredDb.getKalshiCredentials(userId);
          if (
            !creds ||
            ("needsReauth" in creds && creds.needsReauth) ||
            creds.accountStatus !== "connected"
          ) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Connect a live Kalshi account before enabling Aggressive Mode.",
            });
          }

          const overrides = tradingPreferencesDb.buildAggressiveModePresetOverrides();
          const saved = await tradingPreferencesDb.saveTradingPreferences(userId, {
            ...existing,
            ...overrides,
          });
          await db.logAuditEvent(
            "aggressive_mode_enabled",
            JSON.stringify({ overrides }),
            ctx.user!.openId,
          );
          return { success: true, preferences: saved };
        }

        // Disabling: just flip the flag, leave the rest of the prefs alone
        // so the user can keep whatever cadence/notional/etc. they had set.
        const saved = await tradingPreferencesDb.saveTradingPreferences(userId, {
          ...existing,
          aggressiveMode: false,
        });
        await db.logAuditEvent(
          "aggressive_mode_disabled",
          "",
          ctx.user!.openId,
        );
        return { success: true, preferences: saved };
      }),

    setMoonshotMode: protectedProcedure
      .input(z.object({ enabled: z.boolean() }))
      .mutation(async ({ ctx, input }) => {
        const userId = getRequiredUserId(ctx);
        const existing = await tradingPreferencesDb.getTradingPreferences(userId);

        // Moonshot Mode requires Aggressive Mode to be on first — it's an
        // advanced sleeve, not a beginner toggle.  Reject the enable
        // attempt rather than silently flipping aggressiveMode for the user.
        if (input.enabled && !existing.aggressiveMode) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Enable Aggressive Mode before turning on Moonshot Mode.",
          });
        }

        const saved = await tradingPreferencesDb.saveTradingPreferences(userId, {
          ...existing,
          moonshotMode: input.enabled,
        });
        await db.logAuditEvent(
          input.enabled ? "moonshot_mode_enabled" : "moonshot_mode_disabled",
          "",
          ctx.user!.openId,
        );
        return { success: true, preferences: saved };
      }),

    disconnectKalshiAccount: protectedProcedure.mutation(async ({ ctx }) => {
      try {
        const userId = getRequiredUserId(ctx);
        await kalshiCredDb.deleteKalshiCredentials(userId);
        await db.logAuditEvent(
          "kalshi_account_disconnected",
          "",
          ctx.user!.openId
        );
        return { success: true };
      } catch (error) {
        logger.error({ err: error }, "[Kalshi] Disconnect account error");
        return { success: false, error: String(error) };
      }
    }),

    // --- Risk parameter tuning ---
    getRiskParameters: protectedProcedure.query(async ({ ctx }) => {
      try {
        const userId = getRequiredUserId(ctx);
        const history = await getRiskParameterHistory(userId, 1);
        const currentParams =
          history.length > 0 ? history[0].params : DEFAULT_RISK_PARAMETERS;
        return {
          current: currentParams,
          defaults: DEFAULT_RISK_PARAMETERS,
        };
      } catch (error) {
        logger.error({ err: error }, "[Kalshi] Get risk parameters error");
        return {
          current: DEFAULT_RISK_PARAMETERS,
          defaults: DEFAULT_RISK_PARAMETERS,
        };
      }
    }),

    validateRiskParameters: protectedProcedure
      .input(
        z.object({
          maxPositionSizePercent: z.number().optional(),
          maxDailyLossPercent: z.number().optional(),
          maxOpenPositions: z.number().int().optional(),
          minCapitalReservePercent: z.number().optional(),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const userId = getRequiredUserId(ctx);

          // Validate parameters
          const validation = await validateRiskParameters(input);

          // Estimate impact on recent runs
          const impactEstimate = await estimateImpactOnRecentRuns(userId, {
            maxPositionSizePercent:
              input.maxPositionSizePercent ??
              DEFAULT_RISK_PARAMETERS.maxPositionSizePercent,
            maxDailyLossPercent:
              input.maxDailyLossPercent ??
              DEFAULT_RISK_PARAMETERS.maxDailyLossPercent,
            maxOpenPositions:
              input.maxOpenPositions ??
              DEFAULT_RISK_PARAMETERS.maxOpenPositions,
            minCapitalReservePercent:
              input.minCapitalReservePercent ??
              DEFAULT_RISK_PARAMETERS.minCapitalReservePercent,
          });

          return {
            valid: validation.valid,
            warnings: validation.warnings,
            errors: validation.errors,
            impact: impactEstimate,
          };
        } catch (error) {
          logger.error(
            { err: error },
            "[Kalshi] Validate risk parameters error"
          );
          return {
            valid: false,
            warnings: [],
            errors: ["Failed to validate parameters"],
            impact: {
              wouldHaveBlocked: 0,
              wouldHaveExecuted: 0,
              accountAtRisk: 0,
              recommendation: "Validation failed",
            },
          };
        }
      }),

    applyRiskParameters: protectedProcedure
      .input(
        z.object({
          maxPositionSizePercent: z.number(),
          maxDailyLossPercent: z.number(),
          maxOpenPositions: z.number().int(),
          minCapitalReservePercent: z.number(),
          platform: z.enum(["kalshi", "polymarket"]),
        })
      )
      .mutation(async ({ ctx, input }) => {
        try {
          const userId = getRequiredUserId(ctx);

          const params: RiskParameters = {
            maxPositionSizePercent: input.maxPositionSizePercent,
            maxDailyLossPercent: input.maxDailyLossPercent,
            maxOpenPositions: input.maxOpenPositions,
            minCapitalReservePercent: input.minCapitalReservePercent,
          };

          // Validate first
          const validation = await validateRiskParameters(params);
          if (!validation.valid) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: `Invalid parameters: ${validation.errors.join(", ")}`,
            });
          }

          // Apply the parameters
          await applyRiskParameters(
            userId,
            input.platform,
            params,
            ctx.user!.openId
          );

          return {
            success: true,
            params,
            message: `${input.platform} risk parameters updated`,
          };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          logger.error({ err: error }, "[Kalshi] Apply risk parameters error");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to apply risk parameters",
            cause: error,
          });
        }
      }),

    getRiskTuningHistory: protectedProcedure
      .input(
        z.object({
          limit: z.number().int().min(1).max(50).optional().default(20),
        })
      )
      .query(async ({ ctx, input }) => {
        try {
          const userId = getRequiredUserId(ctx);
          const history = await getRiskParameterHistory(userId, input.limit);
          return { history, count: history.length };
        } catch (error) {
          logger.error(
            { err: error },
            "[Kalshi] Get risk tuning history error"
          );
          return { history: [], count: 0 };
        }
      }),
  }),

  // Beta access management
  beta: router({
    /** Return the current user's beta access level. */
    getStatus: protectedProcedure.query(async ({ ctx }) => {
      try {
        const userId = getRequiredUserId(ctx);
        const betaAccessLevel = await db.getUserBetaAccessLevel(userId);
        return {
          betaAccessLevel,
          hasLiveAccess: betaAccessLevel !== "none",
        };
      } catch (error) {
        logger.error({ err: error }, "[Beta] Get beta status error");
        return { betaAccessLevel: "none" as const, hasLiveAccess: false };
      }
    }),

    /** Admin-only: grant or revoke beta access for a user by their integer id. */
    setAccess: protectedProcedure
      .input(
        z.object({
          targetUserId: z.number().int().positive(),
          level: z.enum(["none", "internal", "invited", "public"]),
        })
      )
      .mutation(async ({ input, ctx }) => {
        try {
          const requestingUser = ctx.user;
          if (requestingUser?.role !== "admin") {
            throw new TRPCError({
              code: "FORBIDDEN",
              message: "Only admins can modify beta access.",
            });
          }

          const updated = await db.setBetaAccessLevel(
            input.targetUserId,
            input.level
          );
          await db.logAuditEvent(
            "beta_access_updated",
            JSON.stringify({
              targetUserId: input.targetUserId,
              level: input.level,
            }),
            requestingUser.openId
          );

          return { success: true, user: updated };
        } catch (error) {
          if (error instanceof TRPCError) throw error;
          logger.error({ err: error }, "[Beta] Set beta access error");
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Unable to update beta access level",
            cause: error,
          });
        }
      }),
  }),


  // --------------------------------------------------------------------------
  // AI Chatbot workspaces (Kalshi + Polymarket, persistent memory)
  // --------------------------------------------------------------------------
  chat: chatRouter,

  combinatorial: router({
    /**
     * Detect cross-market combinatorial arbitrage on Kalshi markets.
     * Checks sum-to-one violations and logical implication violations.
     */
    detectKalshiArbitrage: protectedProcedure
      .input(
        z
          .object({
            minSumDeviation: z
              .number()
              .min(0)
              .max(0.5)
              .optional()
              .default(0.03),
            minViolation: z.number().min(0).max(0.5).optional().default(0.05),
            minLiquidity: z.number().min(0).optional().default(500),
          })
          .optional()
      )
      .query(async ({ input }) => {
        try {
          const rawMarkets = await fetchKalshiMarkets({ status: "open" });
          const markets: ArbitrageMarket[] = rawMarkets
            .filter(m => m.status === "open")
            .map(m => ({
              marketId: m.id,
              title: m.title,
              category: m.category,
              impliedProbabilityYes: Number(m.impliedProbability ?? 0.5),
              yesPrice: Number(m.yesPrice ?? 0),
              noPrice: Number(m.noPrice ?? 0),
              volume: Number(m.yesVolume ?? 0) + Number(m.noVolume ?? 0),
              liquidity: Number(m.yesVolume ?? 0) + Number(m.noVolume ?? 0),
            }));

          const opportunities = detectAllCombinatorialArbitrage(markets, {
            minSumDeviation: input?.minSumDeviation ?? 0.03,
            minViolation: input?.minViolation ?? 0.05,
            minLiquidity: input?.minLiquidity ?? 500,
          });

          return { opportunities, marketsAnalyzed: markets.length };
        } catch (error) {
          logger.error(
            { err: error },
            "[Combinatorial] Kalshi arbitrage detection error"
          );
          return { opportunities: [], marketsAnalyzed: 0 };
        }
      }),

  }),

  trading: router({
    getTradingReadinessStatus: protectedProcedure.query(async ({ ctx }) => {
      const userId = getRequiredUserId(ctx);
      const [prefs, recentRuns, auditLog] = await Promise.all([
        tradingPreferencesDb.getTradingPreferences(userId),
        db.getRecentAutonomyRuns(userId, 10),
        db.getAuditLog(30, ctx.user!.openId),
      ]);

      // Count autonomy cycles (runs with status: executed, skipped, or error)
      const autonomyCyclesCompleted = recentRuns.filter(
        (r: any) =>
          r.status === "executed" ||
          r.status === "skipped" ||
          r.status === "error"
      ).length;

      // Determine paper trading mode and duration
      const paperTradeMode = !prefs.liveTradingEnabled;
      const firstRunDate =
        recentRuns.length > 0
          ? recentRuns[recentRuns.length - 1]?.startedAt
          : null;
      const daysInPaperMode = firstRunDate
        ? Math.floor(
            (Date.now() - new Date(firstRunDate).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : 0;

      // Collect desk memory stats (Kalshi + Polymarket)
      const allDeskIds = [
        "kalshi_sports",
        "kalshi_crypto",
        "kalshi_politics",
        "kalshi_esports",
        "polymarket_crypto",
        "polymarket_politics",
        "polymarket_general",
        "polymarket_sports",
      ];

      const deskMemoryStats: Record<
        string,
        {
          totalLessons: number;
          winRate: number;
          recentLessons: Array<{
            ts: string;
            outcome: "win" | "loss" | "scratch";
            note: string;
          }>;
        }
      > = {};

      // Fetch desk memory for Kalshi and Polymarket
      const kalshiDesks = await Promise.all([
        import("./db.desk-memory").then(m =>
          m.getDeskMemory(userId, "kalshi", "kalshi_sports")
        ),
        import("./db.desk-memory").then(m =>
          m.getDeskMemory(userId, "kalshi", "kalshi_crypto")
        ),
        import("./db.desk-memory").then(m =>
          m.getDeskMemory(userId, "kalshi", "kalshi_politics")
        ),
        import("./db.desk-memory").then(m =>
          m.getDeskMemory(userId, "kalshi", "kalshi_esports")
        ),
      ]);

      const allDesks = [...kalshiDesks].filter(Boolean);
      for (const desk of allDesks) {
        if (desk) {
          const winRate =
            desk.tradeCount > 0 ? (desk.winCount / desk.tradeCount) * 100 : 0;
          deskMemoryStats[desk.deskId] = {
            totalLessons: desk.notes.length,
            winRate: Math.round(winRate),
            recentLessons: desk.notes.slice(-3),
          };
        }
      }

      // Build recent autonomy runs summary
      const recentAutonomyRuns = recentRuns.slice(0, 10).map((run: any) => ({
        runId: run.runId || "",
        timestamp: run.startedAt?.toISOString() || new Date().toISOString(),
        platform: "kalshi" as const, // Simplified; could parse from decision details
        signalsGenerated: run.signalsGenerated || 0,
        signalsApproved: run.executionCandidates || 0,
        ordersPlaced: run.orderPlaced ? 1 : 0,
        ordersBlocked: run.executionCandidates > 0 && !run.orderPlaced ? 1 : 0,
        totalPnL: 0, // Would require additional query if needed
        executionStatus: (run.status || "error") as
          | "completed"
          | "skipped"
          | "error",
      }));

      return {
        paperTradeMode,
        daysInPaperMode,
        autonomyCyclesCompleted,
        deskMemoryStats,
        recentAutonomyRuns,
      };
    }),

    getPaperTradingMetrics: protectedProcedure.query(async ({ ctx }) => {
      const userId = getRequiredUserId(ctx);
      const auditLog = await db.getAuditLog(90, ctx.user!.openId);

      // Parse order placement events to compute paper vs real win rates
      let paperTrades = 0;
      let paperWins = 0;
      let realTrades = 0;
      let realWins = 0;
      let totalPaperPnL = 0;
      let totalRealPnL = 0;

      for (const event of auditLog) {
        if (
          event.eventType === "kalshi_order_placed" ||
          event.eventType === "scheduled_autonomy_order_placed"
        ) {
          try {
            const details = event.details ? JSON.parse(event.details) : {};
            const pnl =
              details.realizedPnl !== undefined
                ? Number(details.realizedPnl)
                : 0;
            // Simplified: would need live trading flag from preferences at time of trade
            paperTrades += 1;
            if (pnl > 0) paperWins += 1;
            totalPaperPnL += pnl;
          } catch {
            // Ignore parse errors
          }
        }
      }

      const paperWinRate =
        paperTrades > 0 ? Math.round((paperWins / paperTrades) * 100) : 0;
      const realWinRate =
        realTrades > 0 ? Math.round((realWins / realTrades) * 100) : 0;

      let alertMessage: string | undefined;
      let recommendation: string | undefined;

      if (realTrades > 0 && realWinRate < paperWinRate * 0.7) {
        alertMessage = `Real performance (${realWinRate}%) is 30%+ below paper baseline (${paperWinRate}%)`;
        recommendation = "Review execution discipline and risk";
      } else if (paperTrades < 5) {
        alertMessage = "Insufficient paper trade history";
        recommendation = "Complete more autonomy cycles before going live";
      } else if (realTrades === 0 && paperWinRate >= 60) {
        recommendation = "Ready to begin micro-funding Phase 1";
      }

      return {
        paperWinRate,
        paperTotalTrades: paperTrades,
        paperTotalPnL: Number(totalPaperPnL.toFixed(2)),
        realWinRate,
        realTotalTrades: realTrades,
        realTotalPnL: Number(totalRealPnL.toFixed(2)),
        comparison: {
          alertMessage,
          recommendation,
        },
      };
    }),

    getPreLiveChecklist: protectedProcedure.query(async ({ ctx }) => {
      const userId = getRequiredUserId(ctx);
      const [prefs, recentRuns, auditLog, kalshiCreds] = await Promise.all([
        tradingPreferencesDb.getTradingPreferences(userId),
        db.getRecentAutonomyRuns(userId, 30),
        db.getAuditLog(30, ctx.user!.openId),
        kalshiCredDb.getKalshiCredentials(userId),
      ]);

      // Gather metrics
      const autonomyCyclesCompleted = recentRuns.filter(
        (r: any) =>
          r.status === "executed" ||
          r.status === "skipped" ||
          r.status === "error"
      ).length;

      const firstRunDate =
        recentRuns.length > 0
          ? recentRuns[recentRuns.length - 1]?.startedAt
          : null;
      const daysInPaperMode = firstRunDate
        ? Math.floor(
            (Date.now() - new Date(firstRunDate).getTime()) /
              (1000 * 60 * 60 * 24)
          )
        : 0;

      // Count desk memory lessons per desk
      const allDesks = await Promise.all([
        import("./db.desk-memory").then(m =>
          m.getDeskMemory(userId, "kalshi", "kalshi_sports")
        ),
        import("./db.desk-memory").then(m =>
          m.getDeskMemory(userId, "kalshi", "kalshi_crypto")
        ),
        import("./db.desk-memory").then(m =>
          m.getDeskMemory(userId, "kalshi", "kalshi_politics")
        ),
        import("./db.desk-memory").then(m =>
          m.getDeskMemory(userId, "kalshi", "kalshi_esports")
        ),
      ]);

      const deskDesksWithLessons = allDesks.filter(
        d => d && d.notes.length >= 4
      ).length;

      // Calculate paper win rate
      let paperWins = 0;
      let paperTrades = 0;
      for (const event of auditLog) {
        if (
          event.eventType === "kalshi_order_placed" ||
          event.eventType === "scheduled_autonomy_order_placed"
        ) {
          paperTrades += 1;
          try {
            const details = event.details ? JSON.parse(event.details) : {};
            if (Number(details.realizedPnl) > 0) {
              paperWins += 1;
            }
          } catch {
            // Ignore
          }
        }
      }
      const paperWinRate =
        paperTrades > 0 ? (paperWins / paperTrades) * 100 : 0;

      // Check for execution errors
      const hasExecutionErrors =
        auditLog.some((e: any) => e.eventType.includes("error")) || false;

      // Build checklist items with scoring
      const checklist = [
        {
          id: "paper_duration",
          label: "7+ days paper trading",
          description: "Running paper trades for at least one week",
          completed: daysInPaperMode >= 7,
          score: daysInPaperMode >= 7 ? 20 : 0,
          evidence: `${daysInPaperMode} days in paper mode`,
        },
        {
          id: "autonomy_cycles",
          label: "30+ autonomy cycles",
          description:
            "Completed at least 30 scheduled autonomy runs (executed, skipped, or error)",
          completed: autonomyCyclesCompleted >= 30,
          score: autonomyCyclesCompleted >= 30 ? 15 : 0,
          evidence: `${autonomyCyclesCompleted} cycles completed`,
        },
        {
          id: "desk_memory",
          label: "Desk memory 4+ lessons/desk",
          description:
            "At least 4 desks have recorded 4+ lessons each from prior trades",
          completed: deskDesksWithLessons >= 4,
          score: deskDesksWithLessons >= 4 ? 15 : 0,
          evidence: `${deskDesksWithLessons}/6 desks with 4+ lessons`,
        },
        {
          id: "paper_win_rate",
          label: "Paper win rate >60%",
          description:
            "Paper trading win rate exceeds 60% confidence threshold",
          completed: paperWinRate > 60,
          score: paperWinRate > 60 ? 15 : 0,
          evidence: `${Math.round(paperWinRate)}% win rate (${paperTrades} trades)`,
        },
        {
          id: "no_errors",
          label: "No execution errors",
          description: "No critical errors in past 30 days of autonomy runs",
          completed: !hasExecutionErrors,
          score: !hasExecutionErrors ? 15 : 0,
          evidence: hasExecutionErrors ? "Errors detected" : "Clean record",
        },
        {
          id: "risk_params",
          label: "Risk parameters reviewed",
          description: "Position size, loss limits, and cadence validated",
          completed:
            prefs.maxOrderNotional > 0 &&
            prefs.maxDailyOrders > 0 &&
            prefs.riskPosture !== undefined,
          score:
            prefs.maxOrderNotional > 0 &&
            prefs.maxDailyOrders > 0 &&
            prefs.riskPosture
              ? 10
              : 0,
          evidence: `${prefs.riskPosture} posture, $${prefs.maxOrderNotional} per order`,
        },
        {
          id: "api_verified",
          label: "API credentials verified",
          description: "Kalshi API key and credentials are valid and connected",
          completed: kalshiCreds !== null,
          score: kalshiCreds !== null ? 10 : 0,
          evidence: kalshiCreds ? "Connected" : "Not configured",
        },
      ];

      const overallScore = checklist.reduce((sum, item) => sum + item.score, 0);

      let recommendation: "NOT_READY" | "CAUTIOUS" | "READY";
      if (overallScore < 60) {
        recommendation = "NOT_READY";
      } else if (overallScore < 85) {
        recommendation = "CAUTIOUS";
      } else {
        recommendation = "READY";
      }

      return {
        checklist,
        overallScore,
        recommendation,
      };
    }),
  }),
});

export type AppRouter = typeof appRouter;
