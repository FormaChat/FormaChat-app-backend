import { Router } from 'express';
import { tokenController } from '../controllers/auth.token.controller';
import { asyncHandler } from '../middleware/auth.errorHandler.middleware';
import { validateRequest } from '../middleware/auth.validation.middleware';
import { refreshTokenSchema } from '../middleware/auth.validation.middleware';
import { jwtMiddleware } from '../middleware/auth.jwt.middleware';
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

const tokenRefreshRateLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  10, // 10 refresh attempts per 15 minutes
  'TOKEN_REFRESH_RATE_LIMIT',
  'Too many token refresh attempts. Please login again.'
);

// Refresh access token
router.post(
  '/token/refresh',
  loggerMiddleware,
  tokenRefreshRateLimiter,
  validateRequest(refreshTokenSchema),
  asyncHandler(tokenController.refreshToken)
);

// Validate token (for other microservices)
router.post(
  '/token/validate',
  loggerMiddleware,
  asyncHandler(tokenController.validateToken)
);

// Revoke other sessions (future multi-device support)
router.post(
  '/token/revoke-others',
  loggerMiddleware,
  jwtMiddleware,
  validateRequest(refreshTokenSchema),
  asyncHandler(tokenController.revokeOtherSessions)
);

// NOTE: POST /token/revoke has been removed - use POST /logout instead
// (it was duplicating the logout functionality)

export default router;