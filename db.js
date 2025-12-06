require("dotenv").config();
const { Pool } = require("pg");

// Prefer DATABASE_URL if provided; otherwise, fall back to individual vars
// Render PostgreSQL always requires SSL
const isRender = process.env.RENDER === "true" || process.env.DATABASE_URL?.includes("render.com");
const shouldUseSsl =
  isRender ||
  process.env.PGSSLMODE === "require" ||
  process.env.DB_SSL === "true" ||
  process.env.NODE_ENV === "production";

/**
 * Build pool configuration compatible with Render Postgres.
 * - Render Postgres always requires SSL. We set rejectUnauthorized=false
 *   to work with managed certs in node-postgres.
 */
const poolConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
    }
  : {
      // Fallback for local development (requires individual env vars)
      user: process.env.DB_USER,
      host: process.env.DB_HOST || "localhost",
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
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
