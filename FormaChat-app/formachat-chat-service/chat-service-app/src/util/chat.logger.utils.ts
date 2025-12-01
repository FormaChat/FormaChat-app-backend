import winston from 'winston';
import path from 'path';
import fs from 'fs';

// Environment variables
const NODE_ENV = process.env.NODE_ENV || 'development';
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const LOG_FILE_PATH = process.env.LOG_FILE_PATH || './logs/chat-service.log';
const SERVICE_NAME = process.env.SERVICE_NAME || 'chat-service';

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
    const { timestamp, level, message, service, requestId, sessionId, businessId, ...meta } = info;
    
    const logEntry = {
      timestamp,
      level: level.toUpperCase(),
      service: service || SERVICE_NAME,
      message,
      ...(requestId ? { requestId } : {}),
      ...(sessionId ? { sessionId } : {}),
      ...(businessId ? { businessId } : {}),
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
    const { timestamp, level, message, requestId, sessionId, businessId, ...meta } = info;
    
    let logMessage = `[${timestamp}] ${level}: ${message}`;
    
    if (requestId) logMessage += ` [ReqID: ${requestId}]`;
    if (sessionId) logMessage += ` [SessionID: ${sessionId}]`;
    if (businessId) logMessage += ` [BusinessID: ${businessId}]`;
    
    if (Object.keys(meta).length > 0) {
      logMessage += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    return logMessage;
  })
);

// Create transports array
const transports: winston.transport[] = [];

// Console transport
if (isDevelopment) {
  transports.push(
    new winston.transports.Console({
      format: consoleFormat,
      level: LOG_LEVEL
    })
  );
} else {
  transports.push(
    new winston.transports.Console({
      format: logFormat,
      level: LOG_LEVEL
    })
  );
}

