const express = require('express');
const { Pool } = require('pg');
const amqp = require('amqplib');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');

// ─── Config ───────────────────────────────────────────────
const PORT = process.env.PORT || 8083;
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) { console.error('FATAL: JWT_SECRET not set'); process.exit(1); }
const RABBITMQ_URL = process.env.RABBITMQ_URL;
if (!RABBITMQ_URL) { console.error('FATAL: RABBITMQ_URL not set'); process.exit(1); }
const QUEUE_COMPLETED = 'transaction.completed';

// ─── Logger ───────────────────────────────────────────────
const dbSsl = process.env.DB_SSL === 'true'
  ? { rejectUnauthorized: false }
  : false;

const log = {
  info: (msg, meta = {}) => console.log(JSON.stringify({ level: 'info', service: 'notification-service', msg, ...meta, timestamp: new Date().toISOString() })),
  error: (msg, meta = {}) => console.error(JSON.stringify({ level: 'error', service: 'notification-service', msg, ...meta, timestamp: new Date().toISOString() })),
  warn: (msg, meta = {}) => console.warn(JSON.stringify({ level: 'warn', service: 'notification-service', msg, ...meta, timestamp: new Date().toISOString() })),
};

// ─── Database ─────────────────────────────────────────────
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'payops',
  user: process.env.DB_USER || 'payops',
  password: process.env.DB_PASSWORD,
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: dbSsl,
});

// ─── Auth Middleware ──────────────────────────────────────
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    req.user = jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// ─── Express App ──────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || uuidv4();
  res.setHeader('X-Request-ID', req.requestId);
  const start = Date.now();
  res.on('finish', () => {
    log.info('request', { requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, duration: Date.now() - start });
  });
  next();
});

// ─── Health Check ─────────────────────────────────────────
let rabbitConnected = false;
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: rabbitConnected ? 'healthy' : 'degraded', service: 'notification-service' });
  } catch (err) {
    res.status(503).json({ status: 'unhealthy', error: err.message });
  }
});

// ─── GET /notifications ──────────────────────────────────
app.get('/notifications', authMiddleware, async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    const offset = parseInt(req.query.offset) || 0;

    const [data, count] = await Promise.all([
      pool.query(
        'SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [req.user.userId, limit, offset]
      ),
      pool.query(
        'SELECT COUNT(*) FROM notifications WHERE user_id = $1',
        [req.user.userId]
      ),
    ]);

    res.json({
      notifications: data.rows,
      total: parseInt(count.rows[0].count),
      limit,
      offset,
    });
  } catch (err) {
    log.error('List notifications failed', { error: err.message });
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── RabbitMQ Consumer ────────────────────────────────────
async function startConsumer(retries = 15) {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await amqp.connect(RABBITMQ_URL);
      const channel = await connection.createChannel();

      await channel.assertQueue(QUEUE_COMPLETED, { durable: true });
      channel.prefetch(5);

      log.info('Notification service connected to RabbitMQ');
      rabbitConnected = true;

      channel.consume(QUEUE_COMPLETED, async (msg) => {
        if (!msg) return;

        try {
          const data = JSON.parse(msg.content.toString());
          const { transactionId, userId, amount, recipient, success } = data;

          const type = success ? 'transaction_completed' : 'transaction_failed';
          const message = success
            ? `Transaction of ${amount} to ${recipient} completed successfully`
            : `Transaction of ${amount} to ${recipient} failed: ${data.reason}`;

          await pool.query(
            'INSERT INTO notifications (user_id, transaction_id, type, message) VALUES ($1, $2, $3, $4)',
            [userId, transactionId, type, message]
          );

          log.info('Notification created', { transactionId, userId, type });
          channel.ack(msg);
        } catch (err) {
          log.error('Notification processing failed', { error: err.message });
          channel.nack(msg, false, true);
        }
      });

      connection.on('close', () => {
        rabbitConnected = false;
        log.error('RabbitMQ connection lost, reconnecting...');
        setTimeout(() => startConsumer(retries), 5000);
      });

      return;
    } catch (err) {
      log.warn(`RabbitMQ attempt ${i + 1}/${retries}`, { error: err.message });
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// ─── Start ────────────────────────────────────────────────
const server = app.listen(PORT, async () => {
  log.info(`Notification service started on port ${PORT}`);
  await startConsumer();
});

const shutdown = async (signal) => {
  log.info(`${signal} received, shutting down`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
