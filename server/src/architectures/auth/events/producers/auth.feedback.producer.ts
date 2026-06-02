// events/producers/auth.feedback.producer.ts

import { publishMessage } from '../../config/auth.rabbitmq';
import { FeedbackSubmittedEventData } from '../../types/auth.events';
import { CryptoUtils } from '../../utils/auth.crypto.utils';
import { createLogger } from '../../utils/auth.logger.utils';

const logger = createLogger('feedback-producer');

/**
 * Publish feedback.submitted event when user submits feedback
 * Triggers feedback email to support@formachat.com from email service
 */
export async function publishFeedbackSubmitted(data: FeedbackSubmittedEventData): Promise<void> {
  try {
    const eventId = CryptoUtils.generateUUID();

    logger.info('Publishing feedback.submitted event', {
      eventId,
      userId: data.userId,
      email: data.email
    });

    await publishMessage('feedbackSubmitted', data, {
      eventId,
      eventType: 'feedback.submitted',
      persistent: true,
      priority: 7
    });

    logger.info('feedback.submitted event published successfully', { eventId });
  } catch (error: any) {
    logger.error('Failed to publish feedback.submitted event', {
      userId: data.userId,
      error: error.message
    });
    // Don't throw - feedback submission shouldn't fail user experience
    throw error; // But we do want to notify the user if it fails
  }
}