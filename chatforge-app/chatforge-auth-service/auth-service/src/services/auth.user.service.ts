import { UserModel, IUser, AuthLogModel } from '../persistence/auth.user.models';
import { PasswordService } from './auth.password.service';
import { AuditService } from './auth.audit.service';
import { createLogger } from '../utils/auth.logger.utils';

// producers
import { publishUserCreated } from '../events/producers/auth.user.producer';
import { publishPasswordChanged } from '../events/producers/auth.password.producer';
import { publishUserDeactivated } from '../events/producers/auth.account.producer';


const logger = createLogger('user-service');

export interface CreateUserData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
}

export interface LoginCredentials {
  email: string;
  password: string;
  ipAddress: string;
  userAgent: string;
}

export interface LoginResult {
  success: boolean;
  user?: IUser;
  error?: string;
  isLocked?: boolean;
  lockUntil?: Date;
}

export interface UpdateProfileData {
  firstName?: string;
  lastName?: string;
  email?: string;
}

/**
 * User service handling user lifecycle and authentication
 */
export class UserService {
  private readonly MAX_FAILED_ATTEMPTS = 5;
  private readonly LOCK_TIME = 30 * 60 * 1000; // 30 minutes

  /**
   * Register a new user
   */
  async registerUser(userData: CreateUserData, metadata: { ipAddress: string; userAgent: string }): Promise<IUser> {
    try {
      logger.info('Registering new user', { email: userData.email });

      // Check if user already exists
      const existingUser = await UserModel.findOne({ email: userData.email.toLowerCase() });
      if (existingUser) {
        await AuditService.logAuthEvent({
          eventType: 'registration',
          success: false,
          metadata: {
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            reason: 'Email already exists'
          }
        });
        throw new Error('USER_ALREADY_EXISTS');
      }

      // Validate password strength
      const passwordValidation = PasswordService.validatePasswordStrength(userData.password);
      if (!passwordValidation.isValid) {
        await AuditService.logAuthEvent({
          eventType: 'registration',
          success: false,
          metadata: {
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            reason: `Weak password: ${passwordValidation.errors.join(', ')}`
          }
        });
        throw new Error(`WEAK_PASSWORD: ${passwordValidation.errors.join(', ')}`);
      }

      // Hash password
      const passwordHash = await PasswordService.hashPassword(userData.password);

      // Create user
      const user = new UserModel({
        email: userData.email.toLowerCase(),
        passwordHash,
        firstName: userData.firstName,
        lastName: userData.lastName,
        isVerified: false, // Will be verified via OTP
        isActive: true
      });

      await user.save();

      // Log successful registration
      await AuditService.logAuthEvent({
        userId: user._id.toString(),
        eventType: 'registration',
        success: true,
        metadata: {
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent
        }
      });

      logger.info('User registered successfully', { userId: user._id, email: user.email });

      // TODO: Publish user.created event via event producer
      // await eventProducer.publishUserCreated({ ... });

      await publishUserCreated({
        userId: user._id.toString(),
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName
      });

      return user;
    } catch (error:any) {
      logger.error('Error registering user:', error);
      throw error;
    }
  }

  /**
   * Login user with credentials
   */
  async loginUser(credentials: LoginCredentials): Promise<LoginResult> {
    try {
      logger.info('User login attempt', { email: credentials.email });

      // Find active user by email
      const user = await UserModel.findOne({ 
        email: credentials.email.toLowerCase(),
        isActive: true 
      });

      if (!user) {
        await AuditService.logAuthEvent({
          eventType: 'login',
          success: false,
          metadata: {
            ipAddress: credentials.ipAddress,
            userAgent: credentials.userAgent,
            reason: 'User not found or inactive'
          }
        });
        return { success: false, error: 'INVALID_CREDENTIALS' };
      }

      // Check if account is locked
      if (this.isAccountLocked(user)) {
        await AuditService.logAuthEvent({
          userId: user._id.toString(),
          eventType: 'login',
          success: false,
          metadata: {
            ipAddress: credentials.ipAddress,
            userAgent: credentials.userAgent,
            reason: 'Account temporarily locked'
          }
        });
        return { 
          success: false, 
          error: 'ACCOUNT_LOCKED',
          isLocked: true,
          lockUntil: user.lockUntil 
        };
      }

      // Verify password
      const isPasswordValid = await PasswordService.comparePassword(
        credentials.password, 
        user.passwordHash
      );

      if (!isPasswordValid) {
        // Handle failed login attempt
        await this.handleFailedLogin(user, credentials);
        
        await AuditService.logAuthEvent({
          userId: user._id.toString(),
          eventType: 'failed_attempt',
          success: false,
          metadata: {
            ipAddress: credentials.ipAddress,
            userAgent: credentials.userAgent,
            reason: 'Invalid password'
          }
        });

        return { success: false, error: 'INVALID_CREDENTIALS' };
      }

      // Successful login - reset failed attempts and update last login
      await this.handleSuccessfulLogin(user, credentials);

      await AuditService.logAuthEvent({
        userId: user._id.toString(),
        eventType: 'login',
        success: true,
        metadata: {
          ipAddress: credentials.ipAddress,
          userAgent: credentials.userAgent
        }
      });

      logger.info('User login successful', { userId: user._id, email: user.email });

      return { success: true, user };
    } catch (error:any) {
      logger.error('Error during user login:', error);
      return { success: false, error: 'LOGIN_FAILED' };
    }
  }

