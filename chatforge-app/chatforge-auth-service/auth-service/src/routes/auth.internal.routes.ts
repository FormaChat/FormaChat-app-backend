import { Router } from 'express';
import { otpController } from '../controllers/auth.otp.controller';
import { adminController } from '../controllers/auth.admin.controller';
import { asyncHandler } from '../middleware/auth.errorHandler.middleware';
import { internalAuthMiddleware } from '../middleware/auth.internalAuth.middleware';
import { loggerMiddleware } from '../middleware/auth.logger.middleware';

const router = Router();

// All internal routes require service token authentication
// These should ONLY be accessible by other microservices, not public

// Get OTP for email service
router.get(
  '/internal/otp/:otpId',
  loggerMiddleware,
  internalAuthMiddleware,
  asyncHandler(otpController.getOTPInternal)
);

// Get user details (for admin service)
router.get(
  '/internal/users/:userId',
  loggerMiddleware,
  internalAuthMiddleware,
  asyncHandler(adminController.getUserDetailsInternal)
);

// Get audit logs (for admin service)
router.get(
  '/internal/audit-logs',
  loggerMiddleware,
  internalAuthMiddleware,
  asyncHandler(adminController.getAuditLogsInternal)
);

// Lock user account (for admin service)
router.post(
  '/internal/users/:userId/lock',
  loggerMiddleware,
  internalAuthMiddleware,
  asyncHandler(adminController.lockUserInternal)
);

export default router;