import { Request, Response } from 'express';
import { businessService } from '../services/business.service';

/**
 * ========================================
 * BUSINESS CONTROLLER (USER ROUTES)
 * ========================================
 * 
 * Handles authenticated user operations on their own businesses.
 * 
 * Purpose:
 * - CRUD operations for user's businesses
 * - Ownership enforcement (users can only access their own businesses)
 * - Triggers vector service operations automatically
 * 
 * Authentication:
 * - authMiddleware (JWT - provides req.user)
 * - ownershipMiddleware (for :id routes - verifies user owns the business)
 * 
 * Endpoints:
 * - POST /businesses → createBusiness
 * - GET /businesses → getUserBusinesses
 * - GET /businesses/:id → getBusinessDetails
 * - PUT /businesses/:id → updateBusiness
 * - DELETE /businesses/:id → deleteBusiness
*/




/**
 * ========================================
 * CREATE BUSINESS
 * ========================================
 * 
 * Creates a new business for the authenticated user.
 * Automatically triggers vector service to create embeddings.
 * 
 * Route: POST /businesses
 * Middleware: authMiddleware
 * 
 * Request Body:
 * {
 *   basicInfo: { businessName, businessDescription, ... },
 *   productsServices: { offerings, popularItems, ... },
 *   customerSupport: { faqs, policies, chatbotTone, ... },
 *   contactEscalation: { contactMethods, escalationContact, ... }
 * }
 * 
 * Success Response (201):
 * {
 *   success: true,
 *   data: { ...business document }
 * }
*/

export const createBusiness = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId  = req.user?.userId;
    const userEmail = req.user?.email;
    const businessData = req.body;

    
    // 1. VALIDATE REQUIRED FIELDS
    if (!businessData.basicInfo || !businessData.basicInfo.businessName) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Business name is required'
        }
      });
      return;
    }

    // 2. CREATE BUSINESS (service handles vector update)
    const business = await businessService.createBusiness(
      userId!,
      userEmail!,
      businessData
    );

    // 3. RETURN SUCCESS RESPONSE
    res.status(201).json({
      success: true,
      data: business
    });

    console.log(`[Business] ✓ Business created: ${business._id} by user: ${userId}`);

  } catch (error: any) {
    console.error('[Business] Create business error:', error.message);

    res.status(400).json({
      success: false,
      error: {
        code: 'BUSINESS_CREATION_FAILED',
        message: error.message || 'Failed to create business'
      }
    });
  }
};

/**
 * ========================================
 * GET USER BUSINESSES
 * ========================================
 * 
 * Returns all businesses owned by the authenticated user (paginated).
 * 
 * Route: GET /businesses?page=1&limit=10
 * Middleware: authMiddleware
 * 
 * Query Parameters:
 * - page: number (default: 1)
 * - limit: number (default: 10)
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: {
 *     businesses: [...],
 *     pagination: {
 *       page: 1,
 *       limit: 10,
 *       total: 25,
 *       pages: 3
 *     }
 *   }
 * }
*/

export const getUserBusinesses = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const userId = req.user?.userId;
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;

    // 1. VALIDATE PAGINATION PARAMETERS
    if (page < 1 || limit < 1 || limit > 100) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PAGINATION',
          message: 'Page must be >= 1 and limit must be between 1 and 100'
        }
      });
      return;
    }

    // 2. GET USER'S BUSINESSES (filtered by userId)
    const result = await businessService.getUserBusinesses(userId!, page, limit);

    // 3. RETURN SUCCESS RESPONSE
    res.status(200).json({
      success: true,
      data: result
    });

    console.log(`[Business] ✓ Retrieved ${result.businesses.length} businesses for user: ${userId}`);

  } catch (error: any) {
    console.error('[Business] Get user businesses error:', error.message);

    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_BUSINESSES_FAILED',
        message: 'Failed to retrieve businesses'
      }
    });
  }
};

/**
 * ========================================
 * GET BUSINESS DETAILS
 * ========================================
 * 
 * Returns full details of a specific business owned by the user.
 * 
 * Route: GET /businesses/:id
 * Middleware: authMiddleware, ownershipMiddleware
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: { ...full business document }
 * }
 * 
 * Not Found Response (404):
 * {
 *   success: false,
 *   error: {
 *     code: 'BUSINESS_NOT_FOUND',
 *     message: 'Business not found or access denied'
 *   }
 * }
*/

export const getBusinessDetails = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id: businessId } = req.params;
    const userId = req.user?.userId;

    // 1. VALIDATE BUSINESS ID FORMAT
    if (!businessId || !businessId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BUSINESS_ID',
          message: 'Business ID must be a valid MongoDB ObjectId'
        }
      });
      return;
    }

    // 2. GET BUSINESS DETAILS (with ownership check)
    const business = await businessService.getBusinessDetails(businessId, userId!);

    // 3. RETURN SUCCESS RESPONSE
    res.status(200).json({
      success: true,
      data: business
    });

    console.log(`[Business] ✓ Retrieved business details: ${businessId} for user: ${userId}`);

  } catch (error: any) {
    console.error('[Business] Get business details error:', error.message);

    // Handle "not found or access denied" from service
    if (error.message.includes('not found') || error.message.includes('access denied')) {
      res.status(404).json({
        success: false,
        error: {
          code: 'BUSINESS_NOT_FOUND',
          message: error.message
        }
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_BUSINESS_FAILED',
        message: 'Failed to retrieve business details'
      }
    });
  }
};

