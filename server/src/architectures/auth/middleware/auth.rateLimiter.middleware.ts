import { Request, Response, NextFunction } from 'express';
import { redisManager } from '../config/auth.redis';
import { createLogger } from '../utils/auth.logger.utils';

const logger = createLogger('auth-rate-limiter-middleware');

const createRateLimiter = (windowMs: number, maxRequests: number, errorCode: string, errorMessage: string) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Use IP or user identifier
      const identifier = req.ip || req.socket.remoteAddress || 'unknown';
      const key = `${identifier}:${req.path}`;

      const result = await redisManager.checkRateLimit(key, windowMs, maxRequests);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', result.remaining.toString());
      res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());

      if (!result.allowed) {
        return res.status(429).json({
          success: false,
          error: {
            code: errorCode,
            message: errorMessage
          }
        });
      }

      next();
    } catch (error:any) {
      // If Redis fails, allow the request but log the error
      logger.error('Rate limit check failed:', error);
      next();
    }
  };
};

export const authRateLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5,
  'RATE_LIMIT_EXCEEDED',
  'Too many authentication attempts, please try again later.'
);

export const strictAuthRateLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  10,
  'STRICT_RATE_LIMIT_EXCEEDED',
  'Too many attempts for this operation.'
);