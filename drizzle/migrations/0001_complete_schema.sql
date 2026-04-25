-- Laurenzo Kalshi Trading Agent — Complete Schema
-- Single authoritative migration. All table/column names match drizzle/schema.ts exactly.
-- All statements use IF NOT EXISTS so this is safe to re-run.

CREATE TABLE IF NOT EXISTS `users` (
  `id` int AUTO_INCREMENT NOT NULL,
  `openId` varchar(64) NOT NULL,
  `name` text,
  `email` varchar(320),
  `role` enum('user','admin') NOT NULL DEFAULT 'user',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `users_id` PRIMARY KEY (`id`),
  CONSTRAINT `users_openId_unique` UNIQUE (`openId`)
);

CREATE TABLE IF NOT EXISTS `auditLog` (
  `id` int AUTO_INCREMENT NOT NULL,
  `eventType` varchar(128) NOT NULL,
  `entityType` varchar(64) NOT NULL,
  `entityId` int,
  `details` text,
  `triggeredByOpenId` varchar(64),
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `auditLog_id` PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `trainingInstructions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text,
  `instructionType` enum('market_filter','signal_filter','position_limit','time_window','custom') NOT NULL,
  `priority` int NOT NULL DEFAULT 0,
  `isActive` int NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `trainingInstructions_id` PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `instructionRules` (
  `id` int AUTO_INCREMENT NOT NULL,
  `instructionId` int NOT NULL,
  `ruleType` enum('include','exclude','require','forbid') NOT NULL,
  `ruleKey` varchar(128) NOT NULL,
  `ruleValue` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `instructionRules_id` PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `instructionSchedules` (
  `id` int AUTO_INCREMENT NOT NULL,
  `instructionId` int NOT NULL,
  `scheduleType` enum('always','time_window','day_of_week','market_condition') NOT NULL,
  `startTime` varchar(8),
  `endTime` varchar(8),
  `daysOfWeek` varchar(20),
  `timezone` varchar(50) NOT NULL DEFAULT 'UTC',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `instructionSchedules_id` PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `instructionHistory` (
  `id` int AUTO_INCREMENT NOT NULL,
  `instructionId` int NOT NULL,
  `version` int NOT NULL,
  `previousState` text,
  `changeReason` text,
  `changedBy` varchar(64) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `instructionHistory_id` PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `kalshiCredentials` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `apiKeyEncrypted` text NOT NULL,
  `privateKeyEncrypted` text NOT NULL,
  `accountEquity` double NOT NULL DEFAULT 0,
  `accountStatus` enum('connected','disconnected','error') NOT NULL DEFAULT 'disconnected',
  `lastSyncedAt` timestamp NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `kalshiCredentials_id` PRIMARY KEY (`id`),
  CONSTRAINT `kalshiCredentials_userId_unique` UNIQUE (`userId`)
);

CREATE TABLE IF NOT EXISTS `kalshiMarkets` (
  `id` int AUTO_INCREMENT NOT NULL,
  `marketId` varchar(128) NOT NULL,
  `title` varchar(255) NOT NULL,
  `category` varchar(128) NOT NULL,
  `description` text,
  `resolutionDate` timestamp NULL,
  `status` enum('open','closed','resolved') NOT NULL DEFAULT 'open',
  `yesPrice` double NOT NULL DEFAULT 0,
  `noPrice` double NOT NULL DEFAULT 0,
  `yesVolume` double NOT NULL DEFAULT 0,
  `noVolume` double NOT NULL DEFAULT 0,
  `impliedProbability` double NOT NULL DEFAULT 0.5,
  `liquidity` double NOT NULL DEFAULT 0,
  `lastUpdated` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `kalshiMarkets_id` PRIMARY KEY (`id`),
  CONSTRAINT `kalshiMarkets_marketId_unique` UNIQUE (`marketId`)
);

CREATE TABLE IF NOT EXISTS `kalshiMarketSnapshots` (
  `id` int AUTO_INCREMENT NOT NULL,
  `marketId` varchar(128) NOT NULL,
  `yesPrice` double NOT NULL,
  `noPrice` double NOT NULL,
  `yesVolume` double NOT NULL,
  `noVolume` double NOT NULL,
  `impliedProbability` double NOT NULL,
  `liquidity` double NOT NULL,
  `snapshotTime` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `kalshiMarketSnapshots_id` PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `kalshiOrderBook` (
  `id` int AUTO_INCREMENT NOT NULL,
  `marketId` varchar(128) NOT NULL,
  `side` enum('yes','no') NOT NULL,
  `price` double NOT NULL,
  `quantity` double NOT NULL,
  `timestamp` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `kalshiOrderBook_id` PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `kalshiOrders` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `orderId` varchar(128) NOT NULL,
  `marketId` varchar(128) NOT NULL,
  `orderAction` enum('buy','sell') NOT NULL DEFAULT 'buy',
  `side` enum('yes','no') NOT NULL,
  `quantity` double NOT NULL,
  `limitPrice` double NOT NULL,
  `orderStatus` enum('pending','filled','cancelled','rejected') NOT NULL DEFAULT 'pending',
  `filledQuantity` double NOT NULL DEFAULT 0,
  `averagePrice` double NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `filledAt` timestamp NULL,
  `cancelledAt` timestamp NULL,
  CONSTRAINT `kalshiOrders_id` PRIMARY KEY (`id`),
  CONSTRAINT `kalshiOrders_orderId_unique` UNIQUE (`orderId`)
);

CREATE TABLE IF NOT EXISTS `kalshiFills` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `orderId` varchar(128) NOT NULL,
  `marketId` varchar(128) NOT NULL,
  `fillPrice` double NOT NULL,
  `fillQuantity` double NOT NULL,
  `fillTime` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `kalshiFills_id` PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `kalshiPositions` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `marketId` varchar(128) NOT NULL,
  `positionSide` enum('yes','no') NOT NULL,
  `quantity` double NOT NULL,
  `entryPrice` double NOT NULL,
  `currentPrice` double NOT NULL,
  `unrealizedPnl` double NOT NULL DEFAULT 0,
  `realizedPnl` double NOT NULL DEFAULT 0,
  `positionStatus` enum('open','closing','closed') NOT NULL DEFAULT 'open',
  `openedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closedAt` timestamp NULL,
  CONSTRAINT `kalshiPositions_id` PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `kalshiSignals` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `marketId` varchar(128) NOT NULL,
  `signalType` enum('value_play','momentum','contrarian','arbitrage','sentiment') NOT NULL,
  `signalSide` enum('yes','no') NOT NULL,
  `confidence` double NOT NULL,
  `reasoning` text NOT NULL,
  `impliedProbability` double NOT NULL,
  `marketPrice` double NOT NULL,
  `expectedValue` double NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `kalshiSignals_id` PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `kalshiPerformance` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `signalId` int NOT NULL,
  `marketId` varchar(128) NOT NULL,
  `outcome` enum('win','loss','partial') NOT NULL,
  `pnl` double NOT NULL,
  `roi` double NOT NULL,
  `accuracy` double NOT NULL,
  `executionQuality` double NOT NULL,
  `resolvedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT `kalshiPerformance_id` PRIMARY KEY (`id`)
);

