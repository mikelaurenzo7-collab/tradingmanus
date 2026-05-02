import {
  doublePrecision,
  integer,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const instructionTypeEnum = pgEnum("instruction_type", ["market_filter", "signal_filter", "position_limit", "time_window", "custom"]);
export const instructionRuleTypeEnum = pgEnum("instruction_rule_type", ["include", "exclude", "require", "forbid"]);
export const instructionScheduleTypeEnum = pgEnum("instruction_schedule_type", ["always", "time_window", "day_of_week", "market_condition"]);
export const kalshiAccountStatusEnum = pgEnum("kalshi_account_status", ["connected", "disconnected", "error"]);
export const kalshiMarketStatusEnum = pgEnum("kalshi_market_status", ["open", "closed", "resolved"]);
export const kalshiSideEnum = pgEnum("kalshi_side", ["yes", "no"]);
export const kalshiOrderActionEnum = pgEnum("kalshi_order_action", ["buy", "sell"]);
export const kalshiOrderStatusEnum = pgEnum("kalshi_order_status", ["pending", "filled", "cancelled", "rejected"]);
export const kalshiPositionStatusEnum = pgEnum("kalshi_position_status", ["open", "closing", "closed"]);
export const kalshiSignalTypeEnum = pgEnum("kalshi_signal_type", ["value_play", "momentum", "contrarian", "arbitrage", "sentiment"]);
export const kalshiOutcomeEnum = pgEnum("kalshi_outcome", ["win", "loss", "partial"]);
export const autonomyModeEnum = pgEnum("autonomy_mode", ["manual", "approval_required", "semi_autonomous", "fully_autonomous"]);
export const executionCadenceEnum = pgEnum("execution_cadence", ["manual_only", "session_assisted", "hourly_watch", "continuous_watch"]);
export const riskPostureEnum = pgEnum("risk_posture", ["conservative", "balanced", "aggressive"]);
export const autonomyRunStatusEnum = pgEnum("autonomy_run_status", ["in_progress", "executed", "generated_only", "skipped", "blocked", "error"]);
export const reconciliationStatusEnum = pgEnum("reconciliation_status", ["not_required", "pending", "reconciled"]);

const now = () => new Date();
const createdAt = () => timestamp("createdAt", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () => timestamp("updatedAt", { withTimezone: true }).defaultNow().notNull().$onUpdate(now);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 128 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  role: userRoleEnum("role").default("user").notNull(),
  createdAt: createdAt(),
});

export const auditLog = pgTable("auditLog", {
  id: serial("id").primaryKey(),
  eventType: varchar("eventType", { length: 128 }).notNull(),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: integer("entityId"),
  details: text("details"),
  triggeredByOpenId: varchar("triggeredByOpenId", { length: 128 }),
  createdAt: createdAt(),
});

