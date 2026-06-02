import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Since we can't import env yet, we'll use process.env directly
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_FILE_PATH = process.env.LOG_FILE_PATH || './logs/email-service.log';
const SERVICE_NAME = process.env.SERVICE_NAME || 'email-service';
const LOG_EMAIL_CONTENT = process.env.LOG_EMAIL_CONTENT === 'true';

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
    const { timestamp, level, message, service, requestId, emailId, userId, ...meta } = info;
    
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      service: service || SERVICE_NAME,
      message,
      ...(requestId ? { requestId } : {}),
      ...(emailId ? { emailId } : {}),
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
    const { timestamp, level, message, requestId, emailId, userId, ...meta } = info;
    
    let logMessage = `[${timestamp}] ${level}: ${message}`;
    
    if (requestId) logMessage += ` [ReqID: ${requestId}]`;
    if (emailId) logMessage += ` [EmailID: ${emailId}]`;
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
    
    // Email operations log file (for audit trail)
    new winston.transports.File({
      filename: LOG_FILE_PATH.replace('.log', '.emails.log'),
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
  // Don't exit on error
  exitOnError: false,
  // Silence winston's own logs unless in debug mode
  silent: false
});

// Custom logging methods with context
export class Logger {
  private requestId?: string;
  private emailId?: string;
  private userId?: string;

  constructor(requestId?: string, emailId?: string, userId?: string) {
    this.requestId = requestId;
    this.emailId = emailId;
    this.userId = userId;
  }

