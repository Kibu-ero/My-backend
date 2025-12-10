const express = require("express");
const cors = require("cors");
const path = require('path');
require("dotenv").config({ path: path.join(__dirname, '.env') });

const app = express();
// const settingsRoutes = require('./routes/settings');
// app.use('/api/settings', settingsRoutes);
// CORS configuration
// Allow Vercel domain and any configured frontend URLs
const defaultOrigins = "https://dolores-wd.vercel.app,http://localhost:3000";
const rawOrigins = process.env.FRONTEND_URLS || process.env.FRONTEND_URL || defaultOrigins;
const allowedOrigins = rawOrigins.split(",").map((o) => o.trim()).filter(o => o.length > 0);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow non-browser requests
      // Check exact match
      const isAllowed = allowedOrigins.some((o) => o === origin);
      if (isAllowed) return callback(null, true);
      // Check if origin matches Vercel pattern (*.vercel.app)
      if (origin.includes('.vercel.app')) return callback(null, true);
      // Check if origin matches any pattern with wildcard
      const matchesPattern = allowedOrigins.some((pattern) => {
        if (pattern.includes('*')) {
          const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
          return regex.test(origin);
        }
        return false;
      });
      if (matchesPattern) return callback(null, true);
      console.warn(`CORS blocked: ${origin} not in allowed origins:`, allowedOrigins);
      return callback(new Error(`CORS blocked: ${origin} not in allowed origins`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Ensure preflight OPTIONS requests are handled with CORS headers
app.options(
  '*',
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      const isAllowed = allowedOrigins.some((o) => o === origin);
      if (isAllowed) return callback(null, true);
      if (origin.includes('.vercel.app')) return callback(null, true);
      return callback(new Error(`CORS blocked: ${origin} not in allowed origins`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Middleware
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Database health check middleware (with timeout)
const pool = require('./db');
let dbConnectionStatus = { connected: false, lastCheck: 0 };
const DB_CHECK_INTERVAL = 5000; // Check every 5 seconds max

app.use(async (req, res, next) => {
  // Skip health check for the health endpoint itself
  if (req.path === '/health' || req.path === '/') {
    return next();
  }
  
  // Only check database connection if we haven't checked recently
  const now = Date.now();
  if (now - dbConnectionStatus.lastCheck > DB_CHECK_INTERVAL || !dbConnectionStatus.connected) {
    try {
      // Quick database connectivity check with timeout
      const client = await Promise.race([
        pool.connect(),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Database connection timeout')), 3000)
        )
      ]);
      client.release();
      dbConnectionStatus = { connected: true, lastCheck: now };
      next();
    } catch (error) {
      console.error('❌ Database connection error in middleware:', error.message);
      dbConnectionStatus = { connected: false, lastCheck: now };
      return res.status(503).json({ 
        message: 'Service temporarily unavailable - database connection error',
        error: 'Database connection failed',
        code: error.code || 'DB_CONNECTION_ERROR'
      });
    }
  } else {
    // Database was recently checked and is connected, proceed
    next();
  }
});

// Middleware for logging incoming requests
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

// Routes
const paymentSubmissionRoutes = require('./routes/paymentSubmission');
const cashierBillingRoutes = require("./routes/cashierBilling");
const authRoutes = require("./routes/auth");
const billingRoutes = require("./routes/billing");
const employeeRoutes = require("./routes/employees");
const customerRoutes = require("./routes/customers");
const paymentRoutes = require("./routes/payments");
const billRoutes = require("./routes/bills");
const uploadRoutes = require("./routes/uploads");
const reportRoutes = require("./routes/reports");
const dashboardRoutes = require('./routes/dashboard');
const archiveBillingRouter = require('./routes/archiveBilling');
const auditLogsRoutes = require('./routes/auditLogs');
const { router: otpRoutes } = require('./routes/otp');
const penaltyRoutes = require('./src/routes/penalties');
const creditRoutes = require('./src/routes/credits');
const settingsRoutes = require('./routes/settings');

// Validate that all routes are actually routers (routers are objects with methods like use, get, post, etc.)
const routes = [
  { name: 'paymentSubmissionRoutes', route: paymentSubmissionRoutes },
  { name: 'cashierBillingRoutes', route: cashierBillingRoutes },
  { name: 'authRoutes', route: authRoutes },
  { name: 'billingRoutes', route: billingRoutes },
  { name: 'employeeRoutes', route: employeeRoutes },
  { name: 'customerRoutes', route: customerRoutes },
  { name: 'paymentRoutes', route: paymentRoutes },
  { name: 'billRoutes', route: billRoutes },
  { name: 'uploadRoutes', route: uploadRoutes },
  { name: 'reportRoutes', route: reportRoutes },
  { name: 'dashboardRoutes', route: dashboardRoutes },
  { name: 'archiveBillingRouter', route: archiveBillingRouter },
  { name: 'auditLogsRoutes', route: auditLogsRoutes },
  { name: 'otpRoutes', route: otpRoutes },
  { name: 'penaltyRoutes', route: penaltyRoutes },
  { name: 'creditRoutes', route: creditRoutes },
  { name: 'settingsRoutes', route: settingsRoutes },
];

routes.forEach(({ name, route }) => {
  // Express routers are functions (callable) that also have methods like use, get, post, etc.
  if (!route || (typeof route !== 'function' && typeof route !== 'object') || typeof route.use !== 'function') {
    console.error(`❌ ${name} is not a valid router. Type: ${typeof route}, Value:`, route);
    throw new Error(`${name} is not a valid Express router`);
  }
});

// Initialize automatic penalty processing
const { schedulePenaltyProcessing } = require('./src/utils/scheduler');
schedulePenaltyProcessing();

// Route registration
app.use('/api/payment-submissions', paymentSubmissionRoutes);
app.use("/api/cashier-billing", cashierBillingRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/customers", customerRoutes);
app.use("/api/billing", billingRoutes);
app.use("/api/employees", employeeRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/bills", billRoutes);
app.use("/api/uploads", uploadRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api', archiveBillingRouter);
app.use('/api/audit-logs', auditLogsRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/penalties', penaltyRoutes);
app.use('/api/credits', creditRoutes);
app.use('/api/settings', settingsRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({ 
    message: 'Billink API Server',
    status: 'running',
    timestamp: new Date().toISOString(),
    endpoints: {
      health: '/health',
      api: '/api/*'
    }
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err, req, res, next) => {
  console.error("Error:", err.stack);
  res.status(err.status || 500).json({
    error: err.message || "Something went wrong!",
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Export app for Vercel serverless functions
module.exports = app;

// Only start server if not in Vercel environment
if (process.env.VERCEL !== '1' && !process.env.VERCEL_ENV) {
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  });
}
