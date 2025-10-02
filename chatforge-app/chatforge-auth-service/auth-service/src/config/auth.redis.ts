import Redis, {RedisOptions} from 'ioredis';
import crypto from 'crypto';
import { createLogger } from '../utils/auth.logger.utils';
import { env } from './auth.env';

const logger = createLogger('redis');

// Types for stronger safety
interface SessionData {
  userId: string;
  createdAt: number;
  [key: string]: any;
}

interface IdempotencyResult {
  status: string;
  response: any;
}

class RedisManager {
  private static instance: RedisManager;
  private client: Redis;
  private isConnected = false;

  private constructor() {
    const options: RedisOptions = {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      autoResendUnfulfilledCommands: true,
      enableOfflineQueue: true,
      retryStrategy: (times) => {
        // Exponential backoff: wait longer with each retry
        return Math.min(times * 200, 2000);
      },
    };

    if (env.REDIS_TLS) options.tls = {};
    if (env.REDIS_PASSWORD) options.password = env.REDIS_PASSWORD;

    this.client = new Redis(env.REDIS_URL, options);
    this.setupEventListeners();
  }

  public static getInstance(): RedisManager {
    if (!RedisManager.instance) {
      RedisManager.instance = new RedisManager();
    }
    return RedisManager.instance;
  }

  private setupEventListeners(): void {
    this.client.on('connect', () => logger.info('🔄 Redis connecting...'));

    this.client.on('ready', () => {
      this.isConnected = true;
      logger.info('✅ Redis connected and ready');
    });

    this.client.on('error', (error) => {
      this.isConnected = false;
      logger.error(`❌ Redis error: ${error.message}`, { error });
    });

    this.client.on('close', () => {
      this.isConnected = false;
      logger.warn('⚠️ Redis connection closed');
    });

    this.client.on('reconnecting', () => logger.info('🔄 Redis reconnecting...'));
  }

  public async connect(): Promise<void> {
    if (this.isConnected) return;
    try {
      await this.client.connect();
    } catch (error: any) {
      logger.error(`❌ Failed to connect to Redis: ${error.message}`, { error });
      throw error;
    }
  }

  public async disconnect(): Promise<void> {
    if (!this.isConnected) return;
    try {
      await this.client.quit();
      this.isConnected = false;
      logger.info('✅ Redis disconnected gracefully');
    } catch (error: any) {
      logger.error(`❌ Error disconnecting from Redis: ${error.message}`, { error });
      throw error;
    }
  }

  // ---------------- OTP Handling ----------------
  private hashOTP(otp: string): string {
    return crypto.createHash('sha256').update(otp).digest('hex');
  }

  public async storeOTP(identifier: string, otp: string, expiryMinutes: number = env.OTP_EXPIRY_MINUTES): Promise<void> {
    const key = `otp:${identifier}`;
    await this.client.setex(key, expiryMinutes * 60, this.hashOTP(otp));
  }

  public async verifyOTP(identifier: string, otp: string): Promise<boolean> {
    const key = `otp:${identifier}`;
    const stored = await this.client.get(key);
    return stored === this.hashOTP(otp);
  }

  public async deleteOTP(identifier: string): Promise<void> {
    await this.client.del(`otp:${identifier}`);
  }

  // ---------------- Session Management ----------------
  public async storeSession(sessionId: string, data: SessionData, ttl: number = 3600): Promise<void> {
    await this.client.setex(`session:${sessionId}`, ttl, JSON.stringify(data));
  }

  public async getSession(sessionId: string): Promise<SessionData | null> {
    const data = await this.client.get(`session:${sessionId}`);
    return data ? JSON.parse(data) : null;
  }

  public async deleteSession(sessionId: string): Promise<void> {
    await this.client.del(`session:${sessionId}`);
  }

  // ---------------- Rate Limiting ----------------
  public async checkRateLimit(key: string, windowMs: number, maxRequests: number): Promise<{ allowed: boolean; remaining: number }> {
    const now = Date.now();
    const windowStart = now - windowMs;

    const pipeline = this.client.pipeline();
    pipeline.zremrangebyscore(key, 0, windowStart);
    pipeline.zadd(key, now, `${now}-${Math.random()}`);
    pipeline.zcard(key);
    pipeline.expire(key, Math.ceil(windowMs / 1000));

    const results = await pipeline.exec();
    if (!results || results.some(r => r[0] !== null)) {
      throw new Error('Redis pipeline execution failed');
    }

    const requestCount = results[2][1] as number;
    const remaining = Math.max(0, maxRequests - requestCount);

    return { allowed: requestCount <= maxRequests, remaining };
  }

  // ---------------- Idempotency ----------------
  public async storeIdempotencyKey(key: string, result: IdempotencyResult, ttl: number = env.IDEMPOTENCY_KEY_TTL): Promise<void> {
    await this.client.setex(`idempotency:${key}`, ttl, JSON.stringify(result));
  }

  public async getIdempotencyKey(key: string): Promise<IdempotencyResult | null> {
    const data = await this.client.get(`idempotency:${key}`);
    return data ? JSON.parse(data) : null;
  }

  // ---------------- Health Monitoring ----------------
  public async healthCheck(): Promise<{ status: string; latency?: number }> {
    if (!this.isConnected) return { status: 'disconnected' };
    try {
      const start = Date.now();
      await this.client.ping();
      const latency = Date.now() - start;
      return { status: 'healthy', latency };
    } catch (error: any) {
      logger.error(`❌ Redis health check failed: ${error.message}`, { error });
      return { status: 'unhealthy' };
    }
  }

  public isHealthy(): boolean {
    return this.isConnected && this.client.status === 'ready';
  }

  // ---------------- Utilities ----------------
  public async flushPattern(pattern: string): Promise<void> {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      if (keys.length > 0) await this.client.del(...keys);
      cursor = nextCursor;
    } while (cursor !== '0');
  }

  public getClient(): Redis {
    return this.client;
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('🔄 SIGINT: closing Redis connection...');
  await RedisManager.getInstance().disconnect();
});

process.on('SIGTERM', async () => {
  logger.info('🔄 SIGTERM: closing Redis connection...');
  await RedisManager.getInstance().disconnect();
});

export const redisManager = RedisManager.getInstance();
