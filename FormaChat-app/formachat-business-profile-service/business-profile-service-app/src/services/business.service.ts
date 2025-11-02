import { createLogger } from "../utils/business.logger.utils";
import Business, { IBusiness } from '../models/business.model';
import { vectorService } from './vector.service';

export class BusinessService {
  /**
   * Create a new business for user
  */

  async createBusiness(userId: string, userEmail: string, businessData: any): Promise<IBusiness> {
    const business = new Business({
      userId,
      userEmail,
      ...businessData
    });
    
    if (!userId || !userEmail) {
      throw new Error('User ID and email are required');
    }
    
    if (!businessData?.basicInfo?.businessName) {
      throw new Error('Business name is required');
    }

    const savedBusiness = await business.save();
    
    // Trigger vector update (placeholder) - Fixed typing
    await vectorService.triggerVectorUpdate(String(savedBusiness._id));
    
    return savedBusiness;
  }

  /**
   * Get user's businesses (paginated)
   * UPDATED: Now includes freeze status
  */
 
  async getUserBusinesses(userId: string, page: number = 1, limit: number = 10) {
    const skip = (page - 1) * limit;
    
    const [businesses, total] = await Promise.all([
      Business.find({ userId })
        .select('basicInfo isActive freezeInfo vectorInfo.vectorStatus createdAt updatedAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Business.countDocuments({ userId })
    ]);

    return {
      businesses,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get business details (with ownership check)
  */

  async getBusinessDetails(businessId: string, userId: string): Promise<IBusiness> {
    const business = await Business.findOne({ _id: businessId, userId });
    
    if (!business) {
      throw new Error('Business not found or access denied');
    }
    
    return business;
  }

  /**
   * Update business (with ownership check)
  */

  async updateBusiness(businessId: string, userId: string, updateData: any): Promise<IBusiness> {
    const business = await Business.findOneAndUpdate(
      { _id: businessId, userId },
      { ...updateData, updatedAt: new Date() },
      { new: true, runValidators: true }
    );

    if (!business) {
      throw new Error('Business not found or access denied');
    }

    // Trigger vector update if relevant fields changed
    await vectorService.triggerVectorUpdate(businessId);
    
    return business;
  }

  /**
   * Delete business (with ownership check)
  */

  async deleteBusiness(businessId: string, userId: string): Promise<void> {
    const result = await Business.findOneAndDelete({ _id: businessId, userId });
    
    if (!result) {
      throw new Error('Business not found or access denied');
    }

    // Trigger vector cleanup (hard delete)
    await vectorService.triggerVectorCleanup(businessId);
  }

  // ==================== FREEZE MANAGEMENT ====================

  /**
   * Freeze a business with full metadata tracking
   * @param businessId - Business to freeze
   * @param reason - Why it's being frozen
   * @param frozenBy - Who triggered the freeze ('system', 'admin', or userId)
   * @param adminNote - Optional admin context note
  */

  async freezeBusiness(
    businessId: string, 
    reason: 'trial_expired' | 'payment_failed' | 'admin_action' | 'subscription_canceled' | 'user_requested',
    frozenBy: 'system' | 'admin',
    adminNote?: string
  ): Promise<IBusiness> {
    const business = await Business.findById(businessId);
    
    if (!business) {
      throw new Error('Business not found');
    }

    // Already frozen - no action needed
    if (!business.isActive && business.freezeInfo?.isFrozen) {
      return business;
    }

    // Update freeze status
    business.isActive = false;
    business.freezeInfo = {
      isFrozen: true,
      reason,
      frozenAt: new Date(),
      frozenBy,
      adminNote: adminNote || undefined
    };

    const frozenBusiness = await business.save();

    // Trigger vector freeze (soft freeze - keeps vectors but blocks access)
    await vectorService.freezeVectorAccess(businessId);

    console.log(`[FREEZE] Business ${businessId} frozen. Reason: ${reason}, By: ${frozenBy}`);

    return frozenBusiness;
  }

  /**
   * Unfreeze a business and restore access
   * @param businessId - Business to unfreeze
   * @param unfrozenBy - Who triggered the unfreeze ('system', 'admin', or userId)
  */

  async unfreezeBusiness(businessId: string, unfrozenBy: string): Promise<IBusiness> {
    const business = await Business.findById(businessId);
    
    if (!business) {
      throw new Error('Business not found');
    }

    // Already active - no action needed
    if (business.isActive) {
      return business;
    }

    // Reactivate business
    business.isActive = true;
    // Note: Pre-save hook will automatically handle freezeInfo and vectorStatus

    const unfrozenBusiness = await business.save();

    // Resume vector access (vectors already exist, just unblock)
    await vectorService.resumeVectorAccess(businessId);

    console.log(`[UNFREEZE] Business ${businessId} unfrozen. By: ${unfrozenBy}`);

    return unfrozenBusiness;
  }

  /**
   * Check if a business can be accessed/used for chat
   * Centralized access control used by Chat Service
  */

  async checkBusinessAccess(businessId: string): Promise<{
    allowed: boolean;
    business?: IBusiness;
    reason?: string;
    freezeInfo?: any;
  }> {
    const business = await Business.findById(businessId);
    
    if (!business) {
      return {
        allowed: false,
        reason: 'Business not found'
      };
    }

    const chatCheck = business.canChat();

    if (!chatCheck.allowed) {
      return {
        allowed: false,
        business,
        reason: chatCheck.reason,
        freezeInfo: business.freezeInfo
      };
    }

    return {
      allowed: true,
      business
    };
  }

  /**
   * ADMIN: Get all frozen businesses (paginated)
  */

  async getFrozenBusinesses(page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;
    
    const [businesses, total] = await Promise.all([
      Business.find({ 
        isActive: false,
        'freezeInfo.isFrozen': true 
      })
        .select('userId userEmail basicInfo isActive freezeInfo vectorInfo createdAt updatedAt')
        .sort({ 'freezeInfo.frozenAt': -1 })
        .skip(skip)
        .limit(limit),
      Business.countDocuments({ 
        isActive: false,
        'freezeInfo.isFrozen': true 
      })
    ]);

    return {
      businesses,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * Get businesses that need to be frozen (for cron job)
   * This will be expanded with trial expiration logic
  */

  async getBusinessesPendingFreeze(): Promise<IBusiness[]> {
    // TODO: Add trial expiration date logic
    // For now, returns businesses with auto-unfreeze dates that have passed
    
    return Business.find({
      isActive: true,
      'freezeInfo.isFrozen': false,
      'freezeInfo.autoUnfreezeAt': { $lte: new Date() }
    });
  }

  // ==================== ADMIN METHODS ====================

  /**
   * ADMIN: Get all businesses (paginated)
   * UPDATED: Now includes freeze status
  */

  async getAllBusinesses(page: number = 1, limit: number = 50) {
    const skip = (page - 1) * limit;
    
    const [businesses, total] = await Promise.all([
      Business.find()
        .select('userId userEmail basicInfo isActive freezeInfo vectorInfo createdAt updatedAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Business.countDocuments()
    ]);

    return {
      businesses,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    };
  }

  /**
   * ADMIN: Get business by ID (no ownership check)
   */
  async getBusinessById(businessId: string): Promise<IBusiness> {
    const business = await Business.findById(businessId);
    
    if (!business) {
      throw new Error('Business not found');
    }
    
    return business;
  }

  /**
   * ADMIN: Freeze/unfreeze business (wrapper method)
   * Now properly calls freezeBusiness/unfreezeBusiness
  */

  async setBusinessStatus(
    businessId: string, 
    isActive: boolean,
    adminId?: string,
    reason?: string,
    adminNote?: string
  ): Promise<IBusiness> {
    if (!isActive) {
      // Freeze the business
      return this.freezeBusiness(
        businessId,
        (reason as any) || 'admin_action',
        'admin',
        adminNote
      );
    } else {
      // Unfreeze the business
      return this.unfreezeBusiness(businessId, adminId || 'admin');
    }
  }

  /**
   * ADMIN: Get platform statistics
   * UPDATED: Now includes freeze statistics
  */
 
  async getPlatformStats() {
    const [
      totalBusinesses,
      activeBusinesses,
      frozenBusinesses,
      businessesToday,
      businessesThisWeek,
      byBusinessType,
      byFreezeReason
    ] = await Promise.all([
      Business.countDocuments(),
      Business.countDocuments({ isActive: true }),
      Business.countDocuments({ isActive: false, 'freezeInfo.isFrozen': true }),
      Business.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }),
      Business.countDocuments({
        createdAt: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }),
      Business.aggregate([
        { $group: { _id: '$basicInfo.businessType', count: { $sum: 1 } } }
      ]),
      Business.aggregate([
        { 
          $match: { 
            isActive: false, 
            'freezeInfo.isFrozen': true 
          } 
        },
        { 
          $group: { 
            _id: '$freezeInfo.reason', 
            count: { $sum: 1 } 
          } 
        }
      ])
    ]);

    return {
      totalBusinesses,
      activeBusinesses,
      frozenBusinesses,
      businessesToday,
      businessesThisWeek,
      byBusinessType,
      freezeReasons: byFreezeReason
    };
  }
}

export const businessService = new BusinessService();