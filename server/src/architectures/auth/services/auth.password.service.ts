import { createHash } from "crypto";
import { CryptoUtils } from "../utils/auth.crypto.utils";
import {env} from "../config/auth.env";
import { createLogger } from "../utils/auth.logger.utils";


const logger = createLogger('password-service')

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[]
}

export interface PasswordChangeResult {
  success: boolean;
  message: string;
}

/**
 * Password service handling password alidation, hashing and verification 
*/

export class PasswordService {

  /**
   * Validate password strength based on environment rules 
  */

  static validatePasswordStrength(password: string): PasswordValidationResult {
    const errors: string[] = [];

    // Check minimum length

    if (password.length < env.MIN_PASSWORD_LENGTH) {
      errors.push(`Password must be at least ${env.MIN_PASSWORD_LENGTH} characters long`);
    }

    // Check maximun length

    if (password.length > env.MAX_PASSWORD_LENGTH) {
      errors.push(`Passwordmust be less than ${env.MAX_PASSWORD_LENGTH} characters`)
    }

    // Check for at least one uppercase letter

    if (!/(?=.*[A-Z])/.test(password)) {
      errors.push("Password must contain at least one uppercase letter")
    }

    // Check for at least one lowercase letter

    if (!/(?=.*[a-z])/.test(password)) {
      errors.push("Password must contain at least one lowercase letter");
    }

    // Check for at least one number

    if (!/(?=.*\d)/.test(password)) {
      errors.push('Password must contain at least one number');
    }

    // Check for at least one special character

    if (!/(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?])/.test(password)) {
      errors.push('Passord must contain at least one special character');
    }

    // Check for a common weak passwords (basic check)

    const weakPassword = ['password', '123456', 'qwerty', 'letmein', 'welcome'];

    if (weakPassword.includes(password.toLowerCase())) {
      errors.push('Password is too common and easily guessable');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }

  /**
   *Hash password using crypto utils 
  */
  
  static async hashPassword(plainPassword: string): Promise<string> {
    try {
      logger.debug("Hashing password");
      return await CryptoUtils.hashSensitive(plainPassword);
    } catch (error: any) {
      logger.error('Error hashing password:', error);
      throw new Error("PASSWORD_HASHING_FAILED");
    }
  }

  /**
   * Compare plain password with hashed password 
  */

  static async comparePassword(plainPassword:string, hashedPassword: string): Promise<boolean> {
    try {
      logger.debug('Comparing password with hash');
      return await CryptoUtils.compareHash(plainPassword, hashedPassword);
    } catch (error: any) {
      logger.error('Error comparing passwrod:', error);
      throw new Error("PASSWORD_COMPARISON_FAILED");
    }
  }

  /**
   *  CHeck if password is different from current hash
  */

  static async isPasswordDifferent(plainPassword: string, hashedPassword:string): Promise<boolean> {
    return !(await this.comparePassword(plainPassword, hashedPassword));
  }

  /**
   * Generate a secure random password
  */

  static generateSecurePassword(length: number = 16): string {
    const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = ''

    // Ensure at least one of each required character type

    password += 'A' // uppercase
    password += 'a' // lowercase
    password += '1' // number
    password += '!' // special 

    // Fill the rest with random characters

    for (let i = password.length; i < length; i++) {
      const randomIndex = Math.floor(Math.random() * charset.length);
      password += charset[randomIndex];
    }

    // Shuffle the password

    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  /**
   * Check if password has been compromised in known breaches, using the
   * Have I Been Pwned Pwned Passwords k-anonymity API. Only the first 5 hex
   * characters of the password's SHA-1 hash are ever sent - the full hash
   * (and never the plaintext) leaves this service.
   * Fails open: if HIBP is unreachable or errors, we do not block the user.
  */

  static async checkPasswordBreach(password: string): Promise<boolean> {
    try {
      const sha1 = createHash('sha1').update(password).digest('hex').toUpperCase();
      const prefix = sha1.slice(0, 5);
      const suffix = sha1.slice(5);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      let response: Response;
      try {
        response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
          signal: controller.signal,
          headers: { 'Add-Padding': 'true' }
        });
      } finally {
        clearTimeout(timeout);
      }

      if (!response.ok) {
        logger.warn('HIBP API returned non-OK status, failing open', { status: response.status });
        return false;
      }

      const body = await response.text();
      return body.split('\n').some(line => line.split(':')[0].trim() === suffix);
    } catch (error: any) {
      logger.warn('HIBP breach check failed, failing open (not blocking user)', { error: error.message });
      return false;
    }
  }

}

// Export individual functions for convenience

export const validatePasswordStrength = PasswordService.validatePasswordStrength;
export const hashPassword = PasswordService.hashPassword;
export const comparePassword = PasswordService.comparePassword;
export const isPasswordDifferent = PasswordService.isPasswordDifferent;
export const generateSecurePassword = PasswordService.generateSecurePassword;
export const checkPasswordBreach = PasswordService.checkPasswordBreach;
