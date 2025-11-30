import dotenv from 'dotenv';
import path from 'path';

// Load .env file
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * ========================================
 * CHAT SERVICE ENVIRONMENT CONFIGURATION.
 * ========================================
 * 
 * Validates and exports all required environment variables
 * Fails fast if critical variables are missing
*/

interface EnvConfig {
  // Service
  NODE_ENV: string;
  PORT: number;
  SERVICE_NAME: string;
  
  // MongoDB
  MONGODB_URI: string;

  JWT_ACCESS_SECRET: string;
  
  // Pinecone (Query only - no upsert in chat service)
  PINECONE_API_KEY: string;
  PINECONE_ENVIRONMENT: string;
  PINECONE_INDEX_NAME: string;
  
  // Groq LLM
  GROQ_API_KEY: string;
  GROQ_MODEL: string;
  GROQ_TEMPERATURE: string;
  GROQ_MAX_TOKENS: string;
  
  // Redis (Session limits)
  REDIS_URL: string;
  REDIS_PASSWORD?: string;
  
  // Session Configuration
  DAILY_SESSION_LIMIT: number;
  SESSION_LIMIT_WINDOW: number; // seconds
  
  // Message Retention
  MESSAGE_RETENTION_DAYS: number;
  
  // Logging
  LOG_LEVEL: string;
  LOG_FILE_PATH: string;
  ENABLE_FILE_LOGGING: string;
  
  // Business Service URL (for checking business access)
  BUSINESS_SERVICE_URL: string;

  // LLM Config
  LLM_PROVIDER: string;

  INTERNAL_SERVICE_SECRET: string;
}

class EnvironmentValidator {
  private static getEnv(key: string, required: boolean = true): string {
    const value = process.env[key];
    
    if (!value && required) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    
    return value || '';
  }

  private static getEnvAsNumber(
    key: string, 
    defaultValue: number, 
    required: boolean = false
  ): number {
    const value = process.env[key];
    
    if (!value) {
      if (required) {
        throw new Error(`Missing required environment variable: ${key}`);
      }
      return defaultValue;
    }
    
    const parsed = parseInt(value, 10);
    
    if (isNaN(parsed)) {
      throw new Error(`Invalid number for environment variable ${key}: ${value}`);
    }
    
    return parsed;
  }

