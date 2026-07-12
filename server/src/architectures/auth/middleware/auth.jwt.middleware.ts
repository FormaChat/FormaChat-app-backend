import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthError } from './auth.errorHandler.middleware';
import { createLogger, getRequestId } from '../utils/auth.logger.utils';
import { env } from '../config/auth.env';
import { redisManager } from '../config/auth.redis';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
    sessionId?: string;
  };
}

interface DecodedAccessToken {
  userId: string;
  email: string;
  sessionId?: string;
}

/**
 * Check whether the access token's session has been explicitly revoked
 * (sign out this device, sign out other devices, deactivate, password
 * change/reset). Fails OPEN on Redis errors - a Redis outage must not lock
 * every signed-in user out; the JWT signature/expiry check is still the
 * primary gate, this just closes the "still logged in after sign out"
 * window that a bare stateless JWT would otherwise leave open for its full
 * lifetime.
 */
async function isRevoked(sessionId: string | undefined, logger: ReturnType<typeof createLogger>): Promise<boolean> {
  if (!sessionId) return false;
  try {
    return await redisManager.isSessionRevoked(sessionId);
  } catch (error: any) {
    logger.warn('Session revocation check failed (Redis unavailable, allowing request)', { error: error.message });
    return false;
  }
}

export const jwtMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const requestId = getRequestId(req);
  const logger = createLogger(requestId);

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Missing or invalid authorization header', {
      path: req.path,
      ip: req.ip
    });
    return next(new AuthError('Access token required', 401, 'MISSING_TOKEN'));
  }

  const token = authHeader.substring(7);

  let decoded: DecodedAccessToken;
  try {
    decoded = jwt.verify(token, env.JWT_ACCESS_SECRET!) as DecodedAccessToken;
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn('Expired token used', { path: req.path, ip: req.ip });
      return next(new AuthError('Access token expired', 401, 'TOKEN_EXPIRED'));
    }

    logger.warn('Invalid token used', {
      path: req.path,
      ip: req.ip,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    return next(new AuthError('Invalid access token', 401, 'INVALID_TOKEN'));
  }

  if (await isRevoked(decoded.sessionId, logger)) {
    logger.warn('Revoked session used', { userId: decoded.userId, path: req.path });
    return next(new AuthError('Session has been revoked', 401, 'SESSION_REVOKED'));
  }

  req.user = decoded;

  logger.debug('JWT verification successful', {
    userId: decoded.userId,
    path: req.path
  });

  next();
};

export const optionalJwtMiddleware = async (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const logger = createLogger(getRequestId(req));

    try {
      const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET!) as DecodedAccessToken;
      req.user = (await isRevoked(decoded.sessionId, logger)) ? undefined : decoded;
    } catch (error) {
      // Silently fail for optional auth
      req.user = undefined;
    }
  }

  next();
};