import { timeStamp } from "console";
import { AuthLogModel, IAuthLog } from "../persistence/auth.user.models";
import { createLogger } from "../utils/auth.logger.utils";

const logger = createLogger('audit-service');

export interface AuditEvent {
  userId?: string;
  eventType: 
    | 'login' 
    | 'logout' 
    | 'registration' 
    | 'password_change' 
    | 'failed_attempt' 
    | 'account_locked'
    | 'otp_requested'
    | 'otp_verified'
    | 'otp_failed'
    | 'password_reset'
    | 'token_refreshed'
    | 'account_deactivated'
    | 'feedback_submitted';
  success: boolean;
  metadata: {
    ipAddress: string;
    userAgent: string;
    location?: string;
    deviceId?: string;
    reason?: string;
    suspectedAnomaly?: boolean;
    feedbackLength?: number;
  };
}

/**
 * Audit service for security event logging 
*/

export class AuditService {

  /**
   * Log authentication event 
  */
  static async logAuthEvent(event: AuditEvent): Promise<void> {
    try {
      await AuthLogModel.create({
        userId: event.userId,
        eventType: event.eventType,
        success: event.success,
        metadata: event.metadata,
        timestamp: new Date()
      });

      // Also log to console for immediate visibility

      const logLevel = event.success ? 'info' : 'warn';

      logger[logLevel]('Auth event logged', {
        eventType: event.eventType,
        userId: event.userId,
        success: event.success,
        ipAddress: event.metadata.ipAddress
        });
    } catch (error: any) {
      // Don't throw error from audit logging to aoid breaking main flow
      
      logger.error('Error logging audit event:', error)
    }
  }

  /** 
   * Get audit trail for a user 
  */

  static async getUserAuditTrail(userId: string, limit: number = 100): Promise<any[]> {
    try {
      return await AuthLogModel.find({userId})
      .sort({timeStamp: -1})
      .limit(limit)
      .select('eventType success metadata timestamp')
      .lean();
    } catch (error: any) {
      logger.error('Error getting user audit trail:', error);
      throw new Error('AUDIT_TRAIL_FETCH_FAILED');
    }
  }

  /**
   * Get recent security events 
  */

  static async getRecentEvents(limit: number = 50): Promise<any[]> {
    try {
      return await AuthLogModel.find()
      .sort({timeStamp: -1})
      .limit(limit)
      .populate('userId', 'email firstname lastname')
      .lean();
    } catch (error: any) {
      logger.error('Error getting recent events:', error);
      throw new Error('RECENT_EVENTS_FETCH_FAILED');
    }
  }

  /**
   * Search audit logs with filters 
  */

  static async searchAuditLogs(filters: {
    userId?: string;
    eventType?: string;
    success?: boolean;
    startDate?: Date;
    endDate?: Date;
    ipAddress?: string;
  }): Promise<any[]> {
    try{
      const query: any = {};

      if (filters.userId) query.userId = filters.userId;
      if (filters.eventType) query.eventType = filters.eventType;
      if (filters.success !== undefined) query.success = filters.success;
      if (filters.ipAddress) query['metadata.ipAddress'] = filters.ipAddress;
      if (filters.startDate || filters.endDate) {
        query.timestamp = {};
        if (filters.startDate) query.timestamp.$gte = filters.startDate;
        if (filters.endDate) query.timestamp.$lte = filters.endDate;
      }

      return await AuthLogModel.find(query)
      .sort({timestamp: -1})
      .limit(100)
      .populate("userId", 'email firstname lastname')
      .lean();

    } catch (error: any) {
      logger.error('Error searching audit logs:', error);
      throw new Error("AUDIT_SEARCH_FAILED");
    }
  }

  /**
   * Get security statistics 
  */

  static async getSecurityStats(timeframe: '24h' | '7d' | '30d' = '24h'): Promise<any> {
    try {
      const timeRanges = {
        '24h': new Date(Date.now() - 24 * 60 * 60 * 1000),
        '7d' : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
        '30d': new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
      };

      const startDate = timeRanges[timeframe];

      const stats = await AuthLogModel.aggregate([
        {
          $match: {
            timestamp: {$gte: startDate}
          }
        },
        {
          $group: {
            _id: '$eventType',
            total: {$sum: 1},
            successful : {
              $sum: {$cond: ['$success', 1, 0]}
            },
            failed: {
              $sum : {$cond: ['$success', 0, 1]}
            }
          }
        }
      ]);

      return stats
    } catch (error: any) {
      logger.error('Errro getting security stats:', error);
      throw new Error('SECURITY_STATS_FETCH_FAILED');

    }
  }

  /**
   * Clean up old audit logs (can be called by scheduled job) 
  */

  static async cleanupOldLOgs(retentionDays: number = 90): Promise<number> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

      const result = await AuthLogModel.deleteMany({
        timestamp: {$lt: cutoffDate}
      });

      logger.info('Old audit logs cleaned up', {
        deleteCount: result.deletedCount,
        retentionDays
      });

      return result.deletedCount || 0;

    } catch (error: any) {
      logger.error('Error cleaning up old audit logs:', error);
      throw new Error('AUDIT_CLEANUP_FAILED');
    }
  }
}

// Export individual functions for convenience

export const logAuthEvent = AuditService.logAuthEvent;
export const getUserAuditTrail = AuditService.getUserAuditTrail;
export const getRecentEvents = AuditService.getRecentEvents;
export const searchAuditLogs = AuditService.searchAuditLogs;
export const getSecurityStats = AuditService.getSecurityStats;
export const cleanupOldLOgs = AuditService.cleanupOldLOgs;