import jwt from 'jsonwebtoken';
import { RefreshTokenModel } from '../persistence/auth.user.models';
import { CryptoUtils } from '../utils/auth.crypto.utils';
import { env } from '../config/auth.env';
import { redisManager } from '../config/auth.redis';
import { createLogger } from '../utils/auth.logger.utils';

const logger = createLogger('token-service');

export interface TokenPayload {
  userId: string;
  email: string;
  type: 'access' | 'refresh';
  // Ties an access token to the RefreshToken document (_id) it was issued
  // alongside, so jwtMiddleware can check Redis for instant revocation
  // instead of trusting the JWT for its full lifetime. Optional so tokens
  // issued before this existed still verify fine (just skip the check).
  sessionId?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TokenVerificationResult {
  valid: boolean;
  payload?: TokenPayload;
  error?: string;
}

/**
 * Token service handling JWT tokens and refresh tokens
*/

export class TokenService {
  /**
   * Generate access token (JWT)
  */

  async generateAccessToken(userId: string, email: string, sessionId?: string): Promise<string> {
    try {
      const payload: TokenPayload = {
        userId,
        email,
        type: 'access',
        ...(sessionId ? { sessionId } : {})
      };

      return jwt.sign(payload, env.JWT_ACCESS_SECRET, {
        expiresIn: env.JWT_ACCESS_EXPIRES_IN,
        issuer: env.JWT_ISSUER
      });
    } catch (error:any) {
      logger.error('Error generating access token:', error);
      throw new Error('ACCESS_TOKEN_GENERATION_FAILED');
    }
  }

  /**
   * Generate refresh token and store in database
   * FIXED: Using deterministic SHA-256 hash instead of bcrypt
   * FIXED: Only revoke on NEW login, not on token refresh
  */

  async generateRefreshToken(
    userId: string,
    deviceInfo: { userAgent: string; ipAddress: string },
    revokeExisting: boolean = false // Only true on new login
  ): Promise<{ refreshToken: string; sessionId: string }> {
    try {
      // Generate secure random token
      const refreshToken = CryptoUtils.generateCryptoString(64);

      // ✅ FIXED: Use deterministic hash (SHA-256) instead of bcrypt
      const tokenHash = CryptoUtils.hashDeterministic(refreshToken);

      // Calculate expiration
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + this.parseJWTExpiry(env.JWT_REFRESH_EXPIRES_IN));

      // Only revoke existing tokens if explicitly requested (new login)
      if (revokeExisting) {
        await RefreshTokenModel.updateMany(
          { userId, isRevoked: false },
          { isRevoked: true }
        );
        logger.info('Revoked existing tokens for new login', { userId });
      }

      // Store new refresh token
      const doc = await RefreshTokenModel.create({
        userId,
        tokenHash,
        expiresAt,
        isRevoked: false,
        deviceInfo: {
          userAgent: deviceInfo.userAgent,
          ipAddress: deviceInfo.ipAddress
        }
      });

      return { refreshToken, sessionId: doc._id.toString() };
    } catch (error:any) {
      logger.error('Error generating refresh token:', error);
      throw new Error('REFRESH_TOKEN_GENERATION_FAILED');
    }
  }

  /**
   * Generate both access and refresh tokens.
   * Multi-device support: defaults to NOT revoking existing sessions - a new
   * login on a second device should not silently kill the first one's session.
   * Pass revokeExisting=true explicitly for flows that should end other
   * sessions on purpose (e.g. password change, "sign out everywhere").
  */

  async generateTokenPair(
    userId: string,
    email: string,
    deviceInfo: { userAgent: string; ipAddress: string },
    revokeExisting: boolean = false
  ): Promise<TokenPair> {
    // Sequential, not parallel: the access token needs the sessionId that
    // only exists once the refresh token's RefreshToken document has been
    // created. The extra round trip is negligible next to the DB write.
    const { refreshToken, sessionId } = await this.generateRefreshToken(userId, deviceInfo, revokeExisting);
    const accessToken = await this.generateAccessToken(userId, email, sessionId);

    return { accessToken, refreshToken };
  }

  /**
   * Verify access token (JWT)
  */

  async verifyAccessToken(token: string): Promise<TokenVerificationResult> {
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET, {
        issuer: env.JWT_ISSUER
      }) as TokenPayload;

