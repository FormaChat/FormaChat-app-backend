import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_FILE_PATH = process.env.LOG_FILE_PATH || './logs/business-service.log';
const SERVICE_NAME = process.env.SERVICE_NAME || 'business-service';

const isDevelopment = NODE_ENV === 'development';
const isProduction = NODE_ENV === 'production';

// Custom log format for structured logging
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.json(),
  winston.format.printf((info) => {
    const { timestamp, level, message, service, requestId, businessId, userId, ...meta } = info;
    
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      service: service || SERVICE_NAME,
      message,
      ...(requestId ? { requestId } : {}),
      ...(businessId ? { businessId } : {}),
      ...(userId ? { userId } : {}),
      ...(Object.keys(meta).length > 0 && { meta })
    };

    return JSON.stringify(logEntry);
  })
);

// Console format for development
const consoleFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'HH:mm:ss.SSS'
  }),
  winston.format.colorize(),
  winston.format.errors({ stack: true }),
  winston.format.printf((info) => {
    const { timestamp, level, message, requestId, businessId, userId, ...meta } = info;
    
    let logMessage = `[${timestamp}] ${level}: ${message}`;
    
    if (requestId) logMessage += ` [ReqID: ${requestId}]`;
    if (businessId) logMessage += ` [BusinessID: ${businessId}]`;
    if (userId) logMessage += ` [UserID: ${userId}]`;
    
    if (Object.keys(meta).length > 0) {
      logMessage += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    return logMessage;
  })
);

// Create transports array
const transports: winston.transport[] = [];

// Console transport (always enabled in development)
if (isDevelopment) {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: LOG_LEVEL
    })
  );
} else {
  // In production, use structured JSON logging to console
  transports.push(
    new winston.transports.Console({
      format: logFormat,
      level: LOG_LEVEL
    })
  );
}

// File transport for persistent logging
if (process.env.ENABLE_FILE_LOGGING === 'true') {
  // Ensure logs directory exists
  const logDir = path.dirname(LOG_FILE_PATH);
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  transports.push(
    // Combined log file
    new winston.transports.File({
      filename: LOG_FILE_PATH,
      format: logFormat,
      level: LOG_LEVEL,
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true
    }),
    
    // Error-only log file
    new winston.transports.File({
      filename: LOG_FILE_PATH.replace('.log', '.error.log'),
      format: logFormat,
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 3,
      tailable: true
    }),
    
    // Business operations log file (for audit trail)
    new winston.transports.File({
      filename: LOG_FILE_PATH.replace('.log', '.business-ops.log'),
      format: logFormat,
      level: 'info',
      maxsize: 10485760, // 10MB
      maxFiles: 7,
      tailable: true
    })
  );
}

// Create the logger instance
export const logger = winston.createLogger({
  level: LOG_LEVEL,
  format: logFormat,
  defaultMeta: {
    service: SERVICE_NAME,
    environment: NODE_ENV
  },
  transports,
  exitOnError: false,
  silent: false
});

// Custom logging methods with context
export class Logger {
  private requestId?: string;
  private businessId?: string;
  private userId?: string;

  constructor(requestId?: string, businessId?: string, userId?: string) {
    this.requestId = requestId;
    this.businessId = businessId;
    this.userId = userId;
  }

  private log(level: string, message: string, meta?: object) {
    const logData = {
      ...meta,
      ...(this.requestId && { requestId: this.requestId }),
      ...(this.businessId && { businessId: this.businessId }),
      ...(this.userId && { userId: this.userId })
    };

    logger.log(level, message, logData);
  }

  error(message: string, meta?: object): void {
    this.log('error', message, meta);
  }

  warn(message: string, meta?: object): void {
    this.log('warn', message, meta);
  }

  info(message: string, meta?: object): void {
    this.log('info', message, meta);
  }

  debug(message: string, meta?: object): void {
    this.log('debug', message, meta);
  }

  // Business-specific logging
  businessCreated(details: {
    businessName: string;
    businessType: string;
    duration?: number;
  }): void {
    this.log('info', `Business profile created: ${details.businessName}`, {
      business: true,
      action: 'created',
      businessName: details.businessName,
      businessType: details.businessType,
      duration: details.duration
    });
  }

  businessUpdated(details: {
    businessName: string;
    fieldsUpdated: string[];
    duration?: number;
  }): void {
    this.log('info', `Business profile updated: ${details.businessName}`, {
      business: true,
      action: 'updated',
      businessName: details.businessName,
      fieldsUpdated: details.fieldsUpdated,
      duration: details.duration
    });
  }

