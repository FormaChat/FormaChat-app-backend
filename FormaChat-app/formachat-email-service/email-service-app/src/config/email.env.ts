import dotenv from 'dotenv';
import { cleanEnv, str, num, bool,url } from 'envalid';
import { createLogger } from '../utils/email.logger.utils';

dotenv.config();

const logger = createLogger('env-config');

export const env = cleanEnv(process.env, {
  // Server
  NODE_ENV: str({ choices: ['development', 'production', 'test'], default: 'development' }),
  PORT: num({ default: 4000 }),
  API_VERSION: str({ default: 'v1' }),
  SERVICE_NAME: str({ default: 'email-service' }),
  SERVICE_VERSION: str({ default: '1.0.0' }),

  // Internal Service Security
  INTERNAL_SERVICE_SECRET: str(), 

  AUTH_SERVICE_URL: url(),
 
 
  // RabbitMQ
  RABBITMQ_URL: str({ default: 'amqp://localhost:5672' }),
  RABBITMQ_EXCHANGE: str({ default: 'email.exchange' }),
  RABBITMQ_RETRY_ATTEMPTS: num({ default: 3 }),
  RABBITMQ_RETRY_DELAY: num({ default: 5000 }), // 5 seconds
  RABBITMQ_MAX_RETRY_DELAY: num({ default: 300000 }), // 5 minutes
  RABBITMQ_PREFETCH_COUNT: num({ default: 10 }),
  RABBITMQ_HEARTBEAT: num({ default: 60 }),
  
  // RabbitMQ Queue Names
  QUEUE_AUTH_EMAILS: str({ default: 'auth.emails' }),
  QUEUE_PAYMENT_EMAILS: str({ default: 'payment.emails' }),
  QUEUE_NOTIFICATION_EMAILS: str({ default: 'notification.emails' }),
  QUEUE_BUSINESS_EMAILS: str({ default: 'business.emails' }),
  QUEUE_RETRY: str({ default: 'email.retry' }),
  QUEUE_DLQ: str({ default: 'email.dlq' }),

  // Resend
  RESEND_API_KEY: str({ default: '' }),
  RESEND_FROM_EMAIL: str({ default: 'noreply@formachat.com' }),
  
 
  // Email Configuration
  EMAIL_MAX_RETRIES: num({ default: 3 }),
  EMAIL_RETRY_BACKOFF_MULTIPLIER: num({ default: 2 }),
  EMAIL_TIMEOUT: num({ default: 30000 }), // 30 seconds
  EMAIL_BATCH_SIZE: num({ default: 50 }),
  EMAIL_MAX_RECIPIENTS: num({ default: 50 }),
  
  // Rate Limiting (per hour)
  RATE_LIMIT_WINDOW: num({ default: 3600000 }), // 1 hour
  RATE_LIMIT_MAX_EMAILS_PER_USER: num({ default: 100 }),
  RATE_LIMIT_MAX_EMAILS_GLOBAL: num({ default: 10000 }),
  
  // Template Configuration
  TEMPLATE_CACHE_ENABLED: bool({ default: true }),
  TEMPLATE_PATH: str({ default: './templates' }),
  TEMPLATE_DEFAULT_LANGUAGE: str({ default: 'en' }),
  
  // Tracking & Analytics
  EMAIL_TRACKING_ENABLED: bool({ default: true }),
  EMAIL_OPEN_TRACKING: bool({ default: true }),
  EMAIL_CLICK_TRACKING: bool({ default: true }),
  TRACKING_PIXEL_DOMAIN: str({ default: 'https://track.yourdomain.com' }),
  
  // Security
  ALLOWED_EMAIL_DOMAINS: str({ default: '' }), // Comma-separated whitelist (empty = allow all)
  BLOCKED_EMAIL_DOMAINS: str({ default: 'tempmail.com,guerrillamail.com' }), // Comma-separated blacklist
  SANITIZE_HTML: bool({ default: true }),
  MAX_ATTACHMENT_SIZE: num({ default: 10485760 }), // 10MB in bytes
  
  // Logging
  LOG_LEVEL: str({ choices: ['error', 'warn', 'info', 'debug'], default: 'info' }),
  LOG_FILE_PATH: str({ default: './logs/email-service.log' }),
  LOG_EMAIL_CONTENT: bool({ default: false }), // Log full email content (disable in production)
  
  // Health Check
  HEALTH_CHECK_INTERVAL: num({ default: 30000 }), // 30 seconds
  HEALTH_CHECK_TIMEOUT: num({ default: 5000 }), // 5 seconds
  
  // Metrics & Monitoring
  METRICS_ENABLED: bool({ default: true }),
  METRICS_PORT: num({ default: 9090 }),
  
  // Dead Letter Queue
  DLQ_MAX_AGE: num({ default: 604800000 }), // 7 days in milliseconds
  DLQ_ALERT_THRESHOLD: num({ default: 100 }), // Alert when DLQ reaches this size
  
  // CORS (for internal APIs)
  CORS_ORIGIN: str({ default: 'http://localhost:3000' }),
  CORS_CREDENTIALS: bool({ default: true }),
});

