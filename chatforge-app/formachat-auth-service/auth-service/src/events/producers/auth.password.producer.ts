import { publishMessage } from '../../config/auth.rabbitmq';
import { PasswordChangedEventData } from '../../types/auth.events';
import { CryptoUtils } from '../../utils/auth.crypto.utils';
import { createLogger } from '../../utils/auth.logger.utils';

const logger = createLogger('password-producer');

/**
 * Publish password.changed event when user changes their password
 * Triggers password change confirmation email from email service
 */
export async function publishPasswordChanged(data: PasswordChangedEventData): Promise<void> {
  try {
    const eventId = CryptoUtils.generateUUID();

    logger.info('Publishing password.changed event', {
      eventId,
      userId: data.userId,
      email: data.email
    });

    await publishMessage('passwordChanged', data, {
      eventId,
      eventType: 'password.changed',
      persistent: true,
      priority: 7 // High priority - security notification
    });

    logger.info('password.changed event published successfully', { eventId });
  } catch (error: any) {
    logger.error('Failed to publish password.changed event', {
      userId: data.userId,
      error: error.message
    });
    // Don't throw - password is already changed
    // Email notification failure shouldn't rollback password change
  }
}