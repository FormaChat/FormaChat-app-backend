import { Request, Response } from 'express';
import { userService } from '../services/auth.user.service';
import { sessionService } from '../services/auth.session.service';
import { AuditService } from '../services/auth.audit.service';
import { otpService } from '../services/auth.otp.service';
import { IUser } from '../persistence/auth.user.models';
import { createLogger } from '../utils/auth.logger.utils';

const logger = createLogger('login-controller');

export class LoginController {
  /**
   * Revoke existing sessions, create a new one, and build the standard
   * login-success response body. Shared by password login and 2FA-verified login.
   */
  private async completeLogin(user: IUser, ipAddress: string, userAgent: string) {
    logger.info('completeLogin: start', { userId: user.id });

    try {
      await sessionService.revokeAllUserSessions(user.id, {
        ipAddress,
        userAgent,
        reason: 'New login from different location'
      });
      logger.info('completeLogin: sessions revoked', { userId: user.id });
    } catch (revokeError: any) {
      logger.warn('Failed to revoke old sessions (non-critical)', {
        error: revokeError.message
      });
    }

    let tokens;
    try {
      tokens = await sessionService.createSession(user.id, user.email, { userAgent, ipAddress });
      logger.info('completeLogin: session created', { userId: user.id });
    } catch (createError: any) {
      logger.error('completeLogin: createSession failed', {
        userId: user.id,
        message: createError?.message,
        name: createError?.name,
        stack: createError?.stack
      });
      throw createError;
    }

    const userData = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      isVerified: user.isVerified,
      lastLoginAt: user.lastLoginAt
    };

