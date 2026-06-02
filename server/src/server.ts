import app from './app';
import { createLogger } from './architectures/auth/utils/auth.logger.utils';

// --- Auth service dependencies ---
import { databaseManager as authDb } from './architectures/auth/config/auth.database';
import { redisManager } from './architectures/auth/config/auth.redis';
import { rabbitmq } from './architectures/auth/config/auth.rabbitmq';
import { startEmailResponseConsumer } from './architectures/auth/events/consumers/auth.emailResponse.consumer';

// --- Business service dependencies ---
import { databaseManager as businessDb } from './architectures/business/config/business.database';

// --- Chat service dependencies ---
import { databaseManager as chatDb } from './architectures/chat/config/chat.db.config';
import { getRedisClient } from './architectures/chat/config/chat.redis.config';
import { setupCronJobs } from './architectures/chat/cron/chat.cron';

// --- Email service dependencies ---
import { connectRabbitMQ as connectEmailRabbitMQ } from './architectures/email/config/email.rabbitmq';
import { startAuthEmailConsumer } from './architectures/email/events/consumers/auth.email.consumer';

const logger = createLogger('server');
const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    logger.info('Starting FormaChat server...');

    // --- Database ---
    logger.info('Connecting to MongoDB...');
    await authDb.connect();
    // Business and chat share the same mongoose instance; connecting again is a safe no-op
    await businessDb.connect();
    await chatDb.connect();
    logger.info('MongoDB connected');

    // --- Redis (auth: ioredis) ---
    logger.info('Connecting to Redis (auth)...');
    await redisManager.connect();
    logger.info('Auth Redis connected');

    // --- Redis (chat: node-redis) ---
    logger.info('Connecting to Redis (chat)...');
    await getRedisClient();
    logger.info('Chat Redis connected');

    // --- RabbitMQ (auth) ---
    logger.info('Connecting to RabbitMQ (auth)...');
    await rabbitmq.connect();
    if (!rabbitmq.isConnected) {
      throw new Error('Auth RabbitMQ connection failed');
    }
    logger.info('Auth RabbitMQ connected');

    // --- RabbitMQ (email) ---
    logger.info('Connecting to RabbitMQ (email)...');
    await connectEmailRabbitMQ();
    logger.info('Email RabbitMQ connected');

    // --- Consumers ---
    logger.info('Starting message consumers...');
    await startEmailResponseConsumer();
    await startAuthEmailConsumer();
    logger.info('All consumers started');

    // --- Cron jobs ---
    logger.info('Setting up cron jobs...');
    setupCronJobs();
    logger.info('Cron jobs active');

    // --- HTTP server ---
    app.listen(PORT, () => {
      logger.info(`FormaChat is running on port ${PORT}`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
      });
    });

  } catch (error: any) {
    logger.error('Failed to start server', {
      error: error.message,
      stack: error.stack,
    });

    try {
      await rabbitmq.disconnect();
      await redisManager.disconnect();
      await authDb.disconnect();
    } catch (cleanupError) {
      logger.error('Error during startup cleanup', { error: cleanupError });
    }

    process.exit(1);
  }
}

async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  try {
    await rabbitmq.disconnect();
    await redisManager.disconnect();
    await authDb.disconnect();

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error during graceful shutdown', { error: error.message });
    process.exit(1);
  }
}

// Register restart hook for RabbitMQ reconnections (auth service pattern)
(global as any).restartEmailConsumer = async () => {
  try {
    logger.info('Restarting email response consumer...');
    await startEmailResponseConsumer();
    logger.info('Email response consumer restarted');
  } catch (error: any) {
    logger.error('Failed to restart email response consumer', { error: error.message });
  }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', { reason, promise });
  process.exit(1);
});

startServer();
