import { Router } from 'express';
import { loginController } from '../controllers/auth.login.controller';
import { asyncHandler } from '../middleware/auth.errorHandler.middleware';
import { validateRequest } from '../middleware/auth.validation.middleware';
import { loginSchema, refreshTokenSchema, verifyTwoFactorLoginSchema, requestMagicLinkSchema, verifyMagicLinkSchema } from '../middleware/auth.validation.middleware';
import { jwtMiddleware } from '../middleware/auth.jwt.middleware';
import { idempotencyMiddleware } from '../middleware/auth.idempotency.middleware';
import { loggerMiddleware } from '../middleware/auth.logger.middleware';
import { redisManager } from '../config/auth.redis';
import { createLogger } from '../utils/auth.logger.utils';

const logger = createLogger('auth-login-routes');

const router:Router = Router();

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
    } catch (error:any) {
      logger.error('Rate limit check failed:', error);
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

const twoFactorVerifyRateLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  10, // 10 code attempts per 15 minutes (prevents brute force)
  'TWO_FACTOR_VERIFY_RATE_LIMIT',
  'Too many verification attempts. Please try again later.'
);

// User login
router.post(
  '/login',
  loggerMiddleware,
  loginRateLimiter,
  validateRequest(loginSchema),
  asyncHandler(loginController.login)
);

// Complete login after 2FA OTP verification
router.post(
  '/login/2fa/verify',
  loggerMiddleware,
  twoFactorVerifyRateLimiter,
  validateRequest(verifyTwoFactorLoginSchema),
  asyncHandler(loginController.verifyTwoFactorLogin)
);

const magicLinkRequestRateLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  3, // 3 magic link requests per hour
  'MAGIC_LINK_REQUEST_RATE_LIMIT',
  'Too many sign-in link requests. Please try again later.'
);

const magicLinkVerifyRateLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  10, // 10 verify attempts per 15 minutes
  'MAGIC_LINK_VERIFY_RATE_LIMIT',
  'Too many attempts. Please try again later.'
);

// Request a magic sign-in link
router.post(
  '/magic-link/request',
  loggerMiddleware,
  magicLinkRequestRateLimiter,
  validateRequest(requestMagicLinkSchema),
  asyncHandler(loginController.requestMagicLink)
);

// Verify a magic sign-in link and complete login
router.post(
  '/magic-link/verify',
  loggerMiddleware,
  magicLinkVerifyRateLimiter,
  validateRequest(verifyMagicLinkSchema),
  asyncHandler(loginController.verifyMagicLink)
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