import { OTPModel, IOTP } from "../persistence/auth.user.models";
import { CryptoUtils } from "../utils/auth.crypto.utils";
import { AuditService } from "./auth.audit.service";
import { redisManager } from "../config/auth.redis";
import { env } from "../config/auth.env";
import { createLogger } from "../utils/auth.logger.utils";

const logger = createLogger("otp-service");

export interface OTPGenerateOptions {
  userId: string;
  type: 'email_verification' | 'password_reset' | '2fa';
  metadata: {
    ipAddress: string;
    userAgent: string;
    deviceFingerprint?: string;
  };
}

export interface OTPVerificationResult {
  valid: boolean;
  error?: string;
  otpRecord?: IOTP;
}

/**
 *  OTP service generation, storage and verification
*/

export class OTPService {

  /**
   * Generate OTP and store in both REdis and MongoDB 
  */

  async generateOTP(options: OTPGenerateOptions): Promise<{otp:string, otpId: string}> {
    try {
      const {userId, type, metadata} = options;

      // Generate OTP

      const otp = CryptoUtils.generateSecureRandom(env.OTP_LENGTH);
      const otpId = CryptoUtils.generateUUID();

      // Hash OTP for secure storage

      const hashedOTP = await CryptoUtils.hashData(otp);

      // Calculate expiration

      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + env.OTP_EXPIRY_MINUTES);

      // Store in MOngoDB (hashed) 
      await OTPModel.create({
        userId,
        type,
        hashedOTP,
        expiresAt,
        used: false,
        metadata,
      });


      // Store in Redis (plaintext) with OTP ID as key
      await redisManager.storePlainOTP(otpId, otp, env.OTP_EXPIRY_MINUTES * 60)

       // Also store hashed version in Redis for faster verification (optional)
      await redisManager.storeHashedOTP(`${userId}:${type}`, hashedOTP, env.OTP_EXPIRY_MINUTES);

      // Log OTP generation
      await AuditService.logAuthEvent({
        userId,
        eventType: 'otp_requested',
        success: true,
        metadata
      });

      logger.info('OTP generated', {userId, type, otpId});


      // TODO: Publish otp.generated event (with otpid only, not actual otp)
      // await eventproducer.publishOTPGeneration({otpid, userid, type});

      return {otp, otpId};
    } catch (error: any) {
      logger.error('Error generating OTP:' ,error);
      throw new Error('OTP_GENERATION_FAILED');
    }
  }

  /**
   * Verify OTP 
  */

  async verifyOTP(userId: string, otp: string, type: string): Promise<OTPVerificationResult> {
    try {

      // Find the latest non-expired, non-used OTP FOR THIS USER AND TYPE

      const otpRecord = await OTPModel.findOne({
        userId,
        type,
        used: false,
        expiresAt: {$gt: new Date()}

      }).sort({createdAt: -1});

      if (!otpRecord) {
        await AuditService.logAuthEvent({
          userId,
          eventType: 'otp_failed',
          success: false,
          metadata: {
            ipAddress: 'unknown', // would come from verification context
            userAgent: 'unknown',
            reason: 'NO active OTP found'
          }
        });

        return {valid: false, error: 'OTP_NOT_FOUND_OR_EXPIRED'}
      }

      // Verify OTP

      const isValid = await CryptoUtils.compareHash(otp, otpRecord.hashedOTP);

      if (!isValid) {
        await AuditService.logAuthEvent({
          userId,
          eventType: 'otp_failed',
          success: false,
          metadata: {
            ipAddress: 'unknown',
            userAgent: 'unknown',
            reason: 'Invalid OTP code'
          }
        });
        return {valid: false, error: 'INVALID_OTP'};
      }

      // Mark OTP as used
      otpRecord.used = true;
      await otpRecord.save();

      await AuditService.logAuthEvent({
        userId,
        eventType: 'otp_verified',
        success: true,
        metadata: {
          ipAddress: 'unknown',
          userAgent: 'unknown'
        }
      });

      logger.info('OTP verified successfully', {userId, type});

      return {valid: true, otpRecord};
    } catch(error:any) {
      logger.error('Error verifying OTP:', error);
      return {valid: false, error: 'OTP_VERIFICATION_FAILED'};
    }
  }

  /**
   * Get OTP by ID from Redis (for internal API)
  */

  async getOTPForEmail(otpId: string): Promise<string | null> {
  try {
    logger.debug('Retrieving OTP for email service', { otpId });
    
    // Get plain OTP from Redis (automatically deletes on retrieval)
    const otp = await redisManager.getPlainOTP(otpId);
    
    if (otp) {
      logger.info('OTP retrieved for email service', { otpId });
    } else {
      logger.warn('OTP not found in Redis for email service', { otpId });
    }
    
    return otp;
  } catch (error:any) {
    logger.error('Error getting OTP for email service:', error);
    throw new Error('OTP_RETRIEVAL_FAILED');
  }
}

  /**
   * CHeck if OPT is expired 
  */

  async isOTPExpired(otpId:string): Promise<boolean> {
    try {
      const otpRecord = await OTPModel.findOne({_id:otpId});
      if (!otpRecord) return true;

      return otpRecord.expiresAt < new Date();
    } catch (error: any) {
      logger.error('Error checking OTP exoiration:', error);
      return true;
    }
  }

  /**
   * Invalidate OTP (mark as used) 
  */

  async invalidateOTP(otpId: string): Promise<void> {
    try {
      await OTPModel.findByIdAndUpdate(otpId, {used:true});
      await redisManager.deleteOTP(otpId); // Also remove from redis
    } catch (error: any) {
      logger.error('Error invalidating OTP:', error);
      throw new Error('OTP_INVALIDATION_FAILED');
    }
  }

  /**
   *  Clean up expired OTPs (caN be called by a scheduled job)
  */

  async cleanupExpiredOTPs(): Promise<number> {
    try {
      const result = await OTPModel.deleteMany({
        expiresAt: {$lt: new Date()} 
      });

      logger.info('Expired OTPs cleaned up', {deletedCount: result.deletedCount});
      return result.deletedCount || 0;

    } catch (error: any) {
      logger.error('Error cleaning up expired OTPs:', error);
      throw new Error('OTP_CLEANUP_FAILED');
    }
  }

  /**
   * Get OTP usage statistics for a user
  */

  async getOTPStats(userId: string): Promise<{total: number, used: number; expired: number}> {
    try {
      const [total, used, expired] = await Promise.all([
        OTPModel.countDocuments({userId}),
        OTPModel.countDocuments({userId, used: true}),
        OTPModel.countDocuments({userId, expiresAt: {$lt: new Date()}})
      ]);

      return {total, used, expired};
    } catch (error: any) {
      logger.error('Error getting OTP stats:', error);
      throw new Error('OTP_STATS_FETCH_FAILED');
    }
  }
}


// Export for convenience

export const otpService = new OTPService()