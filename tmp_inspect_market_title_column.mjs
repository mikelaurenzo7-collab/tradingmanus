import mysql from 'mysql2/promise';

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}

const connection = await mysql.createConnection(databaseUrl);

try {
  const [columns] = await connection.execute(
    `
      SELECT COLUMN_NAME, COLUMN_TYPE, CHARACTER_MAXIMUM_LENGTH, IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'kalshiMarkets'
        AND COLUMN_NAME IN ('title', 'category', 'marketId')
      ORDER BY COLUMN_NAME
    `,
  );

  console.log(JSON.stringify(columns, null, 2));
} finally {
  await connection.end();
}
