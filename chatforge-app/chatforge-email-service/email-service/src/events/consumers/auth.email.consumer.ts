// events/consumers/auth.email.consumer.ts

import { consumeMessages, publishToDLQ } from '../../config/email.rabbitmq';
import { logger } from '../../utils/email.logger.utils';
import { emailCoreService } from '../../services/email.core.service';
import {
  publishEmailResponse,
  createSuccessResponse,
  createFailureResponse,
  EmailResponseEventData
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
 * Handler for user.created events
 * Sends welcome email to new users
 */
async function handleUserCreated(message: RabbitMQMessage): Promise<void> {
  const { eventId, data } = message;
  const retryCount = message.retryCount || 0;
  
  try {
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
  } catch (error: any) {
    logger.error('❌ Failed to send welcome email', {
      eventId,
      email: data.email,
      retryCount,
      error: error.message,
      errorCode: error.code
    });

    // Publish failure status back to Auth
    await publishEmailResponse(
      createFailureResponse(
        eventId,
        data.userId,
        data.email,
        'welcome',
        error.message
      )
    );

    // Handle retry logic
    await handleMessageFailure(message, error, 'welcome email');
  }
}

/**
 * Handler for otp.generated events
 * Sends OTP email based on type (email_verification, password_reset, 2fa)
 */
async function handleOTPGenerated(message: RabbitMQMessage): Promise<void> {
  const { eventId, data } = message;
  const retryCount = message.retryCount || 0;
  
  try {
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
  } catch (error: any) {
    logger.error('❌ Failed to send OTP email', {
      eventId,
      email: data.email,
      otpId: data.otpId,
      type: data.type,
      retryCount,
      error: error.message,
      errorCode: error.code
    });

    // Publish failure status back to Auth
    await publishEmailResponse(
      createFailureResponse(
        eventId,
        data.userId,
        data.email,
        'otp',
        error.message
      )
    );

    // Handle retry logic
    await handleMessageFailure(message, error, 'OTP email');
  }
}

/**
 * Handler for password.changed events
 * Sends password change confirmation email
 */
async function handlePasswordChanged(message: RabbitMQMessage): Promise<void> {
  const { eventId, data } = message;
  const retryCount = message.retryCount || 0;
  
  try {
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
  } catch (error: any) {
    logger.error('❌ Failed to send password changed email', {
      eventId,
      email: data.email,
      retryCount,
      error: error.message,
      errorCode: error.code
    });

    // Publish failure status back to Auth
    await publishEmailResponse(
      createFailureResponse(
        eventId,
        data.userId,
        data.email,
        'password_changed',
        error.message
      )
    );

    // Handle retry logic
    await handleMessageFailure(message, error, 'password changed email');
  }
}

/**
 * Handler for user.deactivated events
 * Sends account deactivation confirmation email
 */
async function handleUserDeactivated(message: RabbitMQMessage): Promise<void> {
  const { eventId, data } = message;
  const retryCount = message.retryCount || 0;
  
  try {
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
  } catch (error: any) {
    logger.error('❌ Failed to send account deactivated email', {
      eventId,
      email: data.email,
      retryCount,
      error: error.message,
      errorCode: error.code
    });

    // Publish failure status back to Auth
    await publishEmailResponse(
      createFailureResponse(
        eventId,
        data.userId,
        data.email,
        'account_deactivated',
        error.message
      )
    );

    // Handle retry logic
    await handleMessageFailure(message, error, 'account deactivated email');
  }
}

/**
 * Central error handling logic for message failures
 * Implements hybrid retry strategy:
 * - Retriable errors: Throw error to trigger NACK with requeue (if under retry limit)
 * - Permanent errors: Send to DLQ immediately (don't throw)
 * - Max retries exceeded: Send to DLQ (don't throw)
 */
async function handleMessageFailure(
  message: RabbitMQMessage,
  error: any,
  emailType: string
): Promise<void> {
  const retryCount = message.retryCount || 0;
  const isRetriable = isRetriableError(error);
  const hasExceededLimit = hasExceededRetryLimit(message);

  logger.info('Evaluating message failure strategy', {
    eventId: message.eventId,
    emailType,
    retryCount,
    maxRetries: MAX_RETRY_ATTEMPTS,
    isRetriable,
    hasExceededLimit,
    errorCode: error.code,
    errorMessage: error.message
  });

  // Case 1: Retriable error AND under retry limit → Requeue for retry
  if (isRetriable && !hasExceededLimit) {
    logger.warn('⚠️ Retriable error detected - message will be requeued', {
      eventId: message.eventId,
      emailType,
      retryCount,
      nextRetry: retryCount + 1,
      errorCode: error.code
    });

    // Increment retry count in the message
    message.retryCount = retryCount + 1;

    // Throw error to trigger NACK(msg, false, false) in rabbitmq.js
    // This sends message to DLQ, but we'll configure DLX with TTL for delayed retry
    throw error;
  }

  // Case 2: Permanent error OR max retries exceeded → Send to DLQ
  if (!isRetriable) {
    logger.error('🚫 Permanent error detected - sending to DLQ', {
      eventId: message.eventId,
      emailType,
      errorCode: error.code,
      errorMessage: error.message
    });
  } else if (hasExceededLimit) {
    logger.error('🚫 Max retry limit exceeded - sending to DLQ', {
      eventId: message.eventId,
      emailType,
      retryCount,
      maxRetries: MAX_RETRY_ATTEMPTS
    });
  }

  // Send to DLQ with detailed metadata
  await publishToDLQ(
    message,
    isRetriable ? 'Max retries exceeded' : 'Permanent failure',
    {
      emailType,
      retryCount,
      errorCode: error.code,
      errorMessage: error.message,
      errorStack: error.stack,
      isRetriable,
      timestamp: new Date().toISOString()
    }
  );

  // DON'T throw error here - this allows the message to be ACKed
  // and removed from the original queue (already in DLQ)
}