CREATE TABLE IF NOT EXISTS `kalshiCapital` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `startingBalance` double NOT NULL DEFAULT 0,
  `currentBalance` double NOT NULL DEFAULT 0,
  `totalPnl` double NOT NULL DEFAULT 0,
  `maxDrawdown` double NOT NULL DEFAULT 0,
  `winRate` double NOT NULL DEFAULT 0,
  `sharpeRatio` double NOT NULL DEFAULT 0,
  `totalTrades` int NOT NULL DEFAULT 0,
  `winningTrades` int NOT NULL DEFAULT 0,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `kalshiCapital_id` PRIMARY KEY (`id`),
  CONSTRAINT `kalshiCapital_userId_unique` UNIQUE (`userId`)
);

CREATE TABLE IF NOT EXISTS `tradingPreferences` (
  `id` int AUTO_INCREMENT NOT NULL,
  `userId` int NOT NULL,
  `autonomyMode` enum('manual','approval_required','semi_autonomous','fully_autonomous') NOT NULL DEFAULT 'approval_required',
  `liveTradingEnabled` int NOT NULL DEFAULT 0,
  `executionCadence` enum('manual_only','session_assisted','hourly_watch','continuous_watch') NOT NULL DEFAULT 'manual_only',
  `riskPosture` enum('conservative','balanced','aggressive') NOT NULL DEFAULT 'balanced',
  `minSignalConfidence` double NOT NULL DEFAULT 0.72,
  `maxOrderNotional` double NOT NULL DEFAULT 10,
  `maxDailyOrders` int NOT NULL DEFAULT 3,
  `requireApprovalAbove` double NOT NULL DEFAULT 8,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT `tradingPreferences_id` PRIMARY KEY (`id`),
  CONSTRAINT `tradingPreferences_userId_unique` UNIQUE (`userId`)
);
