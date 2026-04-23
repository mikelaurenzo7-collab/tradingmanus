-- Training Instructions Tables
CREATE TABLE `trainingInstructions` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `description` text,
  `instructionType` enum('market_filter', 'signal_filter', 'position_limit', 'time_window', 'custom') NOT NULL,
  `priority` int NOT NULL DEFAULT 0,
  `isActive` int NOT NULL DEFAULT 1,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY `userId` (`userId`)
);

CREATE TABLE `instructionRules` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `instructionId` int NOT NULL,
  `ruleType` enum('include', 'exclude', 'require', 'forbid') NOT NULL,
  `ruleKey` varchar(128) NOT NULL,
  `ruleValue` text NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `instructionId` (`instructionId`)
);

CREATE TABLE `instructionSchedules` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `instructionId` int NOT NULL,
  `scheduleType` enum('always', 'time_window', 'day_of_week', 'market_condition') NOT NULL,
  `startTime` varchar(8),
  `endTime` varchar(8),
  `daysOfWeek` varchar(20),
  `timezone` varchar(50) NOT NULL DEFAULT 'UTC',
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `instructionId` (`instructionId`)
);

CREATE TABLE `instructionHistory` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `instructionId` int NOT NULL,
  `version` int NOT NULL,
  `previousState` text,
  `changeReason` text,
  `changedBy` varchar(64) NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY `instructionId` (`instructionId`)
);
