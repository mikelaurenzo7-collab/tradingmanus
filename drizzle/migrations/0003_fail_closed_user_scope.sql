-- Remove silent userId defaults so missing user scope fails closed.
-- Existing single-user ledgers introduced by earlier migrations were backfilled to user 1;
-- after this migration every insert must provide an explicit authenticated userId.

UPDATE `kalshiOrders` SET `userId` = 1 WHERE `userId` IS NULL;
ALTER TABLE `kalshiOrders` MODIFY COLUMN `userId` int NOT NULL;

UPDATE `kalshiFills` SET `userId` = 1 WHERE `userId` IS NULL;
ALTER TABLE `kalshiFills` MODIFY COLUMN `userId` int NOT NULL;

UPDATE `kalshiPositions` SET `userId` = 1 WHERE `userId` IS NULL;
ALTER TABLE `kalshiPositions` MODIFY COLUMN `userId` int NOT NULL;

UPDATE `kalshiSignals` SET `userId` = 1 WHERE `userId` IS NULL;
ALTER TABLE `kalshiSignals` MODIFY COLUMN `userId` int NOT NULL;

UPDATE `kalshiCapital` SET `userId` = 1 WHERE `userId` IS NULL;
ALTER TABLE `kalshiCapital` MODIFY COLUMN `userId` int NOT NULL;
