// src/services/email.core.service.ts
import { logger } from '../utils/email.logger.utils';
import { sendEmail } from '../providers/email.provider';
import { getOTPFromAuth } from '../utils/auth.api.utils';
import { templateService } from './template.service';


export interface WelcomeEmailParams {
  email: string;
  firstName?: string;
  lastName?: string;
}

export interface OTPEmailParams {
  email: string;
  otpId: string;
  type: 'email_verification' | 'password_reset' | '2fa';
  userId: string;
}

export interface PasswordChangedParams {
  email: string;
  changedAt: Date;
}

export interface AccountDeactivatedParams {
  email: string;
  deactivatedAt: Date;
  reason?: string;
}

export class EmailCoreService {
  /**
   * Send welcome email to new users
   */
  async sendWelcomeEmail(params: WelcomeEmailParams): Promise<void> {
    try {
      logger.info('Sending welcome email', { email: params.email });

      const subject = 'Welcome to ChatForge! 🚀';
      const html = this.renderWelcomeTemplate(params);
      
      await sendEmail({
        to: params.email,
        subject,
        html
      });

      logger.info('Welcome email sent successfully', { email: params.email });
    } catch (error: any) {
      logger.error('Failed to send welcome email', {
        email: params.email,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Send OTP email - fetches OTP from Auth service
   */
  async sendOTPEmail(params: OTPEmailParams): Promise<void> {
    try {
      logger.info('Sending OTP email', { 
        email: params.email, 
        otpId: params.otpId,
        type: params.type 
      });

      // Fetch actual OTP from Auth service
      const otp = await getOTPFromAuth(params.otpId);
      
      if (!otp) {
        throw new Error(`OTP not found for ID: ${params.otpId}`);
      }

      const subject = this.getOTPSubject(params.type);
      const html = this.renderOTPTemplate(params.type, otp);
      
      await sendEmail({
        to: params.email,
        subject,
        html
      });

      logger.info('OTP email sent successfully', { 
        email: params.email,
        type: params.type 
      });
    } catch (error: any) {
      logger.error('Failed to send OTP email', {
        email: params.email,
        otpId: params.otpId,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Send password changed confirmation
   */
  async sendPasswordChangedEmail(params: PasswordChangedParams): Promise<void> {
    try {
      logger.info('Sending password changed email', { email: params.email });

      const subject = 'Password Changed Successfully';
      const html = this.renderPasswordChangedTemplate(params);
      
      await sendEmail({
        to: params.email,
        subject,
        html
      });

      logger.info('Password changed email sent successfully', { email: params.email });
    } catch (error: any) {
      logger.error('Failed to send password changed email', {
        email: params.email,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Send account deactivation email
   */
  async sendAccountDeactivatedEmail(params: AccountDeactivatedParams): Promise<void> {
    try {
      logger.info('Sending account deactivated email', { email: params.email });

      const subject = 'Account Deactivated';
      const html = this.renderAccountDeactivatedTemplate(params);
      
      await sendEmail({
        to: params.email,
        subject,
        html
      });

      logger.info('Account deactivated email sent successfully', { email: params.email });
    } catch (error: any) {
      logger.error('Failed to send account deactivated email', {
        email: params.email,
        error: error.message
      });
      throw error;
    }
  }

  // ========== TEMPLATE RENDERING (Simple Placeholders) ==========

  private renderWelcomeTemplate(params: WelcomeEmailParams): string {
    return templateService.renderWelcomeEmail({
      firstName: params.firstName,
      lastName: params.lastName
    });
  }

  private getOTPSubject(type: string): string {
    const subjects = {
      email_verification: 'Verify Your Email - ChatForge',
      password_reset: 'Reset Your Password - ChatForge', 
      '2fa': 'Your Two-Factor Authentication Code - ChatForge'
    };
    return subjects[type as keyof typeof subjects] || 'Your Verification Code - ChatForge';
  }

  private renderOTPTemplate(type: string, otp: string): string {
    return templateService.renderOTPEmail({
      otp,
      type: type as any
    });
  }

  private renderPasswordChangedTemplate(params: PasswordChangedParams): string {
    return templateService.renderPasswordChangedEmail({
      changedAt: params.changedAt
    });
  }

  private renderAccountDeactivatedTemplate(params: AccountDeactivatedParams): string {
    return templateService.renderAccountDeactivatedEmail({
      deactivatedAt: params.deactivatedAt,
      reason: params.reason
    });
  }
}

// Singleton instance
export const emailCoreService = new EmailCoreService();