  public static validate(): EnvConfig {
    const nodeEnv = this.getEnv('NODE_ENV', false) || 'development';
    const isDevelopment = nodeEnv === 'development';
    
    // Service Configuration
    const port = this.getEnvAsNumber('PORT', 4002);
    const serviceName = this.getEnv('SERVICE_NAME', false) || 'chat-service';
    
    // MongoDB
    const mongoUri = this.getEnv(
      'MONGODB_URI',
      true
    );

    const jsonwebtoken = this.getEnv('JWT_ACCESS_SECRET', true);
    // Pinecone
    const pineconeApiKey = this.getEnv('PINECONE_API_KEY', true);
    const pineconeEnvironment = this.getEnv('PINECONE_ENVIRONMENT', false) || 'us-east-1-aws';
    const pineconeIndexName = this.getEnv('PINECONE_INDEX_NAME', false) || 'formachat-businesses';
    
    // Groq LLM
    const groqApiKey = this.getEnv('GROQ_API_KEY', true);
    const groqModel = this.getEnv('GROQ_MODEL', false) || 'llama-3.3-70b-versatile';
    const groqTemperature = this.getEnv('GROQ_TEMPERATURE', false) || '0.7';
    const groqMaxTokens = this.getEnv('GROQ_MAX_TOKENS', false) || '500';
    
    // Redis
    const redisUrl = this.getEnv(
      'REDIS_URL',
      false
    ) || 'redis://localhost:6379';
    const redisPassword = this.getEnv('REDIS_PASSWORD', false);
    
    // Session Configuration
    const dailySessionLimit = this.getEnvAsNumber('DAILY_SESSION_LIMIT', 5);
    const sessionLimitWindow = this.getEnvAsNumber('SESSION_LIMIT_WINDOW', 86400); // 24 hours
    
    // Message Retention
    const messageRetentionDays = this.getEnvAsNumber('MESSAGE_RETENTION_DAYS', 7);
    
    // Logging
    const logLevel = this.getEnv('LOG_LEVEL', false) || (isDevelopment ? 'debug' : 'info');
    const logFilePath = this.getEnv('LOG_FILE_PATH', false) || './logs/chat-service.log';
    const enableFileLogging = this.getEnv('ENABLE_FILE_LOGGING', false) || 'false';
    
    // Business Service URL
    const businessServiceUrl = this.getEnv(
      'BUSINESS_SERVICE_URL',
      false
    ) || 'http://localhost:4001';

    //LLM
    const llmProvider = this.getEnv(
      'LLM_PROVIDER',
      false
    ) || 'groq'
    
    const internalServiceSecret = this.getEnv('INTERNAL_SERVICE_SECRET', true);
    
    // Validate values
    if (dailySessionLimit < 1) {
      throw new Error('DAILY_SESSION_LIMIT must be at least 1');
    }
    
    if (messageRetentionDays < 1) {
      throw new Error('MESSAGE_RETENTION_DAYS must be at least 1');
    }
    
    if (sessionLimitWindow < 60) {
      throw new Error('SESSION_LIMIT_WINDOW must be at least 60 seconds');
    }
    
    // Validate Groq temperature (0-2)
    const tempValue = parseFloat(groqTemperature);
    if (isNaN(tempValue) || tempValue < 0 || tempValue > 2) {
      throw new Error('GROQ_TEMPERATURE must be a number between 0 and 2');
    }
    
    // Validate Groq max tokens
    const maxTokensValue = parseInt(groqMaxTokens, 10);
    if (isNaN(maxTokensValue) || maxTokensValue < 1) {
      throw new Error('GROQ_MAX_TOKENS must be a positive number');
    }
    
    return {
      NODE_ENV: nodeEnv,
      PORT: port,
      SERVICE_NAME: serviceName,
      MONGODB_URI: mongoUri,
      JWT_ACCESS_SECRET: jsonwebtoken,
      PINECONE_API_KEY: pineconeApiKey,
      PINECONE_ENVIRONMENT: pineconeEnvironment,
      PINECONE_INDEX_NAME: pineconeIndexName,
      GROQ_API_KEY: groqApiKey,
      GROQ_MODEL: groqModel,
      GROQ_TEMPERATURE: groqTemperature,
      GROQ_MAX_TOKENS: groqMaxTokens,
      REDIS_URL: redisUrl,
      REDIS_PASSWORD: redisPassword,
      DAILY_SESSION_LIMIT: dailySessionLimit,
      SESSION_LIMIT_WINDOW: sessionLimitWindow,
      MESSAGE_RETENTION_DAYS: messageRetentionDays,
      LOG_LEVEL: logLevel,
      LOG_FILE_PATH: logFilePath,
      ENABLE_FILE_LOGGING: enableFileLogging,
      BUSINESS_SERVICE_URL: businessServiceUrl,
      LLM_PROVIDER: llmProvider,
      INTERNAL_SERVICE_SECRET: internalServiceSecret,
    };
  }
}

// Validate and export
export const env = EnvironmentValidator.validate();

// Log configuration summary (safe - no secrets)
if (env.NODE_ENV === 'development') {
  console.log('\n🔧 Chat Service Configuration:');
  console.log(`   Environment: ${env.NODE_ENV}`);
  console.log(`   Port: ${env.PORT}`);
  console.log(`   Groq Model: ${env.GROQ_MODEL}`);
  console.log(`   Daily Session Limit: ${env.DAILY_SESSION_LIMIT}`);
  console.log(`   Message Retention: ${env.MESSAGE_RETENTION_DAYS} days`);
  console.log(`   Pinecone Index: ${env.PINECONE_INDEX_NAME}`);
  console.log(`   Redis: ${env.REDIS_URL.replace(/:[^:]*@/, ':***@')}`); // Hide password
  console.log(`   Business Service: ${env.BUSINESS_SERVICE_URL}\n`);
}

export default env;