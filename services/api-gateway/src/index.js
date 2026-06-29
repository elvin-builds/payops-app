const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');

// ─── Config ───────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';

// Service URL-ləri — Docker Compose-da service adı ilə resolve olur
const AUTH_SERVICE = process.env.AUTH_SERVICE_URL || 'http://auth-service:8081';
const TRANSACTION_SERVICE = process.env.TRANSACTION_SERVICE_URL || 'http://transaction-service:8082';
const NOTIFICATION_SERVICE = process.env.NOTIFICATION_SERVICE_URL || 'http://notification-service:8083';

// ─── Logger ───────────────────────────────────────────────
const log = {
  info: (msg, meta = {}) => console.log(JSON.stringify({ level: 'info', service: 'api-gateway', msg, ...meta, timestamp: new Date().toISOString() })),
  error: (msg, meta = {}) => console.error(JSON.stringify({ level: 'error', service: 'api-gateway', msg, ...meta, timestamp: new Date().toISOString() })),
  warn: (msg, meta = {}) => console.warn(JSON.stringify({ level: 'warn', service: 'api-gateway', msg, ...meta, timestamp: new Date().toISOString() })),
};

// ─── Express App ──────────────────────────────────────────
const app = express();
app.use(cors());

// ─── Request ID Middleware ────────────────────────────────
// Hər request-ə unikal ID veririk — bütün service-lərdən keçəcək
// Incident zamanı bir request-in bütün yolunu izləmək üçün
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || uuidv4();
  req.headers['x-request-id'] = req.requestId;
  res.setHeader('X-Request-ID', req.requestId);

  const start = Date.now();
  res.on('finish', () => {
    log.info('request', {
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      duration: Date.now() - start,
    });
  });
  next();
});

// ─── Rate Limiting ────────────────────────────────────────
// DDoS-dan qoruma: hər IP üçün 15 dəqiqədə max 100 request
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
});
app.use(limiter);

// ─── Health Check ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'api-gateway' });
});

// ─── JWT Auth Middleware ──────────────────────────────────
// Auth route-lar istisna — onlar token-siz gəlir
function jwtAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.headers['x-user-id'] = decoded.userId;
    req.headers['x-user-email'] = decoded.email;
    req.headers['x-user-role'] = decoded.role;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── Proxy Config ─────────────────────────────────────────
// Proxy error handler — downstream service əlçatmaz olsa
const onProxyError = (err, req, res) => {
  log.error('Proxy error', {
    requestId: req.requestId,
    target: req.originalUrl,
    error: err.message,
  });
  res.status(502).json({ error: 'Service unavailable' });
};

const proxyOptions = (target) => ({
  target,
  changeOrigin: true,
  on: {
    error: onProxyError,
  },
});

// ─── Routes ───────────────────────────────────────────────

// Auth routes — token tələb olunmur
app.use('/api/auth', createProxyMiddleware({
  ...proxyOptions(AUTH_SERVICE),
  pathRewrite: { '^/api/auth': '' },
}));

// Transaction routes — JWT tələb olunur
app.use('/api/transactions', jwtAuth, createProxyMiddleware({
  ...proxyOptions(TRANSACTION_SERVICE),
  pathRewrite: { '^/api/transactions': '/transactions' },
}));

// Notification routes — JWT tələb olunur
app.use('/api/notifications', jwtAuth, createProxyMiddleware({
  ...proxyOptions(NOTIFICATION_SERVICE),
  pathRewrite: { '^/api/notifications': '/notifications' },
}));

// ─── 404 ──────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ─── Start ────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  log.info(`API Gateway started on port ${PORT}`);
  log.info('Route map', {
    '/api/auth/*': AUTH_SERVICE,
    '/api/transactions/*': TRANSACTION_SERVICE,
    '/api/notifications/*': NOTIFICATION_SERVICE,
  });
});

const shutdown = (signal) => {
  log.info(`${signal} received, shutting down`);
  server.close(() => {
    log.info('API Gateway stopped');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
