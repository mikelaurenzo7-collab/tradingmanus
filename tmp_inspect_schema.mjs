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

const auditColumns = await query(
  `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
   FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'auditLog'
   ORDER BY ORDINAL_POSITION`,
  [dbName],
);

const marketColumns = await query(
  `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT
   FROM information_schema.COLUMNS
   WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'kalshiMarkets'
   ORDER BY ORDINAL_POSITION`,
  [dbName],
);

const capitalRows = await query('SELECT * FROM kalshiCapital LIMIT 5');

console.log(JSON.stringify({ dbName, auditColumns, marketColumns, capitalRows }, null, 2));

await connection.end();
