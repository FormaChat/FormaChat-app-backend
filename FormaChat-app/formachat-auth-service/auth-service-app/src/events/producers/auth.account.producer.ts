
import { publishMessage } from '../../config/auth.rabbitmq';
import { UserDeactivatedEventData } from '../../types/auth.events';
import { CryptoUtils } from '../../utils/auth.crypto.utils';
import { createLogger } from '../../utils/auth.logger.utils';

const logger = createLogger('account-producer');

/**
 * Publish user.deactivated event when user account is deactivated
 * Triggers account deactivation confirmation email from email service
 */
export async function publishUserDeactivated(data: UserDeactivatedEventData): Promise<void> {
  try {
    const eventId = CryptoUtils.generateUUID();

    logger.info('Publishing user.deactivated event', {
      eventId,
      userId: data.userId,
      email: data.email,
    });

    await publishMessage('userDeactivated', data, {
      eventId,
      eventType: 'user.deactivated',
      persistent: true,
      priority: 6 // Medium-high priority
    });

    logger.info('user.deactivated event published successfully', { eventId });
  } catch (error: any) {
    logger.error('Failed to publish user.deactivated event', {
      userId: data.userId,
      error: error.message
    });
    // Don't throw - account is already deactivated
    // Email notification failure shouldn't rollback deactivation
  }
}