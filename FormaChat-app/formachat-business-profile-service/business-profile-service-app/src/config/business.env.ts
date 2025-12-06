import dotenv from 'dotenv';
import { cleanEnv, str, num, bool, url } from 'envalid';
import { createLogger } from '../utils/business.logger.utils';

dotenv.config();

const logger = createLogger('env-config');

export const env = cleanEnv(process.env, {
  // Server
  NODE_ENV: str({ choices: ['development', 'production', 'test'], default: 'development' }),
  PORT: num({ default: 4001 }),
  API_VERSION: str({ default: 'v1' }),
  SERVICE_NAME: str({ default: 'business-profile-service' }),
  SERVICE_VERSION: str({ default: '1.0.0' }),

  // Internal Service Security
  INTERNAL_SERVICE_SECRET: str(),

  // Database
  MONGODB_URI: str(),
  MONGODB_DB_NAME: str({ default: 'business_profile_service' }),
  MONGODB_POOL_SIZE: num({ default: 10 }),
  MONGODB_CONNECTION_TIMEOUT: num({ default: 30000 }),

  // Vector DB - Pinecone
  PINECONE_API_KEY: str(),
  PINECONE_ENVIRONMENT: str({ default: 'us-east-1' }),
  PINECONE_INDEX_NAME: str({ default: 'formachat-businesses' }),

 

  // JWT
  JWT_ACCESS_SECRET: str(),
  JWT_ISSUER: str({ default: 'formachat-auth-service' }),

  
  // File Upload (for future)
  CLOUD_STORAGE_BUCKET: str({ default: '' }),
  CLOUD_STORAGE_REGION: str({ default: '' }),

  // Admin Security
  ADMIN_API_KEY: str(),
  
  // CLOUDINARY
  // API_SECRET_CLOUDINARY: str(),
  // API_KEY_CLOUDINARY: str(),
  // CLOUDINARY_URL: str(),

});

// --- Custom Validations ---
(() => {
  // MongoDB URI validation
  if (!env.MONGODB_URI.startsWith('mongodb://') && !env.MONGODB_URI.startsWith('mongodb+srv://')) {
    logger.error('❌ MONGODB_URI must start with "mongodb://" or "mongodb+srv://"');
    process.exit(1);
  }

  // Pinecone API Key validation
  if (!env.PINECONE_API_KEY) {
    logger.error('❌ PINECONE_API_KEY is required for vector database operations');
    process.exit(1);
  }

  
  // Internal service secret validation
  if (!env.INTERNAL_SERVICE_SECRET || env.INTERNAL_SERVICE_SECRET.length < 32) {
    logger.error('❌ INTERNAL_SERVICE_SECRET must be at least 32 characters long');
    process.exit(1);
  }

  // Admin API key validation
  if (!env.ADMIN_API_KEY || env.ADMIN_API_KEY.length < 16) {
    logger.error('❌ ADMIN_API_KEY must be at least 16 characters long');
    process.exit(1);
  }

  logger.info('✅ Business service environment configuration validated successfully');
})();

// --- Derived Configurations ---
export const isDevelopment = env.NODE_ENV === 'development';
export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';



export const mongoOptions = {
  dbName: env.MONGODB_DB_NAME,
  maxPoolSize: env.MONGODB_POOL_SIZE,
  serverSelectionTimeoutMS: env.MONGODB_CONNECTION_TIMEOUT,
  socketTimeoutMS: 45000,
  family: 4,
};

export const pineconeOptions = {
  apiKey: env.PINECONE_API_KEY,
  environment: env.PINECONE_ENVIRONMENT,
  index: env.PINECONE_INDEX_NAME,
};




export const securityConfig = {
  internalServiceSecret: env.INTERNAL_SERVICE_SECRET,
  adminApiKey: env.ADMIN_API_KEY,
};



export const jwtConfig = {
  issuer: env.SERVICE_NAME,
  audience: 'formachat-platform',
};

// --- Rate Limiting (for future) ---
export const rateLimitConfig = {
  businessCreation: {
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 10, // Max 10 businesses per day per user (tier limits enforced separately)
  },
  vectorUpdates: {
    windowMs: 60 * 1000, // 1 minute
    max: 10, // Max 10 vector updates per minute per business
  },
};

// --- Feature Flags ---
export const featureFlags = {
  enableFileUploads: Boolean(env.CLOUD_STORAGE_BUCKET),
  enableVectorAutoUpdate: true,
  enableAdminDashboard: true,
};

logger.info(`${env.SERVICE_NAME} v${env.SERVICE_VERSION} environment loaded`);
logger.info(`NODE_ENV: ${env.NODE_ENV}`);
logger.info(`MongoDB: ${env.MONGODB_DB_NAME}`);
logger.info(`Pinecone: ${env.PINECONE_INDEX_NAME}`);