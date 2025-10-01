require("dotenv").config();
const { Pool } = require("pg");

// Create a database connection pool
const pool = new Pool({
  user: process.env.DB_USER || "postgres",
  host: process.env.DB_HOST || "localhost",
  database: process.env.DB_NAME || "DWS",
  password: process.env.DB_PASSWORD || "kibu",
  port: process.env.DB_PORT || 5432,
});

// Test the connection
pool.connect()
  .then(() => {
    console.log("✅ PostgreSQL Connected!");
    console.log(`Database: ${process.env.DB_NAME || "DWS"}`);
  })
  .catch(err => {
    console.error("❌ Connection error", err.stack);
    process.exit(1); // Exit if we can't connect to the database
  });

module.exports = pool;
