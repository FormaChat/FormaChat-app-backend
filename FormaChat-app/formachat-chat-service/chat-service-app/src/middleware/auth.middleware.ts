import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/chat.env.config';
import { createLogger } from '../util/chat.logger.utils';

const logger = createLogger('auth-middleware');

interface JWTPayload {
  userId: string;
  email: string;
  role?: string;
  iat?: number;  // Issued at
  exp?: number;  // Expiration
}

export interface AuthenticatedRequest extends Request {
  user?: {
    userId: string;
    email: string;
    role?: string;
  };
}


export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // 1. CHECK IF AUTHORIZATION HEADER EXISTS
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authorization header is missing',
        code: 'NO_AUTH_HEADER'
      });
      return;
    }

    // 2. VALIDATE AUTHORIZATION HEADER FORMAT
    // Expected format: "Bearer <token>"
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid authorization header format. Expected: Bearer <token>',
        code: 'INVALID_AUTH_FORMAT'
      });
      return;
    }

    // 3. EXTRACT TOKEN
    const token = authHeader.substring(7); // Remove "Bearer " prefix

    if (!token || token.trim().length === 0) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Token is missing',
        code: 'NO_TOKEN'
      });
      return;
    }

    // 4. VERIFY JWT_SECRET EXISTS
    const jwtSecret = env.JWT_ACCESS_SECRET;

    if (!jwtSecret) {
      logger.error('[Auth] JWT_SECRET not configured in environment variables');
      res.status(500).json({
        error: 'Server configuration error',
        message: 'Authentication service is not properly configured'
      });
      return;
    }

    // 5. VERIFY AND DECODE TOKEN
    let decoded: JWTPayload;

    

    try {
      decoded = jwt.verify(token, jwtSecret) as JWTPayload;
      
    } catch (error: any) {
      // Handle specific JWT errors
      if (error.name === 'TokenExpiredError') {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Token has expired',
          code: 'TOKEN_EXPIRED',
          expiredAt: error.expiredAt
        });
        return;
      }

      if (error.name === 'JsonWebTokenError') {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid token signature',
          code: 'INVALID_TOKEN'
        });
        return;
      }

      if (error.name === 'NotBeforeError') {
        res.status(401).json({
          error: 'Unauthorized',
          message: 'Token not yet active',
          code: 'TOKEN_NOT_ACTIVE'
        });
        return;
      }

      // Generic JWT error
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Token verification failed',
        code: 'TOKEN_VERIFICATION_FAILED'
      });
      return;
    }

    // 6. VALIDATE TOKEN PAYLOAD
    if (!decoded.userId || !decoded.email) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid token payload - missing required fields',
        code: 'INVALID_PAYLOAD'
      });
      return;
    }

    // 7. ATTACH USER DATA TO REQUEST
    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role || 'user', // Default to 'user' if role not specified
    };

    logger.info(`[Auth] ✓ User authenticated: ${req.user.userId} (${req.user.email})`);

    // 8. PROCEED TO NEXT MIDDLEWARE/CONTROLLER
    next();

  } catch (error: any) {
    logger.error('[Auth] Middleware error:', error.message);

    res.status(500).json({
      error: 'Internal server error',
      message: 'Authentication failed due to server error'
    });
  }
};

export const optionalAuthMiddleware = async (
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;

    // No auth header? That's okay, just continue without user data
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      logger.info('[Auth] No authentication provided - proceeding as anonymous');
      next();
      return;
    }

    const token = authHeader.substring(7);
    const jwtSecret = env.JWT_ACCESS_SECRET;

    if (!jwtSecret) {
      // Even if JWT_SECRET missing, continue without auth
      logger.warn('[Auth] JWT_SECRET not configured - proceeding as anonymous');
      next();
      return;
    }

    try {
      const decoded = jwt.verify(token, jwtSecret) as JWTPayload;

      if (decoded.userId && decoded.email) {
        req.user = {
          userId: decoded.userId,
          email: decoded.email,
          role: decoded.role || 'user',
        };
        logger.info(`[Auth] ✓ Optional auth - user identified: ${req.user.userId}`);
      }
    } catch (error: any) {
      // Token invalid? That's okay for optional auth
      logger.warn('[Auth] Optional auth - invalid token, proceeding as anonymous');
    }

    // Always proceed, regardless of auth success
    next();

  } catch (error: any) {
    logger.error('[Auth] Optional middleware error:', error.message);
    // Don't fail request even on error
    next();
  }
};

export const verifyToken = (token: string): JWTPayload | null => {
  try {
    const jwtSecret = env.JWT_ACCESS_SECRET;

    if (!jwtSecret) {
      logger.error('[Auth] JWT_SECRET not configured');
      return null;
    }

    const decoded = jwt.verify(token, jwtSecret) as JWTPayload;

    if (!decoded.userId || !decoded.email) {
      return null;
    }

    return decoded;

  } catch (error: any) {
    logger.error('[Auth] Token verification failed:', error.message);
    return null;
  }
};


export default authMiddleware;