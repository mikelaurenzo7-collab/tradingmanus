CREATE TABLE `accountConnectors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`dataSource` enum('alpaca','alpha_vantage','polygon','kraken','polymarket','manual') NOT NULL,
	`connectionStatus` enum('connected','disconnected','error','stale') NOT NULL DEFAULT 'disconnected',
	`balance` double,
	`lastSyncAt` timestamp,
	`errorMessage` text,
	`apiKeyEncrypted` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `accountConnectors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `auditLog` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventType` varchar(128) NOT NULL,
	`entityType` varchar(64) NOT NULL,
	`entityId` int,
	`details` text,
	`triggeredByOpenId` varchar(64),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `auditLog_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `dataConnectors` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`dataSource` enum('alpaca','alpha_vantage','polygon','kraken','polymarket','manual') NOT NULL,
	`market` enum('stocks','crypto','prediction') NOT NULL,
	`connectionStatus` enum('connected','disconnected','error','stale') NOT NULL DEFAULT 'disconnected',
	`lastSyncAt` timestamp,
	`errorMessage` text,
	`apiKeyEncrypted` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `dataConnectors_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `marketDataSnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`symbol` varchar(64) NOT NULL,
	`market` enum('stocks','crypto','prediction') NOT NULL,
	`open` double,
	`high` double,
	`low` double,
	`close` double NOT NULL,
	`volume` double,
	`dataSource` enum('alpaca','alpha_vantage','polygon','kraken','polymarket','manual') NOT NULL,
	`timestamp` timestamp NOT NULL,
	`recordedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `marketDataSnapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `paperTrades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tradeType` enum('paper','live') NOT NULL DEFAULT 'paper',
	`symbol` varchar(64) NOT NULL,
	`market` enum('stocks','crypto','prediction') NOT NULL,
	`positionSide` enum('long','short','yes','no') NOT NULL,
	`quantity` double NOT NULL,
	`entryPrice` double NOT NULL,
	`exitPrice` double,
	`entrySignal` varchar(255) NOT NULL,
	`entryRationale` text NOT NULL,
	`invalidationCondition` text,
	`expectedHoldingPeriod` varchar(64),
	`slippageAssumption` double,
	`feeAssumption` double,
	`strategyTag` varchar(160) NOT NULL,
	`enteredAt` timestamp NOT NULL DEFAULT (now()),
	`exitedAt` timestamp,
	`pnl` double,
	`pnlPct` double,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `paperTrades_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `riskLimits` (
	`id` int AUTO_INCREMENT NOT NULL,
	`limitType` varchar(64) NOT NULL,
	`value` double NOT NULL,
	`period` varchar(64) NOT NULL,
	`isActive` int DEFAULT 1,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `riskLimits_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `strategies` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(128) NOT NULL,
	`hypothesis` text NOT NULL,
	`marketUniverse` varchar(255) NOT NULL,
	`holdingPeriod` varchar(64) NOT NULL,
	`entryLogic` text NOT NULL,
	`exitLogic` text NOT NULL,
	`sizingRules` text NOT NULL,
	`allowedRegimes` text,
	`expectedCosts` double,
	`failureConditions` text,
	`strategyStatus` enum('active','paused','archived','retired') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `strategies_id` PRIMARY KEY(`id`),
	CONSTRAINT `strategies_name_unique` UNIQUE(`name`)
);
--> statement-breakpoint
CREATE TABLE `strategyValidation` (
	`id` int AUTO_INCREMENT NOT NULL,
	`strategyId` int NOT NULL,
	`validationPeriod` varchar(64) NOT NULL,
	`outOfSampleReturn` double,
	`postCostReturn` double,
	`sharpeRatio` double,
	`maxDrawdown` double,
	`winRate` double,
	`tradeCount` int,
	`passedCostTest` int DEFAULT 0,
	`passedConsistencyTest` int DEFAULT 0,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `strategyValidation_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `tradeJournalEntries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`paperTradeId` int NOT NULL,
	`founderView` text,
	`systemView` text,
	`outcome` varchar(64),
	`attributionTags` text,
	`notes` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `tradeJournalEntries_id` PRIMARY KEY(`id`)
);
