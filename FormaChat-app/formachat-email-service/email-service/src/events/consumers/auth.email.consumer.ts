// events/consumers/auth.email.consumer.ts

import { consumeMessages, publishToDLQ } from '../../config/email.rabbitmq';
import { logger } from '../../utils/email.logger.utils';
import { emailCoreService } from '../../services/email.core.service';
import {
  publishEmailResponse,
  createSuccessResponse,
  createFailureResponse,
} from '../producers/email.response.producer';

/**
 * Message structure from RabbitMQ
 */
interface RabbitMQMessage {
  eventId: string;
  eventType: string;
  timestamp: number;
  data: any;
  retryCount?: number; // Track retry attempts
}


/**
 * Valid email types that can be sent
 */
type EmailType = 'otp' | 'password_reset' | 'password_changed' | 'welcome' | 'account_deactivated';



/**
 * Retriable error codes/patterns
 * These errors indicate temporary failures that should be retried
 */
const RETRIABLE_ERROR_PATTERNS = [
  // Network errors
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ENETUNREACH',
  'EAI_AGAIN',
  
  // SMTP specific
  'SMTP_TIMEOUT',
  'SMTP_UNAVAILABLE',
  'RATE_LIMIT',
  'TEMPORARY_FAILURE',
  '4.', // SMTP 4xx errors are temporary
  
  // Service unavailable
  'SERVICE_UNAVAILABLE',
  'INTERNAL_ERROR',
  'TIMEOUT'
];

/**
 * Maximum retry attempts before sending to DLQ
 */
const MAX_RETRY_ATTEMPTS = 3;

/**
 * Check if an error should trigger a retry
 */
function isRetriableError(error: any): boolean {
  if (!error) return false;
  
  const errorString = `${error.code || ''} ${error.message || ''}`.toUpperCase();
  
  return RETRIABLE_ERROR_PATTERNS.some(pattern => 
    errorString.includes(pattern.toUpperCase())
  );
}

/**
 * Check if message has exceeded retry limit
 */
function hasExceededRetryLimit(message: RabbitMQMessage): boolean {
  const retryCount = message.retryCount || 0;
  return retryCount >= MAX_RETRY_ATTEMPTS;
}

/**
 * Start consuming messages from all Auth service queues
 */
export async function startAuthEmailConsumer(): Promise<void> {
  try {
    logger.info('Starting Auth email consumers...');

    // Consume from user.created queue
    await consumeMessages('authUserCreated', handleUserCreated);
    
    // Consume from otp.generated queue
    await consumeMessages('authOtpGenerated', handleOTPGenerated);
    
    // Consume from password.changed queue
    await consumeMessages('authPasswordChanged', handlePasswordChanged);
    
    // Consume from user.deactivated queue
    await consumeMessages('authUserDeactivated', handleUserDeactivated);

    logger.info('✅ All Auth email consumers started successfully');
  } catch (error: any) {
    logger.error('❌ Failed to start Auth email consumers:', error);
    throw error;
  }
}

/**
 * Central retry handler for all email operations
 * Implements hybrid retry strategy:
 * - Retriable errors: Throw error to trigger NACK with requeue (if under retry limit)
 * - Permanent errors: Send to DLQ immediately (don't throw)
 * - Max retries exceeded: Send to DLQ (don't throw)
 * 
 * @param message - The RabbitMQ message
 * @param emailType - Type of email for logging/tracking
 * @param handler - The actual email sending logic
 */
async function handleWithRetry(
  message: RabbitMQMessage,
  emailType: EmailType,
  handler: (msg: RabbitMQMessage) => Promise<void>
): Promise<void> {
  const retryCount = message.retryCount || 0;
  
  try {
    // Execute the email sending logic
    await handler(message);
    // Success - consumer will ACK
  } catch (error: any) {
    const isRetriable = isRetriableError(error);
    const hasExceededLimit = retryCount >= MAX_RETRY_ATTEMPTS;
    
    logger.error(`❌ Failed to send ${emailType}`, {
      eventId: message.eventId,
      email: message.data.email,
      retryCount,
      error: error.message,
      errorCode: error.code,
      isRetriable,
      hasExceededLimit
    });

    // Publish failure status back to Auth
    await publishEmailResponse(
      createFailureResponse(
        message.eventId,
        message.data.userId,
        message.data.email,
        emailType,
        error.message
      )
    );

    // Case 1: Should retry - THROW to trigger NACK with requeue
    if (isRetriable && !hasExceededLimit) {
      message.retryCount = retryCount + 1;
      logger.warn(`Retriable error for ${emailType} - will retry`, { 
        eventId: message.eventId, 
        retryCount: message.retryCount,
        maxRetries: MAX_RETRY_ATTEMPTS
      });
      throw error; // This triggers RabbitMQ NACK with requeue
    }

    // Case 2: Permanent failure or max retries - send to DLQ and DON'T throw
    logger.error(`Sending ${emailType} to DLQ`, {
      eventId: message.eventId,
      isRetriable,
      hasExceededLimit,
      retryCount,
      reason: hasExceededLimit ? 'Max retries exceeded' : 'Permanent error'
    });

    await publishToDLQ(message, error.message, {
      emailType,
      retryCount,
      errorCode: error.code,
      isRetriable,
      finalAttempt: true
    });

    // DON'T throw here - message should be ACKed since it's in DLQ
  }
}

