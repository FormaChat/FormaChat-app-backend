import { Request, Response } from 'express';
import { tokenService } from '../services/auth.token.service';
import { sessionService } from '../services/auth.session.service';
import { AuditService } from '../services/auth.audit.service';
import { createLogger } from '../utils/auth.logger.utils';

const logger = createLogger('token-controller');

export class TokenController {
  /**
   * Refresh access token using refresh token
   */
  async refreshToken(req: Request, res: Response) {
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

      const result = await sessionService.refreshSession(refreshToken, {
        ipAddress,
        userAgent
      });

      res.json({
        success: true,
        data: {
          accessToken: result.accessToken,
          refreshToken: result.newRefreshToken || refreshToken
        }
      });

    } catch (error: any) {
      logger.error('Token refresh error:', error);
      
      if (error.message === 'INVALID_REFRESH_TOKEN') {
        return res.status(401).json({
          success: false,
          error: 'Invalid or expired refresh token'
        });
      }

      res.status(500).json({
        success: false,
        error: 'Failed to refresh token'
      });
    }
  }

  /**
   * Revoke refresh token (logout)
   */
  async revokeToken(req: Request, res: Response) {
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
      logger.error('Token revocation error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to logout'
      });
    }
  }

  /**
   * Validate access token
   */
  async validateToken(req: Request, res: Response) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Bearer token required'
        });
      }

      const token = authHeader.substring(7);
      const verification = await tokenService.verifyAccessToken(token);

      if (!verification.valid) {
        return res.status(401).json({
          success: false,
          error: 'Invalid token',
          details: verification.error
        });
      }

      res.json({
        success: true,
        data: {
          valid: true,
          payload: verification.payload
        }
      });

    } catch (error: any) {
      logger.error('Token validation error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to validate token'
      });
    }
  }

  /**
   * Get token information (decode without verification)
   */
  async getTokenInfo(req: Request, res: Response) {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'Bearer token required'
        });
      }

      const token = authHeader.substring(7);
      
      // Simple decode without verification (for debugging)
      const { verify } = require('jsonwebtoken');
      const { JWT_ACCESS_SECRET } = require('../config/auth.env').env;
      
      try {
        const payload = verify(token, JWT_ACCESS_SECRET);
        
        res.json({
          success: true,
          data: {
            payload,
            issuedAt: new Date(payload.iat * 1000),
            expiresAt: new Date(payload.exp * 1000)
          }
        });
      } catch (error) {
        return res.status(401).json({
          success: false,
          error: 'Invalid token'
        });
      }

    } catch (error: any) {
      logger.error('Token info error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to get token info'
      });
    }
  }

  /**
   * Revoke all sessions except current (for future multi-device support)
   */
  async revokeOtherSessions(req: Request, res: Response) {
    try {
      const userId = (req as any).user?.userId;
      const { refreshToken } = req.body;

      if (!userId) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      await sessionService.revokeAllSessionsExceptCurrent(userId, refreshToken);

      res.json({
        success: true,
        message: 'All other sessions revoked'
      });

    } catch (error: any) {
      logger.error('Revoke other sessions error:', error);
      
      res.status(500).json({
        success: false,
        error: 'Failed to revoke sessions'
      });
    }
  }
}

export const tokenController = new TokenController();