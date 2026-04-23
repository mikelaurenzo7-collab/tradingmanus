-- Add kalshiCredentials table for storing encrypted Kalshi API credentials
CREATE TABLE `kalshiCredentials` (
  `id` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  `userId` int NOT NULL,
  `apiKeyEncrypted` text NOT NULL,
  `privateKeyEncrypted` text NOT NULL,
  `accountEquity` double NOT NULL DEFAULT 0,
  `accountStatus` enum('connected', 'disconnected', 'error') NOT NULL DEFAULT 'disconnected',
  `lastSyncedAt` timestamp,
  `createdAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY `userId` (`userId`)
);
