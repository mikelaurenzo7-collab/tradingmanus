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
  event: varchar("event", { length: 128 }).notNull(),
  details: text("details"),
  triggeredByOpenId: varchar("triggeredByOpenId", { length: 64 }).notNull(),
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
  lastUpdated: timestamp("lastUpdated").defaultNow().onUpdateNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const kalshiOrders = mysqlTable("kalshiOrders", {
  id: int("id").autoincrement().primaryKey(),
  orderId: varchar("orderId", { length: 128 }).notNull().unique(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
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
  orderId: varchar("orderId", { length: 128 }).notNull(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  fillPrice: double("fillPrice").notNull(),
  fillQuantity: double("fillQuantity").notNull(),
  fillTime: timestamp("fillTime").defaultNow().notNull(),
});

export const kalshiPositions = mysqlTable("kalshiPositions", {
  id: int("id").autoincrement().primaryKey(),
  marketId: varchar("marketId", { length: 128 }).notNull(),
  side: mysqlEnum("positionSide", ["yes", "no"]).notNull(),
  quantity: double("quantity").notNull(),
  entryPrice: double("entryPrice").notNull(),
  currentPrice: double("currentPrice").notNull(),
  unrealizedPnl: double("unrealizedPnl").default(0).notNull(),
  realizedPnl: double("realizedPnl").default(0).notNull(),
  positionStatus: mysqlEnum("positionStatus", ["open", "closed"]).default("open").notNull(),
  openedAt: timestamp("openedAt").defaultNow().notNull(),
  closedAt: timestamp("closedAt"),
});

export const kalshiSignals = mysqlTable("kalshiSignals", {
  id: int("id").autoincrement().primaryKey(),
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
  startingBalance: double("startingBalance").default(100).notNull(),
  currentBalance: double("currentBalance").default(100).notNull(),
  totalPnl: double("totalPnl").default(0).notNull(),
  maxDrawdown: double("maxDrawdown").default(0).notNull(),
  winRate: double("winRate").default(0).notNull(),
  sharpeRatio: double("sharpeRatio").default(0).notNull(),
  totalTrades: int("totalTrades").default(0).notNull(),
  winningTrades: int("winningTrades").default(0).notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Type exports
export type User = typeof users.$inferSelect;
