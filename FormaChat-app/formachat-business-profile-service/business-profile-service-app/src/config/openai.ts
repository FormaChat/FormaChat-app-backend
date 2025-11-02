import OpenAI from 'openai';
import { env } from './business.env';
import { createLogger } from '../utils/business.logger.utils';




const logger = createLogger('openai-config');

/**
 * ========================================
 * OPENAI CONFIGURATION (Embeddings Only)
 * ========================================
 * 
 * This file sets up OpenAI for creating embeddings.
 * Embeddings = Converting text into vectors (arrays of numbers)
 * 
 * Purpose: Convert business data from MongoDB into vectors for Pinecone
*/

class OpenAIConfig {
  private static instance: OpenAI | null = null;

  private static readonly config = {
    apiKey: env.OPENAI_API_KEY,
    embeddingModel: env.OPENAI_EMBEDDING_MODEL,
    maxRetries: parseInt(env.OPENAI_MAX_RETRIES),
    timeout: parseInt(env.OPENAI_TIMEOUT),
  };

  /**
   * Get OpenAI client (Singleton)
  */

  public static getClient(): OpenAI {
    if (!OpenAIConfig.instance) {
      if (!OpenAIConfig.config.apiKey) {
        throw new Error('OPENAI_API_KEY not set in environment variables');
      }

      OpenAIConfig.instance = new OpenAI({
        apiKey: OpenAIConfig.config.apiKey,
        maxRetries: OpenAIConfig.config.maxRetries,
        timeout: OpenAIConfig.config.timeout,
      });

      logger.info('[OpenAI] Client initialized');
    }

    return OpenAIConfig.instance;
  }

  /**
   * Get embedding model name
  */

  public static getEmbeddingModel(): string {
    return OpenAIConfig.config.embeddingModel;
  }

  /**
   * Get embedding dimensions (must match Pinecone index)
  */

  public static getEmbeddingDimensions(): number {
    const model = OpenAIConfig.config.embeddingModel;
    
    switch (model) {
      case 'text-embedding-3-small':
      case 'text-embedding-ada-002':
        return 1536;
      case 'text-embedding-3-large':
        return 3072;
      default:
        return 1536;
    }
  }

  /**
   * Create embeddings from text chunks
   * 
   * @param texts - Array of text strings to convert to vectors
   * @returns Array of embedding vectors
  */
 
  public static async createEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const client = OpenAIConfig.getClient();
      
      const response = await client.embeddings.create({
        model: OpenAIConfig.getEmbeddingModel(),
        input: texts,
      });

      const embeddings = response.data.map(item => item.embedding);

      logger.info(`[OpenAI] Created ${embeddings.length} embeddings`);

      return embeddings;

    } catch (error: any) {
      logger.error('[OpenAI] Embedding failed:', error.message);
      
      if (error.status === 401) {
        throw new Error('Invalid OpenAI API key');
      }
      if (error.status === 429) {
        throw new Error('OpenAI rate limit exceeded');
      }
      
      throw error;
    }
  }
}

// Exports
export const getOpenAIClient = OpenAIConfig.getClient.bind(OpenAIConfig);
export const createEmbeddings = OpenAIConfig.createEmbeddings.bind(OpenAIConfig);
export const getEmbeddingModel = OpenAIConfig.getEmbeddingModel.bind(OpenAIConfig);
export const getEmbeddingDimensions = OpenAIConfig.getEmbeddingDimensions.bind(OpenAIConfig);

export default OpenAIConfig;