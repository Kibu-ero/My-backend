const express = require("express");
const cors = require("cors");
const path = require('path');

// Load environment variables (optional - Vercel provides env vars automatically)
try {
  require("dotenv").config({ path: path.join(__dirname, '.env') });
} catch (error) {
  // dotenv.config() doesn't throw, but just in case
  console.warn('⚠️ Could not load .env file (this is normal in production):', error.message);
}

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

// Detect serverless environment (used elsewhere)
const isServerless = process.env.VERCEL === '1' || process.env.VERCEL_ENV || process.env.AWS_LAMBDA_FUNCTION_NAME;

// Middleware for logging incoming requests
app.use((req, res, next) => {
  console.log(`Incoming request: ${req.method} ${req.url}`);
  next();
});

// Routes - wrap in try-catch for serverless environments
let paymentSubmissionRoutes, cashierBillingRoutes, authRoutes, billingRoutes;
let employeeRoutes, customerRoutes, paymentRoutes, billRoutes, uploadRoutes;
let reportRoutes, dashboardRoutes, archiveBillingRouter, auditLogsRoutes;
let otpRoutes, penaltyRoutes, creditRoutes, settingsRoutes;

try {
  paymentSubmissionRoutes = require('./routes/paymentSubmission');
  cashierBillingRoutes = require("./routes/cashierBilling");
  authRoutes = require("./routes/auth");
  billingRoutes = require("./routes/billing");
  employeeRoutes = require("./routes/employees");
  customerRoutes = require("./routes/customers");
  paymentRoutes = require("./routes/payments");
  billRoutes = require("./routes/bills");
  uploadRoutes = require("./routes/uploads");
  reportRoutes = require("./routes/reports");
  dashboardRoutes = require('./routes/dashboard');
  archiveBillingRouter = require('./routes/archiveBilling');
  auditLogsRoutes = require('./routes/auditLogs');
  otpRoutes = require('./routes/otp').router;
  penaltyRoutes = require('./src/routes/penalties');
  creditRoutes = require('./src/routes/credits');
  settingsRoutes = require('./routes/settings');
} catch (error) {
  console.error('❌ Error loading routes:', error);
  if (!isServerless) {
    throw error; // Re-throw in non-serverless to fail fast
  }
  // In serverless, continue but routes will be undefined
}

// Validate that all routes are actually routers (routers are objects with methods like use, get, post, etc.)
// In serverless, we want to fail gracefully rather than crash the function
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
  // Skip validation if route is undefined (failed to load)
  if (route === undefined) {
    console.warn(`⚠️ ${name} failed to load - route will not be available`);
    return;
  }
  // Express routers are functions (callable) that also have methods like use, get, post, etc.
  if (!route || (typeof route !== 'function' && typeof route !== 'object') || typeof route.use !== 'function') {
    console.error(`❌ ${name} is not a valid router. Type: ${typeof route}, Value:`, route);
    // In serverless, log error but don't crash - let the route fail at request time
    if (!isServerless) {
      throw new Error(`${name} is not a valid Express router`);
    }
  }
});

// Initialize automatic penalty processing (skip in serverless environments)
// Cron jobs don't work in serverless - use external cron service if needed
if (!isServerless) {
  try {
    const { schedulePenaltyProcessing } = require('./src/utils/scheduler');
    schedulePenaltyProcessing();
  } catch (error) {
    console.warn('⚠️ Failed to initialize scheduler (non-critical):', error.message);
  }
}

// Route registration - only register routes that loaded successfully
if (paymentSubmissionRoutes) app.use('/api/payment-submissions', paymentSubmissionRoutes);
if (cashierBillingRoutes) app.use("/api/cashier-billing", cashierBillingRoutes);
if (authRoutes) app.use("/api/auth", authRoutes);
if (customerRoutes) app.use("/api/customers", customerRoutes);
if (billingRoutes) app.use("/api/billing", billingRoutes);
if (employeeRoutes) app.use("/api/employees", employeeRoutes);
if (paymentRoutes) app.use("/api/payments", paymentRoutes);
if (billRoutes) app.use("/api/bills", billRoutes);
if (uploadRoutes) app.use("/api/uploads", uploadRoutes);
if (reportRoutes) app.use('/api/reports', reportRoutes);
if (dashboardRoutes) app.use('/api/dashboard', dashboardRoutes);
if (archiveBillingRouter) app.use('/api', archiveBillingRouter);
if (auditLogsRoutes) app.use('/api/audit-logs', auditLogsRoutes);
if (otpRoutes) app.use('/api/otp', otpRoutes);
if (penaltyRoutes) app.use('/api/penalties', penaltyRoutes);
if (creditRoutes) app.use('/api/credits', creditRoutes);
if (settingsRoutes) app.use('/api/settings', settingsRoutes);

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
