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
export const dataSourceEnum = mysqlEnum("dataSource", ["alpaca", "alpha_vantage", "polygon", "kraken", "polymarket", "manual"]);
export const connectionStatusEnum = mysqlEnum("connectionStatus", ["connected", "disconnected", "error", "stale"]);
export const tradeTypeEnum = mysqlEnum("tradeType", ["paper", "live"]);
export const strategyStatusEnum = mysqlEnum("strategyStatus", ["active", "paused", "archived", "retired"]);

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

// Data connectors and real-time state
export const dataConnectors = mysqlTable("dataConnectors", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  source: dataSourceEnum.notNull(),
  market: marketEnum.notNull(),
  status: connectionStatusEnum.default("disconnected").notNull(),
  lastSyncAt: timestamp("lastSyncAt"),
  errorMessage: text("errorMessage"),
  apiKeyEncrypted: text("apiKeyEncrypted"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const marketDataSnapshots = mysqlTable("marketDataSnapshots", {
  id: int("id").autoincrement().primaryKey(),
  symbol: varchar("symbol", { length: 64 }).notNull(),
  market: marketEnum.notNull(),
  open: double("open"),
  high: double("high"),
  low: double("low"),
  close: double("close").notNull(),
  volume: double("volume"),
  source: dataSourceEnum.notNull(),
  timestamp: timestamp("timestamp").notNull(),
  recordedAt: timestamp("recordedAt").defaultNow().notNull(),
});

export const accountConnectors = mysqlTable("accountConnectors", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull(),
  source: dataSourceEnum.notNull(),
  status: connectionStatusEnum.default("disconnected").notNull(),
  balance: double("balance"),
  lastSyncAt: timestamp("lastSyncAt"),
  errorMessage: text("errorMessage"),
  apiKeyEncrypted: text("apiKeyEncrypted"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Paper trading and journaling
export const paperTrades = mysqlTable("paperTrades", {
  id: int("id").autoincrement().primaryKey(),
  tradeType: tradeTypeEnum.default("paper").notNull(),
  symbol: varchar("symbol", { length: 64 }).notNull(),
  market: marketEnum.notNull(),
  side: positionSideEnum.notNull(),
  quantity: double("quantity").notNull(),
  entryPrice: double("entryPrice").notNull(),
  exitPrice: double("exitPrice"),
  entrySignal: varchar("entrySignal", { length: 255 }).notNull(),
  entryRationale: text("entryRationale").notNull(),
  invalidationCondition: text("invalidationCondition"),
  expectedHoldingPeriod: varchar("expectedHoldingPeriod", { length: 64 }),
  slippageAssumption: double("slippageAssumption"),
  feeAssumption: double("feeAssumption"),
  strategyTag: varchar("strategyTag", { length: 160 }).notNull(),
  enteredAt: timestamp("enteredAt").defaultNow().notNull(),
  exitedAt: timestamp("exitedAt"),
  pnl: double("pnl"),
  pnlPct: double("pnlPct"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const tradeJournalEntries = mysqlTable("tradeJournalEntries", {
  id: int("id").autoincrement().primaryKey(),
  paperTradeId: int("paperTradeId").notNull(),
  founderView: text("founderView"),
  systemView: text("systemView"),
  outcome: varchar("outcome", { length: 64 }),
  attributionTags: text("attributionTags"),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

// Strategy registry and validation
export const strategies = mysqlTable("strategies", {
  id: int("id").autoincrement().primaryKey(),
  name: varchar("name", { length: 128 }).notNull().unique(),
  hypothesis: text("hypothesis").notNull(),
  marketUniverse: varchar("marketUniverse", { length: 255 }).notNull(),
  holdingPeriod: varchar("holdingPeriod", { length: 64 }).notNull(),
  entryLogic: text("entryLogic").notNull(),
  exitLogic: text("exitLogic").notNull(),
  sizingRules: text("sizingRules").notNull(),
  allowedRegimes: text("allowedRegimes"),
  expectedCosts: double("expectedCosts"),
  failureConditions: text("failureConditions"),
  status: strategyStatusEnum.default("active").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export const strategyValidation = mysqlTable("strategyValidation", {
  id: int("id").autoincrement().primaryKey(),
  strategyId: int("strategyId").notNull(),
  validationPeriod: varchar("validationPeriod", { length: 64 }).notNull(),
  outOfSampleReturn: double("outOfSampleReturn"),
  postCostReturn: double("postCostReturn"),
  sharpeRatio: double("sharpeRatio"),
  maxDrawdown: double("maxDrawdown"),
  winRate: double("winRate"),
  tradeCount: int("tradeCount"),
  passedCostTest: int("passedCostTest").default(0),
  passedConsistencyTest: int("passedConsistencyTest").default(0),
  notes: text("notes"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

// Governance and audit
export const auditLog = mysqlTable("auditLog", {
  id: int("id").autoincrement().primaryKey(),
  eventType: varchar("eventType", { length: 128 }).notNull(),
  entityType: varchar("entityType", { length: 64 }).notNull(),
  entityId: int("entityId"),
  details: text("details"),
  triggeredByOpenId: varchar("triggeredByOpenId", { length: 64 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const riskLimits = mysqlTable("riskLimits", {
  id: int("id").autoincrement().primaryKey(),
  limitType: varchar("limitType", { length: 64 }).notNull(),
  value: double("value").notNull(),
  period: varchar("period", { length: 64 }).notNull(),
  isActive: int("isActive").default(1),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
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
export type DataConnector = typeof dataConnectors.$inferSelect;
export type MarketDataSnapshot = typeof marketDataSnapshots.$inferSelect;
export type AccountConnector = typeof accountConnectors.$inferSelect;
export type PaperTrade = typeof paperTrades.$inferSelect;
export type TradeJournalEntry = typeof tradeJournalEntries.$inferSelect;
export type Strategy = typeof strategies.$inferSelect;
export type StrategyValidation = typeof strategyValidation.$inferSelect;
export type AuditLog = typeof auditLog.$inferSelect;
export type RiskLimit = typeof riskLimits.$inferSelect;
