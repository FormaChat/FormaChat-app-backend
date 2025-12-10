import app from './app';
import { databaseManager } from './config/auth.database';
import { redisManager } from './config/auth.redis';
import { rabbitmq } from './config/auth.rabbitmq';
import { logger } from './utils/auth.logger.utils';
import { startEmailResponseConsumer } from './events/consumers/auth.emailResponse.consumer'; 

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    logger.info('Starting Auth Service...');

    // Step 1: Connect to dependencies (database, cache, message broker)
    logger.info('Connecting to dependencies...');
    await databaseManager.connect();
    await redisManager.connect();
    await rabbitmq.connect();

    // Step 2: Start consuming email responses from email service
    logger.info('Starting email response consumer...');
    await startEmailResponseConsumer();

    // Step 3: Start Express server
    logger.info('Starting Express server...');
    app.listen(PORT, () => {
      logger.info(`Auth service running on port ${PORT}`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
      });
    });

  } catch (error: any) {
    logger.error('Failed to start server', { 
      error: error.message,
      stack: error.stack 
    });
    process.exit(1);
  }
}

// Graceful shutdown handling
async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}, starting graceful shutdown...`);
  
  try {
    // Add your consumer cleanup here if you implement stopEmailResponseConsumer
    // await stopEmailResponseConsumer();
    
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

// Register signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', { reason, promise });
  process.exit(1);
});

startServer();