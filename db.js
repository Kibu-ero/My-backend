require("dotenv").config();
const { Pool } = require("pg");

// Prefer DATABASE_URL if provided; otherwise, fall back to individual vars
// Render PostgreSQL always requires SSL
const databaseUrl = process.env.DATABASE_URL || '';
const isRender = process.env.RENDER === "true" || databaseUrl.includes("render.com");
const hasSslModeRequire = databaseUrl.includes("sslmode=require") || databaseUrl.includes("?ssl=true");
const shouldUseSsl =
  isRender ||
  hasSslModeRequire ||
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
      // SSL configuration: Render PostgreSQL requires SSL with rejectUnauthorized=false
      // This allows connection to managed PostgreSQL services with self-signed certificates
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
      // Connection pool settings for better reliability
      max: 20, // Maximum number of clients in the pool
      idleTimeoutMillis: 30000, // Close idle clients after 30 seconds
      connectionTimeoutMillis: 10000, // Return an error after 10 seconds if connection could not be established
    }
  : {
      // Fallback for local development (requires individual env vars)
      user: process.env.DB_USER,
      host: process.env.DB_HOST || "localhost",
      database: process.env.DB_NAME,
      password: process.env.DB_PASSWORD,
      port: Number(process.env.DB_PORT) || 5432,
      ssl: shouldUseSsl ? { rejectUnauthorized: false } : false,
      // Connection pool settings for better reliability
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };

// Create a database connection pool
const pool = new Pool(poolConfig);

// Handle pool errors
pool.on('error', (err, client) => {
  console.error('❌ Unexpected error on idle client', err);
  // Don't exit - let the pool handle reconnection
});

// Handle pool connection events
pool.on('connect', () => {
  console.log('✅ New database client connected');
});

// Test the connection (but don't exit in serverless environments)
// In serverless, we skip the initial connection test to avoid blocking function initialization
const isServerless = process.env.VERCEL === '1' || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME;

if (!isServerless) {
  // Only test connection in non-serverless environments
  pool
    .connect()
    .then((client) => {
      console.log("✅ PostgreSQL Connected!");
      console.log(`Database: ${process.env.DB_NAME || process.env.DATABASE_URL || "DWS"}`);
      client.release(); // Release the client back to the pool
    })
    .catch((err) => {
      console.error("❌ Connection error", err);
      process.exit(1);
    });
} else {
  // In serverless, log that we're deferring connection test
  console.log("📦 Serverless environment detected - database connection will be tested on first request");
}

module.exports = pool;
