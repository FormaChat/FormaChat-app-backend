// src/services/email.core.service.ts
import { logger } from '../utils/email.logger.utils';
import { sendEmail } from '../providers/email.provider';
import { getOTPFromAuth } from '../utils/auth.api.utils';
import { templateService } from './template.service';

export interface FeedbackEmailParams {
  email: string;
  firstName: string;
  lastName: string;
  userId: string;
  feedbackMessage: string;
  timestamp: string;
  userAgent: string;
  ipAddress: string;
}

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

      const subject = 'Welcome to FormaChat! 🚀';
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
   * Send feedback email to support team
   */
  async sendFeedbackEmail(params: FeedbackEmailParams): Promise<void> {
  try {
    logger.info('Sending feedback email to support', { 
      from: params.email,
      userId: params.userId 
    });

    const subject = `Feedback from ${params.firstName} ${params.lastName}`;
    const html = this.renderFeedbackTemplate(params);
    
    await sendEmail({
      to: 'support@formachat.com',
      subject,
      html,
      from: 'noreply@formachat.com',
      replyTo: params.email // ← ADD THIS - allows direct reply to user
    });

    logger.info('Feedback email sent successfully to support', { 
      from: params.email,
      userId: params.userId 
    });
  } catch (error: any) {
    logger.error('Failed to send feedback email', {
      email: params.email,
      userId: params.userId,
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
      email_verification: 'Verify Your Email - FormaChat',
      password_reset: 'Reset Your Password - FormaChat', 
      '2fa': 'Your Two-Factor Authentication Code - FormaChat'
    };
    return subjects[type as keyof typeof subjects] || 'Your Verification Code - FormaChat';
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

  private renderFeedbackTemplate(params: FeedbackEmailParams): string {
  const formattedDate = new Date(params.timestamp).toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'long'
  });

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { 
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            line-height: 1.6; 
            color: #333;
            margin: 0;
            padding: 0;
            background-color: #f5f5f5;
          }
          .container { 
            max-width: 600px; 
            margin: 20px auto; 
            background: white;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          .header { 
            background: linear-gradient(135deg, #636b2f 0%, #4f5625 100%);
            color: white; 
            padding: 30px 20px;
            text-align: center;
          }
          .header h2 {
            margin: 0;
            font-size: 24px;
            font-weight: 600;
          }
          .content { 
            padding: 30px;
          }
          .info-section {
            background: #f9fafb;
            border-left: 4px solid #636b2f;
            padding: 15px;
            margin: 20px 0;
            border-radius: 4px;
          }
          .info-section p {
            margin: 8px 0;
          }
          .label {
            font-weight: 600;
            color: #636b2f;
          }
          .message-box { 
            background: #ffffff;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 20px;
            margin: 20px 0;
          }
          .message-box h3 {
            margin-top: 0;
            color: #1a1a1a;
            font-size: 16px;
          }
          .message-content {
            white-space: pre-wrap;
            word-wrap: break-word;
            color: #374151;
            line-height: 1.7;
          }
          .metadata { 
            font-size: 13px; 
            color: #6b7280;
            margin-top: 25px; 
            padding-top: 20px; 
            border-top: 1px solid #e5e7eb;
          }
          .metadata p {
            margin: 6px 0;
          }
          .reply-note {
            background: #fef3c7;
            border-left: 4px solid #f59e0b;
            padding: 12px;
            margin: 20px 0;
            border-radius: 4px;
            font-size: 14px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h2>📬 New Feedback Received</h2>
          </div>
          <div class="content">
            <div class="info-section">
              <p><span class="label">From:</span> ${params.firstName} ${params.lastName}</p>
              <p><span class="label">Email:</span> ${params.email}</p>
              <p><span class="label">User ID:</span> ${params.userId}</p>
              <p><span class="label">Submitted:</span> ${formattedDate}</p>
            </div>
            
            <div class="reply-note">
              💡 <strong>Reply directly to this email</strong> to respond to the user at ${params.email}
            </div>
            
            <div class="message-box">
              <h3>Feedback Message:</h3>
              <div class="message-content">${params.feedbackMessage.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>
            </div>
            
            <div class="metadata">
              <p><strong>Technical Details:</strong></p>
              <p>IP Address: ${params.ipAddress}</p>
              <p>User Agent: ${params.userAgent}</p>
            </div>
          </div>
        </div>
      </body>
      </html>
    `;
  }
}

// Singleton instance
export const emailCoreService = new EmailCoreService();