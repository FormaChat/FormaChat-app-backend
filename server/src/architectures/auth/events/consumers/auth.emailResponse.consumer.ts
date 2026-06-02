import { consumeMessages } from '../../config/auth.rabbitmq';
import { logger } from '../../utils/auth.logger.utils';
import mongoose from 'mongoose';
import { AuthLogModel } from '../../persistence/auth.user.models';
/**
 * Email response message structure from email service
 */
export interface EmailResponseMessage {
  eventId: string; // Original event ID that triggered the email
  userId: string;
  email: string;
  emailType: 'welcome' | 'otp' | 'password_reset' | 'password_changed' | 'account_deactivated';
  status: 'sent' | 'failed' | 'bounced';
  timestamp: Date;
  sentAt?: Date;
  failedAt?: Date;
  error?: string;
  provider?: string;
  retryable?: boolean;
  errorCode?: string;
  finalAttempt?: boolean;
  metadata?: {
    retryCount?: number;
    originalTimestamp?: Date;
    duration?: number;
    [key: string]: any;
  };
}

/**
 * Service for handling email response events
 */
export class EmailResponseService {
  /**
   * Handle successful email delivery
   */
  private async handleEmailSent(response: EmailResponseMessage): Promise<void> {
    try {
      logger.info('✅ Email successfully delivered', {
        eventId: response.eventId,
        userId: response.userId,
        emailType: response.emailType,
        provider: response.provider,
        sentAt: response.sentAt
      });

      // Update user record or audit log
      await this.updateEmailDeliveryStatus(response.userId, response.emailType, 'sent', {
        eventId: response.eventId,
        sentAt: response.sentAt,
        provider: response.provider
      });

      // Specific actions based on email type
      switch (response.emailType) {
        case 'welcome':
          await this.handleWelcomeEmailSent(response);
          break;
        case 'otp':
          await this.handleOTPEmailSent(response);
          break;
        case 'password_reset':
          await this.handlePasswordResetEmailSent(response);
          break;
        case 'password_changed':
          await this.handlePasswordChangedEmailSent(response);
          break;
        case 'account_deactivated':
          await this.handleAccountDeactivatedEmailSent(response);
          break;
      }
    } catch (error: any) {
      logger.error('Failed to process email sent event', {
        eventId: response.eventId,
        userId: response.userId,
        emailType: response.emailType,
        error: error.message
      });
    }
  }

  /**
   * Handle email delivery failure
   */
  private async handleEmailFailed(response: EmailResponseMessage): Promise<void> {
    try {
      logger.warn('❌ Email delivery failed', {
        eventId: response.eventId,
        userId: response.userId,
        emailType: response.emailType,
        error: response.error,
        retryable: response.retryable,
        finalAttempt: response.finalAttempt,
        provider: response.provider
      });

      // Update failure status
      await this.updateEmailDeliveryStatus(response.userId, response.emailType, 'failed', {
        eventId: response.eventId,
        error: response.error,
        errorCode: response.errorCode,
        retryable: response.retryable,
        finalAttempt: response.finalAttempt,
        failedAt: response.failedAt
      });

      // Take action based on email type and failure
      if (response.finalAttempt) {
        await this.handlePermanentEmailFailure(response);
      }

      // Alert for critical failures
      if (this.isCriticalFailure(response)) {
        await this.alertCriticalFailure(response);
      }
    } catch (error: any) {
      logger.error('Failed to process email failure event', {
        eventId: response.eventId,
        userId: response.userId,
        emailType: response.emailType,
        error: error.message
      });
    }
  }

  /**
   * Handle email bounce
   */
  private async handleEmailBounced(response: EmailResponseMessage): Promise<void> {
    try {
      logger.error('📨 Email bounced', {
        eventId: response.eventId,
        userId: response.userId,
        email: response.email,
        emailType: response.emailType,
        error: response.error,
        provider: response.provider
      });

      // Mark email as invalid in user profile
      await this.handleBouncedEmail(response.userId, response.email, response.emailType);

      // Update delivery status
      await this.updateEmailDeliveryStatus(response.userId, response.emailType, 'bounced', {
        eventId: response.eventId,
        error: response.error,
        failedAt: response.failedAt
      });
    } catch (error: any) {
      logger.error('Failed to process email bounce event', {
        eventId: response.eventId,
        userId: response.userId,
        emailType: response.emailType,
        error: error.message
      });
    }
  }

  /**
   * Email type specific handlers
   */
  private async handleWelcomeEmailSent(response: EmailResponseMessage): Promise<void> {
    logger.info('Welcome email delivered successfully', {
      userId: response.userId,
      email: response.email,
      eventId: response.eventId
    });
    
    // You might want to update user onboarding status
    // await userService.markWelcomeEmailSent(response.userId);
  }

  private async handleOTPEmailSent(response: EmailResponseMessage): Promise<void> {
    logger.info('OTP email delivered successfully', {
      userId: response.userId,
      email: response.email,
      eventId: response.eventId
    });
    
    // OTP email was sent - you might want to update OTP status
    // await otpService.markOTPSent(response.metadata?.otpId);
  }

  private async handlePasswordResetEmailSent(response: EmailResponseMessage): Promise<void> {
    logger.info('Password reset email delivered successfully', {
      userId: response.userId,
      email: response.email,
      eventId: response.eventId
    });
  }

  private async handlePasswordChangedEmailSent(response: EmailResponseMessage): Promise<void> {
    logger.info('Password changed notification delivered successfully', {
      userId: response.userId,
      email: response.email,
      eventId: response.eventId
    });
  }

