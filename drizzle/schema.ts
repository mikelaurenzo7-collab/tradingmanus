import {
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);
export const subscriptionTierEnum = pgEnum("subscription_tier", [
  "starter",
  "pro",
  "fund",
]);
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "cancelled",
  "unpaid",
]);
export const betaAccessLevelEnum = pgEnum("beta_access_level", [
  "none",
  "internal",
  "invited",
  "public",
]);
export const instructionTypeEnum = pgEnum("instruction_type", [
  "market_filter",
  "signal_filter",
  "position_limit",
  "time_window",
  "custom",
]);
export const instructionRuleTypeEnum = pgEnum("instruction_rule_type", [
  "include",
  "exclude",
  "require",
  "forbid",
]);
export const instructionScheduleTypeEnum = pgEnum("instruction_schedule_type", [
  "always",
  "time_window",
  "day_of_week",
  "market_condition",
]);
export const kalshiAccountStatusEnum = pgEnum("kalshi_account_status", [
  "connected",
  "disconnected",
  "error",
]);
export const kalshiMarketStatusEnum = pgEnum("kalshi_market_status", [
  "open",
  "closed",
  "resolved",
]);
export const kalshiSideEnum = pgEnum("kalshi_side", ["yes", "no"]);
export const kalshiOrderActionEnum = pgEnum("kalshi_order_action", [
  "buy",
  "sell",
]);
export const kalshiOrderStatusEnum = pgEnum("kalshi_order_status", [
  "pending",
  "filled",
  "cancelled",
  "rejected",
]);
export const kalshiPositionStatusEnum = pgEnum("kalshi_position_status", [
  "open",
  "closing",
  "closed",
]);
export const kalshiSignalTypeEnum = pgEnum("kalshi_signal_type", [
  "value_play",
  "momentum",
  "contrarian",
  "arbitrage",
  "sentiment",
  "multi_timeframe",
  "order_flow",
]);
export const kalshiOutcomeEnum = pgEnum("kalshi_outcome", [
  "win",
  "loss",
  "partial",
]);
export const evidenceTypeEnum = pgEnum("evidence_type", [
  "price_move",
  "volume_spike",
  "sentiment_shift",
  "news_item",
  "market_close",
  "fundamental",
]);
export const evidenceDirectionEnum = pgEnum("evidence_direction", [
  "bullish",
  "bearish",
  "neutral",
]);
export const autonomyModeEnum = pgEnum("autonomy_mode", [
  "manual",
  "approval_required",
  "semi_autonomous",
  "fully_autonomous",
]);
export const executionCadenceEnum = pgEnum("execution_cadence", [
  "manual_only",
  "session_assisted",
  "hourly_watch",
  "continuous_watch",
]);
export const riskPostureEnum = pgEnum("risk_posture", [
  "conservative",
  "balanced",
  "aggressive",
]);
export const autonomyRunStatusEnum = pgEnum("autonomy_run_status", [
  "in_progress",
  "executed",
  "generated_only",
  "skipped",
  "blocked",
  "error",
]);
export const reconciliationStatusEnum = pgEnum("reconciliation_status", [
  "not_required",
  "pending",
  "reconciled",
]);

const now = () => new Date();
const createdAt = () =>
  timestamp("createdAt", { withTimezone: true }).defaultNow().notNull();
