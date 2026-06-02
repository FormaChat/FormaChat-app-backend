import { Pinecone } from '@pinecone-database/pinecone';
import { createLogger } from '../util/chat.logger.utils';
import { env } from './chat.env.config';

const logger = createLogger('pinecone-query-service');

/**
 * ========================================
 * PINECONE QUERY SERVICE (Chat Service)
 * ========================================
 * 
 * Purpose: Query vectors to find relevant business context
 * Does NOT store/upsert - that's Business Profile Service's job
 * 
 * Responsibilities:
 * 1. Embed user questions (using Pinecone Inference)
 * 2. Query Pinecone for relevant business chunks
 * 3. Return context for LLM (Groq) to generate responses
 * 
 * Key Difference from Business Service:
 * - Business Service: Creates & stores vectors (upsert)
 * - Chat Service: Only reads vectors (query)
*/

class PineconeQueryService {
  private static instance: Pinecone | null = null;

  private static readonly config = {
    apiKey: env.PINECONE_API_KEY,
    indexName: env.PINECONE_INDEX_NAME,
    embeddingModel: 'multilingual-e5-large', // Same as Business Service
  };

  /**
   * Get Pinecone client (Singleton)
  */
 
  public static getClient(): Pinecone {
    if (!PineconeQueryService.instance) {
      if (!PineconeQueryService.config.apiKey) {
        throw new Error('PINECONE_API_KEY not set in environment variables');
      }

      PineconeQueryService.instance = new Pinecone({
        apiKey: PineconeQueryService.config.apiKey,
      });

      logger.info('[Pinecone] Query service initialized', {
        indexName: PineconeQueryService.config.indexName,
        embeddingModel: PineconeQueryService.config.embeddingModel
      });
    }

    return PineconeQueryService.instance;
  }

  /**
   * Get the Pinecone index
   */
  public static getIndex() {
    const client = PineconeQueryService.getClient();
    return client.index(PineconeQueryService.config.indexName);
  }

  /**
   * ========================================
   * EMBED QUESTION (User Query)
   * ========================================
   * 
   * Converts user question to vector for querying
   * Uses same model as Business Service for consistency
   * 
   * IMPORTANT: Use inputType: 'query' for questions
   * (Business Service uses inputType: 'passage' for documents)
   */
  public static async embedQuestion(question: string): Promise<number[]> {
    const startTime = Date.now();

    try {
      if (!question || question.trim().length === 0) {
        throw new Error('Question cannot be empty');
      }

      const client = PineconeQueryService.getClient();
      
      logger.debug('[Pinecone] Embedding user question', {
        questionLength: question.length,
        questionPreview: question.substring(0, 50) + '...'
      });

      // Use Pinecone Inference with inputType: 'query'
      const embeddingResponse = await client.inference.embed(
        PineconeQueryService.config.embeddingModel,
        [question],
        { inputType: 'query', truncate: 'END' } // 'query' for questions, 'passage' for documents
      );

      // Extract embedding
      const embedding = embeddingResponse.data?.[0];
      
      if (!embedding || !('values' in embedding)) {
        throw new Error('Failed to create question embedding');
      }

      const duration = Date.now() - startTime;

      logger.debug('[Pinecone] ✓ Question embedded', {
        dimensions: embedding.values.length,
        duration: `${duration}ms`
      });

      return embedding.values;

    } catch (error: any) {
      const duration = Date.now() - startTime;

      logger.error('[Pinecone] Question embedding failed', {
        message: error?.message,
        status: error?.status,
        duration: `${duration}ms`
      });

      // Specific error handling
      if (error?.status === 401 || error?.message?.includes('authentication')) {
        throw new Error('Pinecone API key is invalid or expired');
      }
      
      if (error?.status === 429) {
        throw new Error('Pinecone rate limit exceeded. Please wait and try again');
      }

      throw error;
    }
  }

