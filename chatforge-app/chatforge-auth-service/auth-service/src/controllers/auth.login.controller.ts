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
  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

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

      if (!loginResult.success) {
        return res.status(401).json({
          success: false,
          error: loginResult.error,
          isLocked: loginResult.isLocked,
          lockUntil: loginResult.lockUntil
        });
      }

      // Generate tokens for successful login
      const tokens = await sessionService.createSession(
        loginResult.user!.id,
        loginResult.user!.email,
        { userAgent, ipAddress }
      );

      // Return user data (excluding sensitive information)
      const userData = {
        id: loginResult.user!.id,
        email: loginResult.user!.email,
        firstName: loginResult.user!.firstName,
        lastName: loginResult.user!.lastName,
        isVerified: loginResult.user!.isVerified,
        lastLoginAt: loginResult.user!.lastLoginAt
      };

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
   */
  async logout(req: Request, res: Response) {
    try {
      const { refreshToken } = req.body;
      const ipAddress = req.ip ?? 'unknown';
      const userAgent = req.get('User-Agent') || 'unknown';

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: 'Refresh token is required'
        });
      }

      await sessionService.revokeCurrentSession(refreshToken, {
        ipAddress,
        userAgent
      });

      res.json({
        success: true,
        message: 'Logged out successfully'
      });

    } catch (error: any) {
      logger.error('Logout error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Logout failed'
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