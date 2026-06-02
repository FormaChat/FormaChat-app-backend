import { Request, Response, NextFunction } from 'express';
import { createLogger, getRequestId } from '../utils/auth.logger.utils';
import { AuthRequest } from './auth.jwt.middleware';

export const loggerMiddleware = (req: AuthRequest, res: Response, next: NextFunction) => {
  const requestId = getRequestId(req);
  const logger = createLogger(requestId);
  const start = Date.now();

  // Log incoming request
  logger.info('Incoming request', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  res.on('finish', () => {
    const duration = Date.now() - start;
    
    const logData = {
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      duration,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.userId // Include user ID if authenticated
    };

    // Log using httpRequest method from your logger
    logger.httpRequest({
      method: req.method,
      url: req.originalUrl || req.url,
      statusCode: res.statusCode,
      responseTime: duration,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Additional audit log for authentication events
    if (req.path.includes('/login') || req.path.includes('/register') || req.path.includes('/logout')) {
      logger.audit(req.path.replace('/', '').toUpperCase(), {
        email: req.body?.email,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        success: res.statusCode >= 200 && res.statusCode < 300,
        statusCode: res.statusCode
      });
    }
  });

  next();
};