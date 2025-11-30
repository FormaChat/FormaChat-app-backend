import { Request, Response } from 'express';
import { userService } from '../services/auth.user.service';
import { AuditService } from '../services/auth.audit.service';
import { otpService } from '../services/auth.otp.service';
import { tokenService } from '../services/auth.token.service';
import { createLogger } from '../utils/auth.logger.utils';

const logger = createLogger('admin-controller');

export class AdminController {
  /**
   * Internal API - Get all users (for admin service)
   */
  async getUsersInternal(req: Request, res: Response) {
    try {
      // This would be called by the admin service with proper service authentication
      const { page = 1, limit = 50, search } = req.query;
      
      // In a real implementation, you'd have a method to get paginated users
      // For now, this is a placeholder
      logger.info('Admin service requested users', { page, limit, search });
      
      // TODO: Implement proper user listing with pagination
      const users:any = []; // await UserModel.find(...).paginate()
      
      res.json({
        success: true,
        data: {
          users,
          pagination: {
            page: parseInt(page as string),
            limit: parseInt(limit as string),
            total: 0 // Would be actual count
          }
        }
      });

    } catch (error: any) {
      logger.error('Get users internal error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to get users'
      });
    }
  }

  /**
   * Internal API - Get audit logs (for admin service)
   */
  async getAuditLogsInternal(req: Request, res: Response) {
    try {
      const { 
        userId, 
        eventType, 
        startDate, 
        endDate, 
        page = 1, 
        limit = 100 
      } = req.query;

      const logs = await AuditService.searchAuditLogs({
        userId: userId as string,
        eventType: eventType as string,
        startDate: startDate ? new Date(startDate as string) : undefined,
        endDate: endDate ? new Date(endDate as string) : undefined
      });

      res.json({
        success: true,
        data: {
          logs,
          pagination: {
            page: parseInt(page as string),
            limit: parseInt(limit as string),
            total: logs.length
          }
        }
      });

    } catch (error: any) {
      logger.error('Get audit logs internal error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to get audit logs'
      });
    }
  }

  /**
   * Internal API - Lock user account (for admin service)
   */
  async lockUserInternal(req: Request, res: Response) {
    try {
      const { userId, reason } = req.body;
      const adminId = (req as any).serviceContext?.adminId; // From service auth

      if (!userId) {
        return res.status(400).json({
          success: false,
          error: 'User ID is required'
        });
      }

      const user = await userService.getUserProfile(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Lock the user account
      user.isActive = false;
      await user.save();

      // Revoke all active tokens
      await tokenService.revokeAllUserTokens(userId);

      await AuditService.logAuthEvent({
        userId: user.id,
        eventType: 'account_deactivated',
        success: true,
        metadata: {
          ipAddress: 'admin-service',
          userAgent: 'admin-service',
          reason: reason || 'Admin action'
        }
      });

      logger.info('User locked by admin', { userId, adminId, reason });

      res.json({
        success: true,
        message: 'User account locked successfully'
      });

    } catch (error: any) {
      logger.error('Lock user internal error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to lock user account'
      });
    }
  }

  /**
   * Internal API - Get user details (for admin service)
   */
  async getUserDetailsInternal(req: Request, res: Response) {
    try {
      const { userId } = req.params;

      const user = await userService.getUserProfile(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const userData = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isVerified: user.isVerified,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        failedLoginAttempts: user.failedLoginAttempts,
        lockUntil: user.lockUntil,
        passwordChangedAt: user.passwordChangedAt,
        source: user.source,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      };

      // Get user's recent audit logs
      const recentLogs = await AuditService.getUserAuditTrail(userId, 20);

      // Get OTP stats
      const otpStats = await otpService.getOTPStats(userId);

      // Get active sessions
      const activeSessions = await tokenService.getActiveSessions(userId);

      res.json({
        success: true,
        data: {
          user: userData,
          recentActivity: recentLogs,
          otpStats,
          activeSessions: activeSessions.length
        }
      });

    } catch (error: any) {
      logger.error('Get user details internal error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to get user details'
      });
    }
  }

  /**
   * Internal API - Get system statistics (for admin service)
   */
  async getSystemStatsInternal(req: Request, res: Response) {
    try {
      const { timeframe = '24h' } = req.query;

      const securityStats = await AuditService.getSecurityStats(timeframe as any);

      // TODO: Add more stats like:
      // - Total user count
      // - New registrations
      // - Active sessions count
      // - OTP usage statistics

      res.json({
        success: true,
        data: {
          security: securityStats,
          users: {
            total: 0, // Would be actual count
            active: 0,
            verified: 0
          },
          system: {
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            timestamp: new Date()
          }
        }
      });

    } catch (error: any) {
      logger.error('Get system stats internal error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to get system statistics'
      });
    }
  }
}

export const adminController = new AdminController();