  /**
   * Get user profile by ID
   */
  async getUserProfile(userId: string): Promise<IUser | null> {
    try {
      return await UserModel.findById(userId);
    } catch (error:any) {
      logger.error('Error getting user profile:', error);
      throw new Error('USER_PROFILE_FETCH_FAILED');
    }
  }

  /**
   * Get user by email
   */
  async getUserByEmail(email: string): Promise<IUser | null> {
    try {
      return await UserModel.findOne({ email: email.toLowerCase() });
    } catch (error:any) {
      logger.error('Error getting user by email:', error);
      throw new Error('USER_FETCH_FAILED');
    }
  }

  /**
   * Update user profile
   */
  async updateUserProfile(userId: string, updates: UpdateProfileData, metadata: { ipAddress: string; userAgent: string }): Promise<IUser> {
    try {
      const user = await UserModel.findById(userId);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      // Update allowed fields
      if (updates.firstName) user.firstName = updates.firstName;
      if (updates.lastName) user.lastName = updates.lastName;
      if (updates.email && updates.email !== user.email) {
        // Email change requires verification
        user.email = updates.email.toLowerCase();
        user.isVerified = false;
        // TODO: Trigger email verification for new email
      }

      await user.save();

      await AuditService.logAuthEvent({
        userId: user._id.toString(),
        eventType: 'password_change',
        success: true,
        metadata: {
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent
        }
      });

      return user;
    } catch (error:any) {
      logger.error('Error updating user profile:', error);
      throw error;
    }
  }

  /**
   * Change user password
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string, metadata: { ipAddress: string; userAgent: string }): Promise<void> {
    try {
      const user = await UserModel.findById(userId);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      // Verify current password
      const isCurrentPasswordValid = await PasswordService.comparePassword(currentPassword, user.passwordHash);
      if (!isCurrentPasswordValid) {
        await AuditService.logAuthEvent({
          userId: user._id.toString(),
          eventType: 'password_change',
          success: false,
          metadata: {
            ipAddress: metadata.ipAddress,
            userAgent: metadata.userAgent,
            reason: 'Current password incorrect'
          }
        });
        throw new Error('INVALID_CURRENT_PASSWORD');
      }

      // Validate new password strength
      const passwordValidation = PasswordService.validatePasswordStrength(newPassword);
      if (!passwordValidation.isValid) {
        throw new Error(`WEAK_PASSWORD: ${passwordValidation.errors.join(', ')}`);
      }

      // Hash and update new password
      user.passwordHash = await PasswordService.hashPassword(newPassword);
      user.passwordChangedAt = new Date();
      await user.save();

      await AuditService.logAuthEvent({
        userId: user._id.toString(),
        eventType: 'password_change',
        success: true,
        metadata: {
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent
        }
      });

      // TODO: Publish password.changed event

      await publishPasswordChanged({
        userId: user._id.toString(),
        email: user.email,
        changedAt: new Date()
      });

      // TODO: Revoke all existing tokens (security measure)

    } catch (error:any) {
      logger.error('Error changing password:', error);
      throw error;
    }
  }

  /**
   * Deactivate user account
   */
  async deactivateAccount(userId: string, metadata: { ipAddress: string; userAgent: string }): Promise<void> {
    try {
      const user = await UserModel.findById(userId);
      if (!user) {
        throw new Error('USER_NOT_FOUND');
      }

      user.isActive = false;
      await user.save();

      await AuditService.logAuthEvent({
        userId: user._id.toString(),
        eventType: 'account_deactivated',
        success: true,
        metadata: {
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent
        }
      });

      // TODO: Publish user.deactivated event

      await publishUserDeactivated({
        userId: user._id.toString(),
        email: user.email,
        deactivatedAt: new Date(),
      });

      // TODO: Revoke all active sessions/tokens

      logger.info('User account deactivated', { userId });
    } catch (error:any) {
      logger.error('Error deactivating account:', error);
      throw error;
    }
  }

  /**
   * Verify user email (mark as verified)
   */
  async verifyUserEmail(userId: string): Promise<void> {
    try {
      await UserModel.findByIdAndUpdate(userId, { 
        isVerified: true 
      });
      
      logger.info('User email verified', { userId });
    } catch (error:any) {
      logger.error('Error verifying user email:', error);
      throw new Error('EMAIL_VERIFICATION_FAILED');
    }
  }

  /**
   * Check if account is locked
   */
  private isAccountLocked(user: IUser): boolean {
    return !!(user.lockUntil && user.lockUntil > new Date());
  }

  /**
   * Handle failed login attempt
   */
  private async handleFailedLogin(user: IUser, credentials: LoginCredentials): Promise<void> {
    user.failedLoginAttempts += 1;

    if (user.failedLoginAttempts >= this.MAX_FAILED_ATTEMPTS) {
      user.lockUntil = new Date(Date.now() + this.LOCK_TIME);
      await AuditService.logAuthEvent({
        userId: user._id.toString(),
        eventType: 'account_locked',
        success: false,
        metadata: {
          ipAddress: credentials.ipAddress,
          userAgent: credentials.userAgent,
          reason: 'Too many failed login attempts'
        }
      });
    }

    await user.save();
  }

  /**
   * Handle successful login
   */
  private async handleSuccessfulLogin(user: IUser, credentials: LoginCredentials): Promise<void> {
    user.lastLoginAt = new Date();
    user.failedLoginAttempts = 0;
    user.lockUntil = undefined;
    await user.save();
  }
}

// Export for convenience
export const userService = new UserService();
