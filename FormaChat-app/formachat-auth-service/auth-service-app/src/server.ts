import app from './app';
import { databaseManager } from './config/auth.database';
import { redisManager } from './config/auth.redis';
import { rabbitmq } from './config/auth.rabbitmq';
import { logger } from './utils/auth.logger.utils';
import { startEmailResponseConsumer } from './events/consumers/auth.emailResponse.consumer'; 

const PORT = process.env.PORT || 3000;



async function initializeEmailConsumer() {
  try {
    logger.info('Starting email response consumer...');
    await startEmailResponseConsumer();
    logger.info('Email response consumer started successfully');
  } catch (error: any) {
    logger.error('Failed to start email response consumer', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

(global as any).restartEmailConsumer = async () => {
  try {
    logger.info('Restarting email response consumer after reconnection...');
    await initializeEmailConsumer();
    logger.info('Email response consumer restarted successfully');
  } catch (error: any) {
    logger.error('Failed to restart email response consumer', {
      error: error.message
    });
  }
};

async function startServer() {
  try {
    logger.info('Starting Auth Service...');

    // CRITICAL: Connect to ALL dependencies BEFORE starting Express
    logger.info('Connecting to dependencies...');
    
    // Database
    logger.info('Connecting to database...');
    await databaseManager.connect();
    logger.info('✅ Database connected');
    
    // Redis
    logger.info('Connecting to Redis...');
    await redisManager.connect();
    logger.info('✅ Redis connected');
    
    // RabbitMQ - MUST complete before accepting HTTP requests
    logger.info('Connecting to RabbitMQ...');
    await rabbitmq.connect();
    
    // Verify RabbitMQ is actually connected
    if (!rabbitmq.isConnected) {
      throw new Error('RabbitMQ connection failed - isConnected is false');
    }
    logger.info('✅ RabbitMQ connected and ready');

    // Start consumer
    logger.info('Starting email response consumer...');
    await initializeEmailConsumer();
    logger.info('✅ Email consumer started');

    // ONLY NOW start accepting HTTP requests
    logger.info('Starting Express server...');
    app.listen(PORT, () => {
      logger.info('🚀 Auth service running on port ' + PORT, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        status: 'READY_TO_ACCEPT_REQUESTS'
      });
    });

  } catch (error: any) {
    logger.error('❌ Failed to start server', { 
      error: error.message,
      stack: error.stack 
    });
    
    // Clean up any partial connections
    try {
      await rabbitmq.disconnect();
      await redisManager.disconnect();
      await databaseManager.disconnect();
    } catch (cleanupError) {
      logger.error('Error during cleanup', { error: cleanupError });
    }
    
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  
  try {
    delete (global as any).restartEmailConsumer;
    
    await rabbitmq.disconnect();
    await redisManager.disconnect();
    await databaseManager.disconnect();
    
    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error during graceful shutdown', { error: error.message });
    process.exit(1);
  }
}

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