import { createClient, RedisClientType } from 'redis';
import { env } from './chat.env.config';
import { createLogger } from '../util/chat.logger.utils';

const logger = createLogger("redis-cache-service");

/**
 * ========================================
 * REDIS CONFIGURATION (Chat Service)
 * ========================================
 * 
 * Purpose: Session limit tracking
 * - Track daily session count per business
 * - Auto-expire at end of day
 * - Prevent abuse (5-8 sessions/day FREE tier)
 * 
 * Key Pattern: `session_limit:{businessId}:{YYYY-MM-DD}`
 * Example: `session_limit:business_123:2025-01-15`
*/

class RedisConfig {
  private static instance: RedisClientType | null = null;
  private static isConnecting: boolean = false;
  private static connectionPromise: Promise<RedisClientType> | null = null;

  /**
   * Get Redis client (Singleton with connection pooling)
   */
  public static async getClient(): Promise<RedisClientType> {
    // Return existing connection
    if (RedisConfig.instance?.isOpen) {
      return RedisConfig.instance;
    }

    // Wait for in-progress connection
    if (RedisConfig.isConnecting && RedisConfig.connectionPromise) {
      return RedisConfig.connectionPromise;
    }

    // Create new connection
    RedisConfig.isConnecting = true;
    RedisConfig.connectionPromise = RedisConfig.connect();

    try {
      RedisConfig.instance = await RedisConfig.connectionPromise;
      return RedisConfig.instance;
    } finally {
      RedisConfig.isConnecting = false;
      RedisConfig.connectionPromise = null;
    }
  }

