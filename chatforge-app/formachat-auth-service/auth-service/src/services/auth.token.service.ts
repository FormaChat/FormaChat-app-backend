import jwt from 'jsonwebtoken';
import { RefreshTokenModel } from '../persistence/auth.user.models';
import { CryptoUtils } from '../utils/auth.crypto.utils';
import { env } from '../config/auth.env';
import { createLogger } from '../utils/auth.logger.utils';

const logger = createLogger('token-service');

export interface TokenPayload {
  userId: string;
  email: string;
  type: 'access' | 'refresh';
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
  async generateAccessToken(userId: string, email: string): Promise<string> {
    try {
      const payload: TokenPayload = {
        userId,
        email,
        type: 'access'
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
   */
  async generateRefreshToken(userId: string, deviceInfo: { userAgent: string; ipAddress: string }): Promise<string> {
    try {
      // Generate secure random token
      const refreshToken = CryptoUtils.generateCryptoString(64);
      const tokenHash = await CryptoUtils.hashData(refreshToken);

      // Calculate expiration
      const expiresAt = new Date();
      expiresAt.setSeconds(expiresAt.getSeconds() + this.parseJWTExpiry(env.JWT_REFRESH_EXPIRES_IN));

      // Revoke any existing active tokens (single session enforcement)
      await RefreshTokenModel.updateMany(
        { userId, isRevoked: false },
        { isRevoked: true }
      );

      // Store new refresh token
      await RefreshTokenModel.create({
        userId,
        tokenHash,
        expiresAt,
        isRevoked: false,
        deviceInfo: {
          userAgent: deviceInfo.userAgent,
          ipAddress: deviceInfo.ipAddress
        }
      });

      return refreshToken;
    } catch (error:any) {
      logger.error('Error generating refresh token:', error);
      throw new Error('REFRESH_TOKEN_GENERATION_FAILED');
    }
  }

  /**
   * Generate both access and refresh tokens
   */
  async generateTokenPair(userId: string, email: string, deviceInfo: { userAgent: string; ipAddress: string }): Promise<TokenPair> {
    const [accessToken, refreshToken] = await Promise.all([
      this.generateAccessToken(userId, email),
      this.generateRefreshToken(userId, deviceInfo)
    ]);

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
   */
  async verifyRefreshToken(token: string): Promise<TokenVerificationResult> {
    try {
      const tokenHash = await CryptoUtils.hashData(token);

      // Find valid, non-revoked, non-expired token
      const storedToken = await RefreshTokenModel.findOne({
        tokenHash,
        isRevoked: false,
        expiresAt: { $gt: new Date() }
      }).populate('userId');

      if (!storedToken) {
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
   */
  async revokeRefreshToken(token: string): Promise<void> {
    try {
      const tokenHash = await CryptoUtils.hashData(token);
      
      await RefreshTokenModel.findOneAndUpdate(
        { tokenHash },
        { isRevoked: true }
      );

      logger.info('Refresh token revoked');
    } catch (error:any) {
      logger.error('Error revoking refresh token:', error);
      throw new Error('TOKEN_REVOCATION_FAILED');
    }
  }

  /**
   * Revoke all refresh tokens for a user
   */
  async revokeAllUserTokens(userId: string): Promise<void> {
    try {
      await RefreshTokenModel.updateMany(
        { userId },
        { isRevoked: true }
      );

      logger.info('All user tokens revoked', { userId });

      // TODO: Publish token.revoked event for security monitoring
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
      }).select('deviceInfo createdAt');
    } catch (error:any) {
      logger.error('Error getting active sessions:', error);
      throw new Error('SESSIONS_FETCH_FAILED');
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