import { Router } from 'express';
import { passwordController } from '../controllers/auth.password.controller';
import { asyncHandler } from '../middleware/auth.errorHandler.middleware';
import { validateRequest } from '../middleware/auth.validation.middleware';
import { 
  changePasswordSchema, 
  resetPasswordSchema, 
  requestPasswordResetSchema,
  validatePasswordSchema 
} from '../middleware/auth.validation.middleware';
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

const passwordResetRateLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  3, // 3 password reset requests per hour
  'PASSWORD_RESET_RATE_LIMIT',
  'Too many password reset requests. Please try again later.'
);

// Change password (authenticated users)
router.post(
  '/password/change',
  loggerMiddleware,
  jwtMiddleware,
  validateRequest(changePasswordSchema),
  idempotencyMiddleware,
  asyncHandler(passwordController.changePassword)
);

// Request password reset (public - sends OTP)
router.post(
  '/password/reset',
  loggerMiddleware,
  passwordResetRateLimiter,
  validateRequest(requestPasswordResetSchema),
  asyncHandler(passwordController.resetPassword)
);

// Confirm password reset with OTP
router.post(
  '/password/reset/confirm',
  loggerMiddleware,
  validateRequest(resetPasswordSchema),
  idempotencyMiddleware,
  asyncHandler(passwordController.confirmReset)
);

// Validate password strength (public - for client-side feedback)
router.post(
  '/password/validate',
  loggerMiddleware,
  validateRequest(validatePasswordSchema),
  asyncHandler(passwordController.validatePassword)
);

export default router;