import { Request, Response, NextFunction } from 'express';
import Business from '../models/business.model';
import { createLogger } from '../utils/business.logger.utils';

const logger = createLogger('ownership-middleware');

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role?: string;
  };
}


export const ownershipMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // 1. VERIFY PREREQUISITES
    // Check if authMiddleware ran first
    if (!req.user || !req.user.userId) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'User must be authenticated to access this resource'
      });
      return;
    }

    // 2. EXTRACT BUSINESS ID FROM ROUTE
    const businessId = req.params.id;

    if (!businessId) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'Business ID is required'
      });
      return;
    }

    // 3. VALIDATE BUSINESS ID FORMAT
    // Check if it's a valid MongoDB ObjectId format

    if (!businessId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400).json({
        error: 'Invalid business ID',
        message: 'Business ID must be a valid MongoDB ObjectId'
      });
      return;
    }

    // 4. CHECK BUSINESS EXISTS AND USER OWNS IT
    const business = await Business.findOne({
      _id: businessId,
      userId: req.user.userId
    }).select('_id userId basicInfo.businessName');

    // Business not found OR doesn't belong to user
    if (!business) {
      // Intentionally vague error message (security best practice)
      // Don't reveal if business exists but belongs to someone else
      res.status(404).json({
        error: 'Business not found',
        message: 'The requested business does not exist or you do not have access to it'
      });
      return;
    }

    // 5. SUCCESS - ATTACH BUSINESS TO REQUEST
    // Controllers can use req.business to avoid re-fetching
    (req as any).business = business;

    logger.info(`[Ownership] ✓ User ${req.user.userId} verified as owner of business ${businessId}`);

    // Proceed to controller
    next();

  } catch (error: any) {
    logger.error('[Ownership] Middleware error:', error.message);
    
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to verify business ownership'
    });
  }
};

/**
 * ========================================
 * OPTIONAL: OWNERSHIP CHECK WITH FROZEN STATUS
 * ========================================
 * 
 * Alternative middleware that also checks if business is active.
 * Use this if you want to block modifications to frozen businesses.
 * 
 * Example:
 * router.put('/businesses/:id', authMiddleware, ownershipWithActiveCheck, updateBusiness);
*/

export const ownershipWithActiveCheck = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Run standard ownership check first
    if (!req.user || !req.user.userId) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'User must be authenticated to access this resource'
      });
      return;
    }

    const businessId = req.params.id;

    if (!businessId) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'Business ID is required'
      });
      return;
    }

    if (!businessId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400).json({
        error: 'Invalid business ID',
        message: 'Business ID must be a valid MongoDB ObjectId'
      });
      return;
    }

    // Fetch business with isActive and freezeInfo
    const business = await Business.findOne({
      _id: businessId,
      userId: req.user.userId
    }).select('_id userId isActive freezeInfo basicInfo.businessName');

    if (!business) {
      res.status(404).json({
        error: 'Business not found',
        message: 'The requested business does not exist or you do not have access to it'
      });
      return;
    }

    // CHECK IF BUSINESS IS FROZEN
    if (!business.isActive || business.freezeInfo?.isFrozen) {
      const reason = business.freezeInfo?.reason || 'unknown';
      const friendlyReason = reason.replace(/_/g, ' ');

      res.status(403).json({
        error: 'Business is frozen',
        message: `This business is currently frozen due to: ${friendlyReason}`,
        freezeInfo: {
          reason: business.freezeInfo?.reason,
          frozenAt: business.freezeInfo?.frozenAt,
          isFrozen: true
        }
      });
      return;
    }

    // Attach business to request
    (req as any).business = business;

    logger.info(`[Ownership] ✓ User ${req.user.userId} verified as owner of active business ${businessId}`);

    next();

  } catch (error: any) {
    logger.error('[Ownership] Middleware error:', error.message);
    
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to verify business ownership'
    });
  }
};

/**
 * ========================================
 * OPTIONAL: BULK OWNERSHIP CHECK
 * ========================================
 * 
 * For endpoints that accept multiple business IDs.
 * Verifies user owns ALL businesses in the request.
 * 
 * Usage:
 * POST /businesses/bulk-delete
 * Body: { businessIds: ['id1', 'id2', 'id3'] }
 * 
 * Example:
 * router.post('/businesses/bulk-delete', authMiddleware, bulkOwnershipMiddleware, bulkDeleteBusinesses);
*/

export const bulkOwnershipMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!req.user || !req.user.userId) {
      res.status(401).json({
        error: 'Authentication required',
        message: 'User must be authenticated to access this resource'
      });
      return;
    }

    // Extract business IDs from request body
    const businessIds = req.body.businessIds;

    if (!businessIds || !Array.isArray(businessIds) || businessIds.length === 0) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'businessIds array is required and must not be empty'
      });
      return;
    }

    // Validate all IDs are valid MongoDB ObjectIds
    const invalidIds = businessIds.filter(id => !id.match(/^[0-9a-fA-F]{24}$/));
    if (invalidIds.length > 0) {
      res.status(400).json({
        error: 'Invalid business IDs',
        message: 'One or more business IDs are not valid MongoDB ObjectIds',
        invalidIds
      });
      return;
    }

    // Find all businesses that match the IDs AND belong to user
    const businesses = await Business.find({
      _id: { $in: businessIds },
      userId: req.user.userId
    }).select('_id');

    // Check if all requested businesses were found
    if (businesses.length !== businessIds.length) {
      res.status(404).json({
        error: 'Business not found',
        message: 'One or more businesses do not exist or you do not have access to them',
        requested: businessIds.length,
        found: businesses.length
      });
      return;
    }

    // Attach businesses to request
    (req as any).businesses = businesses;

    logger.info(`[Ownership] ✓ User ${req.user.userId} verified as owner of ${businesses.length} businesses`);

    next();

  } catch (error: any) {
    logger.error('[Ownership] Bulk middleware error:', error.message);
    
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to verify business ownership'
    });
  }
};

/**
 * ========================================
 * USAGE EXAMPLES
 * ========================================
 * 
 * // Standard ownership check (most common)
 * router.get('/businesses/:id', authMiddleware, ownershipMiddleware, getBusinessDetails);
 * router.put('/businesses/:id', authMiddleware, ownershipMiddleware, updateBusiness);
 * router.delete('/businesses/:id', authMiddleware, ownershipMiddleware, deleteBusiness);
 * 
 * // Ownership check with frozen status validation
 * router.put('/businesses/:id', authMiddleware, ownershipWithActiveCheck, updateBusiness);
 * // This blocks updates to frozen businesses
 * 
 * // Bulk operations
 * router.post('/businesses/bulk-delete', authMiddleware, bulkOwnershipMiddleware, bulkDeleteBusinesses);
 * 
 * // In controller, access pre-fetched business:
 * const business = req.business; // Already loaded by middleware
*/

export default ownershipMiddleware;