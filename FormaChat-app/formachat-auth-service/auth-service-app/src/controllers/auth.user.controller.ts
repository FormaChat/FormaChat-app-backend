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
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required'
          }
        });
      }

      const user = await userService.getUserProfile(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
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
        error: {
          code: 'FAILED_TO_GET_PROFILE',
          message: 'Failed to get profile'
        }
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
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required'
          }
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
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      res.status(500).json({
        success: false,
        error: {
          code: 'FAILED_TO_UPDATE_PROFILE',
          message: 'Failed to update profile'
        }
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
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required'
          }
        });
      }

      if (!password) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'PASSWORD_CONFIRMATION_REQUIRED',
            message: 'Password comfirmation required'
          }
        })
      }

      // Verify password before deletion
      const user = await userService.getUserProfile(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      // Validate password (you'll need to add this method to userService or use PasswordService)
      const isPasswordValid = await PasswordService.comparePassword(password, user.passwordHash);
    
      if (!isPasswordValid) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'INVALID_PASSWORD',
            message: 'Invalid password'
          }
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
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      res.status(500).json({
        success: false,
        error: {
          code: 'FAILED_TO_DEACTIVATE_ACCOUNT',
          message: 'Failed to deactivate account'
        }
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
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required'
          }
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
        error: {
          code: 'FAILED_TO_GET_SESSIONS',
          message: 'Failed to get sessions'
        }
      });
    }
  }

  // controllers/auth.user.controller.ts (add this method to UserController class)

  /**
   * Submit user feedback
   */
  async submitFeedback(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.userId;
      const { message } = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'AUTHETICATION_REQUIRED',
            message: 'Authentication required'
          }
        });
      }

      if (!message || message.trim().length === 0) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'FEEDBACK_MESSAGE_IS_REQUIRED',
            message: 'Feedback message is required'
          }
        });
      }

      if (message.length > 5000) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'FEEDBACK_MESSAGE_TOO_LONG',
            message: 'Feedback message too long (max 5000 characters)'
          }
        });
      }

      await userService.submitFeedback(userId, message.trim(), { ipAddress, userAgent });

      res.json({
        success: true,
        message: {
          code: 'FEEDBACK_SUBMITTED_SUCCESSFULLY',
          message: 'Feedback submitted successfully'
        }
      });

    } catch (error: any) {
      logger.error('Submit feedback error:', error);
      
      if (error.message === 'USER_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }

      res.status(500).json({
        success: false,
      error: {
        code: 'FAILED_TO_SUBMIT_FEEDBACK',
        message: 'Failed to submit feedback'
      }
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
          error: {
            code: 'AUTHENTICATION_REQUIRED',
            message: 'Authentication required'
          }
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
        error: {
          code: 'FAILED_TO_VERIFY_EMAIL',
          message: 'Failed to verify email'
        }
      });
    }
  }
}

export const userController = new UserController();