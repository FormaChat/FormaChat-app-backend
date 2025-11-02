import { Router } from 'express';
import { adminMiddleware } from '../middleware/admin.middleware';
import * as adminBusinessController from '../controllers/admin.controllers';

/**
 * Routes Overview:
 * - GET    /admin/businesses              → List all businesses (paginated)
 * - GET    /admin/businesses/:id          → Get single business details
 * - PATCH  /admin/businesses/:id/status   → Freeze/unfreeze business
 * - GET    /admin/analytics               → Platform statistics
 * - GET    /admin/frozen-businesses       → List frozen businesses
 */

const router = Router();


router.get(
  '/businesses',
  adminMiddleware,
  adminBusinessController.getAllBusinesses
);

router.get(
  '/businesses/:id',
  adminMiddleware,
  adminBusinessController.getBusinessById
);

/**
 * Request Body (Freeze):
 * {
 *   isActive: false,
 *   reason: "payment_failed",
 *   adminNote: "Customer payment declined for 3rd time"
 * }
 * 
 * Request Body (Unfreeze):
 * {
 *   isActive: true
 * }
 * 
 * Valid Reasons:
 * - trial_expired
 * - payment_failed
 * - admin_action
 * - subscription_canceled
 * - user_requested
 * 
 * Example Request:
 * PATCH /admin/businesses/507f1f77bcf86cd799439011/status
 * Body: { isActive: false, reason: "payment_failed", adminNote: "..." }
 * 
*/

router.patch(
  '/businesses/:id/status',
  adminMiddleware,
  adminBusinessController.setBusinessStatus
);

router.get(
  '/analytics',
  adminMiddleware,
  adminBusinessController.getPlatformStats
);

router.get(
  '/frozen-businesses',
  adminMiddleware,
  adminBusinessController.getFrozenBusinesses
);

export default router;