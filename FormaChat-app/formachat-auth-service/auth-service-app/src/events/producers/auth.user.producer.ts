import { publishMessage } from '../../config/auth.rabbitmq';
import { UserCreatedEventData } from '../../types/auth.events';
import { CryptoUtils } from '../../utils/auth.crypto.utils';
import { createLogger } from '../../utils/auth.logger.utils';

const logger = createLogger('user-producer');

/**
 * Publish user.created event when a new user registers
 * Triggers welcome email from email service
 */
export async function publishUserCreated(data: UserCreatedEventData): Promise<void> {
  try {
    const eventId = CryptoUtils.generateUUID();

    logger.info('Publishing user.created event', {
      eventId,
      userId: data.userId,
      email: data.email
    });

    await publishMessage('userCreated', data, {
      eventId,
      eventType: 'user.created',
      persistent: true,
      priority: 5 // Higher priority for welcome emails
    });

    logger.info('user.created event published successfully', { eventId });
  } catch (error: any) {
    logger.error('Failed to publish user.created event', {
      userId: data.userId,
      error: error.message
    });
    // Don't throw - we don't want registration to fail if email publishing fails
    // Email service can be down, but user should still be created
  }
}