  private async handleAccountDeactivatedEmailSent(response: EmailResponseMessage): Promise<void> {
    logger.info('Account deactivation email delivered successfully', {
      userId: response.userId,
      email: response.email,
      eventId: response.eventId
    });
  }

  /**
   * Handle permanent email failures
   */
  private async handlePermanentEmailFailure(response: EmailResponseMessage): Promise<void> {
    logger.error('🚫 Permanent email delivery failure', {
      userId: response.userId,
      email: response.email,
      emailType: response.emailType,
      error: response.error,
      eventId: response.eventId
    });

    // Critical actions for permanent failures
    switch (response.emailType) {
      case 'otp':
        // If OTP email fails permanently, you might want to:
        // - Notify user via alternative method
        // - Mark OTP as invalid
        // - Log security event
        break;
      
      case 'password_reset':
        // Critical - user can't reset password
        // Might need admin intervention
        await this.notifyAdminOfCriticalFailure(response);
        break;
    }
  }

  /**
   * Handle bounced emails (invalid email addresses)
   */
  private async handleBouncedEmail(userId: string, email: string, emailType: string): Promise<void> {
    logger.warn('Handling bounced email address', {
      userId,
      email,
      emailType
    });

    // You might want to:
    // - Mark user's email as invalid
    // - Require email verification
    // - Notify user to update email
    // await userService.markEmailAsBounced(userId, email);
  }

  /**
   * Check if failure is critical and requires immediate attention
   */
  private isCriticalFailure(response: EmailResponseMessage): boolean {
    const criticalEmailTypes = ['otp', 'password_reset'];
    const criticalErrors = ['invalid_email', 'bounced', 'rejected'];
    
    return (
      criticalEmailTypes.includes(response.emailType) &&
      response.status === 'failed' &&
      response.finalAttempt === true
    );
  }

  /**
   * Alert for critical failures (Slack, PagerDuty, etc.)
   */
  private async alertCriticalFailure(response: EmailResponseMessage): Promise<void> {
    // Implement your alerting logic here
    logger.error('🚨 CRITICAL: Email delivery failure requires attention', {
      userId: response.userId,
      emailType: response.emailType,
      error: response.error,
      eventId: response.eventId,
      timestamp: new Date().toISOString()
    });

    // Example: Send to Slack webhook
    // await slackService.sendAlert({...});
  }

  /**
   * Notify admin of critical failures
   */
  private async notifyAdminOfCriticalFailure(response: EmailResponseMessage): Promise<void> {
    // Implement admin notification logic
    logger.error('Admin notification required for email failure', {
      userId: response.userId,
      emailType: response.emailType,
      error: response.error,
      eventId: response.eventId
    });
  }

  /**
   * Update email delivery status in database
   */
  private async updateEmailDeliveryStatus(
    userId: string, 
    emailType: string, 
    status: string, 
    metadata: any
  ): Promise<void> {
    try {
      await AuthLogModel.create({
        userId: new mongoose.Types.ObjectId(userId),
        eventType: `email_${emailType}_${status}` as any, // You might need to extend enum
        success: status === 'sent',
        metadata: {
          ...metadata,
          emailType,
          deliveryStatus: status,
          provider: metadata.provider
        },
        timestamp: new Date()
      });

      logger.debug('Email delivery status updated', {
        userId,
        emailType,
        status,
        ...metadata
      });
    } catch (error: any) {
      logger.error('Failed to update email delivery status', {
        userId,
        emailType,
        status,
        error: error.message
      });
    }
  }

  /**
   * Main message handler for email responses
   */
  public async handleEmailResponse(message: EmailResponseMessage): Promise<void> {
    const { eventId, userId, email, emailType, status } = message;

    logger.info('📨 Received email response from email service', {
      eventId,
      userId,
      email,
      emailType,
      status,
      timestamp: message.timestamp
    });

    try {
      // Route to appropriate handler based on status
      switch (status) {
        case 'sent':
          await this.handleEmailSent(message);
          break;
        
        case 'failed':
          await this.handleEmailFailed(message);
          break;
        
        case 'bounced':
          await this.handleEmailBounced(message);
          break;
        
        default:
          logger.warn('Unknown email status received', { status, eventId });
      }

      logger.info('✅ Email response processed successfully', {
        eventId,
        userId,
        emailType,
        status
      });
    } catch (error: any) {
      logger.error('❌ Failed to process email response', {
        eventId,
        userId,
        emailType,
        status,
        error: error.message,
        stack: error.stack
      });
      
      // Don't throw - we don't want to retry processing the response
      // Just log the error for investigation
    }
  }
}

// Singleton instance
export const emailResponseService = new EmailResponseService();

/**
 * Start consuming email responses from email service
 */
export async function startEmailResponseConsumer(): Promise<void> {
  try {
    logger.info('Starting email response consumer...');

    await consumeMessages(
      'emailResponse', // Queue name from auth.rabbitmq.js
      (message: EmailResponseMessage) => emailResponseService.handleEmailResponse(message),
      {
        noAck: false // Manual acknowledgment
      }
    );

    logger.info('✅ Email response consumer started successfully');
  } catch (error: any) {
    logger.error('❌ Failed to start email response consumer', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Stop consuming email responses (for graceful shutdown)
 */
export async function stopEmailResponseConsumer(): Promise<void> {
  // You might want to implement this for graceful shutdown
  logger.info('Stopping email response consumer...');
}