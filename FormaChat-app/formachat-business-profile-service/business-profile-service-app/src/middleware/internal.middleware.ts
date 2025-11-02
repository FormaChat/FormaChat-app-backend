import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

export const internalMiddleware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // 1. CHECK IF SERVICE TOKEN EXISTS
    const serviceToken = req.headers['x-service-token'] as string;

    if (!serviceToken) {
      console.warn('[Internal] Missing service token', {
        path: req.path,
        ip: req.ip,
        method: req.method
      });

      res.status(401).json({
        success: false,
        error: {
          code: 'MISSING_SERVICE_TOKEN',
          message: 'Service authentication token is required'
        }
      });
      return;
    }

    // 2. VERIFY INTERNAL SERVICE SECRET EXISTS IN ENV
    const expectedServiceSecret = process.env.INTERNAL_SERVICE_SECRET;

    if (!expectedServiceSecret) {
      console.error('[Internal] INTERNAL_SERVICE_SECRET not configured in environment');
      
      res.status(500).json({
        success: false,
        error: {
          code: 'SERVICE_CONFIG_ERROR',
          message: 'Internal service authentication not configured'
        }
      });
      return;
    }

    // 3. VALIDATE SERVICE TOKEN USING TIMING-SAFE COMPARISON
    // Prevents timing attacks by ensuring comparison takes constant time
    try {
      const serviceTokenBuffer = Buffer.from(serviceToken);
      const expectedSecretBuffer = Buffer.from(expectedServiceSecret);

      // Check if lengths match first (constant time for same lengths)
      if (serviceTokenBuffer.length !== expectedSecretBuffer.length) {
        throw new Error('Service token length mismatch');
      }

      // Timing-safe comparison
      if (!crypto.timingSafeEqual(serviceTokenBuffer, expectedSecretBuffer)) {
        throw new Error('Service token mismatch');
      }

    } catch (error: any) {
      console.error('[Internal] Invalid service token', {
        path: req.path,
        ip: req.ip,
        method: req.method,
        error: error.message
      });

      res.status(401).json({
        success: false,
        error: {
          code: 'INVALID_SERVICE_TOKEN',
          message: 'Service authentication failed - invalid token'
        }
      });
      return;
    }

    // 4. AUTHENTICATION SUCCESSFUL
    console.log('[Internal] ✓ Service authenticated', {
      path: req.path,
      method: req.method,
      timestamp: new Date().toISOString()
    });

    // Optional: Attach service metadata to request for logging
    (req as any).internalService = {
      authenticated: true,
      timestamp: new Date()
    };

    // 5. PROCEED TO CONTROLLER
    next();

  } catch (error: any) {
    console.error('[Internal] Middleware error:', error.message);

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_AUTH_ERROR',
        message: 'Service authentication failed due to server error'
      }
    });
  }
};

export default internalMiddleware;