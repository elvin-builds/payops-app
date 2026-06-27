const { Pool } = require('pg');
const amqp = require('amqplib');
const express = require('express');

// ─── Config ───────────────────────────────────────────────
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://payops:payops123@rabbitmq:5672';
const QUEUE_PROCESS = 'transaction.process';
const QUEUE_COMPLETED = 'transaction.completed';
const HEALTH_PORT = process.env.HEALTH_PORT || 8084;

// ─── Logger ───────────────────────────────────────────────
const dbSsl = process.env.DB_SSL === 'true'
  ? { rejectUnauthorized: false }
  : false;

const log = {
  info: (msg, meta = {}) => console.log(JSON.stringify({ level: 'info', service: 'worker-service', msg, ...meta, timestamp: new Date().toISOString() })),
  error: (msg, meta = {}) => console.error(JSON.stringify({ level: 'error', service: 'worker-service', msg, ...meta, timestamp: new Date().toISOString() })),
  warn: (msg, meta = {}) => console.warn(JSON.stringify({ level: 'warn', service: 'worker-service', msg, ...meta, timestamp: new Date().toISOString() })),
};

// ─── Database ─────────────────────────────────────────────
const pool = new Pool({
  host: process.env.DB_HOST || 'postgres',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'payops',
  user: process.env.DB_USER || 'payops',
  password: process.env.DB_PASSWORD || 'payops123',
  max: 5,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: dbSsl,
});

// ─── Health Check Server ──────────────────────────────────
// Worker-in HTTP endpoint-i yoxdur, amma Kubernetes health check üçün lazımdır
let isHealthy = false;
const healthApp = express();
healthApp.get('/health', (req, res) => {
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    service: 'worker-service',
  });
});
healthApp.listen(HEALTH_PORT, () => {
  log.info(`Worker health check on port ${HEALTH_PORT}`);
});

// ─── Transaction Processing ──────────────────────────────
// Bu funksiya hər transaction-u process edir
// Real dünyada: payment provider-ə API call, fraud check, balance update
// Bizim simulyasiyada: 2 saniyə gözlə, balance-dan çıx, status update et
async function processTransaction(data) {
  const { transactionId, userId, amount } = data;
  const client = await pool.connect();

  try {
    // Transaction-u "processing" statusuna keçir
    await client.query(
      "UPDATE transactions SET status = 'processing', updated_at = NOW() WHERE id = $1",
      [transactionId]
    );
    log.info('Processing transaction', { transactionId, userId, amount });

    // Simulyasiya: real payment processing vaxtı
    await new Promise(r => setTimeout(r, 2000));

    // ─── Əsas business logic: balance yoxla və çıx ───
    // BEGIN/COMMIT ilə atomik əməliyyat — ya hamısı olur, ya heç nə
    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT balance FROM users WHERE id = $1 FOR UPDATE',  // FOR UPDATE: row-u lock edir
      [userId]
    );

    if (userResult.rows.length === 0) {
      throw new Error('User not found');
    }

    const balance = parseFloat(userResult.rows[0].balance);
    if (balance < amount) {
      // Insufficient balance — transaction failed
      await client.query(
        "UPDATE transactions SET status = 'failed', failure_reason = 'Insufficient balance', updated_at = NOW() WHERE id = $1",
        [transactionId]
      );
      await client.query('COMMIT');
      log.warn('Transaction failed: insufficient balance', { transactionId, balance, amount });
      return { success: false, reason: 'Insufficient balance' };
    }

    // Balance-dan çıx
    await client.query(
      'UPDATE users SET balance = balance - $1, updated_at = NOW() WHERE id = $2',
      [amount, userId]
    );

    // Transaction completed
    await client.query(
      "UPDATE transactions SET status = 'completed', updated_at = NOW() WHERE id = $1",
      [transactionId]
    );

    await client.query('COMMIT');

    log.info('Transaction completed', {
      transactionId,
      userId,
      amount,
      newBalance: balance - amount,
    });

    return { success: true };
  } catch (err) {
    await client.query('ROLLBACK');
    // Transaction failed
    await client.query(
      "UPDATE transactions SET status = 'failed', failure_reason = $2, updated_at = NOW() WHERE id = $1",
      [transactionId, err.message]
    ).catch(() => {});

    log.error('Transaction processing failed', {
      transactionId,
      error: err.message,
    });

    return { success: false, reason: err.message };
  } finally {
    client.release();
  }
}

// ─── RabbitMQ Consumer ────────────────────────────────────
async function startConsumer(retries = 15) {
  for (let i = 0; i < retries; i++) {
    try {
      const connection = await amqp.connect(RABBITMQ_URL);
      const channel = await connection.createChannel();

      await channel.assertQueue(QUEUE_PROCESS, { durable: true });
      await channel.assertQueue(QUEUE_COMPLETED, { durable: true });

      // prefetch(1): bir dəfədə yalnız 1 mesaj al
      // Bu, worker overload olmasının qarşısını alır
      channel.prefetch(1);

      log.info('Worker connected to RabbitMQ, waiting for messages...');
      isHealthy = true;

      channel.consume(QUEUE_PROCESS, async (msg) => {
        if (!msg) return;

        try {
          const data = JSON.parse(msg.content.toString());
          log.info('Received transaction', { transactionId: data.transactionId });

          const result = await processTransaction(data);

          // Completed transaction-u notification queue-ya göndər
          channel.sendToQueue(
            QUEUE_COMPLETED,
            Buffer.from(JSON.stringify({
              transactionId: data.transactionId,
              userId: data.userId,
              amount: data.amount,
              recipient: data.recipient,
              success: result.success,
              reason: result.reason || null,
              processedAt: new Date().toISOString(),
            })),
            { persistent: true }
          );

          // Manual ACK — yalnız uğurlu process-dən sonra
          // Worker crash olsa, unacked mesaj yenidən queue-ya düşür
          channel.ack(msg);
        } catch (err) {
          log.error('Message processing error', { error: err.message });
          // nack with requeue: mesajı geri queue-ya qoy
          // amma sonsuz loop olmaması üçün production-da dead letter queue istifadə olunur
          channel.nack(msg, false, true);
        }
      });

      connection.on('close', () => {
        log.error('RabbitMQ connection lost, reconnecting...');
        isHealthy = false;
        setTimeout(() => startConsumer(retries), 5000);
      });

      return;
    } catch (err) {
      log.warn(`RabbitMQ connection attempt ${i + 1}/${retries}`, { error: err.message });
      await new Promise(r => setTimeout(r, 3000));
    }
  }
  log.error('Failed to connect to RabbitMQ');
}

// ─── Start ────────────────────────────────────────────────
startConsumer();

// ─── Graceful Shutdown ────────────────────────────────────
const shutdown = async (signal) => {
  log.info(`${signal} received, shutting down worker`);
  isHealthy = false;
  await pool.end();
  log.info('Worker service stopped');
  process.exit(0);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
