// src/routes/email.health.routes.ts
import { Router } from 'express';
import { getRabbitMQHealth } from '../../config/email.rabbitmq';
import { logger } from '../../utils/email.logger.utils';

const router:Router = Router();

/**
 * Health check endpoint
 * Useful for load balancers and monitoring
 */
router.get('/health', async (req, res) => {
  try {
    const rabbitHealth = await getRabbitMQHealth();

    const health = {
      status: 'OK',
      service: 'email-service',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      rabbitMQ: rabbitHealth.status,
      details: {
        rabbitMQ: rabbitHealth.details
      }
    };

    // If RabbitMQ is unhealthy, return 503
    if (rabbitHealth.status !== 'healthy') {
      return res.status(503).json({
        ...health,
        status: 'SERVICE_UNAVAILABLE',
        message: 'RabbitMQ connection issues'
      });
    }

    res.status(200).json(health);
  } catch (error: any) {
    logger.error('Health check failed', { error: error.message });
    
    res.status(503).json({
      status: 'ERROR',
      service: 'email-service',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * Simple readiness probe
 */
router.get('/ready', (req, res) => {
  res.status(200).json({
    status: 'READY',
    service: 'email-service',
    timestamp: new Date().toISOString()
  });
});

/**
 * Simple liveness probe
 */
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'ALIVE',
    service: 'email-service',
    timestamp: new Date().toISOString()
  });
});

export default router;