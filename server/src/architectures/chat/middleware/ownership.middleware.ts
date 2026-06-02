import { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import { env } from '../config/chat.env.config';
import { createLogger } from '../util/chat.logger.utils';

const logger = createLogger('ownership-middleware');

interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role?: string;
  };
}

/**
 * ========================================
 * OWNERSHIP MIDDLEWARE (HTTP-BASED)
 * ========================================
 * 
 * Verifies that the authenticated user owns the business.
 * 
 * Unlike the Business Service version (which queries DB directly),
 * Chat Service makes an HTTP call to Business Service API.
 * 
 * Flow:
 * 1. authMiddleware runs first (attaches req.user)
 * 2. Extract businessId from route params
 * 3. Call Business Service API with user's JWT token
 * 4. Business Service validates ownership with its own middleware
 * 5. If 200 OK → user owns business → proceed
 * 6. If 404/403 → deny access
 * 
 * Routes that need this:
 * - GET /api/chat/business/:businessId/sessions
 * - GET /api/chat/business/:businessId/leads
 * - GET /api/chat/business/:businessId/session/:sessionId
 */

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
        message: 'User must be authenticated to access this resource',
        code: 'NO_AUTH'
      });
      return;
    }

    // 2. EXTRACT BUSINESS ID FROM ROUTE
    const businessId = req.params.businessId;

    if (!businessId) {
      res.status(400).json({
        error: 'Invalid request',
        message: 'Business ID is required',
        code: 'MISSING_BUSINESS_ID'
      });
      return;
    }

    // 3. VALIDATE BUSINESS ID FORMAT (MongoDB ObjectId)
    if (!businessId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400).json({
        error: 'Invalid business ID',
        message: 'Business ID must be a valid MongoDB ObjectId',
        code: 'INVALID_BUSINESS_ID_FORMAT'
      });
      return;
    }

    // 4. VERIFY BUSINESS SERVICE URL IS CONFIGURED
    const businessServiceUrl = env.BUSINESS_SERVICE_URL;

    if (!businessServiceUrl) {
      logger.error('[Ownership] BUSINESS_SERVICE_URL not configured');
      res.status(500).json({
        error: 'Service configuration error',
        message: 'Business service connection not configured',
        code: 'SERVICE_CONFIG_ERROR'
      });
      return;
    }

    // 5. CALL BUSINESS SERVICE API TO VERIFY OWNERSHIP
    // Business Service will check if user owns this business
    const fullUrl = `${businessServiceUrl}/api/v1/businesses/${businessId}`;

    logger.info('[Ownership] Calling Business Service', {
      fullUrl,
      businessServiceUrl,
      businessId,
      userId: req.user.userId,
      authorization: req.headers.authorization ? 'present' : 'missing',
      authHeaderValue: req.headers.authorization?.substring(0, 20) + '...'
    });

    if (!req.headers.authorization) {
      logger.error('[Ownership] No authorization header in request!');
      res.status(401).json({
        error: 'Authentication required',
        message: 'Authorization header missing',
        code: 'NO_AUTH_HEADER'
      });
      return;
    }
    
    try {
      const response = await axios.get(
        fullUrl,
        {
          headers: {
            'Authorization': req.headers.authorization, // Pass JWT token
            'Content-Type': 'application/json'
          },
          timeout: 15000 
        }
      );

      // SUCCESS: Business Service returned 200 OK
      // This means:
      // 1. Business exists
      // 2. User's JWT is valid
      // 3. User owns this business (verified by Business Service's ownershipMiddleware)

      // Optional: Attach business info to request if needed
      if (response.data && response.data.data) {
        (req as any).businessInfo = {
          businessId: response.data.data._id,
          businessName: response.data.data.basicInfo?.businessName,
          isActive: response.data.data.isActive
        };
      }

      logger.info(`[Ownership] ✓ User ${req.user.userId} verified as owner of business ${businessId}`);

      // Proceed to controller
      next();

    } catch (error: any) {
      // Handle HTTP errors from Business Service

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const errorData = error.response?.data;

        // 404: Business not found OR user doesn't own it
        if (status === 404) {
          logger.warn('[Ownership] Business not found or access denied', {
            userId: req.user.userId,
            businessId,
            status
          });

          res.status(404).json({
            error: 'Business not found',
            message: 'The requested business does not exist or you do not have access to it',
            code: 'BUSINESS_NOT_FOUND'
          });
          return;
        }

        // 403: User doesn't own the business (or business is frozen)
        if (status === 403) {
          logger.warn('[Ownership] Access forbidden', {
            userId: req.user.userId,
            businessId,
            reason: errorData?.message
          });

          res.status(403).json({
            error: 'Access denied',
            message: errorData?.message || 'You do not have permission to access this business',
            code: 'ACCESS_DENIED'
          });
          return;
        }

        // 401: JWT token invalid/expired
        if (status === 401) {
          logger.warn('[Ownership] Authentication failed at Business Service', {
            userId: req.user.userId,
            businessId
          });

          res.status(401).json({
            error: 'Authentication failed',
            message: 'Your session has expired. Please log in again.',
            code: 'AUTH_FAILED'
          });
          return;
        }

        // Network timeout
        if (error.code === 'ECONNABORTED') {
          logger.error('[Ownership] Business Service request timeout', {
            businessId,
            timeout: 15000
          });

          res.status(504).json({
            error: 'Service timeout',
            message: 'Failed to verify business ownership - service timeout',
            code: 'SERVICE_TIMEOUT'
          });
          return;
        }

        // Network error (service down)
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
          logger.error('[Ownership] Business Service unavailable', {
            businessServiceUrl,
            error: error.code
          });

          res.status(503).json({
            error: 'Service unavailable',
            message: 'Business service is temporarily unavailable',
            code: 'SERVICE_UNAVAILABLE'
          });
          return;
        }

        // Other HTTP errors
        logger.error('[Ownership] Business Service returned error', {
          status,
          error: errorData
        });

        res.status(500).json({
          error: 'Ownership verification failed',
          message: 'Failed to verify business ownership',
          code: 'OWNERSHIP_CHECK_FAILED'
        });
        return;
      }

      // Non-Axios error
      throw error;
    }

  } catch (error: any) {
    // Unexpected errors
    logger.error('[Ownership] Middleware error:', {
      message: error.message,
      stack: error.stack,
      businessId: req.params.businessId,
      userId: req.user?.userId
    });

    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to verify business ownership',
      code: 'INTERNAL_ERROR'
    });
  }
};


export default ownershipMiddleware