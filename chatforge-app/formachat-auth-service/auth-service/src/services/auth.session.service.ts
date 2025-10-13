import { tokenService } from './auth.token.service';
import { AuditService } from './auth.audit.service';
import { createLogger } from '../utils/auth.logger.utils';

const logger = createLogger('session-service');

export interface SessionInfo {
  deviceInfo: {
    userAgent: string;
    ipAddress: string;
  };
  createdAt: Date;
  expiresAt: Date;
  refreshToken: string;
}

/**
 * Session service managing user sessions (wrapper around token service)
 */
export class SessionService {
  /**
   * Create new session (generates tokens)
   */
  async createSession(userId: string, email: string, deviceInfo: { userAgent: string; ipAddress: string }): Promise<{ accessToken: string; refreshToken: string }> {
    try {
      const tokenPair = await tokenService.generateTokenPair(userId, email, deviceInfo);
      
      logger.info('New session created', { userId });
      return tokenPair;
    } catch (error:any) {
      logger.error('Error creating session:', error);
      throw new Error('SESSION_CREATION_FAILED');
    }
  }

  /**
   * Revoke current session (logout)
   */
  async revokeCurrentSession(refreshToken: string, metadata: { ipAddress: string; userAgent: string }): Promise<void> {
    try {
      await tokenService.revokeRefreshToken(refreshToken);

      await AuditService.logAuthEvent({
        eventType: 'logout',
        success: true,
        metadata
      });

      logger.info('Session revoked');
    } catch (error:any) {
      logger.error('Error revoking session:', error);
      throw new Error('SESSION_REVOCATION_FAILED');
    }
  }

  /**
   * Revoke all sessions except current (future multi-device support)
   */
  async revokeAllSessionsExceptCurrent(userId: string, currentRefreshToken: string): Promise<void> {
    try {
      // For now, with single session enforcement, this revokes all sessions
      await tokenService.revokeAllUserTokens(userId);
      
      logger.info('All sessions revoked except current', { userId });
    } catch (error:any) {
      logger.error('Error revoking other sessions:', error);
      throw new Error('SESSION_BULK_REVOCATION_FAILED');
    }
  }

  /**
   * Get active session information
   */
  async getActiveSessionInfo(userId: string): Promise<SessionInfo[]> {
    try {
      const sessions = await tokenService.getActiveSessions(userId);
      
      if (sessions.length === 0) {
        return [];
      }

      // Map all sessions to SessionInfo format
      return sessions.map(session => ({
        deviceInfo: session.deviceInfo,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
        refreshToken: session.refreshToken // Add this so we can revoke it
      }));
    } catch (error:any) {
      logger.error('Error getting session info:', error);
      throw new Error('SESSION_INFO_FETCH_FAILED');
    }
  }

  /**
   * Refresh session (get new access token using refresh token)
   */
  async refreshSession(refreshToken: string, deviceInfo: { userAgent: string; ipAddress: string }): Promise<{ accessToken: string; newRefreshToken?: string }> {
    try {
      // Verify refresh token
      const verification = await tokenService.verifyRefreshToken(refreshToken);
      if (!verification.valid || !verification.payload) {
        throw new Error('INVALID_REFRESH_TOKEN');
      }

      const { userId, email } = verification.payload;

      // Generate new access token
      const accessToken = await tokenService.generateAccessToken(userId, email);

      // Optionally rotate refresh token (security best practice)
      // For now, we'll keep the same refresh token
      // In production, you might want to implement refresh token rotation

      await AuditService.logAuthEvent({
        userId,
        eventType: 'token_refreshed',
        success: true,
        metadata: deviceInfo
      });

      return { accessToken };
    } catch (error:any) {
      logger.error('Error refreshing session:', error);
      throw new Error('SESSION_REFRESH_FAILED');
    }
  }

  /**
   * Check if session is valid
   */
  async validateSession(accessToken: string): Promise<{ valid: boolean; userId?: string }> {
    try {
      const verification = await tokenService.verifyAccessToken(accessToken);
      
      if (verification.valid && verification.payload) {
        return { valid: true, userId: verification.payload.userId };
      }

      return { valid: false };
    } catch (error:any) {
      logger.error('Error validating session:', error);
      return { valid: false };
    }
  }

  /**
   * Revoking all existing sessions to ensure single session of users per login 
  */

  async revokeAllUserSessions(
    userId: string, 
    context: { ipAddress: string; userAgent: string; reason?: string }
  ): Promise<void> {
    try {
      // Get all active sessions for user
      const sessions = await this.getActiveSessionInfo(userId);
      
      // Revoke each session
      for (const session of sessions) {
        await this.revokeCurrentSession(session.refreshToken, context);
      }
      
      logger.info('All user sessions revoked', { 
        userId, 
        sessionCount: sessions.length,
        reason: context.reason 
      });
    } catch (error: any) {
      logger.error('Failed to revoke all user sessions', { userId, error: error.message });
      throw error;
    }
  }
}

// Export for convenience
export const sessionService = new SessionService();