  private log(level: string, message: string, meta?: object) {
    const logData = {
      ...meta,
      ...(this.requestId && { requestId: this.requestId }),
      ...(this.emailId && { emailId: this.emailId }),
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

  // Email-specific logging
  emailSent(details: {
    to: string | string[];
    from: string;
    subject: string;
    template?: string;
    provider: string;
    messageId?: string;
    duration?: number;
    retryCount?: number;
  }): void {
    const recipients = Array.isArray(details.to) ? details.to.length : 1;
    
    this.log('info', `Email sent successfully`, {
      email: true,
      action: 'sent',
      recipients,
      from: details.from,
      subject: details.subject,
      template: details.template,
      provider: details.provider,
      messageId: details.messageId,
      duration: details.duration,
      retryCount: details.retryCount || 0
    });
  }

  emailFailed(details: {
    to: string | string[];
    from: string;
    subject: string;
    template?: string;
    provider: string;
    error: Error | string;
    retryCount?: number;
    willRetry?: boolean;
  }): void {
    const recipients = Array.isArray(details.to) ? details.to.length : 1;
    const errorMessage = details.error instanceof Error ? details.error.message : details.error;
    
    this.log('error', `Email sending failed`, {
      email: true,
      action: 'failed',
      recipients,
      from: details.from,
      subject: details.subject,
      template: details.template,
      provider: details.provider,
      error: errorMessage,
      retryCount: details.retryCount || 0,
      willRetry: details.willRetry || false
    });
  }

  emailQueued(details: {
    to: string | string[];
    from: string;
    subject: string;
    template?: string;
    queue: string;
    priority?: string;
  }): void {
    const recipients = Array.isArray(details.to) ? details.to.length : 1;
    
    this.log('info', `Email queued for delivery`, {
      email: true,
      action: 'queued',
      recipients,
      from: details.from,
      subject: details.subject,
      template: details.template,
      queue: details.queue,
      priority: details.priority
    });
  }

  emailRetry(details: {
    to: string | string[];
    subject: string;
    attempt: number;
    maxAttempts: number;
    nextRetryIn?: number;
    reason: string;
  }): void {
    const recipients = Array.isArray(details.to) ? details.to.length : 1;
    
    this.log('warn', `Email retry scheduled`, {
      email: true,
      action: 'retry',
      recipients,
      subject: details.subject,
      attempt: details.attempt,
      maxAttempts: details.maxAttempts,
      nextRetryIn: details.nextRetryIn,
      reason: details.reason
    });
  }

  emailDLQ(details: {
    to: string | string[];
    subject: string;
    reason: string;
    attempts: number;
    originalError: string;
  }): void {
    const recipients = Array.isArray(details.to) ? details.to.length : 1;
    
    this.log('error', `Email moved to DLQ`, {
      email: true,
      action: 'dlq',
      recipients,
      subject: details.subject,
      reason: details.reason,
      attempts: details.attempts,
      originalError: details.originalError
    });
  }

  // Template logging
  templateRendered(templateName: string, duration: number, cached?: boolean): void {
    this.log('debug', `Template rendered: ${templateName}`, {
      template: true,
      action: 'rendered',
      templateName,
      duration,
      cached: cached || false
    });
  }

  templateError(templateName: string, error: Error): void {
    this.log('error', `Template rendering failed: ${templateName}`, {
      template: true,
      action: 'error',
      templateName,
      error: error.message,
      stack: error.stack
    });
  }

  // Provider logging
  providerSwitch(from: string, to: string, reason: string): void {
    this.log('warn', `Provider switched from ${from} to ${to}`, {
      provider: true,
      action: 'switch',
      from,
      to,
      reason
    });
  }

  providerHealthCheck(provider: string, status: 'healthy' | 'unhealthy', responseTime?: number): void {
    this.log(status === 'healthy' ? 'info' : 'error', `Provider health check: ${provider}`, {
      provider: true,
      action: 'health_check',
      providerName: provider,
      status,
      responseTime
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

  // Rate limit logging
  rateLimitHit(identifier: string, limit: number, window: number): void {
    this.log('warn', `Rate limit hit`, {
      rateLimit: true,
      identifier,
      limit,
      window
    });
  }

  // Tracking logging
  emailOpened(details: {
    recipient: string;
    subject: string;
    openedAt: Date;
    userAgent?: string;
    ip?: string;
  }): void {
    this.log('info', `Email opened`, {
      tracking: true,
      action: 'opened',
      recipient: details.recipient,
      subject: details.subject,
      openedAt: details.openedAt,
      userAgent: details.userAgent,
      ip: details.ip
    });
  }

  emailClicked(details: {
    recipient: string;
    subject: string;
    link: string;
    clickedAt: Date;
  }): void {
    this.log('info', `Email link clicked`, {
      tracking: true,
      action: 'clicked',
      recipient: details.recipient,
      subject: details.subject,
      link: details.link,
      clickedAt: details.clickedAt
    });
  }

  emailBounced(details: {
    recipient: string;
    subject: string;
    bounceType: string;
    reason: string;
  }): void {
    this.log('warn', `Email bounced`, {
      tracking: true,
      action: 'bounced',
      recipient: details.recipient,
      subject: details.subject,
      bounceType: details.bounceType,
      reason: details.reason
    });
  }
} 

// Helper function to create contextual logger
export const createLogger = (requestId?: string, emailId?: string, userId?: string): Logger => {
  return new Logger(requestId, emailId, userId);
};

// Helper function to extract request ID from request object
export const getRequestId = (req: any): string => {
  return req.headers['x-request-id'] || req.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Helper function to generate email ID
export const generateEmailId = (): string => {
  return `email_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

  // Don't log sensitive response data
  if (responseData && LOG_EMAIL_CONTENT) {
    logData.responseSize = JSON.stringify(responseData).length;
  }

  contextLogger.httpRequest(logData);
};

// Helper function for queue operations logging
export const logQueueOperation = (operation: string, queue: string, emailId?: string, error?: Error) => {
  if (error) {
    logger.error(`Queue operation failed: ${operation}`, {
      queue: true,
      operation,
      queueName: queue,
      emailId,
      error: error.message
    });
  } else {
    logger.info(`Queue operation completed: ${operation}`, {
      queue: true,
      operation,
      queueName: queue,
      emailId
    });
  }
};

// Helper function for message consumption logging
export const logMessageConsumed = (queue: string, emailId: string, processingTime: number, success: boolean) => {
  if (success) {
    logger.info(`Message processed successfully`, {
      queue: true,
      action: 'consumed',
      queueName: queue,
      emailId,
      processingTime,
      success: true
    });
  } else {
    logger.error(`Message processing failed`, {
      queue: true,
      action: 'consumed',
      queueName: queue,
      emailId,
      processingTime,
      success: false
    });
  }
};

// Helper function for batch operations
export const logBatchOperation = (operation: string, batchSize: number, successCount: number, failureCount: number, duration: number) => {
  logger.info(`Batch operation completed: ${operation}`, {
    batch: true,
    operation,
    batchSize,
    successCount,
    failureCount,
    duration,
    successRate: ((successCount / batchSize) * 100).toFixed(2) + '%'
  });
};

// Startup logging
export const logStartup = (port: number, environment: string) => {
  logger.info('Email service starting up', {
    startup: true,
    port,
    environment,
    nodeVersion: process.version,
    pid: process.pid
  });
};

// Shutdown logging
export const logShutdown = (reason: string) => {
  logger.info('Email service shutting down', {
    shutdown: true,
    reason,
    uptime: process.uptime()
  });
};

// Queue connection logging
export const logQueueConnection = (status: 'connected' | 'disconnected' | 'error', details?: any) => {
  const level = status === 'connected' ? 'info' : status === 'disconnected' ? 'warn' : 'error';
  
  logger.log(level, `RabbitMQ ${status}`, {
    rabbitmq: true,
    status,
    ...details
  });
};


// Metrics logging
export const logMetrics = (metrics: {
  emailsSent: number;
  emailsFailed: number;
  avgDeliveryTime: number;
  queueSize: number;
  dlqSize: number;
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