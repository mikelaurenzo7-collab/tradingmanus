-- Create kalshiCapital table
CREATE TABLE IF NOT EXISTS `kalshiCapital` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `startingBalance` double NOT NULL DEFAULT 100,
  `currentBalance` double NOT NULL DEFAULT 100,
  `totalPnl` double NOT NULL DEFAULT 0,
  `maxDrawdown` double NOT NULL DEFAULT 0,
  `winRate` double NOT NULL DEFAULT 0,
  `sharpeRatio` double NOT NULL DEFAULT 0,
  `totalTrades` int NOT NULL DEFAULT 0,
  `winningTrades` int NOT NULL DEFAULT 0,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Create kalshiMarkets table
CREATE TABLE IF NOT EXISTS `kalshiMarkets` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `marketId` varchar(128) NOT NULL UNIQUE,
  `title` varchar(255) NOT NULL,
  `category` varchar(128) NOT NULL,
  `description` text,
  `resolutionDate` timestamp,
  `status` enum('open','closed','resolved') NOT NULL DEFAULT 'open',
  `yesPrice` double NOT NULL DEFAULT 0,
  `noPrice` double NOT NULL DEFAULT 0,
  `yesVolume` double NOT NULL DEFAULT 0,
  `noVolume` double NOT NULL DEFAULT 0,
  `impliedProbability` double NOT NULL DEFAULT 0.5,
  `lastUpdated` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create kalshiOrders table
CREATE TABLE IF NOT EXISTS `kalshiOrders` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `orderId` varchar(128) NOT NULL UNIQUE,
  `marketId` varchar(128) NOT NULL,
  `side` enum('yes','no') NOT NULL,
  `quantity` double NOT NULL,
  `limitPrice` double NOT NULL,
  `orderStatus` enum('pending','filled','cancelled','rejected') NOT NULL DEFAULT 'pending',
  `filledQuantity` double NOT NULL DEFAULT 0,
  `averagePrice` double NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `filledAt` timestamp,
  `cancelledAt` timestamp
);

-- Create kalshiFills table
CREATE TABLE IF NOT EXISTS `kalshiFills` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `orderId` varchar(128) NOT NULL,
  `marketId` varchar(128) NOT NULL,
  `fillPrice` double NOT NULL,
  `fillQuantity` double NOT NULL,
  `fillTime` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create kalshiPositions table
CREATE TABLE IF NOT EXISTS `kalshiPositions` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `marketId` varchar(128) NOT NULL,
  `positionSide` enum('yes','no') NOT NULL,
  `quantity` double NOT NULL,
  `entryPrice` double NOT NULL,
  `currentPrice` double NOT NULL,
  `unrealizedPnl` double NOT NULL DEFAULT 0,
  `realizedPnl` double NOT NULL DEFAULT 0,
  `positionStatus` enum('open','closed') NOT NULL DEFAULT 'open',
  `openedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closedAt` timestamp
);

-- Create kalshiSignals table
CREATE TABLE IF NOT EXISTS `kalshiSignals` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `marketId` varchar(128) NOT NULL,
  `signalType` enum('value_play','momentum','contrarian','arbitrage','sentiment') NOT NULL,
  `signalSide` enum('yes','no') NOT NULL,
  `confidence` double NOT NULL,
  `reasoning` text NOT NULL,
  `impliedProbability` double NOT NULL,
  `marketPrice` double NOT NULL,
  `expectedValue` double NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create kalshiPerformance table
CREATE TABLE IF NOT EXISTS `kalshiPerformance` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `signalId` int NOT NULL,
  `marketId` varchar(128) NOT NULL,
  `outcome` enum('win','loss','partial') NOT NULL,
  `pnl` double NOT NULL,
  `roi` double NOT NULL,
  `accuracy` double NOT NULL,
  `executionQuality` double NOT NULL,
  `resolvedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
