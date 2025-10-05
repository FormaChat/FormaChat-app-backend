import { Request, Response, NextFunction } from 'express';
import { redisManager } from '../config/auth.redis';
import { AuthError } from './auth.errorHandler.middleware';
import { createLogger, getRequestId } from '../utils/auth.logger.utils';

export const idempotencyMiddleware = async (
  req: Request, 
  res: Response, 
  next: NextFunction
) => {
  const requestId = getRequestId(req);
  const logger = createLogger(requestId);

  // Only apply to POST, PUT, PATCH requests
  if (!['POST', 'PUT', 'PATCH'].includes(req.method)) {
    return next();
  }

  const idempotencyKey = req.headers['x-idempotency-key'] as string;
  
  if (!idempotencyKey) {
    logger.warn('Missing idempotency key', {
      path: req.path,
      method: req.method
    });
    throw new AuthError('Idempotency key required', 400, 'MISSING_IDEMPOTENCY_KEY');
  }

  try {
    // Check if this request was already processed
    const existing = await redisManager.getIdempotencyKey(idempotencyKey);
    
    if (existing) {
      logger.info('Duplicate request detected', {
        idempotencyKey,
        path: req.path,
        originalStatus: existing.status
      });

      // Return the original response if available
      return res.status(existing.status === 'success' ? 200 : 409).json(existing.response);
    }

    // Store a "processing" marker to prevent race conditions
    await redisManager.storeIdempotencyKey(idempotencyKey, {
      status: 'processing',
      response: null,
      timestamp: Date.now()
    });

    // Intercept the response to store the result
    const originalJson = res.json.bind(res);
    res.json = function(body: any) {
      // Store the actual response for replay
      redisManager.storeIdempotencyKey(idempotencyKey, {
        status: res.statusCode >= 200 && res.statusCode < 300 ? 'success' : 'error',
        response: body,
        timestamp: Date.now()
      }).catch(err => {
        logger.error('Failed to store idempotency response', { error: err.message });
      });

      return originalJson(body);
    };

    logger.debug('Idempotency key registered', {
      idempotencyKey,
      path: req.path
    });

    next();
  } catch (error) {
    logger.error('Idempotency check failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
      idempotencyKey
    });
    // If Redis fails, allow the request to proceed (fail open)
    next();
  }
};