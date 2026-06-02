// src/events/producers/email.response.producer.ts
import { publishMessage } from '../../config/email.rabbitmq';
import { logger } from '../../utils/email.logger.utils';

/**
 * Valid email types that can be sent
 */
export type EmailType = 'welcome' | 'otp' | 'password_reset' | 'password_changed' | 'account_deactivated' | 'feedback';

/**
 * Email delivery status
 */
export type EmailStatus = 'sent' | 'failed' | 'bounced';

/**
 * Additional metadata for email responses
 */
export interface EmailResponseMetadata {
  retryCount?: number;
  originalTimestamp?: Date;
  duration?: number; // Time taken to send email in ms
  [key: string]: any; // Allow additional custom metadata
}

/**
 * Email response event data structure
 */
export interface EmailResponseEventData {
  eventId: string; // References original event that triggered the email
  userId: string;
  email: string;
  emailType: EmailType;
  status: EmailStatus;
  timestamp: Date; // Always present - when this response was created
  sentAt?: Date; // Only for successful sends
  failedAt?: Date; // Only for failures and bounces
  error?: string;
  provider?: string; // e.g., 'sendgrid', 'smtp'
  retryable?: boolean;
  errorCode?: string;
  finalAttempt?: boolean;
  metadata?: EmailResponseMetadata; // Additional contextual information
}

/**
 * Publish email response back to Auth service
 * 
 * This uses:
 * - Queue: 'auth.email.response'
 * - Exchange: 'auth.exchange' (auth service exchange)
 * - Routing Key: 'email.response.auth'
 * 
 * The auth service should be listening to this queue to receive email status updates.
 */
export async function publishEmailResponse(response: EmailResponseEventData): Promise<void> {
  try {
    await publishMessage(
      'authEmailResponse', // Key from routingKeys in rabbitmq.js
      response,
      {
        eventId: response.eventId,
        eventType: `email.response.${response.emailType}`,
        targetExchange: 'auth.exchange', // Explicitly target auth exchange
        persistent: true,
        priority: 0
      }
    );

    logger.info('Email response published to auth service', {
      eventId: response.eventId,
      userId: response.userId,
      emailType: response.emailType,
      status: response.status,
      queue: 'auth.email.response',
      routingKey: 'email.response.auth'
    });
  } catch (error: any) {
    logger.error('Failed to publish email response', {
      eventId: response.eventId,
      userId: response.userId,
      emailType: response.emailType,
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
}

/**
 * Helper function to create a success response
 */
export function createSuccessResponse(
  eventId: string,
  userId: string,
  email: string,
  emailType: EmailType,
  provider?: string,
  metadata?: EmailResponseMetadata
): EmailResponseEventData {
  const now = new Date();
  
  return {
    eventId,
    userId,
    email,
    emailType,
    status: 'sent',
    timestamp: now,
    sentAt: now,
    provider: provider || 'smtp',
    metadata
  };
}

/**
 * Helper function to create a failure response
 */
export function createFailureResponse(
  eventId: string,
  userId: string,
  email: string,
  emailType: EmailType,
  error: string,
  options?: {
    provider?: string;
    retryable?: boolean;
    errorCode?: string;
    finalAttempt?: boolean;
    metadata?: EmailResponseMetadata;
  }
): EmailResponseEventData {
  const now = new Date();
  
  return {
    eventId,
    userId,
    email,
    emailType,
    status: 'failed',
    timestamp: now,
    failedAt: now,
    error,
    provider: options?.provider || 'smtp',
    retryable: options?.retryable,
    errorCode: options?.errorCode,
    finalAttempt: options?.finalAttempt,
    metadata: options?.metadata
  };
}

/**
 * Helper function to create a bounced response
 */
export function createBouncedResponse(
  eventId: string,
  userId: string,
  email: string,
  emailType: EmailType,
  error: string,
  provider?: string,
  metadata?: EmailResponseMetadata
): EmailResponseEventData {
  const now = new Date();
  
  return {
    eventId,
    userId,
    email,
    emailType,
    status: 'bounced',
    timestamp: now,
    failedAt: now,
    error,
    provider: provider || 'smtp',
    metadata
  };
}