const { Pool } = require('pg');
const amqp = require('amqplib');
const express = require('express');

// ─── Config ───────────────────────────────────────────────
const RABBITMQ_URL = process.env.RABBITMQ_URL;
if (!RABBITMQ_URL) { console.error('FATAL: RABBITMQ_URL not set'); process.exit(1); }
const QUEUE_PROCESS = 'transaction.process';
const QUEUE_COMPLETED = 'transaction.completed';
const DLX_EXCHANGE = 'payops.dlx';
const DLQ_PROCESS = 'transaction.process.dlq';
const MAX_RETRIES = 3;
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
  password: process.env.DB_PASSWORD,
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
    // ─── Idempotency check ─────────────────────────────────
    // If already completed, skip to prevent double-deduct
    const existing = await client.query(
      'SELECT status FROM transactions WHERE id = $1',
      [transactionId]
    );

    if (existing.rows.length === 0) {
      throw new Error('Transaction not found');
    }

    if (existing.rows[0].status === 'completed') {
      log.warn('Transaction already processed, skipping', { transactionId });
      return { success: true, idempotent: true };
    }

    if (existing.rows[0].status === 'processing') {
      log.warn('Transaction already in progress, skipping', { transactionId });
      return { success: false, reason: 'Already processing' };
    }

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
    await client.query('ROLLBACK').catch(() => {});
    client.release();

    // Use pool (not the rolled-back client) to record the failure
    await pool.query(
      "UPDATE transactions SET status = 'failed', failure_reason = $2, updated_at = NOW() WHERE id = $1",
      [transactionId, err.message]
    ).catch(rollbackErr => {
      log.error('Failed to update transaction status after rollback', {
        transactionId,
        error: rollbackErr.message,
      });
    });

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

      // Dead letter exchange — messages that fail too many times end up here
      await channel.assertExchange(DLX_EXCHANGE, 'direct', { durable: true });
      await channel.assertQueue(DLQ_PROCESS, { durable: true });
      await channel.bindQueue(DLQ_PROCESS, DLX_EXCHANGE, QUEUE_PROCESS);

      // Main queue with DLX config — failed messages route to DLQ after MAX_RETRIES
      await channel.assertQueue(QUEUE_PROCESS, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': DLX_EXCHANGE,
          'x-dead-letter-routing-key': QUEUE_PROCESS,
        },
      });

      await channel.assertQueue(QUEUE_COMPLETED, { durable: true });

      // prefetch(1): bir dəfədə yalnız 1 mesaj al
      // Bu, worker overload olmasının qarşısını alır
      channel.prefetch(1);

      log.info('Worker connected to RabbitMQ, waiting for messages...');
      isHealthy = true;

      channel.consume(QUEUE_PROCESS, async (msg) => {
        if (!msg) return;

        const retryCount = (msg.properties.headers || {})['x-retry-count'] || 0;

        try {
          const data = JSON.parse(msg.content.toString());
          log.info('Received transaction', { transactionId: data.transactionId, attempt: retryCount + 1 });

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
          channel.ack(msg);
        } catch (err) {
          log.error('Message processing error', {
            error: err.message,
            attempt: retryCount + 1,
            maxRetries: MAX_RETRIES,
          });

          if (retryCount >= MAX_RETRIES) {
            // Max retries exceeded — send to DLQ (don't requeue)
            log.error('Max retries exceeded, sending to dead letter queue', {
              retryCount,
            });
            channel.nack(msg, false, false);
          } else {
            // Requeue with incremented retry count
            // Publish a new message with updated retry header, ack the original
            const retryMsg = Buffer.from(msg.content.toString());
            channel.sendToQueue(QUEUE_PROCESS, retryMsg, {
              persistent: true,
              headers: { 'x-retry-count': retryCount + 1 },
            });
            channel.ack(msg);
          }
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
