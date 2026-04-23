#!/usr/bin/env node
import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('DATABASE_URL not set');
  process.exit(1);
}

// Parse MySQL connection string
const url = new URL(DATABASE_URL);
const config = {
  host: url.hostname,
  user: url.username,
  password: url.password,
  database: url.pathname.slice(1),
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  ssl: { rejectUnauthorized: false },
  enableKeepAlive: true,
};

async function applyMigrations() {
  const connection = await mysql.createConnection(config);
  
  try {
    // Get migration files
    const migrationsDir = './drizzle/migrations';
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();
    
    console.log(`Found ${files.length} migration files`);
    
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');
      
      // Split by semicolon and execute each statement
      const statements = sql.split(';').filter(s => s.trim());
      
      console.log(`\nApplying ${file}...`);
      for (const statement of statements) {
        if (statement.trim()) {
          try {
            await connection.execute(statement);
            console.log(`  ✓ Statement executed`);
          } catch (err) {
            if (err.code === 'ER_DUP_KEYNAME' || err.code === 'ER_TABLE_EXISTS_ERROR') {
              console.log(`  ⚠ Already exists (skipped)`);
            } else {
              console.error(`  ✗ Error: ${err.message}`);
            }
          }
        }
      }
    }
    
    console.log('\n✅ All migrations applied successfully');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await connection.end();
  }
}

applyMigrations();