// --- Custom Validations ---
(() => {
 
  if (env.INTERNAL_SERVICE_SECRET.length < 32) {
    logger.error('❌ INTERNAL_SERVICE_SECRET must be at least 32 characters long');
    process.exit(1);
  }



  // RabbitMQ validation
  if (!env.RABBITMQ_URL.startsWith('amqp://') && !env.RABBITMQ_URL.startsWith('amqps://')) {
    logger.error('❌ RABBITMQ_URL must start with "amqp://" or "amqps://"');
    process.exit(1);
  }

  
  

  logger.info('✅ Environment configuration validated successfully');
})();

// --- Derived Configurations ---
export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

export const corsOrigins = env.CORS_ORIGIN.split(',').map(o => o.trim());



export const rabbitmqOptions = {
  url: env.RABBITMQ_URL,
  exchange: env.RABBITMQ_EXCHANGE,
  retryAttempts: env.RABBITMQ_RETRY_ATTEMPTS,
  retryDelay: env.RABBITMQ_RETRY_DELAY,
  maxRetryDelay: env.RABBITMQ_MAX_RETRY_DELAY,
  prefetchCount: env.RABBITMQ_PREFETCH_COUNT,
  heartbeat: env.RABBITMQ_HEARTBEAT,
};


export const queueNames = {
  auth: env.QUEUE_AUTH_EMAILS,
  payment: env.QUEUE_PAYMENT_EMAILS,
  notification: env.QUEUE_NOTIFICATION_EMAILS,
  business: env.QUEUE_BUSINESS_EMAILS,
  retry: env.QUEUE_RETRY,
  dlq: env.QUEUE_DLQ,
};

export const allowedEmailDomains = env.ALLOWED_EMAIL_DOMAINS
  ? env.ALLOWED_EMAIL_DOMAINS.split(',').map(d => d.trim())
  : [];

export const blockedEmailDomains = env.BLOCKED_EMAIL_DOMAINS
  .split(',')
  .map(d => d.trim())
  .filter(Boolean);

export const trackingConfig = {
  enabled: env.EMAIL_TRACKING_ENABLED,
  openTracking: env.EMAIL_OPEN_TRACKING,
  clickTracking: env.EMAIL_CLICK_TRACKING,
  domain: env.TRACKING_PIXEL_DOMAIN,
};

export const templateConfig = {
  cacheEnabled: env.TEMPLATE_CACHE_ENABLED,
  path: env.TEMPLATE_PATH,
  defaultLanguage: env.TEMPLATE_DEFAULT_LANGUAGE,
};

export const rateLimitConfig = {
  window: env.RATE_LIMIT_WINDOW,
  maxEmailsPerUser: env.RATE_LIMIT_MAX_EMAILS_PER_USER,
  maxEmailsGlobal: env.RATE_LIMIT_MAX_EMAILS_GLOBAL,
};