    return { user: userData, tokens };
  }

  /**
   * User login with email and password
   */
  // Only showing the login method - rest of the file stays the same

  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // Validate input
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required'
        });
      }

      // Attempt login
      const loginResult = await userService.loginUser({
        email,
        password,
        ipAddress,
        userAgent
      });

      // Check if login was unsuccessful
      if (!loginResult.success) {
        return res.status(401).json({
          success: false,
          error: {
            code: loginResult.error,
            message: 'Invalid email or password'
          },
          isLocked: loginResult.isLocked,
          lockUntil: loginResult.lockUntil
        });
      }

      // Safety check: ensure user object exists
      if (!loginResult.user) {
        logger.error('Login result successful but user object is missing');
        return res.status(401).json({
          success: false,
          error: 'Invalid credentials'
        });
      }

      // Email verification check - CRITICAL SECURITY LAYER
      if (!loginResult.user.isVerified) {
        logger.warn('Login attempt with unverified email', { 
          userId: loginResult.user.id,
          email: loginResult.user.email,
          ipAddress,
          userAgent
        });

        return res.status(403).json({
          success: false,
          error: {
            code: 'EMAIL_NOT_VERIFIED',
            message: 'Please verify your email before logging in'
          },
          data: {
            requiresVerification: true
          }
        });
      }

      // Two-factor authentication gate - password is valid, but don't create
      // a session yet. Issue a 2FA OTP (emailed via the existing OTP pipeline)
      // and require a separate verify call to complete login.
      if (loginResult.user.twoFactorEnabled) {
        await otpService.generateOTP({
          userId: loginResult.user.id,
          type: '2fa',
          metadata: { ipAddress, userAgent }
        });

        logger.info('2FA required, OTP issued', {
          userId: loginResult.user.id,
          email: loginResult.user.email
        });

        return res.json({
          success: true,
          data: {
            requiresTwoFactor: true,
            userId: loginResult.user.id
          }
        });
      }

      const { user: userData, tokens } = await this.completeLogin(loginResult.user, ipAddress, userAgent);

      // Log successful login
      logger.info('User logged in successfully', {
        userId: loginResult.user.id,
        email: loginResult.user.email,
        ipAddress
      });

      res.json({
        success: true,
        data: {
          user: userData,
          tokens
        }
      });

    } catch (error: any) {
      logger.error('Login error:', {
        message: error?.message,
        name: error?.name,
        stack: error?.stack
      });

      res.status(500).json({
        success: false,
        error: 'Login failed'
      });
    }
  }

  /**
   * Complete login after 2FA OTP verification
   */
  async verifyTwoFactorLogin(req: Request, res: Response) {
    try {
      const { userId, otp } = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      const user = await userService.getUserProfile(userId);
      if (!user) {
        return res.status(404).json({
          success: false,
          error: { code: 'USER_NOT_FOUND', message: 'Invalid verification request' }
        });
      }

      if (!user.twoFactorEnabled) {
        return res.status(400).json({
          success: false,
          error: { code: 'TWO_FACTOR_NOT_ENABLED', message: 'Two-factor authentication is not enabled for this account' }
        });
      }

      const otpResult = await otpService.verifyOTP(user.id, otp, '2fa');
      if (!otpResult.valid) {
        await AuditService.logAuthEvent({
          userId: user.id,
          eventType: 'login',
          success: false,
          metadata: { ipAddress, userAgent, reason: 'Invalid 2FA OTP' }
        });

        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_OTP', message: otpResult.error || 'Invalid or expired code' }
        });
      }

      const { user: userData, tokens } = await this.completeLogin(user, ipAddress, userAgent);

      await AuditService.logAuthEvent({
        userId: user.id,
        eventType: 'login',
        success: true,
        metadata: { ipAddress, userAgent, reason: '2FA verified' }
      });

      logger.info('2FA login completed successfully', { userId: user.id });

      res.json({
        success: true,
        data: { user: userData, tokens }
      });

    } catch (error: any) {
      logger.error('2FA login verification error:', { message: error?.message, name: error?.name, stack: error?.stack });

      res.status(500).json({
        success: false,
        error: { code: 'TWO_FACTOR_VERIFICATION_FAILED', message: 'Failed to verify two-factor code' }
      });
    }
  }

  /**
   * Request a magic sign-in link by email (email-enumeration-safe)
   */
  async requestMagicLink(req: Request, res: Response) {
    try {
      const { email } = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      const user = await userService.getUserByEmail(email);

      if (!user) {
        logger.warn('Magic link requested for non-existent email', { email, ipAddress });
        return res.json({
          success: true,
          message: 'If the email exists, a sign-in link has been sent'
        });
      }

      await otpService.generateOTP({
        userId: user.id,
        type: 'magic_link',
        metadata: { ipAddress, userAgent }
      });

      logger.info('Magic link OTP generated', { userId: user.id });

      res.json({
        success: true,
        message: 'If the email exists, a sign-in link has been sent'
      });

    } catch (error: any) {
      logger.error('Magic link request error:', { message: error?.message, name: error?.name, stack: error?.stack });

      // Still return success to prevent email enumeration
      res.json({
        success: true,
        message: 'If the email exists, a sign-in link has been sent'
      });
    }
  }

  /**
   * Verify a magic link token and complete login
   */
  async verifyMagicLink(req: Request, res: Response) {
    try {
      const { email, token } = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      const user = await userService.getUserByEmail(email);
      if (!user) {
        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_MAGIC_LINK', message: 'Invalid or expired sign-in link' }
        });
      }

      const otpResult = await otpService.verifyOTP(user.id, token, 'magic_link');
      if (!otpResult.valid) {
        await AuditService.logAuthEvent({
          userId: user.id,
          eventType: 'login',
          success: false,
          metadata: { ipAddress, userAgent, reason: 'Invalid magic link token' }
        });

        return res.status(400).json({
          success: false,
          error: { code: 'INVALID_MAGIC_LINK', message: 'Invalid or expired sign-in link' }
        });
      }

      if (!user.isVerified) {
        return res.status(403).json({
          success: false,
          error: { code: 'EMAIL_NOT_VERIFIED', message: 'Please verify your email before logging in' },
          data: { requiresVerification: true }
        });
      }

      const { user: userData, tokens } = await this.completeLogin(user, ipAddress, userAgent);

      await AuditService.logAuthEvent({
        userId: user.id,
        eventType: 'login',
        success: true,
        metadata: { ipAddress, userAgent, reason: 'Magic link login' }
      });

      logger.info('Magic link login completed successfully', { userId: user.id });

      res.json({
        success: true,
        data: { user: userData, tokens }
      });

    } catch (error: any) {
      logger.error('Magic link verification error:', { message: error?.message, name: error?.name, stack: error?.stack });

      res.status(500).json({
        success: false,
        error: { code: 'MAGIC_LINK_VERIFICATION_FAILED', message: 'Failed to verify sign-in link' }
      });
    }
  }

  /**
   * Logout user by revoking refresh token
   * FIXED: Now handles missing/invalid tokens gracefully
   */
  async logout(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      // If no refresh token provided, just return success
      // Frontend will clear tokens locally
      if (!refreshToken) {
        logger.warn('Logout called without refresh token', { ipAddress, userAgent });
        return res.json({
          success: true,
          message: 'Logged out successfully (no token provided)'
        });
      }

      // Try to revoke the session, but don't fail if token is invalid
      try {
        await sessionService.revokeCurrentSession(refreshToken, {
          ipAddress,
          userAgent
        });
        
        logger.info('User logged out successfully', { ipAddress });
      } catch (revokeError: any) {
        // Log the error but still return success
        // This handles cases where token is already expired/invalid
        logger.warn('Session revocation failed (token may be expired)', {
          error: revokeError.message,
          ipAddress,
          userAgent
        });
      }

      // Always return success - logout is idempotent
      res.json({
        success: true,
        message: 'Logged out successfully'
      });

    } catch (error: any) {
      logger.error('Logout error:', error);
      
      // Even on error, return success for logout
      // The important thing is that frontend clears tokens
      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    }
  }

  /**
   * Check if user is authenticated (validate token)
   */
  async checkAuth(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.userId;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Not authenticated'
        });
      }

      const user = await userService.getUserProfile(userId);
      
      if (!user) {
        return res.status(404).json({
          success: false,
          error: 'User not found'
        });
      }

      const userData = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        isVerified: user.isVerified,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt
      };

      res.json({
        success: true,
        data: {
          authenticated: true,
          user: userData
        }
      });

    } catch (error: any) {
      logger.error('Check auth error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Authentication check failed'
      });
    }
  }
}

export const loginController = new LoginController();