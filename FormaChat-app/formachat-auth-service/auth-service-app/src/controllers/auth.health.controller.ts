import { Request, Response } from 'express';
import { databaseManager } from '../config/auth.database';
import { redisManager } from '../config/auth.redis';
import { rabbitmq } from '../config/auth.rabbitmq';
import { createLogger } from '../utils/auth.logger.utils';

const logger = createLogger('health-controller');

export class HealthController {
  /**
   * Basic health check
   */
  async healthCheck(req: Request, res: Response) {
    try {
      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'auth-service',
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
      };

      res.json({
        success: true,
        data: health
      });

    } catch (error: any) {
      logger.error('Health check error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Service unhealthy'
      });
    }
  }

  /**
   * Detailed health check with dependencies
   */
  async healthDetailed(req: Request, res: Response) {
    try {
      // Check all dependencies in parallel
      const [dbHealth, redisHealth, rabbitHealth] = await Promise.all([
        databaseManager.healthCheck(),
        redisManager.healthCheck(),
        rabbitmq.healthCheck()
      ]);

      const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'auth-service',
        version: process.env.npm_package_version || '1.0.0',
        uptime: process.uptime(),
        dependencies: {
          database: dbHealth,
          redis: redisHealth,
          rabbitmq: rabbitHealth
        },
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV
      };

      // Determine overall status
      const allHealthy = dbHealth.status === 'healthy' && 
                        redisHealth.status === 'healthy' && 
                        rabbitHealth.status === 'healthy';
      
      health.status = allHealthy ? 'healthy' : 'degraded';

      const statusCode = allHealthy ? 200 : 503;

      res.status(statusCode).json({
        success: allHealthy,
        data: health
      });

    } catch (error: any) {
      logger.error('Detailed health check error:', error);
      
      res.status(503).json({
        success: false,
        error: 'Service unhealthy',
        data: {
          status: 'unhealthy',
          timestamp: new Date().toISOString(),
          error: error.message
        }
      });
    }
  }

  /**
   * Readiness check for Kubernetes/load balancers
   */
  async readinessCheck(req: Request, res: Response) {
    try {
      const [dbHealth, redisHealth] = await Promise.all([
        databaseManager.healthCheck(),
        redisManager.healthCheck()
      ]);

      const isReady = dbHealth.status === 'healthy' && redisHealth.status === 'healthy';

      if (isReady) {
        res.json({
          success: true,
          status: 'ready',
          timestamp: new Date().toISOString()
        });
      } else {
        res.status(503).json({
          success: false,
          status: 'not_ready',
          timestamp: new Date().toISOString(),
          dependencies: {
            database: dbHealth.status,
            redis: redisHealth.status
          }
        });
      }

    } catch (error: any) {
      logger.error('Readiness check error:', error);
      
      res.status(503).json({
        success: false,
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        error: error.message
      });
    }
  }

  /**
   * Liveness check for Kubernetes
   */
  async livenessCheck(req: Request, res: Response) {
    try {
      // Simple check - if we can respond, we're alive
      res.json({
        success: true,
        status: 'alive',
        timestamp: new Date().toISOString()
      });

    } catch (error: any) {
      logger.error('Liveness check error:', error);
      
      res.status(503).json({
        success: false,
        status: 'dead',
        timestamp: new Date().toISOString()
      });
    }
  }
}

export const healthController = new HealthController();