/**
 * ========================================
 * UPDATE BUSINESS
 * ========================================
 * 
 * Updates a business owned by the user.
 * Automatically triggers vector service to update embeddings.
 * 
 * Route: PUT /businesses/:id
 * Middleware: authMiddleware, ownershipMiddleware
 * 
 * Request Body:
 * {
 *   basicInfo?: { ... },
 *   productsServices?: { ... },
 *   customerSupport?: { ... },
 *   contactEscalation?: { ... }
 * }
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: { ...updated business document }
 * }
*/

export const updateBusiness = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id: businessId } = req.params;
    const userId = req.user?.userId;
    const updateData = req.body;

    // 1. VALIDATE BUSINESS ID FORMAT
    if (!businessId || !businessId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BUSINESS_ID',
          message: 'Business ID must be a valid MongoDB ObjectId'
        }
      });
      return;
    }

    // 2. VALIDATE UPDATE DATA NOT EMPTY
    if (!updateData || Object.keys(updateData).length === 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'EMPTY_UPDATE_DATA',
          message: 'Update data cannot be empty'
        }
      });
      return;
    }

    // 3. UPDATE BUSINESS (service handles vector update)
    const business = await businessService.updateBusiness(
      businessId,
      userId!,
      updateData
    );

    // 4. RETURN SUCCESS RESPONSE
    res.status(200).json({
      success: true,
      data: business
    });

    console.log(`[Business] ✓ Business updated: ${businessId} by user: ${userId}`);

  } catch (error: any) {
    console.error('[Business] Update business error:', error.message);

    // Handle "not found or access denied" from service
    if (error.message.includes('not found') || error.message.includes('access denied')) {
      res.status(404).json({
        success: false,
        error: {
          code: 'BUSINESS_NOT_FOUND',
          message: error.message
        }
      });
      return;
    }

    res.status(400).json({
      success: false,
      error: {
        code: 'BUSINESS_UPDATE_FAILED',
        message: error.message || 'Failed to update business'
      }
    });
  }
};

/**
 * ========================================
 * DELETE BUSINESS
 * ========================================
 * 
 * Permanently deletes a business owned by the user.
 * Automatically triggers vector service to cleanup embeddings.
 * 
 * Route: DELETE /businesses/:id
 * Middleware: authMiddleware, ownershipMiddleware
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: {
 *     message: 'Business deleted successfully'
 *   }
 * }
*/

export const deleteBusiness = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id: businessId } = req.params;
    const userId = req.user?.userId;

    // 1. VALIDATE BUSINESS ID FORMAT
    if (!businessId || !businessId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BUSINESS_ID',
          message: 'Business ID must be a valid MongoDB ObjectId'
        }
      });
      return;
    }

    // 2. DELETE BUSINESS (service handles vector cleanup)
    await businessService.deleteBusiness(businessId, userId!);

    // 3. RETURN SUCCESS RESPONSE
    res.status(200).json({
      success: true,
      data: {
        message: 'Business deleted successfully',
        businessId
      }
    });

    console.log(`[Business] ✓ Business deleted: ${businessId} by user: ${userId}`);

  } catch (error: any) {
    console.error('[Business] Delete business error:', error.message);

    // Handle "not found or access denied" from service
    if (error.message.includes('not found') || error.message.includes('access denied')) {
      res.status(404).json({
        success: false,
        error: {
          code: 'BUSINESS_NOT_FOUND',
          message: error.message
        }
      });
      return;
    }

    res.status(500).json({
      success: false,
      error: {
        code: 'BUSINESS_DELETE_FAILED',
        message: 'Failed to delete business'
      }
    });
  }
};

/**
 * ========================================
 * USAGE WITH ROUTES
 * ========================================
 * 
 * import { Router } from 'express';
 * import { authMiddleware } from '../middleware/auth.middleware';
 * import { ownershipMiddleware } from '../middleware/ownershipAndChecks.middleware';
 * import * as businessController from '../controllers/business.controller';
 * 
 * const router = Router();
 * 
 * // Create business (no ownership check needed - creating new)
 * router.post('/businesses', authMiddleware, businessController.createBusiness);
 * 
 * // Get user's businesses (no ownership check - filtered by userId)
 * router.get('/businesses', authMiddleware, businessController.getUserBusinesses);
 * 
 * // Operations on specific business (requires ownership)
 * router.get('/businesses/:id', authMiddleware, ownershipMiddleware, businessController.getBusinessDetails);
 * router.put('/businesses/:id', authMiddleware, ownershipMiddleware, businessController.updateBusiness);
 * router.delete('/businesses/:id', authMiddleware, ownershipMiddleware, businessController.deleteBusiness);
 * 
 * export default router;
*/

export default {
  createBusiness,
  getUserBusinesses,
  getBusinessDetails,
  updateBusiness,
  deleteBusiness
};