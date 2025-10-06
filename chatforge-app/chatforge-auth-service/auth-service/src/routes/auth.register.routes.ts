import {Router} from 'express';
import { registerController } from '../controllers/auth.register.controller';
import { asyncHandler } from '../middleware/auth.errorHandler.middleware';
import { validateRequest } from '../middleware/auth.validation.middleware';
import { registerSchema, verifyOtpSchema } from '../middleware/auth.validation.middleware';
import { idempotencyMiddleware } from '../middleware/auth.idempotency.middleware';
import { loggerMiddleware } from '../middleware/auth.logger.middleware';

const router = Router();

const createRateLimiter = (windowMs: number, maxRequests: number, errorCode: string, errorMessage: string) => {
  return async (req: any, res: any, next: any) => {
    try {
      const identifier = req.ip || req.socket.remoteAddress || 'unknown';
      const key = `${identifier}:${req.path}`;
      const {redisManager} = require('../../config/auth.redis');

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

const registerRateLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  5, // 5 registration attempts per hour
  'REGISTRATION_RATE_LIMIT',
  'Too many registration attempts. Please try again later.'
);

const verifyEmailRateLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  10, // 10 verification attempts
  'VERIFICATION_RATE_LIMIT',
  'Too many verification attempts. Please try again later.'
);

router.post(
  '/register',
  loggerMiddleware,
  registerRateLimiter,
  validateRequest(registerSchema),
  idempotencyMiddleware,
  asyncHandler(registerController.register) 
);

// Verify email with OTP
router.post(
  '/verify-email',
  loggerMiddleware,
  verifyEmailRateLimiter,
  validateRequest(verifyOtpSchema),
  asyncHandler(registerController.verifyEmail)
);

export default router;