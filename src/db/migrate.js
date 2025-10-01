const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'billink_db',
  port: process.env.DB_PORT || 5432
};

async function runMigrations() {
  let pool;
  
  try {
    console.log('🔌 Connecting to PostgreSQL database...');
    pool = new Pool(dbConfig);
    
    console.log('📁 Reading migration files...');
    const migrationsDir = path.join(__dirname, 'migrations');
    const files = await fs.readdir(migrationsDir);
    
    // Sort files to ensure proper order
    const sqlFiles = files
      .filter(file => file.endsWith('.sql'))
      .sort();
    
    console.log(`📋 Found ${sqlFiles.length} migration files`);
    
    for (const file of sqlFiles) {
      console.log(`🔄 Running migration: ${file}`);
      const filePath = path.join(migrationsDir, file);
      const sql = await fs.readFile(filePath, 'utf8');
      
      try {
        await pool.query(sql);
        console.log(`✅ Successfully executed: ${file}`);
      } catch (error) {
        console.error(`❌ Error executing ${file}:`, error.message);
        // Continue with other migrations even if one fails
      }
    }
    
    console.log('🎉 All migrations completed!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    if (pool) {
      await pool.end();
    }
  }
}

// Run migrations if this file is executed directly
if (require.main === module) {
  runMigrations();
}

module.exports = { runMigrations }; 