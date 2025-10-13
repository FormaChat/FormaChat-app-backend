import dotenv from 'dotenv';
import { cleanEnv, str, num, bool } from 'envalid';
import { createLogger } from '../utils/auth.logger.utils';

dotenv.config();

const logger = createLogger('env-config');

export const env = cleanEnv(process.env, {
  // Server
  NODE_ENV: str({ choices: ['development', 'production', 'test'], default: 'development' }),
  PORT: num({ default: 3000 }),
  API_VERSION: str({ default: 'v1' }),
  SERVICE_NAME: str({ default: 'auth-service' }),
  SERVICE_VERSION: str({ default: '1.0.0' }),

   // Internal Service Security
  INTERNAL_SERVICE_SECRET: str(), // Additional layer for internal service-to-service communication

  // Database
  MONGODB_URI: str(),
  MONGODB_DB_NAME: str({ default: 'auth_service' }),
  MONGODB_POOL_SIZE: num({ default: 10 }),
  MONGODB_CONNECTION_TIMEOUT: num({ default: 30000 }),


  // Redis
  REDIS_HOST: str({ default: 'localhost' }),
  REDIS_PORT: num({ default: 6379 }),
  REDIS_PASSWORD: str({ default: '' }),
  REDIS_DB: num({ default: 0 }),
  REDIS_TTL_OTP: num({ default: 600 }), // 10m
  REDIS_TTL_SESSION: num({ default: 86400 }), // 24h
  REDIS_URL: str(),
 
  REDIS_TLS: bool({ default: false }),

  IDEMPOTENCY_KEY_TTL: num({ default: 3600 }),

  // RabbitMQ
  RABBITMQ_URL: str({ default: 'amqp://localhost:5672' }),
  RABBITMQ_EXCHANGE: str({ default: 'auth.exchange' }),
  RABBITMQ_RETRY_ATTEMPTS: num({ default: 3 }),
  RABBITMQ_RETRY_DELAY: num({ default: 5000 }),

  // JWT & Security
  JWT_ACCESS_SECRET: str(),
  JWT_REFRESH_SECRET: str(),
  JWT_ACCESS_EXPIRES_IN: num({default: 900}),
  JWT_REFRESH_EXPIRES_IN: str({ default: '7d' }),
  JWT_ISSUER: str({ default: 'auth-service' }),
  BCRYPT_ROUNDS: num({ default: 12 }),

  // CORS
  CORS_ORIGIN: str({ default: 'http://localhost:3000,http://localhost:3001' }),
  CORS_CREDENTIALS: bool({ default: true }),

  // HELMENT
  SECURITY_HSTS_MAX_AGE: num({ default: 31536000 }), // 1 year in seconds

  // Rate limiting
  RATE_LIMIT_WINDOW: num({ default: 900000 }), // 15m
  RATE_LIMIT_MAX_ATTEMPTS: num({ default: 100 }),
  OTP_RATE_LIMIT_MAX: num({ default: 5 }),

  // Email service
  EMAIL_SERVICE_URL: str({ default: 'http://localhost:4000' }),
  EMAIL_SERVICE_API_KEY: str({ default: '' }),

  // Logging.
  LOG_LEVEL: str({ choices: ['error', 'warn', 'info', 'debug'], default: 'info' }),
  LOG_FILE_PATH: str({ default: './logs/auth-service.log' }),

  // Health check
  HEALTH_CHECK_INTERVAL: num({ default: 30000 }), // 30s

  // OTP
  OTP_LENGTH: num({ default: 6 }),
  OTP_EXPIRY_MINUTES: num({ default: 10 }),
  OTP_MAX_ATTEMPTS: num({ default: 3 }),

  // Idempotency
  IDEMPOTENCY_TTL: num({ default: 3600 }),

  // Validation rules
  MIN_PASSWORD_LENGTH: num({ default: 8 }),
  MAX_PASSWORD_LENGTH: num({ default: 128 }),
  MIN_NAME_LENGTH: num({ default: 2 }),
  MAX_NAME_LENGTH: num({ default: 50 }),
});

// --- Custom Validations ---
(() => {
  // JWT secret length
  if (env.JWT_ACCESS_SECRET.length < 32 || env.JWT_REFRESH_SECRET.length < 32) {
    logger.error('❌ JWT secrets must be at least 32 characters long');
    process.exit(1);
  }

  // MongoDB URI
  if (!env.MONGODB_URI.startsWith('mongodb://') && !env.MONGODB_URI.startsWith('mongodb+srv://')) {
    logger.error('❌ MONGODB_URI must start with "mongodb://" or "mongodb+srv://"');
    process.exit(1);
  }

  // Redis host validation
  if (!env.REDIS_HOST) {
    logger.error('❌ REDIS_HOST must be defined');
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

export const mongoOptions = {
  dbName: env.MONGODB_DB_NAME,
  maxPoolSize: 10,
  serverSelectionTimeoutMS: 5000,
  socketTimeoutMS: 45000,
  family: 4,
};

export const redisOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  password: env.REDIS_PASSWORD || undefined,
  db: env.REDIS_DB,
  enableOfflineQueue: false,
  maxRetriesPerRequest: 3,
};

export const jwtOptions = {
  access: {
    secret: env.JWT_ACCESS_SECRET,
    expiresIn: env.JWT_ACCESS_EXPIRES_IN,
    issuer: env.JWT_ISSUER,
  },
  refresh: {
    secret: env.JWT_REFRESH_SECRET,
    expiresIn: env.JWT_REFRESH_EXPIRES_IN,
    issuer: env.JWT_ISSUER,
  },
};
