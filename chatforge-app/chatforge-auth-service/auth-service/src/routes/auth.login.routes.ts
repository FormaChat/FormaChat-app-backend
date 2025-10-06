import { Router } from 'express';
import { loginController } from '../controllers/auth.login.controller';
import { asyncHandler } from '../middleware/auth.errorHandler.middleware';
import { validateRequest } from '../middleware/auth.validation.middleware';
import { loginSchema, refreshTokenSchema } from '../middleware/auth.validation.middleware';
import { jwtMiddleware } from '../middleware/auth.jwt.middleware';
import { idempotencyMiddleware } from '../middleware/auth.idempotency.middleware';
import { loggerMiddleware } from '../middleware/auth.logger.middleware';
import { redisManager } from '../config/auth.redis';

const router = Router();

// Rate limiter
const createRateLimiter = (windowMs: number, maxRequests: number, errorCode: string, errorMessage: string) => {
  return async (req: any, res: any, next: any) => {
    try {
      const identifier = req.ip || req.socket.remoteAddress || 'unknown';
      const key = `${identifier}:${req.path}`;

      const result = await redisManager.checkRateLimit(key, windowMs, maxRequests);

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
    } catch (error) {
      console.error('Rate limit check failed:', error);
      next();
    }
  };
};

const loginRateLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  5, // 5 login attempts per 15 minutes
  'LOGIN_RATE_LIMIT',
  'Too many login attempts. Please try again later.'
);

// User login
router.post(
  '/login',
  loggerMiddleware,
  loginRateLimiter,
  validateRequest(loginSchema),
  asyncHandler(loginController.login)
);

// User logout
router.post(
  '/logout',
  loggerMiddleware,
  jwtMiddleware,
  validateRequest(refreshTokenSchema),
  asyncHandler(loginController.logout)
);

// Check authentication status
router.get(
  '/me',
  loggerMiddleware,
  jwtMiddleware,
  asyncHandler(loginController.checkAuth)
);

export default router;