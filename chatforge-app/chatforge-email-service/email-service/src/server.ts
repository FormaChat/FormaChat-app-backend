
// import app, { initializeServices } from './app';
// import { env } from './config/email.env';
// import { logger } from './utils/email.logger.utils';

// const PORT = env.PORT || 5002;

// async function startServer() {
//   try {
//     // Initialize all services (RabbitMQ, consumers)
//     await initializeServices();

//     // Start Express server
//     app.listen(PORT, () => {
//       logger.info(`🚀 Email Service listening on port ${PORT}`);
//       logger.info(`📍 Environment: ${env.NODE_ENV}`);
//     });
//   } catch (error: any) {
//     logger.error('❌ Failed to start server:', error);
//     process.exit(1);
//   }
// }

// startServer();