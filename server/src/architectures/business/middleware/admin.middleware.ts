import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/business.env';
import { createLogger } from '../utils/business.logger.utils';

const logger = createLogger('admin-middleware');

interface AdminJWTPayload {
  userId: string;
  email: string;
  role: string;
}

export const adminMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // 1. CHECK ALL REQUIRED HEADERS
    const authHeader = req.headers.authorization;
    const serviceToken = req.headers['x-service-token'] as string;
    const adminApiKey = req.headers['x-admin-api-key'] as string;

    if (!authHeader || !serviceToken || !adminApiKey) {
      logger.warn('[Admin] Missing authentication headers', {
        path: req.path,
        ip: req.ip,
        hasAuth: !!authHeader,
        hasService: !!serviceToken,
        hasApiKey: !!adminApiKey
      });

      res.status(401).json({
        error: 'Unauthorized',
        message: 'Missing required authentication headers',
        code: 'MISSING_ADMIN_AUTH'
      });
      return;
    }

    // 2. VERIFY JWT TOKEN (Admin User Authentication)
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    const jwtSecret = env.JWT_ACCESS_SECRET;

    if (!jwtSecret) {
      logger.error('[Admin] JWT_SECRET not configured');
      res.status(500).json({
        error: 'Server configuration error',
        message: 'Authentication service not configured'
      });
      return;
    }

    let decoded: AdminJWTPayload;
    try {
      decoded = jwt.verify(token, jwtSecret) as AdminJWTPayload;
    } catch (error: any) {
      logger.warn('[Admin] Invalid JWT token', {
        path: req.path,
        error: error.message
      });

      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired admin token',
        code: 'INVALID_ADMIN_TOKEN'
      });
      return;
    }

    // Check admin role in JWT
    if (decoded.role !== 'admin') {
      logger.warn('[Admin] Non-admin user attempted admin access', {
        userId: decoded.userId,
        email: decoded.email,
        role: decoded.role
      });

      res.status(403).json({
        error: 'Forbidden',
        message: 'Admin privileges required',
        code: 'NOT_ADMIN'
      });
      return;
    }

    // 3. VERIFY INTERNAL SERVICE SECRET (Service-to-Service Auth)
    const expectedServiceSecret = env.INTERNAL_SERVICE_SECRET;

    if (!expectedServiceSecret) {
      logger.error('[Admin] INTERNAL_SERVICE_SECRET not configured');
      res.status(500).json({
        error: 'Server configuration error',
        message: 'Service authentication not configured'
      });
      return;
    }

    try {
      const serviceTokenBuffer = Buffer.from(serviceToken);
      const expectedServiceBuffer = Buffer.from(expectedServiceSecret);

      if (serviceTokenBuffer.length !== expectedServiceBuffer.length ||
          !crypto.timingSafeEqual(serviceTokenBuffer, expectedServiceBuffer)) {
        throw new Error('Service token mismatch');
      }
    } catch (error: any) {
      logger.error('[Admin] Invalid service token', {
        path: req.path,
        ip: req.ip
      });

      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid service authentication',
        code: 'INVALID_SERVICE_TOKEN'
      });
      return;
    }

    // 4. VERIFY ADMIN API KEY (Admin Microservice Identifier)
    const expectedAdminKey = env.ADMIN_API_KEY;

    if (!expectedAdminKey) {
      logger.error('[Admin] ADMIN_API_KEY not configured');
      res.status(500).json({
        error: 'Server configuration error',
        message: 'Admin service not configured'
      });
      return;
    }

    try {
      const adminKeyBuffer = Buffer.from(adminApiKey);
      const expectedAdminBuffer = Buffer.from(expectedAdminKey);

      if (adminKeyBuffer.length !== expectedAdminBuffer.length ||
          !crypto.timingSafeEqual(adminKeyBuffer, expectedAdminBuffer)) {
        throw new Error('Admin API key mismatch');
      }
    } catch (error: any) {
      logger.error('[Admin] Invalid admin API key', {
        path: req.path,
        ip: req.ip
      });

      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid admin API key',
        code: 'INVALID_ADMIN_KEY'
      });
      return;
    }

    // 5. ALL CHECKS PASSED - ATTACH ADMIN USER TO REQUEST
    (req as any).adminUser = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role
    };

    logger.info('[Admin] ✓ Admin microservice authenticated', {
      adminUser: decoded.email,
      path: req.path,
      method: req.method
    });

    next();

  } catch (error: any) {
    logger.error('[Admin] Middleware error:', error.message);

    res.status(500).json({
      error: 'Internal server error',
      message: 'Admin authentication failed'
    });
  }
};

export default adminMiddleware;