  /**
   * ========================================
   * QUERY BUSINESS CONTEXT
   * ========================================
   * 
   * Searches Pinecone for relevant business chunks
   * Returns top K results with metadata
   * 
   * @param businessId - Which business to search
   * @param questionEmbedding - Vector representation of user's question
   * @param topK - How many results to return (default: 5)
   */
  public static async queryBusinessContext(
    businessId: string,
    questionEmbedding: number[],
    topK: number = 5
  ): Promise<Array<{
    id: string;
    score: number;
    text: string;
    metadata: Record<string, any>;
  }>> {
    const startTime = Date.now();

    try {
      const index = PineconeQueryService.getIndex();
      const namespace = `business_${businessId}`;

      logger.debug('[Pinecone] Querying business context', {
        businessId,
        namespace,
        topK
      });

      // Query Pinecone
      const queryResponse = await index.namespace(namespace).query({
        vector: questionEmbedding,
        topK,
        includeMetadata: true
      });

      // Extract results
      const results = queryResponse.matches?.map(match => ({
        id: match.id,
        score: match.score || 0,
        text: (match.metadata?.text as string) || '',
        metadata: match.metadata || {}
      })) || [];

      const duration = Date.now() - startTime;

      logger.info('[Pinecone] ✓ Query completed', {
        resultsFound: results.length,
        topScore: results[0]?.score || 0,
        duration: `${duration}ms`,
        businessId
      });

      return results;

    } catch (error: any) {
      const duration = Date.now() - startTime;

      logger.error('[Pinecone] Query failed', {
        message: error?.message,
        businessId,
        duration: `${duration}ms`
      });

      throw error;
    }
  }

  /**
   * ========================================
   * SEARCH BUSINESS (High-Level)
   * ========================================
   * 
   * Combined method: Embed question + Query context
   * This is what your Chat Service will call
   * 
   * Returns formatted results ready for LLM consumption
   */
  public static async searchBusiness(
    businessId: string,
    userQuestion: string,
    topK: number = 5
  ): Promise<{
    question: string;
    results: Array<{
      text: string;
      score: number;
      sourceType: string;
      chunkId: string;
    }>;
    context: string; // Combined text for LLM
    hasResults: boolean;
  }> {
    const startTime = Date.now();

    try {
      // 1. Embed user question
      const questionEmbedding = await PineconeQueryService.embedQuestion(userQuestion);

      // 2. Query Pinecone
      const matches = await PineconeQueryService.queryBusinessContext(
        businessId,
        questionEmbedding,
        topK
      );

      // 3. Format results
      const results = matches.map(match => ({
        text: match.text,
        score: match.score,
        sourceType: match.metadata.sourceType || 'unknown',
        chunkId: match.id
      }));

      // 4. Combine into context for LLM
      const context = matches
        .map(match => match.text)
        .join('\n\n');

      const duration = Date.now() - startTime;

      logger.info('[Pinecone] ✓ Business search completed', {
        businessId,
        questionLength: userQuestion.length,
        resultsCount: results.length,
        contextLength: context.length,
        duration: `${duration}ms`
      });

      return {
        question: userQuestion,
        results,
        context,
        hasResults: results.length > 0
      };

    } catch (error: any) {
      const duration = Date.now() - startTime;

      logger.error('[Pinecone] Business search failed', {
        message: error?.message,
        businessId,
        question: userQuestion,
        duration: `${duration}ms`
      });

      throw error;
    }
  }

