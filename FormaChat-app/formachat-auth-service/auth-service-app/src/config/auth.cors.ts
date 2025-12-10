import { createLogger } from '../utils/auth.logger.utils';

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

  private allowedOrigins: string[] = [
    'http://localhost:5173',   // dev frontend
    'https://www.formachat.com', // prod frontend
    'https://frontend-mockup-phi.vercel.app/' // vercel

  ];

  private constructor() {}

  public static getInstance(): CORSManager {
    if (!CORSManager.instance) {
      CORSManager.instance = new CORSManager();
    }
    return CORSManager.instance;
  }

  private originValidator(
    origin: string | undefined,
    callback: (error: Error | null, allow?: boolean) => void
  ): void {
    // Allow requests with no origin (curl, mobile apps)
    if (!origin) {
      callback(null, true);
      return;
    }

    if (this.allowedOrigins.includes(origin)) {
      logger.debug(`🌐 CORS allowed for origin: ${origin}`);
      callback(null, true);
      return;
    }

    logger.warn(`🚫 CORS blocked origin: ${origin}`, { allowedOrigins: this.allowedOrigins });
    callback(new Error(`Origin ${origin} not allowed by CORS policy`));
  }

  public getCorsConfig(): CorsConfig {
    return {
      origin: this.originValidator.bind(this),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-Idempotency-Key',
        'X-Correlation-Id',
        'Idempotency-Key',        // Mixed case version
        'idempotency-key',        //  // Lowercase version (what browsers send)
        'Accept',
        'Origin',
      ],
      preflightContinue: false,
      optionsSuccessStatus: 204,
    };
  }

  /**
   * Convenience for public endpoints (health checks, public info)
   */
  public getPublicCorsConfig(): CorsConfig {
    return {
      origin: (_origin, callback) => callback(null, true), // Allow all origins
      credentials: false,
      methods: ['GET', 'HEAD', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
      preflightContinue: false,
      optionsSuccessStatus: 204,
    };
  }

  /**
   * Convenience for strict endpoints (sensitive APIs)
   */
  public getStrictCorsConfig(): CorsConfig {
     return {
      origin: this.originValidator.bind(this),
      credentials: true,
      methods: ['POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Idempotency-Key',
        'Idempotency-Key',
        'idempotency-key',
        'X-Correlation-Id'
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
    });
  }
}

// Singleton instance
export const corsManager = CORSManager.getInstance();
export type { CorsConfig };