const updatedAt = () =>
  timestamp("updatedAt", { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(now);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  openId: varchar("openId", { length: 128 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  role: userRoleEnum("role").default("user").notNull(),
  betaAccessLevel: betaAccessLevelEnum("betaAccessLevel")
    .default("none")
    .notNull(),
  passwordHash: text("passwordHash"),
  subscriptionTier: subscriptionTierEnum("subscriptionTier")
    .default("starter")
    .notNull(),
  subscriptionStatus: subscriptionStatusEnum("subscriptionStatus")
    .default("trialing")
    .notNull(),
  subscriptionCurrentPeriodEnd: timestamp("subscriptionCurrentPeriodEnd", {
    withTimezone: true,
  }),
  stripeCustomerId: varchar("stripeCustomerId", { length: 128 }),
  twoFactorSecret: text("twoFactorSecret"), // Encrypted 2FA secret
  twoFactorEnabled: integer("twoFactorEnabled").default(0).notNull(), // 0 = disabled, 1 = enabled
  backupCodesHash: text("backupCodesHash"), // JSON array of hashed backup codes
  lastSignedIn: timestamp("lastSignedIn", { withTimezone: true }),
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
  accountStatus: kalshiAccountStatusEnum("accountStatus")
    .default("disconnected")
    .notNull(),
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
  impliedProbability: doublePrecision("impliedProbability")
    .default(0.5)
    .notNull(),
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
  positionStatus: kalshiPositionStatusEnum("positionStatus")
    .default("open")
    .notNull(),
  // Stateful exit-strategy bookkeeping (high-water mark, trailing stop level,
  // hit profit-target indices).  Nullable: rows that pre-date this column or
  // pre-date the first exit-monitor tick get treated as fresh state by the
  // monitor and re-initialised from entry price + side.  Schema is the
  // ExitStrategyState shape from server/_core/exitStrategy.ts.
  exitState: jsonb("exitState"),
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
  bayesianProbability: doublePrecision("bayesianProbability"), // Bayesian posterior probability
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

export const signalBayesianUpdates = pgTable(
  "signalBayesianUpdates",
  {
    id: serial("id").primaryKey(),
    signalId: integer("signalId").notNull(),
    userId: integer("userId").notNull(),
    prior: doublePrecision("prior").notNull(),
    likelihood: doublePrecision("likelihood").notNull(),
    evidenceProb: doublePrecision("evidenceProb").notNull(),
    posterior: doublePrecision("posterior").notNull(),
    evidenceType: evidenceTypeEnum("evidenceType").notNull(),
    evidenceValue: doublePrecision("evidenceValue").notNull(),
    evidenceDirection: evidenceDirectionEnum("evidenceDirection").notNull(),
    evidenceMetadata: text("evidenceMetadata"),
    weight: doublePrecision("weight").notNull(), // Time-decay weight
    updatedAt: createdAt(),
  },
  table => ({
    signalLookupIdx: index("signal_bayesian_lookup_idx").on(
      table.signalId,
      table.updatedAt
    ),
  })
);

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
  autonomyMode: autonomyModeEnum("autonomyMode")
    .default("approval_required")
    .notNull(),
  liveTradingEnabled: integer("liveTradingEnabled").default(0).notNull(),
  // Per-user paper-mode toggle.  When true, this user's orders are simulated
  // even in fully_autonomous mode.  Default 0 = live trading.  The env-level
  // PAPER_TRADE_MODE=true global override still wins over this when set.
  paperTradeMode: integer("paperTradeMode").default(0).notNull(),
  // Aggressive Mode — single "training wheels off" toggle that bypasses
  // the recent-manual-order cooldown, the per-category open-position
  // concentration cap, and the posture-driven confidence floor boost,
  // and tightens the adaptive cadence ×0.5.  See migrations 0007 (added
  // as ownerMode) and 0010 (rename + default-on).  Hard safety gates
  // (credentials, capital, price drift, exchange rejection) stay
  // enforced.  Default 1 = on for single-tenant; flip off if you want
  // training wheels temporarily.
  aggressiveMode: integer("aggressiveMode").default(1).notNull(),
  // Moonshot Mode — when both aggressiveMode and moonshotMode are on, the
  // bot also hunts low-probability asymmetric plays.  See drizzle/
  // migrations/0009 and the moonshot path in kalshiAutonomy.ts.
  moonshotMode: integer("moonshotMode").default(0).notNull(),
  executionCadence: executionCadenceEnum("executionCadence")
    .default("manual_only")
    .notNull(),
  riskPosture: riskPostureEnum("riskPosture").default("balanced").notNull(),
  minSignalConfidence: doublePrecision("minSignalConfidence")
    .default(0.72)
    .notNull(),
  maxOrderNotional: doublePrecision("maxOrderNotional").default(10).notNull(),
  maxDailyOrders: integer("maxDailyOrders").default(3).notNull(),
  requireApprovalAbove: doublePrecision("requireApprovalAbove")
    .default(8)
    .notNull(),
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
  reconciliationStatus: reconciliationStatusEnum("reconciliationStatus")
    .default("not_required")
    .notNull(),
  reconciliationReason: text("reconciliationReason"),
  startedAt: createdAt(),
  completedAt: timestamp("completedAt", { withTimezone: true }),
  updatedAt: updatedAt(),
});

// ── Polymarket Orders / Fills / Positions ─────────────────────────────────────
// These replace the DEBT workaround in polymarketLearning.ts that was using
// Kalshi tables as a proxy. Polymarket uses USDC CLOB semantics; sizes are in
// USDC rather than contracts.

export const polymarketOrderStatusEnum = pgEnum("polymarket_order_status", [
  "pending",
  "filled",
  "cancelled",
  "rejected",
]);
export const polymarketSideEnum = pgEnum("polymarket_side", ["yes", "no"]);
export const polymarketPositionStatusEnum = pgEnum(
  "polymarket_position_status",
  ["open", "closing", "closed"]
);

export const polymarketOrders = pgTable("polymarketOrders", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  orderId: varchar("orderId", { length: 128 }).notNull().unique(),
  marketId: varchar("marketId", { length: 256 }).notNull(),
  tokenId: varchar("tokenId", { length: 256 }).notNull(),
  side: polymarketSideEnum("side").notNull(),
  /** Size in USDC */
  sizeUsdc: doublePrecision("sizeUsdc").notNull(),
  limitPrice: doublePrecision("limitPrice").notNull(),
  status: polymarketOrderStatusEnum("status").default("pending").notNull(),
  filledSizeUsdc: doublePrecision("filledSizeUsdc").default(0).notNull(),
  averagePrice: doublePrecision("averagePrice").default(0).notNull(),
  createdAt: createdAt(),
  filledAt: timestamp("filledAt", { withTimezone: true }),
  cancelledAt: timestamp("cancelledAt", { withTimezone: true }),
});

export const polymarketFills = pgTable("polymarketFills", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  orderId: varchar("orderId", { length: 128 }).notNull(),
  marketId: varchar("marketId", { length: 256 }).notNull(),
  tokenId: varchar("tokenId", { length: 256 }).notNull(),
  fillPrice: doublePrecision("fillPrice").notNull(),
  /** Fill size in USDC */
  fillSizeUsdc: doublePrecision("fillSizeUsdc").notNull(),
  fillTime: createdAt(),
});

