import axios from 'axios';
import { createLogger } from './email.logger.utils';
import { env } from '../config/email.env';

const logger = createLogger('auth-api-utils');

/**
 * Fetch plain OTP from Auth service's internal API
 */
export async function getOTPFromAuth(otpId: string): Promise<string | null> {
  try {
    logger.debug('Fetching OTP from Auth service', { otpId });

    // TODO: Move these to environment variables
    const AUTH_SERVICE_URL = env.AUTH_SERVICE_URL;
    const INTERNAL_SERVICE_SECRET = env.INTERNAL_SERVICE_SECRET;

    const response = await axios.get(
      `${AUTH_SERVICE_URL}/api/v1/auth/internal/otp/${otpId}`,
      {
        headers: {
          'x-service-token': INTERNAL_SERVICE_SECRET,
          'Content-Type': 'application/json'
        },
        timeout: 5000
      }
    );

    if (response.data.success && response.data.data?.otp) {
      logger.info('OTP retrieved successfully', { otpId });
      return response.data.data.otp;
    }

    logger.warn('OTP not found in response', { otpId });
    return null;

  } catch (error: any) {
    logger.error('Failed to fetch OTP from Auth', { 
      otpId, 
      error: error.message,
      status: error.response?.status,
      statusText: error.response?.statusText,
      url: error.config?.url
    });
    return null;
  }
}