  /**
   * ========================================
   * CHECK BUSINESS EXISTS
   * ========================================
   * 
   * Verifies business has vectors in Pinecone
   * Useful for validating before creating chat session
   */
  public static async checkBusinessExists(businessId: string): Promise<{
    exists: boolean;
    vectorCount: number;
    namespace: string;
  }> {
    try {
      const index = PineconeQueryService.getIndex();
      const namespace = `business_${businessId}`;

      const stats = await index.describeIndexStats();
      const namespaceStats = stats.namespaces?.[namespace];

      const vectorCount = namespaceStats?.recordCount || 0;
      const exists = vectorCount > 0;

      logger.debug('[Pinecone] Business check', {
        businessId,
        vectorCount,
        exists
      });

      return {
        exists,
        vectorCount,
        namespace
      };

    } catch (error: any) {
      logger.error('[Pinecone] Business check failed', {
        message: error?.message,
        businessId
      });

      return {
        exists: false,
        vectorCount: 0,
        namespace: `business_${businessId}`
      };
    }
  }

  /**
   * ========================================
   * GET NAMESPACE STATS
   * ========================================
   * 
   * Get detailed stats for a business namespace
   * Useful for admin dashboard / debugging
   */
  public static async getNamespaceStats(businessId: string): Promise<{
    vectorCount: number;
    namespace: string;
    dimensionality?: number;
  }> {
    try {
      const index = PineconeQueryService.getIndex();
      const namespace = `business_${businessId}`;

      const stats = await index.describeIndexStats();
      const namespaceStats = stats.namespaces?.[namespace];

      return {
        vectorCount: namespaceStats?.recordCount || 0,
        namespace,
        dimensionality: stats.dimension
      };

    } catch (error: any) {
      logger.error('[Pinecone] Stats retrieval failed', {
        message: error?.message,
        businessId
      });

      throw error;
    }
  }

  /**
   * ========================================
   * HEALTH CHECK
   * ========================================
   * 
   * Verify Pinecone connection is working
   */
  public static async healthCheck(): Promise<boolean> {
    try {
      const index = PineconeQueryService.getIndex();
      await index.describeIndexStats();
      
      logger.debug('[Pinecone] Health check passed');
      return true;

    } catch (error: any) {
      logger.error('[Pinecone] Health check failed', {
        message: error?.message
      });
      return false;
    }
  }

  /**
   * ========================================
   * BATCH QUERY (Multiple Questions)
   * ========================================
   * 
   * Query multiple questions at once (for bulk operations)
   * Useful for testing or admin tools
   */
  public static async batchSearchBusiness(
    businessId: string,
    questions: string[],
    topK: number = 5
  ): Promise<Array<{
    question: string;
    results: Array<{
      text: string;
      score: number;
      sourceType: string;
    }>;
    context: string;
  }>> {
    try {
      const results = await Promise.all(
        questions.map(question => 
          PineconeQueryService.searchBusiness(businessId, question, topK)
        )
      );

      logger.info('[Pinecone] Batch search completed', {
        businessId,
        questionsCount: questions.length,
        totalResults: results.reduce((sum, r) => sum + r.results.length, 0)
      });

      return results;

    } catch (error: any) {
      logger.error('[Pinecone] Batch search failed', {
        message: error?.message,
        businessId,
        questionsCount: questions.length
      });

      throw error;
    }
  }
}

// Exports
export const getClient = PineconeQueryService.getClient.bind(PineconeQueryService);
export const getIndex = PineconeQueryService.getIndex.bind(PineconeQueryService);

// Query methods
export const embedQuestion = PineconeQueryService.embedQuestion.bind(PineconeQueryService);
export const queryBusinessContext = PineconeQueryService.queryBusinessContext.bind(PineconeQueryService);
export const searchBusiness = PineconeQueryService.searchBusiness.bind(PineconeQueryService);

// Utility methods
export const checkBusinessExists = PineconeQueryService.checkBusinessExists.bind(PineconeQueryService);
export const getNamespaceStats = PineconeQueryService.getNamespaceStats.bind(PineconeQueryService);
export const healthCheck = PineconeQueryService.healthCheck.bind(PineconeQueryService);

// Batch operations
export const batchSearchBusiness = PineconeQueryService.batchSearchBusiness.bind(PineconeQueryService);

export default PineconeQueryService;