  businessDeleted(businessName: string): void {
    this.log('info', `Business profile deleted: ${businessName}`, {
      business: true,
      action: 'deleted',
      businessName
    });
  }

  businessRetrieved(businessName: string, cached?: boolean): void {
    this.log('debug', `Business profile retrieved: ${businessName}`, {
      business: true,
      action: 'retrieved',
      businessName,
      cached: cached || false
    });
  }

  // FAQ logging
  faqAdded(details: {
    businessName: string;
    faqCount: number;
    type: 'onboarding' | 'custom';
  }): void {
    this.log('info', `FAQs added to business: ${details.businessName}`, {
      faq: true,
      action: 'added',
      businessName: details.businessName,
      faqCount: details.faqCount,
      type: details.type
    });
  }

  faqUpdated(details: {
    businessName: string;
    faqId: string;
  }): void {
    this.log('info', `FAQ updated for business: ${details.businessName}`, {
      faq: true,
      action: 'updated',
      businessName: details.businessName,
      faqId: details.faqId
    });
  }

  faqDeleted(details: {
    businessName: string;
    faqId: string;
  }): void {
    this.log('info', `FAQ deleted from business: ${details.businessName}`, {
      faq: true,
      action: 'deleted',
      businessName: details.businessName,
      faqId: details.faqId
    });
  }

  // File upload logging
  fileUploaded(details: {
    businessName: string;
    fileType: 'document' | 'image';
    fileName: string;
    fileSize: number;
    category?: string;
  }): void {
    this.log('info', `File uploaded for business: ${details.businessName}`, {
      file: true,
      action: 'uploaded',
      businessName: details.businessName,
      fileType: details.fileType,
      fileName: details.fileName,
      fileSize: details.fileSize,
      category: details.category
    });
  }

  fileDeleted(details: {
    businessName: string;
    fileType: 'document' | 'image';
    fileName: string;
  }): void {
    this.log('info', `File deleted from business: ${details.businessName}`, {
      file: true,
      action: 'deleted',
      businessName: details.businessName,
      fileType: details.fileType,
      fileName: details.fileName
    });
  }

  // Vector DB logging
  vectorizationStarted(details: {
    businessName: string;
    namespace: string;
    documentCount: number;
  }): void {
    this.log('info', `Vectorization started for: ${details.businessName}`, {
      vector: true,
      action: 'started',
      businessName: details.businessName,
      namespace: details.namespace,
      documentCount: details.documentCount
    });
  }

  vectorizationCompleted(details: {
    businessName: string;
    namespace: string;
    vectorCount: number;
    duration: number;
  }): void {
    this.log('info', `Vectorization completed for: ${details.businessName}`, {
      vector: true,
      action: 'completed',
      businessName: details.businessName,
      namespace: details.namespace,
      vectorCount: details.vectorCount,
      duration: details.duration
    });
  }

  vectorizationFailed(details: {
    businessName: string;
    namespace: string;
    error: string;
    retryCount?: number;
  }): void {
    this.log('error', `Vectorization failed for: ${details.businessName}`, {
      vector: true,
      action: 'failed',
      businessName: details.businessName,
      namespace: details.namespace,
      error: details.error,
      retryCount: details.retryCount || 0
    });
  }

  vectorQuery(details: {
    namespace: string;
    query: string;
    resultsCount: number;
    duration: number;
  }): void {
    this.log('debug', `Vector query executed`, {
      vector: true,
      action: 'query',
      namespace: details.namespace,
      query: details.query,
      resultsCount: details.resultsCount,
      duration: details.duration
    });
  }

  // AI/OpenAI logging
  aiRequestSent(details: {
    model: string;
    tokens?: number;
    purpose: string;
  }): void {
    this.log('info', `AI request sent`, {
      ai: true,
      action: 'request',
      model: details.model,
      tokens: details.tokens,
      purpose: details.purpose
    });
  }

  aiResponseReceived(details: {
    model: string;
    tokens?: number;
    duration: number;
    purpose: string;
  }): void {
    this.log('info', `AI response received`, {
      ai: true,
      action: 'response',
      model: details.model,
      tokens: details.tokens,
      duration: details.duration,
      purpose: details.purpose
    });
  }

  aiRequestFailed(details: {
    model: string;
    error: string;
    purpose: string;
  }): void {
    this.log('error', `AI request failed`, {
      ai: true,
      action: 'failed',
      model: details.model,
      error: details.error,
      purpose: details.purpose
    });
  }

  // Database logging
  dbConnection(status: 'connected' | 'disconnected' | 'error', details?: any): void {
    const level = status === 'connected' ? 'info' : status === 'disconnected' ? 'warn' : 'error';
    
    this.log(level, `MongoDB ${status}`, {
      database: true,
      status,
      ...details
    });
  }

