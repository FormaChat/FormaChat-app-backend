import app from './app';
import { databaseManager } from './config/business.database';
import { createLogger } from './utils/business.logger.utils';

const logger = createLogger("server");

const PORT = process.env.PORT;

async function startServer() {
  try {
    logger.info('Starting Business Profile Service...');

    logger.info('Connecting to dependencies...');
    await databaseManager.connect();

    logger.info('Starting Express server...');
    app.listen(PORT, () => {
      logger.info(`Business Profile Service is running on ${PORT}`, {
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

async function gracefulShutdown(signal: string) {
  logger.info(`Recieved ${signal}, starting graceful shutdown...`);
  
  try {
    await databaseManager.disconnect();

    logger.info('Graceful shutdown completed...');
    process.exit(0);
  } catch (error: any) {
    logger.error('Error during graceful shutdown', {error: error.message});
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exeption', {error: error.message, stack: error.stack});
  process.exit(1);
});

startServer();

