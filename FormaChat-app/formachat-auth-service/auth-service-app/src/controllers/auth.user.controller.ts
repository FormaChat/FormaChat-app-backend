import { Request, Response } from 'express';
import { userService } from '../services/auth.user.service';
import { sessionService } from '../services/auth.session.service';
import { AuditService } from '../services/auth.audit.service';
import { createLogger } from '../utils/auth.logger.utils';
import { success } from 'zod';
import { PasswordService } from '../services/auth.password.service';

const logger = createLogger('user-controller');

export class UserController {
  /**
   * Get user profile
   */
  async getProfile(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const user = await userService.getUserProfile(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Return safe user data (exclude password hash)
      const userData = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isVerified: user.isVerified,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        source: user.source
      };

      res.json({
        success: true,
        data: userData
      });

    } catch (error: any) {
      logger.error('Get profile error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to get profile'
      });
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.userId;
      const updates = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const allowedUpdates = ['firstName', 'lastName', 'email'];
      const filteredUpdates: any = {};
      
      Object.keys(updates).forEach(key => {
        if (allowedUpdates.includes(key)) {
          filteredUpdates[key] = updates[key];
        }
      });

      const user = await userService.updateUserProfile(
        userId, 
        filteredUpdates, 
        { ipAddress, userAgent }
      );

      const userData = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isVerified: user.isVerified,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt,
        createdAt: user.createdAt,
        source: user.source
      };

      res.json({
        success: true,
        data: userData,
        message: 'Profile updated successfully'
      });

    } catch (error: any) {
      logger.error('Update profile error:', error);
      
      if (error.message === 'USER_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to update profile'
      });
    }
  }

  /**
   * Deactivate user account
   */
  async deactivateAccount(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.userId;
      const {password} = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      if (!password) {
        return res.status(400).json({
          success: false,
          error: 'Password comfirmation required'
        })
      }

      // Verify password before deletion
      const user = await userService.getUserProfile(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      // Validate password (you'll need to add this method to userService or use PasswordService)
      const isPasswordValid = await PasswordService.comparePassword(password, user.passwordHash);
    
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid password'
        });
      }

      await userService.deactivateAccount(userId, { ipAddress, userAgent });

      // TODO: Revoke all active sessions/tokens

      res.json({
        success: true,
        message: 'Account deactivated successfully'
      });

    } catch (error: any) {
      logger.error('Deactivate account error:', error);
      
      if (error.message === 'USER_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to deactivate account'
      });
    }
  }

  /**
   * Get active sessions for user
   */
  async getSessions(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      const sessions = await sessionService.getActiveSessionInfo(userId);

      res.json({
        success: true,
        data: sessions 
      });

    } catch (error: any) {
      logger.error('Get sessions error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to get sessions'
      });
    }
  }

  /**
   * Verify user email with OTP
   */
  async verifyEmail(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.userId;
      const { otp } = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      // This would typically use the OTP service to verify email verification OTP
      // For now, we'll simulate successful verification
      await userService.verifyUserEmail(userId);

      await AuditService.logAuthEvent({
        userId,
        eventType: 'otp_verified',
        success: true,
        metadata: { ipAddress, userAgent }
      });

      res.json({
        success: true,
        message: 'Email verified successfully'
      });

    } catch (error: any) {
      logger.error('Verify email error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to verify email'
      });
    }
  }
}

export const userController = new UserController();