  dbQuery(details: {
    collection: string;
    operation: string;
    duration: number;
    recordsAffected?: number;
  }): void {
    this.log('debug', `Database query executed`, {
      database: true,
      collection: details.collection,
      operation: details.operation,
      duration: details.duration,
      recordsAffected: details.recordsAffected
    });
  }

  // Security/Auth logging
  authAttempt(details: {
    type: 'internal' | 'admin';
    success: boolean;
    reason?: string;
    ip?: string;
  }): void {
    const level = details.success ? 'info' : 'warn';
    
    this.log(level, `Authentication attempt: ${details.type}`, {
      security: true,
      action: 'auth',
      type: details.type,
      success: details.success,
      reason: details.reason,
      ip: details.ip
    });
  }

  unauthorizedAccess(details: {
    endpoint: string;
    ip?: string;
    reason: string;
  }): void {
    this.log('warn', `Unauthorized access attempt`, {
      security: true,
      action: 'unauthorized',
      endpoint: details.endpoint,
      ip: details.ip,
      reason: details.reason
    });
  }

  // HTTP request logging
  httpRequest(req: {
    method: string;
    url: string;
    statusCode?: number;
    responseTime?: number;
    ip?: string;
    userAgent?: string;
  }): void {
    const { method, url, statusCode, responseTime, ip, userAgent } = req;
    
    this.log('info', `HTTP ${method} ${url}`, {
      http: true,
      method,
      url,
      statusCode,
      responseTime,
      ip,
      userAgent
    });
  }

  // Performance logging
  performance(operation: string, duration: number, meta?: object): void {
    this.log('info', `PERFORMANCE: ${operation}`, {
      performance: true,
      operation,
      duration,
      ...meta
    });
  }

  // Rate limit logging
  rateLimitHit(identifier: string, limit: number, window: number): void {
    this.log('warn', `Rate limit hit`, {
      rateLimit: true,
      identifier,
      limit,
      window
    });
  }

  // Validation errors
  validationError(details: {
    field: string;
    value?: any;
    reason: string;
  }): void {
    this.log('warn', `Validation error: ${details.field}`, {
      validation: true,
      field: details.field,
      value: details.value,
      reason: details.reason
    });
  }
}

// Helper function to create contextual logger
export const createLogger = (requestId?: string, businessId?: string, userId?: string): Logger => {
  return new Logger(requestId, businessId, userId);
};

// Helper function to extract request ID from request object
export const getRequestId = (req: any): string => {
  return req.headers['x-request-id'] || req.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Helper function to generate business ID
export const generateBusinessId = (): string => {
  return `biz_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Helper function to log API responses
export const logApiResponse = (req: any, res: any, responseData?: any) => {
  const requestId = getRequestId(req);
  const contextLogger = createLogger(requestId);
  
  const logData: any = {
    method: req.method,
    url: req.originalUrl || req.url,
    statusCode: res.statusCode,
    ip: req.ip || req.connection?.remoteAddress,
    userAgent: req.headers['user-agent']
  };

  // Add response time if available
  if (req.startTime) {
    logData.responseTime = Date.now() - req.startTime;
  }

  // Add response size
  if (responseData) {
    logData.responseSize = JSON.stringify(responseData).length;
  }

  contextLogger.httpRequest(logData);
};

// Startup logging
export const logStartup = (port: number, environment: string) => {
  logger.info('Business service starting up', {
    startup: true,
    port,
    environment,
    nodeVersion: process.version,
    pid: process.pid
  });
};

// Shutdown logging
export const logShutdown = (reason: string) => {
  logger.info('Business service shutting down', {
    shutdown: true,
    reason,
    uptime: process.uptime()
  });
};

// Database connection logging
export const logDatabaseConnection = (status: 'connected' | 'disconnected' | 'error', details?: any) => {
  const level = status === 'connected' ? 'info' : status === 'disconnected' ? 'warn' : 'error';
  
  logger.log(level, `MongoDB ${status}`, {
    database: true,
    status,
    ...details
  });
};

// Metrics logging
export const logMetrics = (metrics: {
  totalBusinesses: number;
  activeBusinesses: number;
  vectorizationsPending: number;
  vectorizationsCompleted: number;
  avgVectorizationTime: number;
}) => {
  logger.info('Service metrics', {
    metrics: true,
    ...metrics
  });
};

// Error handling for uncaught exceptions
if (isProduction) {
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception', {
      error: error.message,
      stack: error.stack,
      fatal: true
    });
    
    // Give logger time to write before exiting
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
      promise: promise.toString()
    });
  });
}