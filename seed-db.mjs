import mysql from 'mysql2/promise';
import { createSecureContext } from 'tls';

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

const url = new URL(dbUrl);
const connection = await mysql.createConnection({
  host: url.hostname,
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  port: parseInt(url.port || '3306'),
  ssl: {
    rejectUnauthorized: false,
  },
});

// Execute migration SQL
const migrationSQL = `
CREATE TABLE IF NOT EXISTS \`kalshiCapital\` (
  \`id\` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  \`startingBalance\` double NOT NULL DEFAULT 100,
  \`currentBalance\` double NOT NULL DEFAULT 100,
  \`totalPnl\` double NOT NULL DEFAULT 0,
  \`maxDrawdown\` double NOT NULL DEFAULT 0,
  \`winRate\` double NOT NULL DEFAULT 0,
  \`sharpeRatio\` double NOT NULL DEFAULT 0,
  \`totalTrades\` int NOT NULL DEFAULT 0,
  \`winningTrades\` int NOT NULL DEFAULT 0,
  \`updatedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS \`kalshiMarkets\` (
  \`id\` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  \`marketId\` varchar(128) NOT NULL UNIQUE,
  \`title\` varchar(255) NOT NULL,
  \`category\` varchar(128) NOT NULL,
  \`description\` text,
  \`resolutionDate\` timestamp,
  \`status\` enum('open','closed','resolved') NOT NULL DEFAULT 'open',
  \`yesPrice\` double NOT NULL DEFAULT 0,
  \`noPrice\` double NOT NULL DEFAULT 0,
  \`yesVolume\` double NOT NULL DEFAULT 0,
  \`noVolume\` double NOT NULL DEFAULT 0,
  \`impliedProbability\` double NOT NULL DEFAULT 0.5,
  \`lastUpdated\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS \`kalshiPositions\` (
  \`id\` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  \`marketId\` varchar(128) NOT NULL,
  \`positionSide\` enum('yes','no') NOT NULL,
  \`quantity\` double NOT NULL,
  \`entryPrice\` double NOT NULL,
  \`currentPrice\` double NOT NULL,
  \`unrealizedPnl\` double NOT NULL DEFAULT 0,
  \`realizedPnl\` double NOT NULL DEFAULT 0,
  \`positionStatus\` enum('open','closed') NOT NULL DEFAULT 'open',
  \`openedAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`closedAt\` timestamp
);

CREATE TABLE IF NOT EXISTS \`kalshiSignals\` (
  \`id\` int NOT NULL AUTO_INCREMENT PRIMARY KEY,
  \`marketId\` varchar(128) NOT NULL,
  \`signalType\` enum('value_play','momentum','contrarian','arbitrage','sentiment') NOT NULL,
  \`signalSide\` enum('yes','no') NOT NULL,
  \`confidence\` double NOT NULL,
  \`reasoning\` text NOT NULL,
  \`impliedProbability\` double NOT NULL,
  \`marketPrice\` double NOT NULL,
  \`expectedValue\` double NOT NULL,
  \`createdAt\` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
);
`;

const statements = migrationSQL.split(';').filter(s => s.trim());
for (const stmt of statements) {
  if (stmt.trim()) {
    try {
      await connection.execute(stmt);
      console.log('✓ Executed:', stmt.substring(0, 50) + '...');
    } catch (err) {
      if (err.code !== 'ER_TABLE_EXISTS_ERROR' && !err.message.includes('already exists')) {
        console.error('✗ Failed:', err.message);
      }
    }
  }
}

// Insert initial capital record
try {
  await connection.execute(
    'INSERT INTO kalshiCapital (startingBalance, currentBalance) VALUES (?, ?) ON DUPLICATE KEY UPDATE currentBalance = VALUES(currentBalance)',
    [100, 100]
  );
  console.log('✓ Initialized capital record');
} catch (err) {
  if (!err.message.includes('Duplicate entry')) {
    console.error('✗ Failed to insert capital:', err.message);
  } else {
    console.log('✓ Capital record already exists');
  }
}

await connection.end();
console.log('✓ Database setup complete');
process.exit(0);
