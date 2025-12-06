import bcrypt from 'bcrypt';
import { randomBytes, randomInt, createHash } from 'crypto';
import {env} from '../config/auth.env';
import { createLogger } from './auth.logger.utils';

const logger = createLogger('crypto-utils');

/**
 * Centralized cryptographic utilities for auth service
 * ONly basic crypto operations -- no business logic
*/

export class CryptoUtils {

  /**
   * Hash data using bcrypt (for passwords)
   * NON-DETERMINISTIC - Use only for user passwords
  */

  static async hashSensitive(plainText: string): Promise<string> {
    try {
      const saltRounds = env.BCRYPT_ROUNDS;
      return await bcrypt.hash(plainText, saltRounds);
    } catch (error: any) {
      logger.error("Error hashing data: ", error);
      throw new Error('HASHING_FAILED')
    }
  }

  /**
   * NEW METHOD: Deterministic hash using SHA-256
   * Use for refresh tokens, session tokens, etc.
   * DETERMINISTIC - Same input always produces same output
   * FAST - Suitable for high-frequency operations
   * SECURE - One-way cryptographic hash
  */
  static hashDeterministic(plainText: string): string {
    try {
      return createHash('sha256')
        .update(plainText)
        .digest('hex');
    } catch (error: any) {
      logger.error("Error creating deterministic hash: ", error);
      throw new Error('DETERMINISTIC_HASH_FAILED');
    }
  }

  /**
   * Compare plain text with hash using bcrypt
  */

  static async compareHash(plainText: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(plainText, hash);
    } catch (error: any) {
      logger.error("Error comparing has: ", error);
      throw new Error("HASH_COMPARISON_FAILED");
    }
  }

  /**
   * Generate secure random string for OTPs 
  */

  static generateSecureRandom(length: number = env.OTP_LENGTH): string {
    try {
      // Use crypto.randomINt for secure random numbers

      let otp = '';
      for (let i = 0; i < length; i++){
        otp += randomInt(0,9).toString();
      }
      return otp;
    } catch (error: any) {
      logger.error("Error generating source: ", error);
      throw new Error("RANDOM_GENERATION_FAILED");
    }
  }

  /**
   * Generate UUID v4 
  */

  static generateUUID(): string {
    try {
      return randomBytes(16).toString('hex');
    } catch (error: any) {
      logger.error('Error generating UUID: ', error);
      throw new Error("UUID_GENERATION_FAILED");
    }
  }

  /**
   * Generate cryptographically secure random string
   * For tokens, IDs, etc 
  */

  static generateCryptoString(length: number = 32): string {
    try {
      return randomBytes(length).toString("hex");
    } catch (error: any) {
      logger.error("error generating crypto string: ", error);
      throw new Error("CRYPTO_STRING_GENERATION_FAILED");
    }
  }

  /**
   * Generate secure random bytes (for encryption keys, etc)
  */

  static generateRandomBytes(length: number): Buffer {
    try {
      return randomBytes(length);
    } catch (error: any) {
      logger.error("Error generating random bytes: ", error);
      throw new Error("RANDOM_BYTES_GENERATION_FAILED");
    }
  }

}

// Export individual functions for convenience

export const hashSensitive = CryptoUtils.hashSensitive;
export const hashDeterministic = CryptoUtils.hashDeterministic; // ✅ NEW EXPORT
export const compareHash = CryptoUtils.compareHash;
export const generateSecureRandom = CryptoUtils.generateSecureRandom;
export const generateUUID = CryptoUtils.generateUUID;
export const generateCryptoString = CryptoUtils.generateCryptoString;
export const generateRandomBytes = CryptoUtils.generateRandomBytes;