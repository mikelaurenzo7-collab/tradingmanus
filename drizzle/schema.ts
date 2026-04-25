import {
  double,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

// Core tables
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const auditLog = mysqlTable("auditLog", {
  id: int("id").autoincrement().primaryKey(),
  eventType: varchar("eventType", { length: 128 }).notNull(),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: int("entityId"),
  details: text("details"),
  triggeredByOpenId: varchar("triggeredByOpenId", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// Training instructions tables
export const trainingInstructions = mysqlTable("trainingInstructions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  description: text("description"),
  instructionType: mysqlEnum("instructionType", ["market_filter", "signal_filter", "position_limit", "time_window", "custom"]).notNull(),
  priority: int("priority").default(0).notNull(), // Higher = more important
  isActive: int("isActive").default(1).notNull(), // 1 = active, 0 = inactive
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const instructionRules = mysqlTable("instructionRules", {
  id: int("id").autoincrement().primaryKey(),
  instructionId: int("instructionId").notNull(),
  ruleType: mysqlEnum("ruleType", ["include", "exclude", "require", "forbid"]).notNull(),
  ruleKey: varchar("ruleKey", { length: 128 }).notNull(), // e.g., "category", "minConfidence", "dayOfWeek"
  ruleValue: text("ruleValue").notNull(), // e.g., "politics", "0.75", "1,2,3,4,5"
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const instructionSchedules = mysqlTable("instructionSchedules", {
  id: int("id").autoincrement().primaryKey(),
  instructionId: int("instructionId").notNull(),
  scheduleType: mysqlEnum("scheduleType", ["always", "time_window", "day_of_week", "market_condition"]).notNull(),
  startTime: varchar("startTime", { length: 8 }), // HH:MM format
  endTime: varchar("endTime", { length: 8 }), // HH:MM format
  daysOfWeek: varchar("daysOfWeek", { length: 20 }), // "1,2,3,4,5" for Mon-Fri
  timezone: varchar("timezone", { length: 50 }).default("UTC").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const instructionHistory = mysqlTable("instructionHistory", {
  id: int("id").autoincrement().primaryKey(),
  instructionId: int("instructionId").notNull(),
  version: int("version").notNull(),
  previousState: text("previousState"), // JSON snapshot
  changeReason: text("changeReason"),
  changedBy: varchar("changedBy", { length: 64 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// Kalshi credentials table
export const kalshiCredentials = mysqlTable("kalshiCredentials", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  apiKeyEncrypted: text("apiKeyEncrypted").notNull(),
  privateKeyEncrypted: text("privateKeyEncrypted").notNull(),
  accountEquity: double("accountEquity").default(0).notNull(),
  accountStatus: mysqlEnum("accountStatus", ["connected", "disconnected", "error"]).default("disconnected").notNull(),
  lastSyncedAt: timestamp("lastSyncedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Kalshi tables
export const kalshiMarkets = mysqlTable("kalshiMarkets", {
  id: int("id").autoincrement().primaryKey(),
  marketId: varchar("marketId", { length: 128 }).notNull().unique(),
  title: varchar("title", { length: 255 }).notNull(),
  category: varchar("category", { length: 128 }).notNull(),
  description: text("description"),
  resolutionDate: timestamp("resolutionDate"),
  status: mysqlEnum("status", ["open", "closed", "resolved"]).default("open").notNull(),
  yesPrice: double("yesPrice").default(0).notNull(),
  noPrice: double("noPrice").default(0).notNull(),
  yesVolume: double("yesVolume").default(0).notNull(),
  noVolume: double("noVolume").default(0).notNull(),
  impliedProbability: double("impliedProbability").default(0.5).notNull(),
  liquidity: double("liquidity").default(0).notNull(), // Total liquidity in market
  lastUpdated: timestamp("lastUpdated").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const kalshiMarketSnapshots = mysqlTable("kalshiMarketSnapshots", {
  id: int("id").autoincrement().primaryKey(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  yesPrice: double("yesPrice").notNull(),
  noPrice: double("noPrice").notNull(),
  yesVolume: double("yesVolume").notNull(),
  noVolume: double("noVolume").notNull(),
  impliedProbability: double("impliedProbability").notNull(),
  liquidity: double("liquidity").notNull(),
  snapshotTime: timestamp("snapshotTime").defaultNow().notNull(),
});


export const kalshiOrderBook = mysqlTable("kalshiOrderBook", {
  id: int("id").autoincrement().primaryKey(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  side: mysqlEnum("side", ["yes", "no"]).notNull(),
  price: double("price").notNull(),
  quantity: double("quantity").notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const kalshiOrders = mysqlTable("kalshiOrders", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  orderId: varchar("orderId", { length: 128 }).notNull().unique(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  action: mysqlEnum("orderAction", ["buy", "sell"]).default("buy").notNull(),
  side: mysqlEnum("side", ["yes", "no"]).notNull(),
  quantity: double("quantity").notNull(),
  limitPrice: double("limitPrice").notNull(),
  status: mysqlEnum("orderStatus", ["pending", "filled", "cancelled", "rejected"]).default("pending").notNull(),
  filledQuantity: double("filledQuantity").default(0).notNull(),
  averagePrice: double("averagePrice").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  filledAt: timestamp("filledAt"),
  cancelledAt: timestamp("cancelledAt"),
});

export const kalshiFills = mysqlTable("kalshiFills", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  orderId: varchar("orderId", { length: 128 }).notNull(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  fillPrice: double("fillPrice").notNull(),
  fillQuantity: double("fillQuantity").notNull(),
  fillTime: timestamp("fillTime").defaultNow().notNull(),
});

export const kalshiPositions = mysqlTable("kalshiPositions", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  side: mysqlEnum("positionSide", ["yes", "no"]).notNull(),
  quantity: double("quantity").notNull(),
  entryPrice: double("entryPrice").notNull(),
  currentPrice: double("currentPrice").notNull(),
  unrealizedPnl: double("unrealizedPnl").default(0).notNull(),
  realizedPnl: double("realizedPnl").default(0).notNull(),
  positionStatus: mysqlEnum("positionStatus", ["open", "closing", "closed"]).default("open").notNull(),
  openedAt: timestamp("openedAt").defaultNow().notNull(),
  closedAt: timestamp("closedAt"),
});

export const kalshiSignals = mysqlTable("kalshiSignals", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  signalType: mysqlEnum("signalType", ["value_play", "momentum", "contrarian", "arbitrage", "sentiment"]).notNull(),
  side: mysqlEnum("signalSide", ["yes", "no"]).notNull(),
  confidence: double("confidence").notNull(),
  reasoning: text("reasoning").notNull(),
  impliedProbability: double("impliedProbability").notNull(),
  marketPrice: double("marketPrice").notNull(),
  expectedValue: double("expectedValue").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const kalshiPerformance = mysqlTable("kalshiPerformance", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  signalId: int("signalId").notNull(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  outcome: mysqlEnum("outcome", ["win", "loss", "partial"]).notNull(),
  pnl: double("pnl").notNull(),
  roi: double("roi").notNull(),
  accuracy: double("accuracy").notNull(),
  executionQuality: double("executionQuality").notNull(),
  resolvedAt: timestamp("resolvedAt").defaultNow().notNull(),
});

export const kalshiCapital = mysqlTable("kalshiCapital", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  startingBalance: double("startingBalance").default(0).notNull(),
  currentBalance: double("currentBalance").default(0).notNull(),
  totalPnl: double("totalPnl").default(0).notNull(),
  maxDrawdown: double("maxDrawdown").default(0).notNull(),
  winRate: double("winRate").default(0).notNull(),
  sharpeRatio: double("sharpeRatio").default(0).notNull(),
  totalTrades: int("totalTrades").default(0).notNull(),
  winningTrades: int("winningTrades").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const tradingPreferences = mysqlTable("tradingPreferences", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  autonomyMode: mysqlEnum("autonomyMode", [
    "manual",
    "approval_required",
    "semi_autonomous",
    "fully_autonomous",
  ]).default("approval_required").notNull(),
  liveTradingEnabled: int("liveTradingEnabled").default(0).notNull(),
  executionCadence: mysqlEnum("executionCadence", [
    "manual_only",
    "session_assisted",
    "hourly_watch",
    "continuous_watch",
  ]).default("manual_only").notNull(),
  riskPosture: mysqlEnum("riskPosture", [
    "conservative",
    "balanced",
    "aggressive",
  ]).default("balanced").notNull(),
  minSignalConfidence: double("minSignalConfidence").default(0.72).notNull(),
  maxOrderNotional: double("maxOrderNotional").default(10).notNull(),
  maxDailyOrders: int("maxDailyOrders").default(3).notNull(),
  requireApprovalAbove: double("requireApprovalAbove").default(8).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Type exports
export type User = typeof users.$inferSelect;
