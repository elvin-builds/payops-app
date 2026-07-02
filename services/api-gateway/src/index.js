const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const Redis = require('ioredis');
const client = require('prom-client');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');


// ─── Config ───────────────────────────────────────────────
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('FATAL: JWT_SECRET not set'); process.exit(1); }

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

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || 'http://localhost:3000').split(',').map(s => s.trim());

// ─── Express App ──────────────────────────────────────────
const app = express();
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// ─── Prometheus Metrics ───────────────────────────────────
client.collectDefaultMetrics({
  prefix: 'payops_api_gateway_',
});

const httpRequestsTotal = new client.Counter({
  name: 'payops_api_gateway_http_requests_total',
  help: 'Total number of HTTP requests handled by api-gateway',
  labelNames: ['method', 'path', 'status_code'],
});

const httpRequestDurationSeconds = new client.Histogram({
  name: 'payops_api_gateway_http_request_duration_seconds',
  help: 'HTTP request duration in seconds for api-gateway',
  labelNames: ['method', 'path', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
});

function normalizePath(req) {
  const path = req.originalUrl.split('?')[0];

  if (path === '/health') return '/health';
  if (path === '/metrics') return '/metrics';
  if (path.startsWith('/api/auth')) return '/api/auth';
  if (path.startsWith('/api/transactions')) return '/api/transactions';
  if (path.startsWith('/api/notifications')) return '/api/notifications';

  return path;
}

// ─── Request ID Middleware ────────────────────────────────
// Hər request-ə unikal ID veririk — bütün service-lərdən keçəcək
// Incident zamanı bir request-in bütün yolunu izləmək üçün
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || uuidv4();
  req.headers['x-request-id'] = req.requestId;
  res.setHeader('X-Request-ID', req.requestId);

  const start = Date.now();
  res.on('finish', () => {
    const durationSeconds = (Date.now() - start) / 1000;
    const labels = {
      method: req.method,
      path: normalizePath(req),
      status_code: String(res.statusCode),
    };

    if (!['/health', '/metrics'].includes(req.path)) {
      httpRequestsTotal.inc(labels);
      httpRequestDurationSeconds.observe(labels, durationSeconds);
    }

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

// ─── Redis Client ─────────────────────────────────────────
const redis = new Redis(process.env.REDIS_URL || 'redis://redis:6379', {
  maxRetriesPerRequest: 3,
  enableReadyCheck: true,
  lazyConnect: true,
});

redis.connect().catch(err => {
  log.warn('Redis connection failed, using in-memory rate limiter', { error: err.message });
});

redis.on('error', (err) => {
  log.warn('Redis error', { error: err.message });
});

// ─── Rate Limiting ────────────────────────────────────────
// DDoS-dan qoruma: hər IP üçün 15 dəqiqədə max 100 request
const limiterConfig = {
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Too many requests, try again later' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => ['/health', '/metrics'].includes(req.path),
};

// Use Redis store if connected, otherwise fall back to in-memory
if (redis.status === 'ready' || redis.status === 'connecting') {
  limiterConfig.store = new RedisStore({
    sendCommand: (...args) => redis.call(...args),
  });
}

const limiter = rateLimit(limiterConfig);
app.use(limiter);

// ─── Health Check ─────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', service: 'api-gateway' });
});

// ─── Metrics Endpoint ─────────────────────────────────────
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
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