// File transport for persistent logging
if (process.env.ENABLE_FILE_LOGGING === 'true') {
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
    
    // Chat operations log file (for audit trail)
    new winston.transports.File({
      filename: LOG_FILE_PATH.replace('.log', '.chat-ops.log'),
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
  private sessionId?: string;
  private businessId?: string;

  constructor(requestId?: string, sessionId?: string, businessId?: string) {
    this.requestId = requestId;
    this.sessionId = sessionId;
    this.businessId = businessId;
  }

  private log(level: string, message: string, meta?: object) {
    const logData = {
      ...meta,
      ...(this.requestId && { requestId: this.requestId }),
      ...(this.sessionId && { sessionId: this.sessionId }),
      ...(this.businessId && { businessId: this.businessId })
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

  // ========================================
  // SESSION LOGGING
  // ========================================

  sessionCreated(details: {
    businessName: string;
    visitorId: string;
    duration?: number;
  }): void {
    this.log('info', `Chat session created for: ${details.businessName}`, {
      session: true,
      action: 'created',
      businessName: details.businessName,
      visitorId: details.visitorId,
      duration: details.duration
    });
  }

  sessionResumed(details: {
    businessName: string;
    messageCount: number;
  }): void {
    this.log('info', `Chat session resumed for: ${details.businessName}`, {
      session: true,
      action: 'resumed',
      businessName: details.businessName,
      messageCount: details.messageCount
    });
  }

  sessionEnded(details: {
    businessName: string;
    duration: number;
    messageCount: number;
    contactCaptured: boolean;
  }): void {
    this.log('info', `Chat session ended for: ${details.businessName}`, {
      session: true,
      action: 'ended',
      businessName: details.businessName,
      duration: details.duration,
      messageCount: details.messageCount,
      contactCaptured: details.contactCaptured
    });
  }

  sessionLimitReached(details: {
    businessName: string;
    currentCount: number;
    maxLimit: number;
  }): void {
    this.log('warn', `Session limit reached for: ${details.businessName}`, {
      session: true,
      action: 'limit_reached',
      businessName: details.businessName,
      currentCount: details.currentCount,
      maxLimit: details.maxLimit
    });
  }

  sessionAbandoned(details: {
    businessName: string;
    lastMessageAt: Date;
  }): void {
    this.log('info', `Session abandoned for: ${details.businessName}`, {
      session: true,
      action: 'abandoned',
      businessName: details.businessName,
      lastMessageAt: details.lastMessageAt
    });
  }

  // ========================================
  // MESSAGE LOGGING
  // ========================================

  messageReceived(details: {
    businessName: string;
    messageLength: number;
    role: 'user' | 'assistant';
  }): void {
    this.log('debug', `Message received in session`, {
      message: true,
      action: 'received',
      businessName: details.businessName,
      messageLength: details.messageLength,
      role: details.role
    });
  }

  messageSent(details: {
    businessName: string;
    messageLength: number;
    latency: number;
    tokensUsed?: number;
  }): void {
    this.log('info', `Message sent in session`, {
      message: true,
      action: 'sent',
      businessName: details.businessName,
      messageLength: details.messageLength,
      latency: details.latency,
      tokensUsed: details.tokensUsed
    });
  }

  messagesDeleted(details: {
    count: number;
    olderThan: Date;
  }): void {
    this.log('info', `Messages auto-deleted`, {
      message: true,
      action: 'deleted',
      count: details.count,
      olderThan: details.olderThan
    });
  }

  // ========================================
  // CONTACT CAPTURE LOGGING
  // ========================================

  contactCaptured(details: {
    businessName: string;
    email?: string;
    phone?: string;
    name?: string;
    isNewLead: boolean;
    confidence?: number;
  }): void {
    this.log('info', `Contact captured for: ${details.businessName}`, {
      contact: true,
      action: 'captured',
      businessName: details.businessName,
      hasEmail: !!details.email,
      hasPhone: !!details.phone,
      hasName: !!details.name,
      isNewLead: details.isNewLead,
      confidence: details.confidence
    });
  }

  contactExtractionFailed(details: {
    businessName: string;
    reason: string;
  }): void {
    this.log('warn', `Contact extraction failed for: ${details.businessName}`, {
      contact: true,
      action: 'extraction_failed',
      businessName: details.businessName,
      reason: details.reason
    });
  }

  highIntentDetected(details: {
    businessName: string;
    keywords: string[];
    userMessage: string;
  }): void {
    this.log('info', `High intent detected for: ${details.businessName}`, {
      contact: true,
      action: 'high_intent',
      businessName: details.businessName,
      keywords: details.keywords,
      messagePreview: details.userMessage.substring(0, 50) + '...'
    });
  }

  leadUpdated(details: {
    businessName: string;
    email: string;
    totalSessions: number;
  }): void {
    this.log('info', `Lead updated for: ${details.businessName}`, {
      contact: true,
      action: 'lead_updated',
      businessName: details.businessName,
      email: details.email,
      totalSessions: details.totalSessions
    });
  }

  // ========================================
  // PINECONE QUERY LOGGING
  // ========================================

  vectorQueryStarted(details: {
    businessName: string;
    namespace: string;
    questionLength: number;
  }): void {
    this.log('debug', `Vector query started for: ${details.businessName}`, {
      vector: true,
      action: 'query_started',
      businessName: details.businessName,
      namespace: details.namespace,
      questionLength: details.questionLength
    });
  }

  vectorQueryCompleted(details: {
    businessName: string;
    namespace: string;
    resultsCount: number;
    topScore: number;
    duration: number;
  }): void {
    this.log('info', `Vector query completed for: ${details.businessName}`, {
      vector: true,
      action: 'query_completed',
      businessName: details.businessName,
      namespace: details.namespace,
      resultsCount: details.resultsCount,
      topScore: details.topScore,
      duration: details.duration
    });
  }

  vectorQueryFailed(details: {
    businessName: string;
    namespace: string;
    error: string;
  }): void {
    this.log('error', `Vector query failed for: ${details.businessName}`, {
      vector: true,
      action: 'query_failed',
      businessName: details.businessName,
      namespace: details.namespace,
      error: details.error
    });
  }

  vectorContextEmpty(details: {
    businessName: string;
    namespace: string;
  }): void {
    this.log('warn', `No vectors found for: ${details.businessName}`, {
      vector: true,
      action: 'context_empty',
      businessName: details.businessName,
      namespace: details.namespace
    });
  }

  // ========================================
  // GROQ LLM LOGGING
  // ========================================

  llmRequestSent(details: {
    businessName: string;
    model: string;
    contextLength: number;
    questionLength: number;
  }): void {
    this.log('info', `LLM request sent for: ${details.businessName}`, {
      llm: true,
      action: 'request_sent',
      businessName: details.businessName,
      model: details.model,
      contextLength: details.contextLength,
      questionLength: details.questionLength
    });
  }

  llmResponseReceived(details: {
    businessName: string;
    model: string;
    tokensUsed: number;
    responseLength: number;
    duration: number;
  }): void {
    this.log('info', `LLM response received for: ${details.businessName}`, {
      llm: true,
      action: 'response_received',
      businessName: details.businessName,
      model: details.model,
      tokensUsed: details.tokensUsed,
      responseLength: details.responseLength,
      duration: details.duration
    });
  }

  llmRequestFailed(details: {
    businessName: string;
    model: string;
    error: string;
    duration: number;
  }): void {
    this.log('error', `LLM request failed for: ${details.businessName}`, {
      llm: true,
      action: 'request_failed',
      businessName: details.businessName,
      model: details.model,
      error: details.error,
      duration: details.duration
    });
  }

  // ========================================
  // REDIS LOGGING
  // ========================================

  redisConnection(status: 'connected' | 'disconnected' | 'error', details?: any): void {
    const level = status === 'connected' ? 'info' : status === 'disconnected' ? 'warn' : 'error';
    
    this.log(level, `Redis ${status}`, {
      redis: true,
      status,
      ...details
    });
  }

  redisSessionLimitChecked(details: {
    businessName: string;
    currentCount: number;
    maxLimit: number;
    limitExceeded: boolean;
  }): void {
    this.log('debug', `Redis session limit checked for: ${details.businessName}`, {
      redis: true,
      action: 'limit_checked',
      businessName: details.businessName,
      currentCount: details.currentCount,
      maxLimit: details.maxLimit,
      limitExceeded: details.limitExceeded
    });
  }

  redisCacheMiss(key: string): void {
    this.log('debug', `Redis cache miss`, {
      redis: true,
      action: 'cache_miss',
      key
    });
  }

  redisCacheHit(key: string): void {
    this.log('debug', `Redis cache hit`, {
      redis: true,
      action: 'cache_hit',
      key
    });
  }

  // ========================================
  // DATABASE LOGGING
  // ========================================

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

  // ========================================
  // EXPORT LOGGING
  // ========================================

  exportRequested(details: {
    businessName: string;
    exportType: 'sessions' | 'leads' | 'conversation';
    format: 'csv' | 'pdf';
    recordCount: number;
  }): void {
    this.log('info', `Export requested for: ${details.businessName}`, {
      export: true,
      action: 'requested',
      businessName: details.businessName,
      exportType: details.exportType,
      format: details.format,
      recordCount: details.recordCount
    });
  }

  exportCompleted(details: {
    businessName: string;
    exportType: 'sessions' | 'leads' | 'conversation';
    format: 'csv' | 'pdf';
    duration: number;
    fileSize: number;
  }): void {
    this.log('info', `Export completed for: ${details.businessName}`, {
      export: true,
      action: 'completed',
      businessName: details.businessName,
      exportType: details.exportType,
      format: details.format,
      duration: details.duration,
      fileSize: details.fileSize
    });
  }

  exportFailed(details: {
    businessName: string;
    exportType: 'sessions' | 'leads' | 'conversation';
    error: string;
  }): void {
    this.log('error', `Export failed for: ${details.businessName}`, {
      export: true,
      action: 'failed',
      businessName: details.businessName,
      exportType: details.exportType,
      error: details.error
    });
  }

  // ========================================
  // BUSINESS ACCESS LOGGING
  // ========================================

  businessAccessChecked(details: {
    businessName: string;
    allowed: boolean;
    reason?: string;
  }): void {
    this.log('info', `Business access checked: ${details.businessName}`, {
      business: true,
      action: 'access_checked',
      businessName: details.businessName,
      allowed: details.allowed,
      reason: details.reason
    });
  }

  businessFrozen(details: {
    businessName: string;
    reason: string;
  }): void {
    this.log('warn', `Business frozen: ${details.businessName}`, {
      business: true,
      action: 'frozen',
      businessName: details.businessName,
      reason: details.reason
    });
  }

  // ========================================
  // HTTP REQUEST LOGGING
  // ========================================

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

  // ========================================
  // PERFORMANCE LOGGING
  // ========================================

  performance(operation: string, duration: number, meta?: object): void {
    this.log('info', `PERFORMANCE: ${operation}`, {
      performance: true,
      operation,
      duration,
      ...meta
    });
  }

  // ========================================
  // VALIDATION ERRORS
  // ========================================

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
export const createLogger = (requestId?: string, sessionId?: string, businessId?: string): Logger => {
  return new Logger(requestId, sessionId, businessId);
};

// Helper function to extract request ID from request object
export const getRequestId = (req: any): string => {
  return req.headers['x-request-id'] || req.id || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

// Helper function to generate session ID
export const generateSessionId = (): string => {
  return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
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

  if (req.startTime) {
    logData.responseTime = Date.now() - req.startTime;
  }

  if (responseData) {
    logData.responseSize = JSON.stringify(responseData).length;
  }

  contextLogger.httpRequest(logData);
};

// Startup logging
export const logStartup = (port: number, environment: string) => {
  logger.info('Chat service starting up', {
    startup: true,
    port,
    environment,
    nodeVersion: process.version,
    pid: process.pid
  });
};

// Shutdown logging
export const logShutdown = (reason: string) => {
  logger.info('Chat service shutting down', {
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
  totalSessions: number;
  activeSessions: number;
  totalLeads: number;
  newLeadsToday: number;
  avgMessagesPerSession: number;
  avgResponseTime: number;
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