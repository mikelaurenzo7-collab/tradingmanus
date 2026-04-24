import mysql from 'mysql2/promise';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const connection = await mysql.createConnection(url);

async function query(sql, params = []) {
  const [rows] = await connection.execute(sql, params);
  return rows;
}

const [currentDbRow] = await query('SELECT DATABASE() AS dbName');
const dbName = currentDbRow?.dbName;

const [liquidityColumn] = await query(
  `SELECT COLUMN_NAME
   FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'kalshiMarkets' AND COLUMN_NAME = 'liquidity'`,
  [dbName],
);

if (!liquidityColumn) {
  await query('ALTER TABLE kalshiMarkets ADD COLUMN liquidity DOUBLE NOT NULL DEFAULT 0 AFTER impliedProbability');
}

await query('ALTER TABLE kalshiCapital MODIFY COLUMN startingBalance DOUBLE NOT NULL DEFAULT 0');
await query('ALTER TABLE kalshiCapital MODIFY COLUMN currentBalance DOUBLE NOT NULL DEFAULT 0');

await query(
  `UPDATE kalshiCapital
   SET startingBalance = currentBalance
   WHERE id = 1
     AND totalTrades = 0
     AND startingBalance = 100
     AND currentBalance <> 100`,
);

const capitalRows = await query('SELECT * FROM kalshiCapital LIMIT 5');
const marketColumns = await query(
  `SELECT COLUMN_NAME
   FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'kalshiMarkets'
   ORDER BY ORDINAL_POSITION`,
  [dbName],
);

console.log(JSON.stringify({ repaired: true, capitalRows, marketColumns }, null, 2));

await connection.end();