  /**
   * Connect to Redis
   */
  private static async connect(): Promise<RedisClientType> {
    const client = createClient({
      url: env.REDIS_URL,
      password: env.REDIS_PASSWORD || undefined,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 10) {
            logger.error('[Redis] Max reconnection attempts reached');
            return new Error('Max reconnection attempts reached');
          }
          // Exponential backoff: 100ms, 200ms, 400ms, ...
          return Math.min(retries * 100, 3000);
        },
      },
    });

    // Error handlers
    client.on('error', (err) => {
      logger.error('[Redis] Client error:', err);
    });

    client.on('connect', () => {
      logger.info('[Redis] Connecting...');
    });

    client.on('ready', () => {
      logger.info('[Redis] ✓ Connected and ready');
    });

    client.on('reconnecting', () => {
      logger.info('[Redis] Reconnecting...');
    });

    client.on('end', () => {
      logger.info('[Redis] Connection closed');
    });

    // Connect
    await client.connect();

    return client as RedisClientType;
  }

  /**
   * Disconnect Redis
   */
  public static async disconnect(): Promise<void> {
    if (RedisConfig.instance?.isOpen) {
      await RedisConfig.instance.quit();
      RedisConfig.instance = null;
      logger.info('[Redis] Disconnected');
    }
  }

  /**
   * ========================================
   * SESSION LIMIT METHODS
   * ========================================
   */

  /**
   * Get today's date in YYYY-MM-DD format
   */
  private static getTodayKey(): string {
    const now = new Date();
    return now.toISOString().split('T')[0]; // "2025-01-15"
  }

  /**
   * Get session limit key for a business
   */
  private static getSessionKey(businessId: string, date?: string): string {
    const dateKey = date || RedisConfig.getTodayKey();
    return `session_limit:${businessId}:${dateKey}`;
  }

  /**
   * Get seconds until end of day (for expiry)
   */
  private static getSecondsUntilEndOfDay(): number {
    const now = new Date();
    const endOfDay = new Date(now);
    endOfDay.setHours(23, 59, 59, 999);
    
    return Math.floor((endOfDay.getTime() - now.getTime()) / 1000);
  }

  /**
   * Check if business has exceeded daily session limit
   */
  public static async checkDailyLimit(businessId: string): Promise<{
    limitExceeded: boolean;
    currentCount: number;
    maxLimit: number;
    resetsAt: string;
  }> {
    try {
      const client = await RedisConfig.getClient();
      const key = RedisConfig.getSessionKey(businessId);
      
      const currentCount = parseInt(await client.get(key) || '0', 10);
      const maxLimit = env.DAILY_SESSION_LIMIT;
      
      // Calculate reset time
      const now = new Date();
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      
      return {
        limitExceeded: currentCount >= maxLimit,
        currentCount,
        maxLimit,
        resetsAt: endOfDay.toISOString(),
      };
    } catch (error: any) {
      logger.error('[Redis] Check limit failed:', error.message);
      // Fail open - allow session if Redis is down
      return {
        limitExceeded: false,
        currentCount: 0,
        maxLimit: env.DAILY_SESSION_LIMIT,
        resetsAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Increment session count for business
   */
  public static async incrementSessionCount(businessId: string): Promise<number> {
    try {
      const client = await RedisConfig.getClient();
      const key = RedisConfig.getSessionKey(businessId);
      
      // Increment counter
      const newCount = await client.incr(key);
      
      // Set expiry if this is the first session today
      if (newCount === 1) {
        const ttl = RedisConfig.getSecondsUntilEndOfDay();
        await client.expire(key, ttl);
        logger.info(`[Redis] Session counter created for ${businessId}, expires in ${ttl}s`);
      }
      
      logger.info(`[Redis] Session count for ${businessId}: ${newCount}/${env.DAILY_SESSION_LIMIT}`);
      
      return newCount;
    } catch (error: any) {
      logger.error('[Redis] Increment failed:', error.message);
      return 0; // Fail silently
    }
  }

  /**
   * Get session count for specific date
   */
  public static async getSessionCount(businessId: string, date?: string): Promise<number> {
    try {
      const client = await RedisConfig.getClient();
      const key = RedisConfig.getSessionKey(businessId, date);
      
      const count = await client.get(key);
      return parseInt(count || '0', 10);
    } catch (error: any) {
      logger.error('[Redis] Get count failed:', error.message);
      return 0;
    }
  }

  /**
   * Reset session count for business (admin only)
   */
  public static async resetSessionCount(businessId: string): Promise<void> {
    try {
      const client = await RedisConfig.getClient();
      const key = RedisConfig.getSessionKey(businessId);
      
      await client.del(key);
      logger.info(`[Redis] Session count reset for ${businessId}`);
    } catch (error: any) {
      logger.error('[Redis] Reset failed:', error.message);
    }
  }

  /**
   * ========================================
   * CONVERSATION HISTORY CACHE (Optional)
   * ========================================
   * 
   * Store last 10 messages per session for faster retrieval
   * Key Pattern: `session_messages:{sessionId}`
   */

  /**
   * Cache recent messages for a session
   */
  public static async cacheSessionMessages(
    sessionId: string,
    messages: Array<{ role: string; content: string; timestamp: Date }>
  ): Promise<void> {
    try {
      const client = await RedisConfig.getClient();
      const key = `session_messages:${sessionId}`;
      
      // Store as JSON, keep only last 10
      const messagesToStore = messages.slice(-10);
      await client.setEx(
        key,
        3600, // 1 hour TTL
        JSON.stringify(messagesToStore)
      );
    } catch (error: any) {
      logger.error('[Redis] Cache messages failed:', error.message);
    }
  }

  /**
   * Get cached session messages
   */
  public static async getCachedMessages(sessionId: string): Promise<Array<{
    role: string;
    content: string;
    timestamp: Date;
  }> | null> {
    try {
      const client = await RedisConfig.getClient();
      const key = `session_messages:${sessionId}`;
      
      const cached = await client.get(key);
      if (!cached) return null;
      
      return JSON.parse(cached);
    } catch (error: any) {
      logger.error('[Redis] Get cached messages failed:', error.message);
      return null;
    }
  }

  /**
   * Clear cached messages for session
   */
  public static async clearCachedMessages(sessionId: string): Promise<void> {
    try {
      const client = await RedisConfig.getClient();
      const key = `session_messages:${sessionId}`;
      
      await client.del(key);
    } catch (error: any) {
      logger.error('[Redis] Clear cache failed:', error.message);
    }
  }

  /**
   * ========================================
   * HEALTH CHECK
   * ========================================
   */

  public static async healthCheck(): Promise<boolean> {
    try {
      const client = await RedisConfig.getClient();
      const result = await client.ping();
      return result === 'PONG';
    } catch (error) {
      return false;
    }
  }
}

// Graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('[Redis] SIGTERM received, closing connection...');
  await RedisConfig.disconnect();
});

process.on('SIGINT', async () => {
  logger.info('[Redis] SIGINT received, closing connection...');
  await RedisConfig.disconnect();
});

// Exports
export const getRedisClient = RedisConfig.getClient.bind(RedisConfig);
export const disconnectRedis = RedisConfig.disconnect.bind(RedisConfig);

// Session limit methods
export const checkDailyLimit = RedisConfig.checkDailyLimit.bind(RedisConfig);
export const incrementSessionCount = RedisConfig.incrementSessionCount.bind(RedisConfig);
export const getSessionCount = RedisConfig.getSessionCount.bind(RedisConfig);
export const resetSessionCount = RedisConfig.resetSessionCount.bind(RedisConfig);

// Message caching (optional)
export const cacheSessionMessages = RedisConfig.cacheSessionMessages.bind(RedisConfig);
export const getCachedMessages = RedisConfig.getCachedMessages.bind(RedisConfig);
export const clearCachedMessages = RedisConfig.clearCachedMessages.bind(RedisConfig);

// Health check
export const redisHealthCheck = RedisConfig.healthCheck.bind(RedisConfig);

export default RedisConfig;