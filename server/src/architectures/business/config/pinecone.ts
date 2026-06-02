import { Pinecone } from '@pinecone-database/pinecone';
import { createLogger } from '../utils/business.logger.utils';
import { env } from './business.env';

const logger = createLogger('pinecone-config');

/**
 * ========================================
 * PINECONE CONFIGURATION (Storage + Inference)
 * ========================================
 * 
 * Now handles BOTH:
 * 1. Creating embeddings (via Pinecone Inference - FREE!)
 * 2. Storing vectors
 * 
 * Benefits:
 * - No OpenAI dependency
 * - Free embeddings
 * - One less API to manage
 * - Faster (no extra network hop)
 */

class PineconeConfig {
  private static instance: Pinecone | null = null;

  private static readonly config = {
    apiKey: env.PINECONE_API_KEY,
    environment: env.PINECONE_ENVIRONMENT,
    indexName: env.PINECONE_INDEX_NAME,
    // Pinecone's free embedding model
    embeddingModel: 'multilingual-e5-large', // 1024 dimensions, FREE!
  };

  /**
   * Get Pinecone client (Singleton)
   */
  public static getClient(): Pinecone {
    if (!PineconeConfig.instance) {
      if (!PineconeConfig.config.apiKey) {
        throw new Error('PINECONE_API_KEY not set in environment variables');
      }

      PineconeConfig.instance = new Pinecone({
        apiKey: PineconeConfig.config.apiKey,
      });

      logger.info('[Pinecone] Client initialized', {
        indexName: PineconeConfig.config.indexName,
        embeddingModel: PineconeConfig.config.embeddingModel
      });
    }

    return PineconeConfig.instance;
  }

  /**
   * Get the Pinecone index (where vectors are stored)
   */
  public static getIndex() {
    const client = PineconeConfig.getClient();
    return client.index(PineconeConfig.config.indexName);
  }

  /**
   * Get index name
   */
  public static getIndexName(): string {
    return PineconeConfig.config.indexName;
  }

  /**
   * Get embedding model name
   */
  public static getEmbeddingModel(): string {
    return PineconeConfig.config.embeddingModel;
  }

  /**
   * Get embedding dimensions
   * IMPORTANT: Your Pinecone index must be created with dimension: 1024
   */
  public static getEmbeddingDimensions(): number {
    // multilingual-e5-large uses 1024 dimensions
    return 1024;
  }

  /**
   * ========================================
   * CREATE EMBEDDINGS (via Pinecone Inference)
   * ========================================
   * 
   * This replaces OpenAI's embedding API.
   * Uses Pinecone's built-in inference - completely FREE!
   * 
   * @param texts - Array of text strings to embed
   * @returns Array of embedding vectors
   */
  public static async createEmbeddings(texts: string[]): Promise<number[][]> {
    const startTime = Date.now();
    
    try {
      // Validation
      if (!texts || texts.length === 0) {
        logger.warn('[Pinecone] Empty texts array provided');
        return [];
      }

      // Filter out empty strings and validate
      const validTexts = texts.filter(text => {
        if (typeof text !== 'string') {
          logger.warn('[Pinecone] Non-string value in texts array:', { type: typeof text });
          return false;
        }
        return text.trim().length > 0;
      });

      if (validTexts.length === 0) {
        logger.warn('[Pinecone] No valid texts after filtering');
        return [];
      }

      const client = PineconeConfig.getClient();
      const model = PineconeConfig.getEmbeddingModel();
      
      logger.info('[Pinecone] Creating embeddings', {
        model,
        textCount: validTexts.length,
        totalChars: validTexts.reduce((sum, t) => sum + t.length, 0),
        averageChars: Math.round(validTexts.reduce((sum, t) => sum + t.length, 0) / validTexts.length)
      });

      // Use Pinecone Inference API
      const embeddingResponse = await client.inference.embed(
        model,
        validTexts,
        { inputType: 'passage', truncate: 'END' }
      );

      // Extract embeddings from response
      const embeddings: number[][] = [];

      // Extract values from each embedding (handling both dense and sparse types)
      for (const item of embeddingResponse.data) {
        // Check if this is a dense embedding (has 'values' property)
        if ('values' in item && Array.isArray(item.values)) {
          embeddings.push(item.values);
        } 
        // If it's sparse, we don't support it yet
        else if ('indices' in item && 'values' in item) {
          throw new Error('Sparse embeddings are not supported. Use a dense embedding model.');
        }
        // Unknown format
        else {
          throw new Error('Unknown embedding format received from Pinecone');
        }
      }

      // Validate embeddings
      if (embeddings.length === 0) {
        throw new Error('No valid embeddings extracted from response');
      }

      const expectedDim = PineconeConfig.getEmbeddingDimensions();
      const invalidEmbedding = embeddings.find(emb => 
        !Array.isArray(emb) || emb.length !== expectedDim
      );

      if (invalidEmbedding) {
        throw new Error(`Invalid embedding dimensions. Expected ${expectedDim}, got ${invalidEmbedding?.length}`);
      }

      const duration = Date.now() - startTime;

      logger.info('[Pinecone] ✓ Embeddings created successfully', {
        count: embeddings.length,
        dimensions: embeddings[0]?.length,
        duration: `${duration}ms`,
        model
      });

      return embeddings;

    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      const errorDetails = {
        message: error?.message || 'Unknown error',
        status: error?.status,
        code: error?.code,
        duration: `${duration}ms`,
        model: PineconeConfig.getEmbeddingModel(),
        textCount: texts.length
      };

      logger.error('[Pinecone] Embedding creation failed', errorDetails);

      // Specific error handling
      if (error?.status === 401 || error?.message?.includes('authentication')) {
        throw new Error('Pinecone API key is invalid or expired');
      }
      
      if (error?.status === 429) {
        throw new Error('Pinecone rate limit exceeded. Please wait and try again');
      }
      
      if (error?.status === 400) {
        throw new Error(`Pinecone bad request: ${error?.message || 'Invalid input'}`);
      }

      if (error?.code === 'ECONNREFUSED' || error?.code === 'ETIMEDOUT') {
        throw new Error('Network error connecting to Pinecone. Check your internet connection');
      }

      throw new Error(`Pinecone embedding failed: ${error?.message || 'Unknown error'}`);
    }
  }

