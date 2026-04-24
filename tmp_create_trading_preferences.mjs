import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const url = new URL(databaseUrl);

const connection = await mysql.createConnection({
  host: url.hostname,
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  port: Number(url.port || 3306),
  ssl: {
    rejectUnauthorized: false,
  },
});

try {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS tradingPreferences (
      id int AUTO_INCREMENT PRIMARY KEY,
      userId int NOT NULL UNIQUE,
      autonomyMode enum('manual','approval_required','semi_autonomous','fully_autonomous') NOT NULL DEFAULT 'approval_required',
      liveTradingEnabled int NOT NULL DEFAULT 0,
      executionCadence enum('manual_only','session_assisted','hourly_watch','continuous_watch') NOT NULL DEFAULT 'manual_only',
      riskPosture enum('conservative','balanced','aggressive') NOT NULL DEFAULT 'balanced',
      minSignalConfidence double NOT NULL DEFAULT 0.72,
      maxOrderNotional double NOT NULL DEFAULT 10,
      maxDailyOrders int NOT NULL DEFAULT 3,
      requireApprovalAbove double NOT NULL DEFAULT 8,
      createdAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updatedAt timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  console.log("tradingPreferences table is ready");
} finally {
  await connection.end();
}
