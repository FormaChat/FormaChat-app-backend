import { createLogger } from '../utils/auth.logger.utils';
import { env } from './auth.env';

const logger = createLogger('cors');

interface CorsConfig {
  origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => void;
  credentials: boolean;
  methods: string[];
  allowedHeaders: string[];
  preflightContinue: boolean;
  optionsSuccessStatus: number;
}

class CORSManager {
  private static instance: CORSManager;

  private constructor() {}

  public static getInstance(): CORSManager {
    if (!CORSManager.instance) {
      CORSManager.instance = new CORSManager();
    }
    return CORSManager.instance;
  }

  public getCorsConfig(): CorsConfig {
    return {
      origin: this.originValidator.bind(this),
      credentials: env.CORS_CREDENTIALS,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-Idempotency-Key',
        'X-Correlation-Id',
        'Accept',
        'Origin',
      ],
      preflightContinue: false,
      optionsSuccessStatus: 204,
    };
  }

  private originValidator(origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void): void {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      callback(null, true);
      return;
    }

    // Development: Allow all origins in development
    if (env.isDevelopment) {
      logger.debug(`🌐 Development CORS allowed for origin: ${origin}`);
      callback(null, true);
      return;
    }

    // Production: Strict origin validation
    const allowedOrigins = env.CORS_ORIGIN;
    
    if (allowedOrigins.includes('*')) {
      logger.warn('⚠️  Using wildcard CORS in production - not recommended for sensitive endpoints');
      callback(null, true);
      return;
    }

    if (allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    // Log blocked origins for security monitoring
    logger.warn(`🚫 CORS blocked origin: ${origin}`, {
      allowedOrigins,
      timestamp: new Date().toISOString(),
    });

    callback(new Error(`Origin ${origin} not allowed by CORS policy`));
  }

  public getPublicCorsConfig(): CorsConfig {
    // Less restrictive CORS for public endpoints like health checks
    return {
      origin: (origin, callback) => callback(null, true), // Allow all origins
      credentials: false,
      methods: ['GET', 'HEAD'],
      allowedHeaders: ['Content-Type'],
      preflightContinue: false,
      optionsSuccessStatus: 204,
    };
  }

  public getStrictCorsConfig(): CorsConfig {
    // More restrictive CORS for sensitive endpoints
    return {
      origin: this.originValidator.bind(this),
      credentials: true,
      methods: ['POST', 'PUT', 'DELETE'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Idempotency-Key',
        'X-Correlation-Id',
      ],
      preflightContinue: false,
      optionsSuccessStatus: 204,
    };
  }

  public logCorsViolation(origin: string, path: string): void {
    logger.warn('🚫 CORS policy violation attempt', {
      origin,
      path,
      timestamp: new Date().toISOString(),
      userAgent: 'unknown', // You can get this from the request if available
    });
  }
}

export const corsManager = CORSManager.getInstance();
export type { CorsConfig };