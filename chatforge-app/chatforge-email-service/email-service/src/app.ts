// // app.ts

// import express, { Express, Request, Response, NextFunction } from 'express';
// import cors from 'cors';
// import helmet from 'helmet';
// import { connectRabbitMQ } from './config/email.rabbitmq';
// import { startAuthEmailConsumer } from './events/consumers/auth.email.consumer';
// import { logger } from './utils/email.logger.utils';
// import healthRoutes from './api/routes/health.routes';

// const app: Express = express();

// // ==================== MIDDLEWARE ====================

// // Security middleware
// app.use(helmet());

// // CORS configuration
// app.use(cors({
//   origin: process.env.ALLOWED_ORIGINS?.split(',') || '*',
//   credentials: true
// }));

// // Body parsing middleware
// app.use(express.json({ limit: '10mb' }));
// app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// // Request logging middleware
// app.use((req: Request, res: Response, next: NextFunction) => {
//   logger.info('Incoming request', {
//     method: req.method,
//     path: req.path,
//     ip: req.ip
//   });
//   next();
// });

// // ==================== ROUTES ====================

// // Health check routes
// app.use('/health', healthRoutes);

// // Root endpoint
// app.get('/', (req: Request, res: Response) => {
//   res.json({
//     service: 'Email Service',
//     status: 'running',
//     version: '1.0.0',
//     timestamp: new Date().toISOString()
//   });
// });

// // 404 handler
// app.use((req: Request, res: Response) => {
//   res.status(404).json({
//     success: false,
//     error: 'Route not found',
//     path: req.path
//   });
// });

// // Global error handler
// app.use((error: any, req: Request, res: Response, next: NextFunction) => {
//   logger.error('Global error handler:', {
//     error: error.message,
//     stack: error.stack,
//     path: req.path
//   });

//   res.status(error.status || 500).json({
//     success: false,
//     error: error.message || 'Internal server error'
//   });
// });

// // ==================== INITIALIZATION ====================

// /**
//  * Initialize all services (RabbitMQ, consumers, etc.)
//  */
// export async function initializeServices(): Promise<void> {
//   try {
//     logger.info('🚀 Initializing Email Service...');

//     // 1. Connect to RabbitMQ
//     logger.info('📡 Connecting to RabbitMQ...');
//     await connectRabbitMQ();
//     logger.info('✅ RabbitMQ connected');

//     // 2. Start all consumers
//     logger.info('👂 Starting message consumers...');
//     await startAuthEmailConsumer();
//     logger.info('✅ All consumers started');

//     logger.info('🎉 Email Service initialized successfully');
//   } catch (error: any) {
//     logger.error('❌ Failed to initialize Email Service:', error);
//     throw error;
//   }
// }

// // ==================== GRACEFUL SHUTDOWN ====================

// /**
//  * Graceful shutdown handler
//  */
// async function gracefulShutdown(signal: string): Promise<void> {
//   logger.info(`${signal} received. Starting graceful shutdown...`);

//   try {
//     // Close RabbitMQ connection
//     const { disconnectRabbitMQ } = require('./config/email.rabbitmq');
//     await disconnectRabbitMQ();
//     logger.info('✅ RabbitMQ disconnected');

//     logger.info('✅ Graceful shutdown completed');
//     process.exit(0);
//   } catch (error: any) {
//     logger.error('❌ Error during graceful shutdown:', error);
//     process.exit(1);
//   }
// }

// // Register shutdown handlers
// process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
// process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// // Uncaught exception handler
// process.on('uncaughtException', (error: Error) => {
//   logger.error('💥 Uncaught Exception:', {
//     error: error.message,
//     stack: error.stack
//   });
//   process.exit(1);
// });

// // Unhandled rejection handler
// process.on('unhandledRejection', (reason: any) => {
//   logger.error('💥 Unhandled Rejection:', {
//     reason: reason?.message || reason
//   });
//   process.exit(1);
// });

// export default app;