export const trainingInstructions = pgTable("trainingInstructions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  instructionType: instructionTypeEnum("instructionType").notNull(),
  priority: integer("priority").default(0).notNull(),
  isActive: integer("isActive").default(1).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const instructionRules = pgTable("instructionRules", {
  id: serial("id").primaryKey(),
  instructionId: integer("instructionId").notNull(),
  ruleType: instructionRuleTypeEnum("ruleType").notNull(),
  ruleKey: varchar("ruleKey", { length: 128 }).notNull(),
  ruleValue: text("ruleValue").notNull(),
  createdAt: createdAt(),
});

export const instructionSchedules = pgTable("instructionSchedules", {
  id: serial("id").primaryKey(),
  instructionId: integer("instructionId").notNull(),
  scheduleType: instructionScheduleTypeEnum("scheduleType").notNull(),
  startTime: varchar("startTime", { length: 8 }),
  endTime: varchar("endTime", { length: 8 }),
  daysOfWeek: varchar("daysOfWeek", { length: 20 }),
  timezone: varchar("timezone", { length: 50 }).default("UTC").notNull(),
  createdAt: createdAt(),
});

export const instructionHistory = pgTable("instructionHistory", {
  id: serial("id").primaryKey(),
  instructionId: integer("instructionId").notNull(),
  version: integer("version").notNull(),
  previousState: text("previousState"),
  changeReason: text("changeReason"),
  changedBy: varchar("changedBy", { length: 128 }).notNull(),
  createdAt: createdAt(),
});

export const kalshiCredentials = pgTable("kalshiCredentials", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  apiKeyEncrypted: text("apiKeyEncrypted").notNull(),
  privateKeyEncrypted: text("privateKeyEncrypted").notNull(),
  accountEquity: doublePrecision("accountEquity").default(0).notNull(),
  accountStatus: kalshiAccountStatusEnum("accountStatus").default("disconnected").notNull(),
  lastSyncedAt: timestamp("lastSyncedAt", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const kalshiMarkets = pgTable("kalshiMarkets", {
  id: serial("id").primaryKey(),
  marketId: varchar("marketId", { length: 128 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  category: varchar("category", { length: 128 }).notNull(),
  description: text("description"),
  resolutionDate: timestamp("resolutionDate", { withTimezone: true }),
  status: kalshiMarketStatusEnum("status").default("open").notNull(),
  yesPrice: doublePrecision("yesPrice").default(0).notNull(),
  noPrice: doublePrecision("noPrice").default(0).notNull(),
  yesVolume: doublePrecision("yesVolume").default(0).notNull(),
  noVolume: doublePrecision("noVolume").default(0).notNull(),
  impliedProbability: doublePrecision("impliedProbability").default(0.5).notNull(),
  liquidity: doublePrecision("liquidity").default(0).notNull(),
  lastUpdated: updatedAt(),
  createdAt: createdAt(),
});

export const kalshiMarketSnapshots = pgTable("kalshiMarketSnapshots", {
  id: serial("id").primaryKey(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  yesPrice: doublePrecision("yesPrice").notNull(),
  noPrice: doublePrecision("noPrice").notNull(),
  yesVolume: doublePrecision("yesVolume").notNull(),
  noVolume: doublePrecision("noVolume").notNull(),
  impliedProbability: doublePrecision("impliedProbability").notNull(),
  liquidity: doublePrecision("liquidity").notNull(),
  snapshotTime: createdAt(),
});

export const kalshiOrderBook = pgTable("kalshiOrderBook", {
  id: serial("id").primaryKey(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  side: kalshiSideEnum("side").notNull(),
  price: doublePrecision("price").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  timestamp: createdAt(),
});

export const kalshiOrders = pgTable("kalshiOrders", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  orderId: varchar("orderId", { length: 128 }).notNull().unique(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  action: kalshiOrderActionEnum("action").default("buy").notNull(),
  side: kalshiSideEnum("side").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  limitPrice: doublePrecision("limitPrice").notNull(),
  status: kalshiOrderStatusEnum("status").default("pending").notNull(),
  filledQuantity: doublePrecision("filledQuantity").default(0).notNull(),
  averagePrice: doublePrecision("averagePrice").default(0).notNull(),
  createdAt: createdAt(),
  filledAt: timestamp("filledAt", { withTimezone: true }),
  cancelledAt: timestamp("cancelledAt", { withTimezone: true }),
});

export const kalshiFills = pgTable("kalshiFills", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  orderId: varchar("orderId", { length: 128 }).notNull(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  fillPrice: doublePrecision("fillPrice").notNull(),
  fillQuantity: doublePrecision("fillQuantity").notNull(),
  fillTime: createdAt(),
});

export const kalshiPositions = pgTable("kalshiPositions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  side: kalshiSideEnum("side").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  entryPrice: doublePrecision("entryPrice").notNull(),
  currentPrice: doublePrecision("currentPrice").notNull(),
  unrealizedPnl: doublePrecision("unrealizedPnl").default(0).notNull(),
  realizedPnl: doublePrecision("realizedPnl").default(0).notNull(),
  positionStatus: kalshiPositionStatusEnum("positionStatus").default("open").notNull(),
  openedAt: createdAt(),
  closedAt: timestamp("closedAt", { withTimezone: true }),
});

export const kalshiSignals = pgTable("kalshiSignals", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  signalType: kalshiSignalTypeEnum("signalType").notNull(),
  side: kalshiSideEnum("side").notNull(),
  confidence: doublePrecision("confidence").notNull(),
  reasoning: text("reasoning").notNull(),
  impliedProbability: doublePrecision("impliedProbability").notNull(),
  marketPrice: doublePrecision("marketPrice").notNull(),
  expectedValue: doublePrecision("expectedValue").notNull(),
  createdAt: createdAt(),
});

export const kalshiPerformance = pgTable("kalshiPerformance", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  signalId: integer("signalId").notNull(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  outcome: kalshiOutcomeEnum("outcome").notNull(),
  pnl: doublePrecision("pnl").notNull(),
  roi: doublePrecision("roi").notNull(),
  accuracy: doublePrecision("accuracy").notNull(),
  executionQuality: doublePrecision("executionQuality").notNull(),
  resolvedAt: createdAt(),
});

export const kalshiCapital = pgTable("kalshiCapital", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  startingBalance: doublePrecision("startingBalance").default(0).notNull(),
  currentBalance: doublePrecision("currentBalance").default(0).notNull(),
  totalPnl: doublePrecision("totalPnl").default(0).notNull(),
  maxDrawdown: doublePrecision("maxDrawdown").default(0).notNull(),
  winRate: doublePrecision("winRate").default(0).notNull(),
  sharpeRatio: doublePrecision("sharpeRatio").default(0).notNull(),
  totalTrades: integer("totalTrades").default(0).notNull(),
  winningTrades: integer("winningTrades").default(0).notNull(),
  updatedAt: updatedAt(),
});

export const tradingPreferences = pgTable("tradingPreferences", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  autonomyMode: autonomyModeEnum("autonomyMode").default("approval_required").notNull(),
  liveTradingEnabled: integer("liveTradingEnabled").default(0).notNull(),
  executionCadence: executionCadenceEnum("executionCadence").default("manual_only").notNull(),
  riskPosture: riskPostureEnum("riskPosture").default("balanced").notNull(),
  minSignalConfidence: doublePrecision("minSignalConfidence").default(0.72).notNull(),
  maxOrderNotional: doublePrecision("maxOrderNotional").default(10).notNull(),
  maxDailyOrders: integer("maxDailyOrders").default(3).notNull(),
  requireApprovalAbove: doublePrecision("requireApprovalAbove").default(8).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const autonomyRuns = pgTable("autonomyRuns", {
  id: serial("id").primaryKey(),
  runId: varchar("runId", { length: 40 }).notNull().unique(),
  runKey: varchar("runKey", { length: 160 }).notNull().unique(),
  userId: integer("userId").notNull(),
  triggeredByOpenId: varchar("triggeredByOpenId", { length: 128 }).notNull(),
  triggerSource: varchar("triggerSource", { length: 32 }).notNull(),
  status: autonomyRunStatusEnum("status").default("in_progress").notNull(),
  autonomyMode: autonomyModeEnum("autonomyMode").notNull(),
  executionCadence: executionCadenceEnum("executionCadence").notNull(),
  reason: text("reason"),
  signalsGenerated: integer("signalsGenerated").default(0).notNull(),
  executionCandidates: integer("executionCandidates").default(0).notNull(),
  orderPlaced: integer("orderPlaced").default(0).notNull(),
  orderId: varchar("orderId", { length: 128 }),
  candidateMarketId: varchar("candidateMarketId", { length: 128 }),
  executedMarketId: varchar("executedMarketId", { length: 128 }),
  decision: text("decision"),
  candidateSet: text("candidateSet"),
  rejectedCandidates: text("rejectedCandidates"),
  appliedGuardrails: text("appliedGuardrails"),
  exchangeRequest: text("exchangeRequest"),
  exchangeResponse: text("exchangeResponse"),
  reconciliationStatus: reconciliationStatusEnum("reconciliationStatus").default("not_required").notNull(),
  reconciliationReason: text("reconciliationReason"),
  startedAt: createdAt(),
  completedAt: timestamp("completedAt", { withTimezone: true }),
  updatedAt: updatedAt(),
});

export const polymarketAccountStatusEnum = pgEnum("polymarket_account_status", ["connected", "disconnected", "error"]);
export const platformSubscriptionEnum = pgEnum("platform_subscription", ["kalshi", "polymarket", "both"]);

export const polymarketCredentials = pgTable("polymarketCredentials", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  apiKeyEncrypted: text("apiKeyEncrypted").notNull(),
  apiSecretEncrypted: text("apiSecretEncrypted").notNull(),
  apiPassphraseEncrypted: text("apiPassphraseEncrypted").notNull(),
  accountStatus: polymarketAccountStatusEnum("accountStatus").default("disconnected").notNull(),
  lastSyncedAt: timestamp("lastSyncedAt", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userPlatformSubscriptions = pgTable("userPlatformSubscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  subscribedPlatforms: platformSubscriptionEnum("subscribedPlatforms").default("kalshi").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── Chatbot ────────────────────────────────────────────────────────────────────

export const chatBotPlatformEnum = pgEnum("chat_bot_platform", ["kalshi", "polymarket"]);
export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant"]);
export const botToneEnum = pgEnum("bot_tone", ["professional", "casual", "aggressive", "analytical"]);

/**
 * Per-user, per-platform bot configuration.
 * Stores personality, custom system instructions, a rolling memory summary,
 * and safety flags for action triggering.
 */
export const botConfigs = pgTable("botConfigs", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  platform: chatBotPlatformEnum("platform").notNull(),
  persona: text("persona"),
  systemInstructions: text("systemInstructions"),
  tone: botToneEnum("tone").default("professional").notNull(),
  memorySummary: text("memorySummary"),
  triggerSignalsEnabled: integer("triggerSignalsEnabled").default(1).notNull(),
  triggerOrdersEnabled: integer("triggerOrdersEnabled").default(0).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/**
 * Individual chat messages for each platform workspace.
 * actionType / actionData carry structured results when the bot triggers a tool.
 */
export const chatMessages = pgTable("chatMessages", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  platform: chatBotPlatformEnum("platform").notNull(),
  role: chatRoleEnum("role").notNull(),
  content: text("content").notNull(),
  actionType: varchar("actionType", { length: 64 }),
  actionData: text("actionData"),
  createdAt: createdAt(),
});

export type User = typeof users.$inferSelect;
export type BotConfig = typeof botConfigs.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