export const polymarketPositions = pgTable("polymarketPositions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  marketId: varchar("marketId", { length: 256 }).notNull(),
  tokenId: varchar("tokenId", { length: 256 }).notNull(),
  side: polymarketSideEnum("side").notNull(),
  /** Position size in USDC */
  sizeUsdc: doublePrecision("sizeUsdc").notNull(),
  entryPrice: doublePrecision("entryPrice").notNull(),
  currentPrice: doublePrecision("currentPrice").notNull(),
  unrealizedPnl: doublePrecision("unrealizedPnl").default(0).notNull(),
  realizedPnl: doublePrecision("realizedPnl").default(0).notNull(),
  positionStatus: polymarketPositionStatusEnum("positionStatus")
    .default("open")
    .notNull(),
  // Stateful exit-strategy bookkeeping (mirror of kalshiPositions.exitState).
  // Holds ExitStrategyState shape from server/_core/exitStrategy.ts so the
  // trailing stop ratchets across exit-monitor ticks for Polymarket positions
  // too.  Nullable: pre-migration rows are treated as fresh state.
  exitState: jsonb("exitState"),
  openedAt: createdAt(),
  closedAt: timestamp("closedAt", { withTimezone: true }),
});

export const polymarketAccountStatusEnum = pgEnum("polymarket_account_status", [
  "connected",
  "disconnected",
  "error",
]);
export const platformSubscriptionEnum = pgEnum("platform_subscription", [
  "kalshi",
  "polymarket",
  "both",
]);

