import { Request, Response } from 'express';
import { otpService } from '../services/auth.otp.service';
import { userService } from '../services/auth.user.service';
import { AuditService } from '../services/auth.audit.service';
import { createLogger } from '../utils/auth.logger.utils';
import { OTPType } from '../types/auth.types';

const logger = createLogger('otp-controller');

export class OTPController {
  /**
   * Generate OTP for various purposes
   */
  async generateOTP(req: Request, res: Response) {
    try {
      const { email, type } = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      if (!email || !type) {
        return res.status(400).json({
          success: false,
          error: 'Email and OTP type are required'
        });
      }

      // Validate OTP type
      const validTypes = Object.values(OTPType);
      if (!validTypes.includes(type)) {
        return res.status(400).json({
          success: false,
          error: `Invalid OTP type. Must be one of: ${validTypes.join(', ')}`
        });
      }

      const user = await userService.getUserByEmail(email);
      
      // For security, don't reveal if user exists
      if (!user) {
        logger.warn('OTP generation attempt for non-existent email', { email, type, ipAddress });
        return res.json({
          success: true,
          message: 'If the email exists, an OTP has been sent'
        });
      }

      // Generate OTP
      const { otpId } = await otpService.generateOTP({
        userId: user.id,
        type: type as any,
        metadata: { ipAddress, userAgent }
      });

      // TODO: Publish event to appropriate service (email/SMS) with otpId
      logger.info('OTP generated', { userId: user.id, type, otpId });

      res.json({
        success: true,
        message: 'If the email exists, an OTP has been sent',
        // In production, don't return otpId to client for email_verification and password_reset
        // It's returned here for testing purposes
        data: type === '2fa' ? { otpId } : undefined
      });

    } catch (error: any) {
      logger.error('OTP generation error:', error);
      
      // Still return success to prevent email enumeration
      res.json({
        success: true,
        message: 'If the email exists, an OTP has been sent'
      });
    }
  }

  /**
   * Verify OTP
   */
  async verifyOTP(req: Request, res: Response) {
    try {
      const { email, otp, type } = req.body;
      const ipAddress = req.ip;
      const userAgent = req.get('User-Agent') || 'unknown';

      if (!email || !otp || !type) {
        return res.status(400).json({
          success: false,
          error: 'Email, OTP, and type are required'
        });
      }

      const user = await userService.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'Invalid verification request'
        });
      }

      // Verify OTP
      const verificationResult = await otpService.verifyOTP(user.id, otp, type);

      if (!verificationResult.valid) {
        return res.status(400).json({
          success: false,
          error: verificationResult.error || 'Invalid OTP'
        });
      }

      // Handle different OTP types
      let additionalData = {};
      
      if (type === 'email_verification') {
        await userService.verifyUserEmail(user.id);
        additionalData = { emailVerified: true };
      }

      // For password reset, the actual password change happens in a separate step
      if (type === 'password_reset') {
        additionalData = { canResetPassword: true };
      }

      res.json({
        success: true,
        message: 'OTP verified successfully',
        data: {
          verified: true,
          ...additionalData
        }
      });

    } catch (error: any) {
      logger.error('OTP verification error:', error);
      
      res.status(500).json({
        success: false,
        error: 'OTP verification failed'
      });
    }
  }

  /**
   * Resend OTP.
   */
  async resendOTP(req: Request, res: Response) {
    try {
      const { email, type } = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      if (!email || !type) {
        return res.status(400).json({
          success: false,
          error: 'Email and OTP type are required'
        });
      }

      const user = await userService.getUserByEmail(email);
      
      // For security, don't reveal if user exists
      if (!user) {
        logger.warn('OTP resend attempt for non-existent email', { email, type, ipAddress });
        return res.json({
          success: true,
          message: 'If the email exists, an OTP has been sent'
        });
      }

      // Generate new OTP
      const { otpId } = await otpService.generateOTP({
        userId: user.id,
        type: type as any,
        metadata: { ipAddress, userAgent }
      });

      // TODO: Publish event to appropriate service
      logger.info('OTP resent', { userId: user.id, type, otpId });

      res.json({
        success: true,
        message: 'If the email exists, an OTP has been sent'
      });

    } catch (error: any) {
      logger.error('OTP resend error:', error);
      
      // Still return success to prevent email enumeration
      res.json({
        success: true,
        message: 'If the email exists, an OTP has been sent'
      });
    }
  }

  /**
   * Internal API - Get OTP for email service (secured with API key)
   */
  async getOTPInternal(req: Request, res: Response) {
    try {
      const { otpId } = req.params;
      
      // This endpoint is for internal service use (email service)
      // It should be protected with API key authentication at the route level

      const otp = await otpService.getOTPForEmail(otpId);

      if (!otp) {
        return res.status(404).json({
          success: false,
          error: 'OTP not found or expired'
        });
      }

      res.json({
        success: true,
        data: { otp }
      });

    } catch (error: any) {
      logger.error('Get OTP internal error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to retrieve OTP'
      });
    }
  }
}

export const otpController = new OTPController();