      return { valid: true, payload };
    } catch (error: any) {
      logger.warn('Access token verification failed:', error.message);
      return { 
        valid: false, 
        error: this.mapJWTError(error) 
      };
    }
  }

  /**
   * Verify refresh token
   * FIXED: Using deterministic SHA-256 hash for lookup
   * IMPROVED: Better error logging
  */

  async verifyRefreshToken(token: string): Promise<TokenVerificationResult> {
    try {
      // ✅ FIXED: Use deterministic hash (SHA-256) instead of bcrypt
      const tokenHash = CryptoUtils.hashDeterministic(token);

      // Find valid, non-revoked, non-expired token
      const storedToken = await RefreshTokenModel.findOne({
        tokenHash,
        isRevoked: false,
        expiresAt: { $gt: new Date() }
      }).populate('userId', 'email');

      if (!storedToken) {
        logger.warn('Refresh token not found or invalid', { 
          tokenHash: tokenHash.substring(0, 10) + '...' 
        });
        return { valid: false, error: 'INVALID_REFRESH_TOKEN' };
      }

      const payload: TokenPayload = {
        userId: storedToken.userId._id.toString(),
        email: (storedToken.userId as any).email,
        type: 'refresh'
      };

      return { valid: true, payload };
    } catch (error:any) {
      logger.error('Error verifying refresh token:', error);
      return { valid: false, error: 'REFRESH_TOKEN_VERIFICATION_FAILED' };
    }
  }

  /**
   * Revoke refresh token (logout)
   * IMPROVED: Better error handling
  */
 
  async revokeRefreshToken(token: string): Promise<void> {
    try {
      // ✅ FIXED: Use deterministic hash (SHA-256) instead of bcrypt
      const tokenHash = CryptoUtils.hashDeterministic(token);

      const result = await RefreshTokenModel.findOneAndUpdate(
        { tokenHash, isRevoked: false },
        { isRevoked: true }
      );

      if (result) {
        await this.markRevokedInRedis(result._id.toString());
        logger.info('Refresh token revoked successfully');
      } else {
        logger.warn('Token already revoked or not found');
      }
    } catch (error:any) {
      logger.error('Error revoking refresh token:', error);
      throw new Error('TOKEN_REVOCATION_FAILED');
    }
  }

  /**
   * Revoke all refresh tokens for a user except the one matching currentToken.
   * Used by "sign out of all other devices" - the session making the request
   * must survive it.
   */
  async revokeAllUserTokensExcept(userId: string, currentToken: string): Promise<void> {
    try {
      const currentTokenHash = CryptoUtils.hashDeterministic(currentToken);
      const filter = { userId, isRevoked: false, tokenHash: { $ne: currentTokenHash } };

      // Grab ids before the bulk update - updateMany doesn't return the
      // documents it touched, and we need them to invalidate the matching
      // access tokens in Redis.
      const toRevoke = await RefreshTokenModel.find(filter).select('_id');
      const result = await RefreshTokenModel.updateMany(filter, { isRevoked: true });
      await this.markRevokedInRedis(toRevoke.map((doc) => doc._id.toString()));

      logger.info('All other user tokens revoked', {
        userId,
        count: result.modifiedCount
      });
    } catch (error: any) {
      logger.error('Error revoking other user tokens:', error);
      throw new Error('TOKEN_BULK_REVOCATION_FAILED');
    }
  }

  /**
   * Revoke all refresh tokens for a user
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    try {
      const filter = { userId, isRevoked: false };

      const toRevoke = await RefreshTokenModel.find(filter).select('_id');
      const result = await RefreshTokenModel.updateMany(filter, { isRevoked: true });
      await this.markRevokedInRedis(toRevoke.map((doc) => doc._id.toString()));

      logger.info('All user tokens revoked', {
        userId,
        count: result.modifiedCount
      });

    } catch (error:any) {
      logger.error('Error revoking all user tokens:', error);
      throw new Error('TOKEN_BULK_REVOCATION_FAILED');
    }
  }

  /**
   * Get active sessions for user
   */
  async getActiveSessions(userId: string): Promise<any[]> {
    try {
      return await RefreshTokenModel.find({
        userId,
        isRevoked: false,
        expiresAt: { $gt: new Date() }
      }).select('_id deviceInfo createdAt expiresAt');
    } catch (error:any) {
      logger.error('Error getting active sessions:', error);
      throw new Error('SESSIONS_FETCH_FAILED');
    }
  }

  /**
   * Revoke a single session by its RefreshToken document id.
   * Ownership-checked: only revokes if the session belongs to userId.
   */
  async revokeSessionById(userId: string, sessionId: string): Promise<boolean> {
    try {
      const result = await RefreshTokenModel.findOneAndUpdate(
        { _id: sessionId, userId, isRevoked: false },
        { isRevoked: true }
      );

      if (result) {
        await this.markRevokedInRedis(sessionId);
        logger.info('Session revoked by id', { userId, sessionId });
        return true;
      }

      logger.warn('Session not found for revoke-by-id (or not owned by user)', { userId, sessionId });
      return false;
    } catch (error: any) {
      logger.error('Error revoking session by id:', error);
      throw new Error('SESSION_REVOKE_BY_ID_FAILED');
    }
  }

  /**
   * Mark one or more sessions revoked in Redis so their still-valid access
   * tokens get rejected on their very next request, instead of waiting out
   * the JWT's full lifetime. Non-critical: a Redis failure here must never
   * fail the underlying Mongo revocation, so errors are swallowed and logged.
   */
  private async markRevokedInRedis(sessionId: string | string[]): Promise<void> {
    try {
      if (Array.isArray(sessionId)) {
        await redisManager.markSessionsRevoked(sessionId, env.JWT_ACCESS_EXPIRES_IN);
      } else {
        await redisManager.markSessionRevoked(sessionId, env.JWT_ACCESS_EXPIRES_IN);
      }
    } catch (error: any) {
      logger.warn('Failed to mark session(s) revoked in Redis (non-critical - Mongo revocation still applies)', {
        error: error.message
      });
    }
  }

  /**
   * Parse JWT expiry string to seconds
   */
  private parseJWTExpiry(expiry: string): number {
    const units: { [key: string]: number } = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400
    };

    const match = expiry.match(/^(\d+)([smhd])$/);
    if (!match) {
      return 86400; // Default 1 day
    }

    const value = parseInt(match[1]);
    const unit = match[2];
    return value * (units[unit] || 86400);
  }

  /**
   * Map JWT errors to user-friendly messages
   */
  private mapJWTError(error: any): string {
    if (error.name === 'TokenExpiredError') return 'TOKEN_EXPIRED';
    if (error.name === 'JsonWebTokenError') return 'INVALID_TOKEN';
    if (error.name === 'NotBeforeError') return 'TOKEN_NOT_ACTIVE';
    return 'TOKEN_VERIFICATION_FAILED';
  }
}

// Export for convenience
export const tokenService = new TokenService();