  /**
   * ========================================
   * UPSERT VECTORS (Store or Update)
   * ========================================
   */
  public static async upsertVectors(
    namespace: string,
    vectors: Array<{
      id: string;
      values: number[];
      metadata?: Record<string, any>;
    }>
  ): Promise<void> {
    try {
      const index = PineconeConfig.getIndex();

      await index.namespace(namespace).upsert(vectors);

      logger.info('[Pinecone] ✓ Vectors upserted', {
        namespace,
        count: vectors.length
      });

    } catch (error: any) {
      logger.error('[Pinecone] Upsert failed', {
        message: error?.message,
        namespace
      });
      throw error;
    }
  }

  /**
   * ========================================
   * DELETE NAMESPACE (Clear Business Data)
   * ========================================
   */
  public static async deleteNamespace(namespace: string): Promise<void> {
    try {
      const index = PineconeConfig.getIndex();

      await index.namespace(namespace).deleteAll();

      logger.info('[Pinecone] ✓ Namespace deleted', { namespace });

    } catch (error: any) {
      logger.error('[Pinecone] Namespace deletion failed', {
        message: error?.message,
        namespace
      });
      throw error;
    }
  }

  /**
   * ========================================
   * DELETE SPECIFIC VECTORS
   * ========================================
   */
  public static async deleteVectors(
    namespace: string,
    vectorIds: string[]
  ): Promise<void> {
    try {
      const index = PineconeConfig.getIndex();

      await index.namespace(namespace).deleteMany(vectorIds);

      logger.info('[Pinecone] ✓ Vectors deleted', {
        namespace,
        count: vectorIds.length
      });

    } catch (error: any) {
      logger.error('[Pinecone] Vector deletion failed', {
        message: error?.message,
        namespace
      });
      throw error;
    }
  }

  /**
   * ========================================
   * GET NAMESPACE STATS
   * ========================================
   */
  public static async getNamespaceStats(namespace: string): Promise<{
    vectorCount: number;
    namespace: string;
  }> {
    try {
      const index = PineconeConfig.getIndex();
      const stats = await index.describeIndexStats();

      const namespaceStats = stats.namespaces?.[namespace];

      return {
        vectorCount: namespaceStats?.recordCount || 0,
        namespace,
      };

    } catch (error: any) {
      logger.error('[Pinecone] Stats retrieval failed', {
        message: error?.message,
        namespace
      });
      throw error;
    }
  }

  /**
   * ========================================
   * UPDATE VECTOR METADATA
   * ========================================
   */
  public static async updateVectorMetadata(
    namespace: string,
    vectorId: string,
    metadata: Record<string, any>
  ): Promise<void> {
    try {
      const index = PineconeConfig.getIndex();

      await index.namespace(namespace).update({
        id: vectorId,
        metadata,
      });

      logger.info('[Pinecone] ✓ Metadata updated', { vectorId });

    } catch (error: any) {
      logger.error('[Pinecone] Metadata update failed', {
        message: error?.message,
        vectorId
      });
      throw error;
    }
  }

  /**
   * ========================================
   * CHECK IF INDEX EXISTS
   * ========================================
   */
  public static async indexExists(): Promise<boolean> {
    try {
      const client = PineconeConfig.getClient();
      const indexes = await client.listIndexes();
      
      const exists = indexes.indexes?.some(
        index => index.name === PineconeConfig.config.indexName
      );

      return exists || false;

    } catch (error: any) {
      logger.error('[Pinecone] Index check failed', {
        message: error?.message
      });
      return false;
    }
  }
}

// Exports
export const getPineconeClient = PineconeConfig.getClient.bind(PineconeConfig);
export const getPineconeIndex = PineconeConfig.getIndex.bind(PineconeConfig);
export const getIndexName = PineconeConfig.getIndexName.bind(PineconeConfig);
export const getEmbeddingModel = PineconeConfig.getEmbeddingModel.bind(PineconeConfig);
export const getEmbeddingDimensions = PineconeConfig.getEmbeddingDimensions.bind(PineconeConfig);

// NEW: Embedding creation (replaces OpenAI)
export const createEmbeddings = PineconeConfig.createEmbeddings.bind(PineconeConfig);

// Storage operations
export const upsertVectors = PineconeConfig.upsertVectors.bind(PineconeConfig);
export const deleteNamespace = PineconeConfig.deleteNamespace.bind(PineconeConfig);
export const deleteVectors = PineconeConfig.deleteVectors.bind(PineconeConfig);
export const updateVectorMetadata = PineconeConfig.updateVectorMetadata.bind(PineconeConfig);

// Utilities
export const getNamespaceStats = PineconeConfig.getNamespaceStats.bind(PineconeConfig);
export const indexExists = PineconeConfig.indexExists.bind(PineconeConfig);

export default PineconeConfig;