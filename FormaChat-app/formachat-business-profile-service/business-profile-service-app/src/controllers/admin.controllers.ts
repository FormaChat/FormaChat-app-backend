import { Request, Response } from 'express';
import { businessService } from '../services/business.service';


export const getAllBusinesses = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

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

    // 2. GET ALL BUSINESSES (no userId filter)
    const result = await businessService.getAllBusinesses(page, limit);

    // 3. RETURN SUCCESS RESPONSE
    res.status(200).json({
      success: true,
      data: result
    });

    console.log(`[Admin] ✓ Retrieved ${result.businesses.length} businesses (page ${page}) by admin: ${req.adminUser?.email}`);

  } catch (error: any) {
    console.error('[Admin] Get all businesses error:', error.message);

    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_BUSINESSES_FAILED',
        message: 'Failed to retrieve businesses'
      }
    });
  }
};

export const getBusinessById = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id: businessId } = req.params;

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

    // 2. GET BUSINESS (no ownership check)
    const business = await businessService.getBusinessById(businessId);

    // 3. RETURN SUCCESS RESPONSE
    res.status(200).json({
      success: true,
      data: business
    });

    console.log(`[Admin] ✓ Retrieved business: ${businessId} by admin: ${req.adminUser?.email}`);

  } catch (error: any) {
    console.error('[Admin] Get business by ID error:', error.message);

    // Handle "not found" from service
    if (error.message.includes('not found')) {
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
        message: 'Failed to retrieve business'
      }
    });
  }
};

export const setBusinessStatus = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id: businessId } = req.params;
    const { isActive, reason, adminNote } = req.body;

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

    // 2. VALIDATE REQUIRED FIELDS
    if (typeof isActive !== 'boolean') {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'isActive field is required and must be a boolean'
        }
      });
      return;
    }

    // 3. VALIDATE REASON FOR FREEZING
    if (!isActive && !reason) {
      res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Reason is required when freezing a business'
        }
      });
      return;
    }

    // 4. VALIDATE REASON ENUM
    const validReasons = [
      'trial_expired',
      'payment_failed',
      'admin_action',
      'subscription_canceled',
      'user_requested'
    ];

    if (!isActive && reason && !validReasons.includes(reason)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_REASON',
          message: `Reason must be one of: ${validReasons.join(', ')}`
        }
      });
      return;
    }

    // 5. SET BUSINESS STATUS (service handles freeze/unfreeze logic)
    const business = await businessService.setBusinessStatus(
      businessId,
      isActive,
      req.adminUser?.userId,
      reason,
      adminNote
    );

    // 6. RETURN SUCCESS RESPONSE
    const message = isActive
      ? 'Business activated successfully'
      : 'Business frozen successfully';

    res.status(200).json({
      success: true,
      data: {
        business,
        message
      }
    });

    console.log(`[Admin] ✓ Business ${businessId} ${isActive ? 'activated' : 'frozen'} by admin: ${req.adminUser?.email}`);

  } catch (error: any) {
    console.error('[Admin] Set business status error:', error.message);

    // Handle "not found" from service
    if (error.message.includes('not found')) {
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
        code: 'STATUS_UPDATE_FAILED',
        message: error.message || 'Failed to update business status'
      }
    });
  }
};

export const getPlatformStats = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // 1. GET PLATFORM STATISTICS
    const stats = await businessService.getPlatformStats();

    // 2. RETURN SUCCESS RESPONSE
    res.status(200).json({
      success: true,
      data: stats
    });

    console.log(`[Admin] ✓ Platform stats retrieved by admin: ${req.adminUser?.email}`);

  } catch (error: any) {
    console.error('[Admin] Get platform stats error:', error.message);

    res.status(500).json({
      success: false,
      error: {
        code: 'STATS_FETCH_FAILED',
        message: 'Failed to retrieve platform statistics'
      }
    });
  }
};

export const getFrozenBusinesses = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 50;

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

    // 2. GET FROZEN BUSINESSES
    const result = await businessService.getFrozenBusinesses(page, limit);

    // 3. RETURN SUCCESS RESPONSE
    res.status(200).json({
      success: true,
      data: result
    });

    console.log(`[Admin] ✓ Retrieved ${result.businesses.length} frozen businesses (page ${page}) by admin: ${req.adminUser?.email}`);

  } catch (error: any) {
    console.error('[Admin] Get frozen businesses error:', error.message);

    res.status(500).json({
      success: false,
      error: {
        code: 'FETCH_FROZEN_BUSINESSES_FAILED',
        message: 'Failed to retrieve frozen businesses'
      }
    });
  }
};



export default {
  getAllBusinesses,
  getBusinessById,
  setBusinessStatus,
  getPlatformStats,
  getFrozenBusinesses
};