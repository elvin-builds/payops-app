const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

// ─── Config ───────────────────────────────────────────────
const PORT = process.env.PORT || 8082;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('FATAL: JWT_SECRET not set'); process.exit(1); }
const RABBITMQ_URL = process.env.RABBITMQ_URL;
if (!RABBITMQ_URL) { console.error('FATAL: RABBITMQ_URL not set'); process.exit(1); }
const QUEUE_PROCESS = 'transaction.process';

// ─── Logger ───────────────────────────────────────────────
const dbSsl = process.env.DB_SSL === 'true'
  ? { rejectUnauthorized: false }
  : false;

const log = {
  info: (msg, meta = {}) => console.log(JSON.stringify({ level: 'info', service: 'transaction-service', msg, ...meta, timestamp: new Date().toISOString() })),
  error: (msg, meta = {}) => console.error(JSON.stringify({ level: 'error', service: 'transaction-service', msg, ...meta, timestamp: new Date().toISOString() })),
  warn: (msg, meta = {}) => console.warn(JSON.stringify({ level: 'warn', service: 'transaction-service', msg, ...meta, timestamp: new Date().toISOString() })),
};

// ─── Database ─────────────────────────────────────────────
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'payops',
  user: process.env.DB_USER || 'payops',
  password: process.env.DB_PASSWORD,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: dbSsl,
});

// ─── RabbitMQ ─────────────────────────────────────────────
// RabbitMQ-ya connection retry ilə qoşuluruq
// Çünki docker-compose-da RabbitMQ service-dən gec qalxa bilər
let channel = null;

async function connectRabbitMQ(retries = 10) {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await amqp.connect(RABBITMQ_URL);
      channel = await connection.createChannel();

      // Durable queue — RabbitMQ restart olsa mesajlar itmir
      await channel.assertQueue(QUEUE_PROCESS, { durable: true });

      log.info('Connected to RabbitMQ');

      connection.on('close', () => {
        log.error('RabbitMQ connection closed, reconnecting...');
        setTimeout(() => connectRabbitMQ(retries), 5000);
      });

      return;
    } catch (err) {
      log.warn(`RabbitMQ connection attempt ${i + 1}/${retries} failed`, { error: err.message });
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  log.error('Could not connect to RabbitMQ after retries');
}

// ─── Auth Middleware ──────────────────────────────────────
// JWT token-i yoxlayır, req.user-ə user data qoyur
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── Express App ──────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

// Request ID middleware
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.requestId);

  const start = Date.now();
  res.on('finish', () => {
    log.info('request', {
      requestId: req.requestId,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration: Date.now() - start,
    });
  });
  next();
});

// ─── Health Check ─────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    const rabbitOk = channel !== null;
    if (!rabbitOk) {
      return res.status(503).json({ status: 'degraded', error: 'RabbitMQ not connected' });
    }
    res.json({ status: 'healthy', service: 'transaction-service' });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// ─── POST /transactions ──────────────────────────────────
app.post('/transactions', authMiddleware, async (req, res) => {
  try {
    const { amount, recipient, description } = req.body;

    // Validation
    if (!amount || !recipient) {
      return res.status(400).json({ error: 'Amount and recipient required' });
    }
    if (amount <= 0) {
      return res.status(400).json({ error: 'Amount must be positive' });
    }

    // Balance yoxla
    const userResult = await pool.query('SELECT balance FROM users WHERE id = $1', [req.user.userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    if (parseFloat(userResult.rows[0].balance) < amount) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Transaction yarat — status: pending
    const result = await pool.query(
      `INSERT INTO transactions (user_id, amount, recipient, description, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [req.user.userId, amount, recipient, description || '']
    );

    const transaction = result.rows[0];

    // RabbitMQ-ya göndər — Worker bunu alacaq
    // persistent: true — RabbitMQ restart olsa mesaj itmir
    if (channel) {
      channel.sendToQueue(
        QUEUE_PROCESS,
        Buffer.from(JSON.stringify({
          transactionId: transaction.id,
          userId: req.user.userId,
          amount,
          recipient,
          timestamp: new Date().toISOString(),
        })),
        { persistent: true }
      );
      log.info('Transaction queued', {
        requestId: req.requestId,
        transactionId: transaction.id,
        userId: req.user.userId,
        amount,
      });
    } else {
      // Queue unavailable — mark as failed so it doesn't stay orphaned in 'pending'
      await pool.query(
        "UPDATE transactions SET status = 'failed', failure_reason = 'Queue unavailable', updated_at = NOW() WHERE id = $1",
        [transaction.id]
      );
      log.error('RabbitMQ not available, transaction marked as failed', {
        transactionId: transaction.id,
      });
    }

    res.status(201).json({ transaction });
  } catch (err) {
    log.error('Create transaction failed', { requestId: req.requestId, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /transactions ───────────────────────────────────
app.get('/transactions', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const [data, count] = await Promise.all([
      pool.query(
        'SELECT * FROM transactions WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [req.user.userId, limit, offset]
      ),
      pool.query(
        'SELECT COUNT(*) FROM transactions WHERE user_id = $1',
        [req.user.userId]
      ),
    ]);

    res.json({
      transactions: data.rows,
      total: parseInt(count.rows[0].count),
      limit,
      offset,
    });
  } catch (err) {
    log.error('List transactions failed', { requestId: req.requestId, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── GET /transactions/:id ───────────────────────────────
app.get('/transactions/:id', authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM transactions WHERE id = $1 AND user_id = $2',
      [req.params.id, req.user.userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }
    res.json({ transaction: result.rows[0] });
  } catch (err) {
    log.error('Get transaction failed', { requestId: req.requestId, error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── Start ────────────────────────────────────────────────
const server = app.listen(PORT, async () => {
  log.info(`Transaction service started on port ${PORT}`);
  await connectRabbitMQ();
});

// ─── Graceful Shutdown ────────────────────────────────────
const shutdown = async (signal) => {
  log.info(`${signal} received, shutting down`);
  server.close(async () => {
    if (channel) await channel.close().catch(() => {});
    await pool.end();
    log.info('Transaction service stopped');
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
