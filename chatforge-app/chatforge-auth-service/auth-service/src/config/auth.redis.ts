import Redis, { RedisOptions } from 'ioredis';
import { createLogger } from '../utils/auth.logger.utils';
import { env } from './auth.env';

const logger = createLogger('redis');

// Types for Redis data structures
interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

interface IdempotencyData {
  status: string;
  response: any;
  timestamp: number;
}

class RedisManager {
  private static instance: RedisManager;
  private client: Redis;
  private isConnected = false;

  // Key prefixes for organization
  private readonly KEY_PREFIXES = {
    OTP_PLAIN: 'otp:plain:',      // For email service (plaintext)
    OTP_HASHED: 'otp:hashed:',    // For verification (hashed)
    SESSION: 'session:',
    IDEMPOTENCY: 'idempotency:',
    RATE_LIMIT: 'rate:',
    LOCK: 'lock:'
  };

  private constructor() {
    const options: RedisOptions = {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      autoResendUnfulfilledCommands: true,
      enableOfflineQueue: true,
      retryStrategy: (times) => Math.min(times * 200, 2000),
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
      logger.error('❌ Redis error:', error);
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
      logger.error('❌ Failed to connect to Redis:', error);
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
      logger.error('❌ Error disconnecting from Redis:', error);
      throw error;
    }
  }

  // ==================== OTP MANAGEMENT ====================

  /**
   * Store plain OTP for email service (short-lived)
   */
  async storePlainOTP(otpId: string, otp: string, expirySeconds: number = env.REDIS_TTL_OTP): Promise<void> {
    const key = `${this.KEY_PREFIXES.OTP_PLAIN}${otpId}`;
    await this.client.setex(key, expirySeconds, otp);
    logger.debug('Plain OTP stored in Redis', { otpId, expirySeconds });
  }

  /**
   * Get plain OTP for email service (one-time retrieval)
   */
  async getPlainOTP(otpId: string): Promise<string | null> {
    const key = `${this.KEY_PREFIXES.OTP_PLAIN}${otpId}`;
    const otp = await this.client.get(key);
    
    if (otp) {
      logger.debug('Plain OTP retrieved and deleted', { otpId });
    }
    
    return otp;
  }

  

  /**
   * Store hashed OTP for verification purposes
   */
  async storeHashedOTP(identifier: string, hashedOTP: string, expiryMinutes: number = env.OTP_EXPIRY_MINUTES): Promise<void> {
    const key = `${this.KEY_PREFIXES.OTP_HASHED}${identifier}`;
    await this.client.setex(key, expiryMinutes * 60, hashedOTP);
    logger.debug('Hashed OTP stored in Redis', { identifier, expiryMinutes });
  }

  /**
   * Verify OTP against stored hash
   */
  async verifyHashedOTP(identifier: string, otpToVerify: string, hashFunction: (otp: string) => Promise<string>): Promise<boolean> {
    const key = `${this.KEY_PREFIXES.OTP_HASHED}${identifier}`;
    const storedHash = await this.client.get(key);
    
    if (!storedHash) return false;
    
    const verifyHash = await hashFunction(otpToVerify);
    return storedHash === verifyHash;
  }

  /**
   * Delete OTP from Redis (both plain and hashed if needed)
   */
  async deleteOTP(identifier: string, otpId?: string): Promise<void> {
    const promises = [];
    
    if (otpId) {
      promises.push(this.client.del(`${this.KEY_PREFIXES.OTP_PLAIN}${otpId}`));
    }
    
    promises.push(this.client.del(`${this.KEY_PREFIXES.OTP_HASHED}${identifier}`));
    
    await Promise.all(promises);
    logger.debug('OTP data deleted from Redis', { identifier, otpId });
  }

  // ==================== RATE LIMITING ====================

  async checkRateLimit(key: string, windowMs: number, maxRequests: number): Promise<RateLimitResult> {
    const redisKey = `${this.KEY_PREFIXES.RATE_LIMIT}${key}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    const pipeline = this.client.pipeline();
    pipeline.zremrangebyscore(redisKey, 0, windowStart);
    pipeline.zadd(redisKey, now, `${now}-${Math.random()}`);
    pipeline.zcard(redisKey);
    pipeline.expire(redisKey, Math.ceil(windowMs / 1000));

    const results = await pipeline.exec();
    
    if (!results) {
      throw new Error('Redis pipeline execution failed');
    }

    const requestCount = results[2][1] as number;
    const remaining = Math.max(0, maxRequests - requestCount);
    const resetTime = now + windowMs;

    return {
      allowed: requestCount <= maxRequests,
      remaining,
      resetTime
    };
  }

  // ==================== IDEMPOTENCY ====================

  async storeIdempotencyKey(key: string, data: IdempotencyData, ttl: number = env.IDEMPOTENCY_TTL): Promise<void> {
    const redisKey = `${this.KEY_PREFIXES.IDEMPOTENCY}${key}`;
    await this.client.setex(redisKey, ttl, JSON.stringify(data));
  }

  async getIdempotencyKey(key: string): Promise<IdempotencyData | null> {
    const redisKey = `${this.KEY_PREFIXES.IDEMPOTENCY}${key}`;
    const data = await this.client.get(redisKey);
    return data ? JSON.parse(data) : null;
  }

  // ==================== DISTRIBUTED LOCKS ====================

  async acquireLock(lockKey: string, ttl: number = 10): Promise<boolean> {
    const key = `${this.KEY_PREFIXES.LOCK}${lockKey}`;
    const result = await this.client.set(key, '1', 'PX', ttl * 1000, 'NX');
    return result === 'OK';
  }

  async releaseLock(lockKey: string): Promise<void> {
    const key = `${this.KEY_PREFIXES.LOCK}${lockKey}`;
    await this.client.del(key);
  }

  // ==================== SESSION MANAGEMENT ====================

  async storeSession(sessionId: string, data: any, ttl: number = env.REDIS_TTL_SESSION): Promise<void> {
    const key = `${this.KEY_PREFIXES.SESSION}${sessionId}`;
    await this.client.setex(key, ttl, JSON.stringify(data));
  }

  async getSession(sessionId: string): Promise<any> {
    const key = `${this.KEY_PREFIXES.SESSION}${sessionId}`;
    const data = await this.client.get(key);
    return data ? JSON.parse(data) : null;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.client.del(`${this.KEY_PREFIXES.SESSION}${sessionId}`);
  }

  // ==================== HEALTH & UTILITIES ====================

  async healthCheck(): Promise<{ status: string; latency?: number }> {
    if (!this.isConnected) {
      return { status: 'disconnected' };
    }

    try {
      const start = Date.now();
      await this.client.ping();
      const latency = Date.now() - start;
      
      return {
        status: 'healthy',
        latency
      };
    } catch (error: any) {
      logger.error('❌ Redis health check failed:', error);
      return { status: 'unhealthy' };
    }
  }

  isHealthy(): boolean {
    return this.isConnected && this.client.status === 'ready';
  }

  async flushPattern(pattern: string): Promise<void> {
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 100);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
      cursor = nextCursor;
    } while (cursor !== '0');
  }

  getClient(): Redis {
    return this.client;
  }
}

// Graceful shutdown handlers
process.on('SIGINT', async () => {
  logger.info('🔄 Received SIGINT, closing Redis connection...');
  await RedisManager.getInstance().disconnect();
});

process.on('SIGTERM', async () => {
  logger.info('🔄 Received SIGTERM, closing Redis connection...');
  await RedisManager.getInstance().disconnect();
});

export const redisManager = RedisManager.getInstance();