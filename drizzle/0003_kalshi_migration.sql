-- Kalshi Trading Agent Schema Migration
-- This migration creates all Kalshi-specific tables for the trading agent

-- Create Kalshi Markets table
CREATE TABLE IF NOT EXISTS `kalshi_markets` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `marketId` varchar(128) NOT NULL UNIQUE,
  `title` varchar(255) NOT NULL,
  `category` varchar(128) NOT NULL,
  `description` text,
  `resolutionDate` timestamp,
  `status` enum('open', 'closed', 'resolved') NOT NULL DEFAULT 'open',
  `yesPrice` double NOT NULL DEFAULT 0,
  `noPrice` double NOT NULL DEFAULT 0,
  `yesVolume` double NOT NULL DEFAULT 0,
  `noVolume` double NOT NULL DEFAULT 0,
  `impliedProbability` double NOT NULL DEFAULT 0.5,
  `lastUpdated` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_category` (`category`),
  INDEX `idx_status` (`status`),
  INDEX `idx_marketId` (`marketId`)
);

-- Create Kalshi Orders table
CREATE TABLE IF NOT EXISTS `kalshi_orders` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `orderId` varchar(128) NOT NULL UNIQUE,
  `marketId` varchar(128) NOT NULL,
  `side` enum('yes', 'no') NOT NULL,
  `quantity` double NOT NULL,
  `limitPrice` double NOT NULL,
  `status` enum('pending', 'filled', 'cancelled', 'rejected') NOT NULL DEFAULT 'pending',
  `filledQuantity` double NOT NULL DEFAULT 0,
  `averagePrice` double NOT NULL DEFAULT 0,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `filledAt` timestamp,
  `cancelledAt` timestamp,
  INDEX `idx_orderId` (`orderId`),
  INDEX `idx_marketId` (`marketId`),
  INDEX `idx_status` (`status`)
);

-- Create Kalshi Fills table
CREATE TABLE IF NOT EXISTS `kalshi_fills` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `orderId` varchar(128) NOT NULL,
  `marketId` varchar(128) NOT NULL,
  `fillPrice` double NOT NULL,
  `fillQuantity` double NOT NULL,
  `fillTime` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_orderId` (`orderId`),
  INDEX `idx_marketId` (`marketId`)
);

-- Create Kalshi Positions table
CREATE TABLE IF NOT EXISTS `kalshi_positions` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `marketId` varchar(128) NOT NULL,
  `side` enum('yes', 'no') NOT NULL,
  `quantity` double NOT NULL,
  `entryPrice` double NOT NULL,
  `currentPrice` double NOT NULL,
  `unrealizedPnl` double NOT NULL DEFAULT 0,
  `realizedPnl` double NOT NULL DEFAULT 0,
  `status` enum('open', 'closed') NOT NULL DEFAULT 'open',
  `openedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `closedAt` timestamp,
  INDEX `idx_marketId` (`marketId`),
  INDEX `idx_status` (`status`)
);

-- Create Kalshi Signals table
CREATE TABLE IF NOT EXISTS `kalshi_signals` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `marketId` varchar(128) NOT NULL,
  `signalType` enum('value_play', 'momentum', 'contrarian', 'arbitrage', 'sentiment') NOT NULL,
  `side` enum('yes', 'no') NOT NULL,
  `confidence` double NOT NULL,
  `reasoning` text NOT NULL,
  `impliedProbability` double NOT NULL,
  `marketPrice` double NOT NULL,
  `expectedValue` double NOT NULL,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_marketId` (`marketId`),
  INDEX `idx_signalType` (`signalType`)
);

-- Create Kalshi Performance table
CREATE TABLE IF NOT EXISTS `kalshi_performance` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `signalId` int NOT NULL,
  `marketId` varchar(128) NOT NULL,
  `outcome` enum('win', 'loss', 'partial') NOT NULL,
  `pnl` double NOT NULL,
  `roi` double NOT NULL,
  `accuracy` double NOT NULL,
  `executionQuality` double NOT NULL,
  `resolvedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX `idx_signalId` (`signalId`),
  INDEX `idx_marketId` (`marketId`)
);

-- Create Kalshi Capital table
CREATE TABLE IF NOT EXISTS `kalshi_capital` (
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

-- Initialize capital tracking with $100 starting balance
INSERT INTO `kalshi_capital` (startingBalance, currentBalance) VALUES (100, 100) ON DUPLICATE KEY UPDATE id=id;
