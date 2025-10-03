
import app from './app';
import { databaseManager } from './config/auth.database';
import { redisManager } from './config/auth.redis';
import { rabbitmq } from './config/auth.rabbitmq';
import { logger } from './utils/auth.logger.utils';


const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Connect all services
    await databaseManager.connect();
    await redisManager.connect();
    await rabbitmq.connect();

    // Start Express server
    app.listen(PORT, () => {
      logger.info(`🚀 Auth service running on port ${PORT}`);
    });
  } catch (error: any) {
    logger.error('Failed to start server', { error: error.message });
    process.exit(1);
  }
}

startServer();





