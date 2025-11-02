import { Pinecone } from '@pinecone-database/pinecone';
import dotenv from 'dotenv';

dotenv.config();

/**
 * ========================================
 * PINECONE CONFIGURATION (Storage Only)
 * ========================================
 * 
 * This file sets up Pinecone for storing business embeddings.
 * 
 * Purpose: 
 * - Store vectors when business created
 * - Update vectors when business updated
 * - Delete vectors when business deleted/frozen
 * 
 * Note: Query/retrieval logic will be in Chat Service (later)
 */

class PineconeConfig {
  private static instance: Pinecone | null = null;

  private static readonly config = {
    apiKey: process.env.PINECONE_API_KEY,
    environment: process.env.PINECONE_ENVIRONMENT,
    indexName: process.env.PINECONE_INDEX_NAME || 'formachat-messages',
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

      console.log('[Pinecone] Client initialized');
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
   * ========================================
   * UPSERT VECTORS (Store or Update)
   * ========================================
   * 
   * Stores vectors in Pinecone. If vectors with same IDs exist, they get updated.
   * This is used when:
   * - Business created (initial storage)
   * - Business updated (replace existing vectors)
   * 
   * @param namespace - Business-specific namespace (e.g., "business_507f1f77bcf86cd799439011")
   * @param vectors - Array of vectors to store
  */

  public static async upsertVectors(
    namespace: string,
    vectors: Array<{
      id: string;              // Unique ID for each vector chunk
      values: number[];        // The embedding vector (1536 or 3072 numbers)
      metadata?: Record<string, any>; // Additional data (businessId, text, etc.)
    }>
  ): Promise<void> {
    try {
      const index = PineconeConfig.getIndex();

      // Upsert to specific namespace (isolated per business)
      await index.namespace(namespace).upsert(vectors);

      console.log(`[Pinecone] Upserted ${vectors.length} vectors to namespace: ${namespace}`);

    } catch (error: any) {
      console.error('[Pinecone] Upsert failed:', error.message);
      throw error;
    }
  }

  /**
   * ========================================
   * DELETE NAMESPACE (Clear Business Data)
   * ========================================
   * 
   * Deletes all vectors in a namespace.
   * This is used when:
   * - Business permanently deleted
   * - Business frozen (optional - depends on your strategy)
   * - Business needs full re-indexing
   * 
   * @param namespace - Business namespace to clear
  */

  public static async deleteNamespace(namespace: string): Promise<void> {
    try {
      const index = PineconeConfig.getIndex();

      // Delete all vectors in this namespace
      await index.namespace(namespace).deleteAll();

      console.log(`[Pinecone] Deleted all vectors in namespace: ${namespace}`);

    } catch (error: any) {
      console.error('[Pinecone] Namespace deletion failed:', error.message);
      throw error;
    }
  }

  /**
   * ========================================
   * DELETE SPECIFIC VECTORS
   * ========================================
   * 
   * Deletes specific vectors by ID.
   * Useful for:
   * - Removing specific document embeddings
   * - Partial updates (delete old, insert new)
   * 
   * @param namespace - Business namespace
   * @param vectorIds - Array of vector IDs to delete
  */

  public static async deleteVectors(
    namespace: string,
    vectorIds: string[]
  ): Promise<void> {
    try {
      const index = PineconeConfig.getIndex();

      await index.namespace(namespace).deleteMany(vectorIds);

      console.log(`[Pinecone] Deleted ${vectorIds.length} vectors from namespace: ${namespace}`);

    } catch (error: any) {
      console.error('[Pinecone] Vector deletion failed:', error.message);
      throw error;
    }
  }

  /**
   * ========================================
   * GET NAMESPACE STATS
   * ========================================
   * 
   * Returns statistics about a namespace.
   * Useful for:
   * - Checking if vectors exist
   * - Monitoring storage usage
   * - Debugging
   * 
   * @param namespace - Business namespace
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
      console.error('[Pinecone] Stats retrieval failed:', error.message);
      throw error;
    }
  }

  /**
   * ========================================
   * UPDATE VECTOR METADATA
   * ========================================
   * 
   * Updates metadata for existing vectors without changing the vector values.
   * Useful for:
   * - Marking vectors as frozen
   * - Adding tags or categories
   * - Updating business info without re-embedding
   * 
   * @param namespace - Business namespace
   * @param vectorId - ID of vector to update
   * @param metadata - New metadata to set
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

      console.log(`[Pinecone] Updated metadata for vector: ${vectorId}`);

    } catch (error: any) {
      console.error('[Pinecone] Metadata update failed:', error.message);
      throw error;
    }
  }

  /**
   * ========================================
   * CHECK IF INDEX EXISTS
   * ========================================
   * 
   * Checks if the Pinecone index exists.
   * Useful for initialization and health checks.
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
      console.error('[Pinecone] Index check failed:', error.message);
      return false;
    }
  }
}

// Exports
export const getPineconeClient = PineconeConfig.getClient.bind(PineconeConfig);
export const getPineconeIndex = PineconeConfig.getIndex.bind(PineconeConfig);
export const getIndexName = PineconeConfig.getIndexName.bind(PineconeConfig);

// Storage operations
export const upsertVectors = PineconeConfig.upsertVectors.bind(PineconeConfig);
export const deleteNamespace = PineconeConfig.deleteNamespace.bind(PineconeConfig);
export const deleteVectors = PineconeConfig.deleteVectors.bind(PineconeConfig);
export const updateVectorMetadata = PineconeConfig.updateVectorMetadata.bind(PineconeConfig);

// Utilities
export const getNamespaceStats = PineconeConfig.getNamespaceStats.bind(PineconeConfig);
export const indexExists = PineconeConfig.indexExists.bind(PineconeConfig);

export default PineconeConfig;

/**
 * ========================================
 * USAGE EXAMPLES (Business Service)
 * ========================================
 * 
 * // 1. Store business vectors
 * import { upsertVectors } from '@/config/pinecone.config';
 * 
 * await upsertVectors('business_507f1f77bcf86cd799439011', [
 *   {
 *     id: 'chunk_0',
 *     values: [0.123, -0.456, ...], // 1536 numbers
 *     metadata: {
 *       businessId: '507f1f77bcf86cd799439011',
 *       text: 'Joe\'s Pizza serves...',
 *       chunkIndex: 0
 *     }
 *   }
 * ]);
 * 
 * // 2. Update business (clear old, store new)
 * import { deleteNamespace, upsertVectors } from '@/config/pinecone.config';
 * 
 * await deleteNamespace('business_507f1f77bcf86cd799439011');
 * await upsertVectors('business_507f1f77bcf86cd799439011', newVectors);
 * 
 * // 3. Delete business
 * import { deleteNamespace } from '@/config/pinecone.config';
 * 
 * await deleteNamespace('business_507f1f77bcf86cd799439011');
 * 
 * // 4. Check storage
 * import { getNamespaceStats } from '@/config/pinecone.config';
 * 
 * const stats = await getNamespaceStats('business_507f1f77bcf86cd799439011');
 * console.log(`Stored ${stats.vectorCount} vectors`);
 */