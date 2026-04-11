import {
  double,
  int,
  mysqlEnum,
  mysqlTable,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const marketEnum = mysqlEnum("market", ["stocks", "crypto", "prediction"]);
export const botStatusEnum = mysqlEnum("botStatus", ["running", "paused", "stopped"]);
export const positionSideEnum = mysqlEnum("positionSide", ["long", "short", "yes", "no"]);
export const positionStatusEnum = mysqlEnum("positionStatus", ["open", "closed"]);
export const tradeActionEnum = mysqlEnum("tradeAction", ["open", "close", "rebalance", "hedge"]);
export const signalEnum = mysqlEnum("signal", ["trade", "hold", "reduce", "close", "hedge"]);
export const alertTypeEnum = mysqlEnum("alertType", [
  "position_open",
  "position_close",
  "drawdown_breach",
  "kill_switch",
]);
export const alertSeverityEnum = mysqlEnum("alertSeverity", ["info", "warning", "critical"]);
export const analyticsScopeEnum = mysqlEnum("analyticsScope", ["global", "stocks", "crypto", "prediction"]);

export const bots = mysqlTable("bots", {
  id: int("id").autoincrement().primaryKey(),
  botKey: varchar("botKey", { length: 64 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  market: marketEnum.notNull(),
  strategy: varchar("strategy", { length: 160 }).notNull(),
  status: botStatusEnum.default("running").notNull(),
  lastActionAt: timestamp("lastActionAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const positions = mysqlTable("positions", {
  id: int("id").autoincrement().primaryKey(),
  botId: int("botId").notNull(),
  symbol: varchar("symbol", { length: 64 }).notNull(),
  market: marketEnum.notNull(),
  side: positionSideEnum.notNull(),
  size: double("size").notNull(),
  entryPrice: double("entryPrice").notNull(),
  markPrice: double("markPrice").notNull(),
  realizedPnl: double("realizedPnl").default(0).notNull(),
  status: positionStatusEnum.default("open").notNull(),
  strategyTag: varchar("strategyTag", { length: 160 }).notNull(),
  openedAt: timestamp("openedAt").defaultNow().notNull(),
  closedAt: timestamp("closedAt"),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const trades = mysqlTable("trades", {
  id: int("id").autoincrement().primaryKey(),
  botId: int("botId").notNull(),
  symbol: varchar("symbol", { length: 64 }).notNull(),
  market: marketEnum.notNull(),
  side: positionSideEnum.notNull(),
  action: tradeActionEnum.notNull(),
  quantity: double("quantity").notNull(),
  fillPrice: double("fillPrice").notNull(),
  pnl: double("pnl").default(0).notNull(),
  strategyTag: varchar("strategyTag", { length: 160 }).notNull(),
  executedAt: timestamp("executedAt").defaultNow().notNull(),
});

export const reasoningLogs = mysqlTable("reasoningLogs", {
  id: int("id").autoincrement().primaryKey(),
  botId: int("botId"),
  market: marketEnum.notNull(),
  signal: signalEnum.notNull(),
  correlationScore: double("correlationScore").notNull(),
  confidenceScore: double("confidenceScore").notNull(),
  headline: varchar("headline", { length: 255 }).notNull(),
  explanation: text("explanation").notNull(),
  regimeSummary: text("regimeSummary").notNull(),
  opportunityTitle: varchar("opportunityTitle", { length: 255 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const equitySnapshots = mysqlTable("equitySnapshots", {
  id: int("id").autoincrement().primaryKey(),
  scope: analyticsScopeEnum.notNull(),
  totalEquity: double("totalEquity").notNull(),
  dailyPnl: double("dailyPnl").notNull(),
  realizedPnl: double("realizedPnl").notNull(),
  unrealizedPnl: double("unrealizedPnl").notNull(),
  winRate: double("winRate").notNull(),
  sharpeRatio: double("sharpeRatio").notNull(),
  drawdownPct: double("drawdownPct").notNull(),
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
});

export const alerts = mysqlTable("alerts", {
  id: int("id").autoincrement().primaryKey(),
  eventType: alertTypeEnum.notNull(),
  severity: alertSeverityEnum.notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  content: text("content").notNull(),
  dedupeKey: varchar("dedupeKey", { length: 191 }).notNull().unique(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const killSwitchEvents = mysqlTable("killSwitchEvents", {
  id: int("id").autoincrement().primaryKey(),
  triggeredByOpenId: varchar("triggeredByOpenId", { length: 64 }).notNull(),
  reason: text("reason").notNull(),
  flattenedPositions: int("flattenedPositions").notNull(),
  haltedBots: int("haltedBots").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Bot = typeof bots.$inferSelect;
export type Position = typeof positions.$inferSelect;
export type Trade = typeof trades.$inferSelect;
export type ReasoningLog = typeof reasoningLogs.$inferSelect;
export type EquitySnapshot = typeof equitySnapshots.$inferSelect;
export type Alert = typeof alerts.$inferSelect;
export type KillSwitchEvent = typeof killSwitchEvents.$inferSelect;
