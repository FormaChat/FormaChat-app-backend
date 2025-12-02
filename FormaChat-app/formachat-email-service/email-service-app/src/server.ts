import app from './app';
import { connectRabbitMQ } from './config/email.rabbitmq';
import { logger } from './utils/email.logger.utils';
import { startAuthEmailConsumer } from './events/consumers/auth.email.consumer';


const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    logger.info('📧 Starting Email Service...');

    // Step 1: Connect to RabbitMQ (only dependency needed)
    logger.info('🔗 Connecting to RabbitMQ...');
    await connectRabbitMQ();

    // Step 2: Start consuming messages from auth service
    logger.info('📨 Starting email consumers...');
    await startAuthEmailConsumer();

    // Step 3: Start Express server (mostly for health checks)
    logger.info('🌐 Starting Express server...');
    app.listen(PORT, () => {
      logger.info(`✅ Email service running on port ${PORT}`, {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString()
      });
    });

  } catch (error: any) {
    logger.error('❌ Failed to start email service', { 
      error: error.message,
      stack: error.stack 
    });
    process.exit(1);
  }
}

// Graceful shutdown
async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}, shutting down email service gracefully...`);
  
  try {
    // RabbitMQ will handle consumer cleanup automatically
    // Just disconnect from services
    const { disconnectRabbitMQ } = require('./config/email.rabbitmq');
    await disconnectRabbitMQ();
    
    logger.info('✅ Email service shutdown completed');
    process.exit(0);
  } catch (error: any) {
    logger.error('❌ Error during email service shutdown', { error: error.message });
    process.exit(1);
  }
}

// Signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Error handlers
process.on('uncaughtException', (error) => {
  logger.error('🆘 Uncaught Exception in email service', { 
    error: error.message, 
    stack: error.stack 
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('🆘 Unhandled Promise Rejection in email service', { reason, promise });
  process.exit(1);
});

startServer();