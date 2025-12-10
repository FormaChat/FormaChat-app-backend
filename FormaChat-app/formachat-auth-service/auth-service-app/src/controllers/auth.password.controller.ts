  import { Request, Response } from 'express';
import { PasswordService } from '../services/auth.password.service';
import { otpService } from '../services/auth.otp.service';
import { userService } from '../services/auth.user.service';
import { AuditService } from '../services/auth.audit.service';
import { createLogger } from '../utils/auth.logger.utils';

const logger = createLogger('password-controller');

export class PasswordController {
  /**
   * Change password for authenticated user
   */
  async changePassword(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.userId; // From JWT middleware
      const { currentPassword, newPassword } = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      await userService.changePassword(
        userId,
        currentPassword,
        newPassword,
        { ipAddress, userAgent }
      );

      res.json({
        success: true,
        message: 'Password changed successfully'
      });

    } catch (error: any) {
      logger.error('Password change error:', error);
      
      if (error.message === 'USER_NOT_FOUND') {
        return res.status(404).json({
          success: false,
          error: {
            code: 'USER_NOT_FOUND',
            message: 'User not found'
          }
        });
      }
      
      if (error.message === 'INVALID_CURRENT_PASSWORD') {
        return res.status(400).json({
          success: false,
          error: {
            code : 'INVALID_CURRENT_PASSWORD',
            message: 'Current password is incorrect'
          }
        });
      }
      
      if (error.message.startsWith('WEAK_PASSWORD')) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'WEAK_PASSWORD',
            message: error.message.replace('WEAK_PASSWORD: ', '')
          }
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to change password'
      });
    }
  }

  /**
   * Initiate password reset process
   */
  async resetPassword(req: Request, res: Response) {
    try {
      const { email } = req.body;
      const ipAddress = req.ip ?? "unkown";
      const userAgent = req.get('User-Agent') || 'unknown';

      const user = await userService.getUserByEmail(email);
      
      // Always return success to prevent email enumeration
      if (!user) {
        logger.warn('Password reset attempt for non-existent email', { email, ipAddress });
        return res.json({
          success: true,
          message: 'If the email exists, a reset code has been sent'
        });
      }

      // Generate OTP for password reset
      const { otpId } = await otpService.generateOTP({
        userId: user.id,
        type: 'password_reset',
        metadata: { ipAddress, userAgent }
      });

      // TODO: Publish event to email service with otpId
      logger.info('Password reset OTP generated', { userId: user.id, otpId });

      res.json({
        success: true,
        message: 'If the email exists, a reset code has been sent',
      });

    } catch (error: any) {
      logger.error('Password reset initiation error:', error);
      
      // Still return success to prevent email enumeration
      res.json({
        success: true,
        message: 'If the email exists, a reset code has been sent'
      });
    }
  }

  /**
   * Confirm password reset with OTP
   */
  async confirmReset(req: Request, res: Response) {
    try {
      const { email, otp, newPassword } = req.body;
      const ipAddress = req.ip ?? "unknown";
      const userAgent = req.get('User-Agent') || 'unknown';

      const user = await userService.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'Invalid reset request'
        });
      }

      // Verify OTP
      const otpResult = await otpService.verifyOTP(user.id, otp, 'password_reset');
      if (!otpResult.valid) {
        await AuditService.logAuthEvent({
          userId: user.id,
          eventType: 'password_reset',
          success: false,
          metadata: {
            ipAddress,
            userAgent,
            reason: 'Invalid OTP'
          }
        });

        return res.status(400).json({
          success: false,
          error: 'Invalid or expired reset code'
        });
      }

      // Update password
      user.passwordHash = await PasswordService.hashPassword(newPassword);
      user.passwordChangedAt = new Date();
      await user.save();

      await AuditService.logAuthEvent({
        userId: user.id,
        eventType: 'password_reset',
        success: true,
        metadata: { ipAddress, userAgent }
      });

      // TODO: Revoke all existing sessions for security

      res.json({
        success: true,
        message: 'Password reset successfully'
      });

    } catch (error: any) {
      logger.error('Password reset confirmation error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to reset password'
      });
    }
  }

  /**
   * Validate password strength
   */
  async validatePassword(req: Request, res: Response) {
    try {
      const { password } = req.body;

      const validation = PasswordService.validatePasswordStrength(password);

      res.json({
        success: true,
        data: validation
      });

    } catch (error: any) {
      logger.error('Password validation error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to validate password'
      });
    }
  }
}

export const passwordController = new PasswordController();