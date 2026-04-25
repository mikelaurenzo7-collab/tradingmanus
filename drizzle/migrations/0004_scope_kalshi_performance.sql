-- Scope historical performance rows to a user so future performance features cannot read across users.

ALTER TABLE `kalshiPerformance` ADD COLUMN `userId` int NULL AFTER `id`;

UPDATE `kalshiPerformance` kp
  INNER JOIN `kalshiSignals` ks ON kp.`signalId` = ks.`id`
   SET kp.`userId` = ks.`userId`
 WHERE kp.`userId` IS NULL;

-- Legacy orphan rows should not exist in normal dogfood flows; backfill to user 1 so the
-- column can become NOT NULL, then all future inserts must provide explicit user scope.
UPDATE `kalshiPerformance` SET `userId` = 1 WHERE `userId` IS NULL;
ALTER TABLE `kalshiPerformance` MODIFY COLUMN `userId` int NOT NULL;

CREATE INDEX `idx_kalshiPerformance_user_resolvedAt` ON `kalshiPerformance` (`userId`, `resolvedAt`);
