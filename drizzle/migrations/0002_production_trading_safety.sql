-- Production trading safety hardening
-- Adds user scoping and explicit order lifecycle metadata for live trading records.

ALTER TABLE `kalshiOrders` ADD COLUMN `userId` int NULL AFTER `id`;
UPDATE `kalshiOrders` SET `userId` = 1 WHERE `userId` IS NULL;
ALTER TABLE `kalshiOrders` MODIFY COLUMN `userId` int NOT NULL;
ALTER TABLE `kalshiOrders` ADD COLUMN `orderAction` enum('buy','sell') NOT NULL DEFAULT 'buy' AFTER `marketId`;

ALTER TABLE `kalshiFills` ADD COLUMN `userId` int NULL AFTER `id`;
UPDATE `kalshiFills` SET `userId` = 1 WHERE `userId` IS NULL;
ALTER TABLE `kalshiFills` MODIFY COLUMN `userId` int NOT NULL;

ALTER TABLE `kalshiPositions` ADD COLUMN `userId` int NULL AFTER `id`;
UPDATE `kalshiPositions` SET `userId` = 1 WHERE `userId` IS NULL;
ALTER TABLE `kalshiPositions` MODIFY COLUMN `userId` int NOT NULL;
ALTER TABLE `kalshiPositions` MODIFY COLUMN `positionStatus` enum('open','closing','closed') NOT NULL DEFAULT 'open';

ALTER TABLE `kalshiSignals` ADD COLUMN `userId` int NULL AFTER `id`;
UPDATE `kalshiSignals` SET `userId` = 1 WHERE `userId` IS NULL;
ALTER TABLE `kalshiSignals` MODIFY COLUMN `userId` int NOT NULL;

ALTER TABLE `kalshiCapital` ADD COLUMN `userId` int NULL AFTER `id`;
UPDATE `kalshiCapital` SET `userId` = 1 WHERE `userId` IS NULL;
ALTER TABLE `kalshiCapital` MODIFY COLUMN `userId` int NOT NULL;

CREATE INDEX `idx_kalshiOrders_user_createdAt` ON `kalshiOrders` (`userId`, `createdAt`);
CREATE INDEX `idx_kalshiPositions_user_status` ON `kalshiPositions` (`userId`, `positionStatus`);
CREATE INDEX `idx_kalshiSignals_user_createdAt` ON `kalshiSignals` (`userId`, `createdAt`);
CREATE UNIQUE INDEX `idx_kalshiCapital_userId_unique` ON `kalshiCapital` (`userId`);
