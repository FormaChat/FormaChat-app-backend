import { Request, Response } from 'express';
import { userService } from '../services/auth.user.service';
import { sessionService } from '../services/auth.session.service';
import { AuditService } from '../services/auth.audit.service';
import { createLogger } from '../utils/auth.logger.utils';

const logger = createLogger('login-controller');

export class LoginController {
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

      // 🔥 FIXED: Revoke all existing sessions BEFORE creating new one
      // This ensures clean state
      try {
        await sessionService.revokeAllUserSessions(loginResult.user.id, {
          ipAddress,
          userAgent,
          reason: 'New login from different location'
        });
      } catch (revokeError: any) {
        // Log but don't block login
        logger.warn('Failed to revoke old sessions (non-critical)', {
          error: revokeError.message
        });
      }

      // Generate tokens for successful login
      // The createSession will internally call tokenService.generateTokenPair with revokeExisting=true
      const tokens = await sessionService.createSession(
        loginResult.user.id,
        loginResult.user.email,
        { userAgent, ipAddress }
      );

      // Return user data (excluding sensitive information)
      const userData = {
        id: loginResult.user.id,
        email: loginResult.user.email,
        firstName: loginResult.user.firstName,
        lastName: loginResult.user.lastName,
        isVerified: loginResult.user.isVerified,
        lastLoginAt: loginResult.user.lastLoginAt
      };

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
      logger.error('Login error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Login failed'
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