import { Request, Response, NextFunction } from "express";
import { createLogger, getRequestId } from "../utils/auth.logger.utils";

export class AuthError extends Error {
  constructor(
    message: string,
    public statusCode: number = 500,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AuthError';
    Error.captureStackTrace(this, this.constructor);
  }
}

// Specific error classes for better error handling
export class ValidationError extends AuthError {
  constructor(message: string, details?: any) {
    super(message, 400, 'VALIDATION_ERROR', details);
    this.name = 'ValidationError';
  }
}

export class UnauthorizedError extends AuthError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, 'UNAUTHORIZED');
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends AuthError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, 'FORBIDDEN');
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AuthError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, 'NOT_FOUND');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AuthError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
    this.name = 'ConflictError';
  }
}

export class RateLimitError extends AuthError {
  constructor(message: string = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
    this.name = 'RateLimitError';
  }
}

export const errorHandlerMiddleware = (
  error: Error | AuthError,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  // Get request context for logging
  const requestId = getRequestId(req);
  const logger = createLogger(requestId);

  // Default error response
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  let errorMessage = 'Internal server error';
  let errorDetails: any = undefined;

  // Handle AuthError and its subclasses
  if (error instanceof AuthError) {
    statusCode = error.statusCode;
    errorCode = error.code || 'AUTH_ERROR';
    errorMessage = error.message;
    errorDetails = error.details;

    // Log based on severity
    if (statusCode >= 500) {
      logger.error('Server error occurred', {
        error: errorMessage,
        code: errorCode,
        stack: error.stack,
        path: req.path,
        method: req.method,
        ip: req.ip
      });
    } else if (statusCode >= 400) {
      logger.warn('Client error occurred', {
        error: errorMessage,
        code: errorCode,
        path: req.path,
        method: req.method,
        ip: req.ip
      });
    }
  } 
  // Handle validation errors from libraries (e.g., express-validator, zod)
  else if (error.name === 'ValidationError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
    errorMessage = error.message;
    
    logger.warn('Validation error', {
      error: errorMessage,
      path: req.path
    });
  }
  // Handle MongoDB/Mongoose errors
  else if (error.name === 'MongoError' || error.name === 'MongoServerError') {
    statusCode = 500;
    errorCode = 'DATABASE_ERROR';
    errorMessage = 'Database operation failed';
    
    logger.error('Database error', {
      error: error.message,
      stack: error.stack,
      path: req.path
    });
  }
  // Handle JWT errors
  else if (error.name === 'JsonWebTokenError') {
    statusCode = 401;
    errorCode = 'INVALID_TOKEN';
    errorMessage = 'Invalid authentication token';
    
    logger.warn('JWT error', {
      error: error.message,
      path: req.path
    });
  }
  else if (error.name === 'TokenExpiredError') {
    statusCode = 401;
    errorCode = 'TOKEN_EXPIRED';
    errorMessage = 'Authentication token has expired';
    
    logger.warn('Token expired', {
      path: req.path
    });
  }
  // Generic unhandled errors
  else {
    logger.error('Unhandled error occurred', {
      error: error.message,
      name: error.name,
      stack: error.stack,
      path: req.path,
      method: req.method,
      ip: req.ip
    });
  }

  // Prepare error response
  const errorResponse: any = {
    success: false,
    error: {
      code: errorCode,
      message: errorMessage,
      timestamp: new Date().toISOString(),
      requestId
    }
  };

  // Include details only in development or for client errors
  if (errorDetails && (process.env.NODE_ENV === 'development' || statusCode < 500)) {
    errorResponse.error.details = errorDetails;
  }

  // Include stack trace only in development for server errors
  if (process.env.NODE_ENV === 'development' && statusCode >= 500) {
    errorResponse.error.stack = error.stack;
  }

  // Send response
  return res.status(statusCode).json(errorResponse);
};

// Async error wrapper to avoid try-catch in every route
export const asyncHandler = (fn: Function) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};