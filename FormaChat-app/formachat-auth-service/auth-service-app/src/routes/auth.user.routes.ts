import { Router } from 'express';
import { userController } from '../controllers/auth.user.controller';
import { asyncHandler } from '../middleware/auth.errorHandler.middleware';
import { validateRequest, submitFeedbackSchema } from '../middleware/auth.validation.middleware';
import { updateProfileSchema, deleteAccountSchema } from '../middleware/auth.validation.middleware';
import { jwtMiddleware } from '../middleware/auth.jwt.middleware';
import { idempotencyMiddleware } from '../middleware/auth.idempotency.middleware';
import { loggerMiddleware } from '../middleware/auth.logger.middleware';

const router:Router = Router();

// Get user profile
router.get(
  '/profile',
  loggerMiddleware,
  jwtMiddleware,
  asyncHandler(userController.getProfile)
);

// Update user profile
router.put(
  '/profile',
  loggerMiddleware,
  jwtMiddleware,
  validateRequest(updateProfileSchema),
  idempotencyMiddleware,
  asyncHandler(userController.updateProfile)
);

// Deactivate account (soft delete with password confirmation)
router.delete(
  '/profile',
  loggerMiddleware,
  jwtMiddleware,
  validateRequest(deleteAccountSchema),
  asyncHandler(userController.deactivateAccount)
);

// Get active sessions
router.get(
  '/sessions',
  loggerMiddleware,
  jwtMiddleware,
  asyncHandler(userController.getSessions)
);

router.post(
  '/feedback',
  loggerMiddleware,
  jwtMiddleware,
  validateRequest(submitFeedbackSchema),
  asyncHandler(userController.submitFeedback)
);

export default router;