// src/events/producers/email.response.producer.ts
import { publishMessage } from '../../config/email.rabbitmq';
import { logger } from '../../utils/email.logger.utils';

export interface EmailResponseEventData {
  eventId: string; // References original event that triggered the email
  userId: string;
  email: string;
  emailType: 'welcome' | 'otp' | 'password_reset' | 'password_changed' | 'account_deactivated';
  status: 'sent' | 'failed' | 'bounced';
  sentAt?: Date;
  error?: string;
  provider?: string; // e.g., 'sendgrid', 'smtp'
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
  emailType: EmailResponseEventData['emailType'],
  provider?: string
): EmailResponseEventData {
  return {
    eventId,
    userId,
    email,
    emailType,
    status: 'sent',
    sentAt: new Date(),
    provider: provider || 'smtp'
  };
}

/**
 * Helper function to create a failure response
 */
export function createFailureResponse(
  eventId: string,
  userId: string,
  email: string,
  emailType: EmailResponseEventData['emailType'],
  error: string,
  provider?: string
): EmailResponseEventData {
  return {
    eventId,
    userId,
    email,
    emailType,
    status: 'failed',
    error,
    provider: provider || 'smtp'
  };
}

/**
 * Helper function to create a bounced response
 */
export function createBouncedResponse(
  eventId: string,
  userId: string,
  email: string,
  emailType: EmailResponseEventData['emailType'],
  error: string,
  provider?: string
): EmailResponseEventData {
  return {
    eventId,
    userId,
    email,
    emailType,
    status: 'bounced',
    error,
    provider: provider || 'smtp'
  };
}