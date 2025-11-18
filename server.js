const express = require("express");
const cors = require("cors");
const path = require('path');
require("dotenv").config({ path: path.join(__dirname, '.env') });

const app = express();
// const settingsRoutes = require('./routes/settings');
// app.use('/api/settings', settingsRoutes);
// CORS configuration
const rawOrigins = process.env.FRONTEND_URLS || process.env.FRONTEND_URL || "http://localhost:3000";
const allowedOrigins = rawOrigins.split(",").map((o) => o.trim());

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true); // allow non-browser requests
      const isAllowed = allowedOrigins.some((o) => o === origin);
      if (isAllowed) return callback(null, true);
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
// const settingsRoutes = require('./routes/settings');

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
// app.use('/api/settings', settingsRoutes);

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

// Server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
});
