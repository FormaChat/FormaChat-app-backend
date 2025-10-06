import { Router } from 'express';
import { otpController } from '../controllers/auth.otp.controller';
import { asyncHandler } from '../middleware/auth.errorHandler.middleware';
import { validateRequest } from '../middleware/auth.validation.middleware';
import { generateOTPSchema, verifyOtpSchema, resendOTPSchema } from '../middleware/auth.validation.middleware';
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

// Strict rate limiting for OTP operations
const otpGenerateRateLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  3, // Only 3 OTP generation requests per hour
  'OTP_GENERATE_RATE_LIMIT',
  'Too many OTP requests. Please try again later.'
);

const otpVerifyRateLimiter = createRateLimiter(
  15 * 60 * 1000, // 15 minutes
  10, // 10 verification attempts (prevents brute force)
  'OTP_VERIFY_RATE_LIMIT',
  'Too many verification attempts. Please try again later.'
);

const otpResendRateLimiter = createRateLimiter(
  60 * 60 * 1000, // 1 hour
  2, // Only 2 resend requests per hour (very strict)
  'OTP_RESEND_RATE_LIMIT',
  'Too many resend requests. Please wait before requesting again.'
);

// Generate OTP
router.post(
  '/otp/generate',
  loggerMiddleware,
  otpGenerateRateLimiter,
  validateRequest(generateOTPSchema),
  asyncHandler(otpController.generateOTP)
);

// Verify OTP
router.post(
  '/otp/verify',
  loggerMiddleware,
  otpVerifyRateLimiter,
  validateRequest(verifyOtpSchema),
  asyncHandler(otpController.verifyOTP)
);

// Resend OTP
router.post(
  '/otp/resend',
  loggerMiddleware,
  otpResendRateLimiter,
  validateRequest(resendOTPSchema),
  asyncHandler(otpController.resendOTP)
);

export default router;