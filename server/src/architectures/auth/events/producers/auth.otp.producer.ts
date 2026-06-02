// events/producers/auth.otp.producer.ts

import { publishMessage } from '../../config/auth.rabbitmq';
import { OTPGeneratedEventData } from '../../types/auth.events';
import { CryptoUtils } from '../../utils/auth.crypto.utils';
import { createLogger } from '../../utils/auth.logger.utils';

const logger = createLogger('otp-producer');

/**
 * Publish otp.generated event when an OTP is created
 * Triggers OTP email from email service based on type (email_verification, password_reset, 2fa)
 * Note: Does NOT send actual OTP - email service fetches it from Auth API using otpId
 */
export async function publishOTPGenerated(data: OTPGeneratedEventData): Promise<void> {
  try {
    const eventId = CryptoUtils.generateUUID();

    logger.info('Publishing otp.generated event', {
      eventId,
      userId: data.userId,
      email: data.email,
      otpId: data.otpId,
      type: data.type
    });

    await publishMessage('otpGenerated', data, {
      eventId,
      eventType: 'otp.generated',
      persistent: true,
      priority: 8 // Highest priority - OTPs are time-sensitive
    });

    logger.info('otp.generated event published successfully', { eventId, type: data.type });
  } catch (error: any) {
    logger.error('Failed to publish otp.generated event', {
      userId: data.userId,
      otpId: data.otpId,
      type: data.type,
      error: error.message
    });
    // Don't throw - OTP is already generated and stored
    // Email service failure shouldn't break OTP generation
  }
}