export const polymarketCredentials = pgTable("polymarketCredentials", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  apiKeyEncrypted: text("apiKeyEncrypted").notNull(),
  apiSecretEncrypted: text("apiSecretEncrypted").notNull(),
  apiPassphraseEncrypted: text("apiPassphraseEncrypted").notNull(),
  accountStatus: polymarketAccountStatusEnum("accountStatus")
    .default("disconnected")
    .notNull(),
  lastSyncedAt: timestamp("lastSyncedAt", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const userPlatformSubscriptions = pgTable("userPlatformSubscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull().unique(),
  subscribedPlatforms: platformSubscriptionEnum("subscribedPlatforms")
    .default("kalshi")
    .notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── AI Desk Memory (per-user, per-platform, per-category persistent learnings) ─

export const deskPlatformEnum = pgEnum("desk_platform", [
  "kalshi",
  "polymarket",
]);
export const deskOutcomeEnum = pgEnum("desk_outcome", [
  "win",
  "loss",
  "scratch",
]);

/**
 * One row per (userId, platform, deskId).  Each row is the rolling tape of
 * lessons the AI reviewer has learned for that desk.  `notes` is a small
 * append-only list of short bullets ("won 3 NBA total points contracts when
 * vegas line was within 1 point of Kalshi implied").  We cap the field
 * server-side before each insert so the cached system prompt stays tight.
 */
export const deskMemory = pgTable("deskMemory", {
  id: serial("id").primaryKey(),
  userId: integer("userId").notNull(),
  platform: deskPlatformEnum("platform").notNull(),
  // e.g. "kalshi.sports", "poly.crypto" — matches CategoryPersona.id.
  deskId: varchar("deskId", { length: 64 }).notNull(),
  // JSON array of { ts, outcome, note } objects.  Capped at ~4KB before write.
  notes: text("notes").default("[]").notNull(),
  tradeCount: integer("tradeCount").default(0).notNull(),
  winCount: integer("winCount").default(0).notNull(),
  lossCount: integer("lossCount").default(0).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

// ── Multi-Timeframe Analysis ──────────────────────────────────────────────────

/**
 * Multi-timeframe analysis data for markets with feed data.
 * Stores momentum, volatility, volume, and trend strength calculations
 * for 5min/15min/1hour/4hour/24hour timeframes.
 */
export const marketTimeframeAnalysis = pgTable(
  "market_timeframe_analysis",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    marketId: text("market_id").notNull(),
    platform: text("platform").notNull(), // 'kalshi' | 'polymarket'
    timeframe: text("timeframe").notNull(), // timeframe in milliseconds as string
    momentum: doublePrecision("momentum").notNull(),
    volatility: doublePrecision("volatility").notNull(),
    volume: doublePrecision("volume").notNull(),
    trendStrength: doublePrecision("trend_strength").notNull(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  table => ({
    marketLookupIdx: index("market_tf_lookup_idx").on(
      table.marketId,
      table.platform,
      table.analyzedAt
    ),
  })
);

// ── Market Microstructure ────────────────────────────────────────────────────

/**
 * Per-market microstructure snapshot: spread, order-book imbalance, and VPIN
 * proxy.  One row per analyzeMicrostructure() call; append-only.
 */
export const marketMicrostructure = pgTable(
  "market_microstructure",
  {
    id: serial("id").primaryKey(),
    marketId: varchar("marketId", { length: 128 }).notNull(),
    platform: varchar("platform", { length: 32 }).notNull().default("kalshi"),
    analyzedAt: timestamp("analyzedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    spread: doublePrecision("spread").notNull(),
    spreadPct: doublePrecision("spreadPct").notNull(),
    spreadScore: doublePrecision("spreadScore").notNull(),
    imbalance: doublePrecision("imbalance").notNull(),
    vpin: doublePrecision("vpin").notNull(),
    microstructureScore: doublePrecision("microstructureScore").notNull(),
  },
  t => ({
    microLookupIdx: index("market_micro_lookup_idx").on(
      t.marketId,
      t.platform,
      t.analyzedAt
    ),
  })
);

// ── Chatbot ────────────────────────────────────────────────────────────────────

export const chatBotPlatformEnum = pgEnum("chat_bot_platform", [
  "kalshi",
  "polymarket",
]);
export const chatRoleEnum = pgEnum("chat_role", ["user", "assistant"]);
export const botToneEnum = pgEnum("bot_tone", [
  "professional",
  "casual",
  "aggressive",
  "analytical",
]);

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

// ── Distributed Locks ─────────────────────────────────────────────────────────

/**
 * Table-based distributed lock for autonomous trading coordination.
 * Replaces PostgreSQL advisory locks which are session-scoped and do not
 * survive the per-request HTTP connections used by the Neon serverless driver.
 * A row being present means the lock is held; expiry allows stale locks to be
 * reaped automatically.
 */
export const distributedLocks = pgTable("distributedLocks", {
  lockKey: varchar("lockKey", { length: 255 }).primaryKey(),
  acquiredAt: timestamp("acquiredAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  expiresAt: timestamp("expiresAt", { withTimezone: true }).notNull(),
  acquiredBy: varchar("acquiredBy", { length: 128 }).notNull(),
});

// ── Portfolio Volatility History ───────────────────────────────────────────────

export const portfolioVolatilityHistory = pgTable(
  "portfolio_volatility_history",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    calculatedAt: timestamp("calculatedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    annualizedVol: doublePrecision("annualizedVol").notNull(),
    dailyVol: doublePrecision("dailyVol").notNull(),
    volScalingFactor: doublePrecision("volScalingFactor").notNull(),
    positionCount: integer("positionCount").notNull(),
    targetVol: doublePrecision("targetVol").notNull(),
  },
  t => ({
    portfolioVolHistIdx: index("portfolio_vol_hist_idx").on(
      t.userId,
      t.calculatedAt
    ),
  })
);

// ── Position Exits ────────────────────────────────────────────────────────────

export const positionExitReasonEnum = pgEnum("position_exit_reason", [
  "stop_loss",
  "trailing_stop",
  "profit_target_1",
  "profit_target_2",
  "profit_target_3",
  "time_decay",
  "volatility_adjustment",
  "manual",
]);

export const positionExits = pgTable(
  "position_exits",
  {
    id: serial("id").primaryKey(),
    positionId: varchar("positionId", { length: 128 }).notNull(),
    userId: integer("userId").notNull(),
    platform: varchar("platform", { length: 32 }).notNull().default("kalshi"),
    exitReason: positionExitReasonEnum("exitReason").notNull(),
    entryPrice: doublePrecision("entryPrice").notNull(),
    exitPrice: doublePrecision("exitPrice").notNull(),
    pnlPct: doublePrecision("pnlPct").notNull(), // (exit - entry) / entry
    exitedAt: timestamp("exitedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
    stopLevel: doublePrecision("stopLevel"),
    profitTargetHit: integer("profitTargetHit"), // 1, 2, or 3
  },
  t => ({
    positionExitsIdx: index("position_exits_idx").on(t.userId, t.exitedAt),
  })
);

// ── ML Ensemble Models ────────────────────────────────────────────────────────

export const mlEnsembleModels = pgTable("ml_ensemble_models", {
  id: serial("id").primaryKey(),
  version: integer("version").notNull(),
  platform: varchar("platform", { length: 32 }).notNull().default("kalshi"),
  modelJson: text("modelJson").notNull(), // serialized EnsembleModel
  trainingSamples: integer("trainingSamples").notNull(),
  accuracy: doublePrecision("accuracy"), // hold-out accuracy if available
  isActive: integer("isActive").default(0).notNull(), // 0 or 1
  trainedAt: timestamp("trainedAt", { withTimezone: true })
    .defaultNow()
    .notNull(),
  createdAt: createdAt(),
});

export type MlEnsembleModel = typeof mlEnsembleModels.$inferSelect;

// ── Market Sentiment History ──────────────────────────────────────────────────

export const marketSentimentHistory = pgTable(
  "market_sentiment_history",
  {
    id: serial("id").primaryKey(),
    marketId: varchar("marketId", { length: 128 }).notNull(),
    platform: varchar("platform", { length: 32 }).notNull().default("kalshi"),
    compositeScore: doublePrecision("compositeScore").notNull(),
    compositeConfidence: doublePrecision("compositeConfidence").notNull(),
    sentimentMomentum: doublePrecision("sentimentMomentum").notNull(),
    isAlertTriggered: integer("isAlertTriggered").default(0).notNull(),
    gdeltScore: doublePrecision("gdeltScore"),
    redditScore: doublePrecision("redditScore"),
    twitterScore: doublePrecision("twitterScore"),
    expertScore: doublePrecision("expertScore"),
    consensusScore: doublePrecision("consensusScore"),
    recordedAt: timestamp("recordedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    sentimentHistIdx: index("sentiment_hist_idx").on(
      t.marketId,
      t.platform,
      t.recordedAt
    ),
  })
);

export type MarketSentimentHistory = typeof marketSentimentHistory.$inferSelect;

// ── Execution Quality Metrics ─────────────────────────────────────────────────

/**
 * Per-order execution quality record.
 * Tracks expected vs actual fill price, slippage, and order strategy used.
 */
export const executionQualityMetrics = pgTable(
  "execution_quality_metrics",
  {
    id: serial("id").primaryKey(),
    orderId: varchar("orderId", { length: 128 }).notNull(),
    userId: integer("userId").notNull(),
    platform: varchar("platform", { length: 32 }).notNull().default("kalshi"),
    strategy: varchar("strategy", { length: 32 }).notNull(),
    expectedPrice: doublePrecision("expectedPrice").notNull(),
    actualPrice: doublePrecision("actualPrice"),
    slippagePct: doublePrecision("slippagePct"),
    targetBudgetUsd: doublePrecision("targetBudgetUsd").notNull(),
    executedAt: timestamp("executedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    execQualityIdx: index("exec_quality_idx").on(t.userId, t.executedAt),
  })
);

export type ExecutionQualityMetric =
  typeof executionQualityMetrics.$inferSelect;

// ── Cross-Platform Arbitrage Execution History ───────────────────────────────

export const crossPlatformArbitrageExecutions = pgTable(
  "cross_platform_arbitrage_executions",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    kalshiMarketId: varchar("kalshiMarketId", { length: 128 }).notNull(),
    polymarketMarketId: varchar("polymarketMarketId", {
      length: 128,
    }).notNull(),
    buyPlatform: varchar("buyPlatform", { length: 32 }).notNull(),
    netEdge: doublePrecision("netEdge").notNull(),
    feeBurden: doublePrecision("feeBurden").notNull(),
    executionRisk: doublePrecision("executionRisk").notNull(),
    hedgeRatio: doublePrecision("hedgeRatio").notNull(),
    bothLegsExecuted: integer("bothLegsExecuted").notNull(),
    kalshiOrderId: varchar("kalshiOrderId", { length: 128 }),
    polymarketOrderId: varchar("polymarketOrderId", { length: 128 }),
    partialLegAction: varchar("partialLegAction", { length: 32 }),
    pnlAttributionArb: doublePrecision("pnlAttributionArb")
      .default(0)
      .notNull(),
    pnlAttributionMarketMove: doublePrecision("pnlAttributionMarketMove")
      .default(0)
      .notNull(),
    executedAt: timestamp("executedAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    crossArbExecIdx: index("cross_arb_exec_idx").on(t.userId, t.executedAt),
  })
);

export type CrossPlatformArbitrageExecution =
  typeof crossPlatformArbitrageExecutions.$inferSelect;

// ── Online Learning Updates ──────────────────────────────────────────────────

export const onlineLearningUpdates = pgTable(
  "online_learning_updates",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    platform: varchar("platform", { length: 32 }).notNull().default("kalshi"),
    signalType: varchar("signalType", { length: 64 }).notNull(),
    outcome: varchar("outcome", { length: 16 }).notNull(),
    pnl: doublePrecision("pnl").notNull(),
    weightBefore: doublePrecision("weightBefore").notNull(),
    weightAfter: doublePrecision("weightAfter").notNull(),
    emaPnl: doublePrecision("emaPnl").notNull(),
    driftDetected: integer("driftDetected").default(0).notNull(),
    explorationTaken: integer("explorationTaken").default(0).notNull(),
    confidenceLower: doublePrecision("confidenceLower").notNull(),
    confidenceUpper: doublePrecision("confidenceUpper").notNull(),
    modelVersion: integer("modelVersion").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    onlineLearningIdx: index("online_learning_idx").on(
      t.userId,
      t.platform,
      t.createdAt
    ),
  })
);

export type OnlineLearningUpdate = typeof onlineLearningUpdates.$inferSelect;

// ── Performance Attribution History ─────────────────────────────────────────

export const performanceAttribution = pgTable(
  "performance_attribution",
  {
    id: serial("id").primaryKey(),
    userId: integer("userId").notNull(),
    platform: varchar("platform", { length: 32 }).notNull().default("kalshi"),
    marketId: varchar("marketId", { length: 128 }).notNull(),
    signalType: varchar("signalType", { length: 64 }).notNull(),
    category: varchar("category", { length: 64 }).notNull().default("unknown"),
    totalPnl: doublePrecision("totalPnl").notNull(),
    signalAlpha: doublePrecision("signalAlpha").notNull(),
    execution: doublePrecision("execution").notNull(),
    timing: doublePrecision("timing").notNull(),
    luck: doublePrecision("luck").notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  t => ({
    performanceAttributionIdx: index("performance_attribution_idx").on(
      t.userId,
      t.platform,
      t.createdAt
    ),
  })
);

export type PerformanceAttributionRecord =
  typeof performanceAttribution.$inferSelect;

type UserRow = typeof users.$inferSelect;
export type User = Omit<
  UserRow,
  | "passwordHash"
  | "subscriptionTier"
  | "subscriptionStatus"
  | "subscriptionCurrentPeriodEnd"
  | "stripeCustomerId"
> &
  Partial<
    Pick<
      UserRow,
      | "passwordHash"
      | "subscriptionTier"
      | "subscriptionStatus"
      | "subscriptionCurrentPeriodEnd"
      | "stripeCustomerId"
    >
  >;
export type BotConfig = typeof botConfigs.$inferSelect;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type PolymarketOrder = typeof polymarketOrders.$inferSelect;
export type PolymarketFill = typeof polymarketFills.$inferSelect;
export type PolymarketPosition = typeof polymarketPositions.$inferSelect;
export type PositionExit = typeof positionExits.$inferSelect;