/**
 * Handler for user.created events
 * Sends welcome email to new users
 */
async function handleUserCreated(message: RabbitMQMessage): Promise<void> {
  await handleWithRetry(message, 'welcome', async (msg) => {
    const { eventId, data } = msg;
    const retryCount = msg.retryCount || 0;
    
    logger.info('Processing user.created event', {
      eventId,
      userId: data.userId,
      email: data.email,
      retryCount
    });

    // Send welcome email
    await emailCoreService.sendWelcomeEmail({
      email: data.email,
      firstName: data.firstName,
      lastName: data.lastName
    });

    // Publish success status back to Auth
    await publishEmailResponse(
      createSuccessResponse(
        eventId,
        data.userId,
        data.email,
        'welcome',
        'smtp'
      )
    );

    logger.info('✅ Welcome email sent successfully', { 
      eventId, 
      email: data.email,
      retryCount 
    });
  });
}

/**
 * Handler for otp.generated events
 * Sends OTP email based on type (email_verification, password_reset, 2fa)
 */
async function handleOTPGenerated(message: RabbitMQMessage): Promise<void> {
  await handleWithRetry(message, 'otp', async (msg) => {
    const { eventId, data } = msg;
    const retryCount = msg.retryCount || 0;
    
    logger.info('Processing otp.generated event', {
      eventId,
      userId: data.userId,
      email: data.email,
      otpId: data.otpId,
      type: data.type,
      retryCount
    });

    // Send OTP email
    await emailCoreService.sendOTPEmail({
      email: data.email,
      otpId: data.otpId,
      type: data.type,
      userId: data.userId
    });

    // Publish success status back to Auth
    await publishEmailResponse(
      createSuccessResponse(
        eventId,
        data.userId,
        data.email,
        'otp',
        'smtp'
      )
    );

    logger.info('✅ OTP email sent successfully', {
      eventId,
      email: data.email,
      type: data.type,
      retryCount
    });
  });
}

/**
 * Handler for password.changed events
 * Sends password change confirmation email
 */
async function handlePasswordChanged(message: RabbitMQMessage): Promise<void> {
  await handleWithRetry(message, 'password_changed', async (msg) => {
    const { eventId, data } = msg;
    const retryCount = msg.retryCount || 0;
    
    logger.info('Processing password.changed event', {
      eventId,
      userId: data.userId,
      email: data.email,
      retryCount
    });

    // Send password changed confirmation email
    await emailCoreService.sendPasswordChangedEmail({
      email: data.email,
      changedAt: data.changedAt
    });

    // Publish success status back to Auth
    await publishEmailResponse(
      createSuccessResponse(
        eventId,
        data.userId,
        data.email,
        'password_changed',
        'smtp'
      )
    );

    logger.info('✅ Password changed email sent successfully', {
      eventId,
      email: data.email,
      retryCount
    });
  });
}

/**
 * Handler for user.deactivated events
 * Sends account deactivation confirmation email
 */
async function handleUserDeactivated(message: RabbitMQMessage): Promise<void> {
  await handleWithRetry(message, 'account_deactivated', async (msg) => {
    const { eventId, data } = msg;
    const retryCount = msg.retryCount || 0;
    
    logger.info('Processing user.deactivated event', {
      eventId,
      userId: data.userId,
      email: data.email,
      retryCount
    });

    // Send account deactivation email
    await emailCoreService.sendAccountDeactivatedEmail({
      email: data.email,
      deactivatedAt: data.deactivatedAt,
      reason: data.reason
    });

    // Publish success status back to Auth
    await publishEmailResponse(
      createSuccessResponse(
        eventId,
        data.userId,
        data.email,
        'account_deactivated',
        'smtp'
      )
    );

    logger.info('✅ Account deactivated email sent successfully', {
      eventId,
      email: data.email,
      retryCount
    });
  });
}