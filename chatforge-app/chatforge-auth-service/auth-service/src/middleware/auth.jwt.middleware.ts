import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { AuthError } from './auth.errorHandler.middleware';
import { createLogger, getRequestId } from '../utils/auth.logger.utils';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    email: string;
  };
}

export const jwtMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const requestId = getRequestId(req);
  const logger = createLogger(requestId);

  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Missing or invalid authorization header', {
      path: req.path,
      ip: req.ip
    });
    throw new AuthError('Access token required', 401, 'MISSING_TOKEN');
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
      userId: string;
      email: string;
    };
    
    req.user = decoded;
    
    logger.debug('JWT verification successful', {
      userId: decoded.userId,
      path: req.path
    });
    
    next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      logger.warn('Expired token used', {
        path: req.path,
        ip: req.ip
      });
      throw new AuthError('Access token expired', 401, 'TOKEN_EXPIRED');
    }
    
    logger.warn('Invalid token used', {
      path: req.path,
      ip: req.ip,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
    
    throw new AuthError('Invalid access token', 401, 'INVALID_TOKEN');
  }
};

export const optionalJwtMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: string;
        email: string;
      };
      req.user = decoded;
    } catch (error) {
      // Silently fail for optional auth
      req.user = undefined;
    }
  }
  
  next();
};