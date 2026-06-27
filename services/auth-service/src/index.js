const express = require('express');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

// ─── Config ───────────────────────────────────────────────
const PORT = process.env.PORT || 8081;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-in-prod';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '1h';

// ─── Structured Logger ───────────────────────────────────
// Production-da log-lar JSON formatında olmalıdır ki, Loki/ELK parse edə bilsin
const log = {
  info: (msg, meta = {}) => console.log(JSON.stringify({ level: 'info', service: 'auth-service', msg, ...meta, timestamp: new Date().toISOString() })),
  error: (msg, meta = {}) => console.error(JSON.stringify({ level: 'error', service: 'auth-service', msg, ...meta, timestamp: new Date().toISOString() })),
  warn: (msg, meta = {}) => console.warn(JSON.stringify({ level: 'warn', service: 'auth-service', msg, ...meta, timestamp: new Date().toISOString() })),
};

// ─── Database ─────────────────────────────────────────────
// Pool istifadə edirik, hər request üçün yeni connection açmırıq
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'payops',
  user: process.env.DB_USER || 'payops',
  password: process.env.DB_PASSWORD || 'payops123',
  max: 10,                    // max pool size
  idleTimeoutMillis: 30000,   // boş connection 30 saniyə sonra bağlanır
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  log.error('Unexpected database pool error', { error: err.message });
});

// ─── Express App ──────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Request logging middleware - hər request-i log edirik
app.use((req, res, next) => {
  const requestId = req.headers['x-request-id'] || require('uuid').v4();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);

  const start = Date.now();
  res.on('finish', () => {
    log.info('request', {
      requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: Date.now() - start,
    });
  });
  next();
});

// ─── Health Check ─────────────────────────────────────────
// Kubernetes readiness/liveness probe-ları bu endpoint-i yoxlayacaq
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'healthy', service: 'auth-service' });
  } catch (err) {
    log.error('Health check failed', { error: err.message });
    res.status(503).json({ status: 'unhealthy', error: 'database unreachable' });
  }
});

// ─── POST /register ───────────────────────────────────────
app.post('/register', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    // Mövcud user-i yoxla
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'User already exists' });
    }

    // Password hash - bcrypt 10 round (production üçün kifayətdir)
    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      'INSERT INTO users (email, password) VALUES ($1, $2) RETURNING id, email, role, balance, created_at',
      [email, hashedPassword]
    );

    const user = result.rows[0];
    const token = jwt.sign({ userId: user.id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRY });

    log.info('User registered', { requestId: req.requestId, userId: user.id, email: user.email });

    res.status(201).json({ user, token });
  } catch (err) {
    log.error('Registration failed', { requestId: req.requestId, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /login ──────────────────────────────────────────
app.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRY }
    );

    log.info('User logged in', { requestId: req.requestId, userId: user.id });

    // Password-u response-dan çıxarırıq
    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword, token });
  } catch (err) {
    log.error('Login failed', { requestId: req.requestId, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /me ──────────────────────────────────────────────
// JWT token ilə current user-i qaytarır
app.get('/me', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No token provided' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);

    const result = await pool.query(
      'SELECT id, email, role, balance, created_at FROM users WHERE id = $1',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (err) {
    if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    log.error('Get user failed', { requestId: req.requestId, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /verify ─────────────────────────────────────────
// API Gateway bu endpoint-i çağırıb token-i verify edir
app.post('/verify', (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }

    const decoded = jwt.verify(token, JWT_SECRET);
    res.json({ valid: true, user: decoded });
  } catch (err) {
    res.json({ valid: false });
  }
});

// ─── Start Server ─────────────────────────────────────────
const server = app.listen(PORT, () => {
  log.info(`Auth service started on port ${PORT}`);
});

// ─── Graceful Shutdown ────────────────────────────────────
// Kubernetes pod-u söndürəndə SIGTERM göndərir
// Əvvəl yeni request qəbulunu dayandırırıq, sonra mövcud connection-ları bağlayırıq
const shutdown = async (signal) => {
  log.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    await pool.end();
    log.info('Auth service stopped');
    process.exit(0);
  });
  // 10 saniyədən sonra force exit
  setTimeout(() => {
    log.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
// ci
