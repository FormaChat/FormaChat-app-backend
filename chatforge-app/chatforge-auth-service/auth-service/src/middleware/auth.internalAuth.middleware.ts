import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { AuthError } from './auth.errorHandler.middleware';
import { createLogger, getRequestId } from '../utils/auth.logger.utils';



export const internalAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const requestId = getRequestId(req);
  const logger = createLogger(requestId);

  const serviceToken = req.headers['x-service-token'] as string;
  
  if (!serviceToken) {
    logger.warn('Missing service token for internal request', {
      path: req.path,
      ip: req.ip
    });
    throw new AuthError('Service token required', 401, 'MISSING_SERVICE_TOKEN');
  }

  const expectedToken = process.env.INTERNAL_SERVICE_SECRET!;
  
  // Timing-safe comparison to prevent timing attacks
  
  try {
    const tokenBuffer = Buffer.from(serviceToken);
    const expectedBuffer = Buffer.from(expectedToken);
    
    if (tokenBuffer.length !== expectedBuffer.length || 
        !crypto.timingSafeEqual(tokenBuffer, expectedBuffer)) {
      throw new Error('Token mismatch');
    }
  } catch (error) {
    logger.error('Invalid service token attempt', {
      path: req.path,
      ip: req.ip,
      userAgent: req.headers['user-agent']
    });
    throw new AuthError('Invalid service token', 401, 'INVALID_SERVICE_TOKEN');
  }

  logger.debug('Internal service authenticated', {
    path: req.path
  });

  next();
};