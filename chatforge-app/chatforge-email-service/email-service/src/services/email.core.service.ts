import axios from 'axios';
import { logger } from '../utils/email.logger.utils';



/**
 * Fetch plain OTP from Auth service's internal API
 * @param otpId - The OTP ID from the queue message
 * @returns Plain OTP string or null if not found
 */
// async getOTPFromAuth(otpId: string): Promise<string | null> {
//   try {
//     logger.debug('Fetching OTP from Auth service', { otpId });

//     const response = await axios.get(
//       `${env.AUTH_SERVICE_URL}/internal/otp/${otpId}`,
//       {
//         headers: {
//           'x-service-token': env.INTERNAL_SERVICE_SECRET,
//           'Content-Type': 'application/json'
//         },
//         timeout: 5000 // 5 second timeout
//       }
//     );

//     if (response.data.success && response.data.data?.otp) {
//       logger.info('OTP retrieved successfully from Auth service', { otpId });
//       return response.data.data.otp;
//     }

//     logger.warn('OTP not found in Auth service response', { otpId });
//     return null;

//   } catch (error: any) {
//     if (error.response?.status === 401) {
//       logger.error('Unauthorized: Invalid service token when calling Auth service', { otpId });
//     } else if (error.response?.status === 404) {
//       logger.warn('OTP not found or expired in Auth service', { otpId });
//     } else {
//       logger.error('Failed to fetch OTP from Auth service', { 
//         otpId, 
//         error: error.message 
//       });
//     }
//     return null;
//   }
// }