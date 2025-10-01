require("dotenv").config();
const { Pool } = require("pg");

// Prefer DATABASE_URL if provided; otherwise, fall back to individual vars
const shouldUseSsl =
  process.env.PGSSLMODE === "require" || process.env.DB_SSL === "true";

/**
 * Build pool configuration compatible with Render Postgres.
 * - Render External URL requires SSL. We set rejectUnauthorized=false
 *   to work with managed certs in node-postgres.
 */
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
    }
  : {
      user: process.env.DB_USER || "postgres",
      host: process.env.DB_HOST || "localhost",
      database: process.env.DB_NAME || "DWS",
      password: process.env.DB_PASSWORD || "kibu",
      port: Number(process.env.DB_PORT) || 5432,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
    };

// Create a database connection pool
const pool = new Pool(poolConfig);

// Test the connection
pool
  .connect()
  .then(() => {
    console.log("✅ PostgreSQL Connected!");
    console.log(`Database: ${process.env.DB_NAME || process.env.DATABASE_URL || "DWS"}`);
  })
  .catch((err) => {
    console.error("❌ Connection error", err);
    process.exit(1); // Exit if we can't connect to the database
  });

module.exports = pool;
