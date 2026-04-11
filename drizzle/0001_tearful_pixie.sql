CREATE TABLE `alerts` (
	`id` int AUTO_INCREMENT NOT NULL,
	`alertType` enum('position_open','position_close','drawdown_breach','kill_switch') NOT NULL,
	`alertSeverity` enum('info','warning','critical') NOT NULL,
	`title` varchar(255) NOT NULL,
	`content` text NOT NULL,
	`dedupeKey` varchar(191) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `alerts_id` PRIMARY KEY(`id`),
	CONSTRAINT `alerts_dedupeKey_unique` UNIQUE(`dedupeKey`)
);
--> statement-breakpoint
CREATE TABLE `bots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`botKey` varchar(64) NOT NULL,
	`name` varchar(128) NOT NULL,
	`market` enum('stocks','crypto','prediction') NOT NULL,
	`strategy` varchar(160) NOT NULL,
	`botStatus` enum('running','paused','stopped') NOT NULL DEFAULT 'running',
	`lastActionAt` timestamp NOT NULL DEFAULT (now()),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bots_id` PRIMARY KEY(`id`),
	CONSTRAINT `bots_botKey_unique` UNIQUE(`botKey`)
);
--> statement-breakpoint
CREATE TABLE `equitySnapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`analyticsScope` enum('global','stocks','crypto','prediction') NOT NULL,
	`totalEquity` double NOT NULL,
	`dailyPnl` double NOT NULL,
	`realizedPnl` double NOT NULL,
	`unrealizedPnl` double NOT NULL,
	`winRate` double NOT NULL,
	`sharpeRatio` double NOT NULL,
	`drawdownPct` double NOT NULL,
	`recordedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `equitySnapshots_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `killSwitchEvents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`triggeredByOpenId` varchar(64) NOT NULL,
	`reason` text NOT NULL,
	`flattenedPositions` int NOT NULL,
	`haltedBots` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `killSwitchEvents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `positions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`botId` int NOT NULL,
	`symbol` varchar(64) NOT NULL,
	`market` enum('stocks','crypto','prediction') NOT NULL,
	`positionSide` enum('long','short','yes','no') NOT NULL,
	`size` double NOT NULL,
	`entryPrice` double NOT NULL,
	`markPrice` double NOT NULL,
	`realizedPnl` double NOT NULL DEFAULT 0,
	`positionStatus` enum('open','closed') NOT NULL DEFAULT 'open',
	`strategyTag` varchar(160) NOT NULL,
	`openedAt` timestamp NOT NULL DEFAULT (now()),
	`closedAt` timestamp,
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `positions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reasoningLogs` (
	`id` int AUTO_INCREMENT NOT NULL,
	`botId` int,
	`market` enum('stocks','crypto','prediction') NOT NULL,
	`signal` enum('trade','hold','reduce','close','hedge') NOT NULL,
	`correlationScore` double NOT NULL,
	`confidenceScore` double NOT NULL,
	`headline` varchar(255) NOT NULL,
	`explanation` text NOT NULL,
	`regimeSummary` text NOT NULL,
	`opportunityTitle` varchar(255) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `reasoningLogs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trades` (
	`id` int AUTO_INCREMENT NOT NULL,
	`botId` int NOT NULL,
	`symbol` varchar(64) NOT NULL,
	`market` enum('stocks','crypto','prediction') NOT NULL,
	`positionSide` enum('long','short','yes','no') NOT NULL,
	`tradeAction` enum('open','close','rebalance','hedge') NOT NULL,
	`quantity` double NOT NULL,
	`fillPrice` double NOT NULL,
	`pnl` double NOT NULL DEFAULT 0,
	`strategyTag` varchar(160) NOT NULL,
	`executedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `trades_id` PRIMARY KEY(`id`)
);
