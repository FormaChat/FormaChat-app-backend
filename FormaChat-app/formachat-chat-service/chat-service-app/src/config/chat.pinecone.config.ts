// import { Pinecone } from '@pinecone-database/pinecone';
// import { createLogger } from '../utils/chat.logger.utils';
// import { env } from './chat.env';

// const logger = createLogger('pinecone-query-service');

// /**
//  * ========================================
//  * PINECONE QUERY SERVICE (Chat Service)
//  * ========================================
//  * 
//  * Purpose: Query vectors to find relevant business context
//  * Does NOT store/upsert - that's Business Profile Service's job
//  * 
//  * Responsibilities:
//  * 1. Embed user questions (using Pinecone Inference)
//  * 2. Query Pinecone for relevant business chunks
//  * 3. Return context for LLM (Groq) to generate responses
//  */

// class PineconeQueryService {
//   private static instance: Pinecone | null = null;

//   private static readonly config = {
//     apiKey: env.PINECONE_API_KEY,
//     indexName: env.PINECONE_INDEX_NAME,
//     embeddingModel: 'multilingual-e5-large', // Same as Business Service
//   };

//   /**
//    * Get Pinecone client (Singleton)
//    */
//   public static getClient(): Pinecone {
//     if (!PineconeQueryService.instance) {
//       if (!PineconeQueryService.config.apiKey) {
//         throw new Error('PINECONE_API_KEY not set in environment variables');
//       }

//       PineconeQueryService.instance = new Pinecone({
//         apiKey: PineconeQueryService.config.apiKey,
//       });

//       logger.info('[Pinecone] Query service initialized');
//     }

//     return PineconeQueryService.instance;
//   }

//   /**
//    * Get the Pinecone index
//    */
//   public static getIndex() {
//     const client = PineconeQueryService.getClient();
//     return client.index(PineconeQueryService.config.indexName);
//   }

//   /**
//    * ========================================
//    * EMBED QUESTION (User Query)
//    * ========================================
//    * 
//    * Converts user question to vector for querying
//    * Uses same model as Business Service for consistency
//    */
//   public static async embedQuestion(question: string): Promise<number[]> {
//     try {
//       if (!question || question.trim().length === 0) {
//         throw new Error('Question cannot be empty');
//       }

//       const client = PineconeQueryService.getClient();
      
//       logger.info('[Pinecone] Embedding user question', {
//         questionLength: question.length,
//         questionPreview: question.substring(0, 50) + '...'
//       });

//       // Use Pinecone Inference with inputType: 'query'
//       const embeddingResponse = await client.inference.embed(
//         PineconeQueryService.config.embeddingModel,
//         [question],
//         { inputType: 'query', truncate: 'END' } // 'query' for questions, 'passage' for documents
//       );

//       // Extract embedding
//       const embedding = embeddingResponse.data?.[0];
      
//       if (!embedding || !('values' in embedding)) {
//         throw new Error('Failed to create question embedding');
//       }

//       logger.info('[Pinecone] ✓ Question embedded', {
//         dimensions: embedding.values.length
//       });

//       return embedding.values;

//     } catch (error: any) {
//       logger.error('[Pinecone] Question embedding failed', {
//         message: error?.message
//       });
//       throw error;
//     }
//   }

//   /**
//    * ========================================
//    * QUERY BUSINESS CONTEXT
//    * ========================================
//    * 
//    * Searches Pinecone for relevant business chunks
//    * Returns top K results with metadata
//    * 
//    * @param businessId - Which business to search
//    * @param questionEmbedding - Vector representation of user's question
//    * @param topK - How many results to return (default: 5)
//    */
//   public static async queryBusinessContext(
//     businessId: string,
//     questionEmbedding: number[],
//     topK: number = 5
//   ): Promise<Array<{
//     id: string;
//     score: number;
//     text: string;
//     metadata: Record<string, any>;
//   }>> {
//     try {
//       const index = PineconeQueryService.getIndex();
//       const namespace = `business_${businessId}`;

//       logger.info('[Pinecone] Querying business context', {
//         businessId,
//         namespace,
//         topK
//       });

//       // Query Pinecone
//       const queryResponse = await index.namespace(namespace).query({
//         vector: questionEmbedding,
//         topK,
//         includeMetadata: true
//       });

//       // Extract results
//       const results = queryResponse.matches?.map(match => ({
//         id: match.id,
//         score: match.score || 0,
//         text: (match.metadata?.text as string) || '',
//         metadata: match.metadata || {}
//       })) || [];

//       logger.info('[Pinecone] ✓ Query completed', {
//         resultsFound: results.length,
//         topScore: results[0]?.score
//       });

//       return results;

//     } catch (error: any) {
//       logger.error('[Pinecone] Query failed', {
//         message: error?.message,
//         businessId
//       });
//       throw error;
//     }
//   }

//   /**
//    * ========================================
//    * SEARCH BUSINESS (High-Level)
//    * ========================================
//    * 
//    * Combined method: Embed question + Query context
//    * This is what your Chat Controller will call
//    */
//   public static async searchBusiness(
//     businessId: string,
//     userQuestion: string,
//     topK: number = 5
//   ): Promise<{
//     question: string;
//     results: Array<{
//       text: string;
//       score: number;
//       sourceType: string;
//     }>;
//     context: string; // Combined text for LLM
//   }> {
//     try {
//       // 1. Embed user question
//       const questionEmbedding = await PineconeQueryService.embedQuestion(userQuestion);

//       // 2. Query Pinecone
//       const matches = await PineconeQueryService.queryBusinessContext(
//         businessId,
//         questionEmbedding,
//         topK
//       );

//       // 3. Format results
//       const results = matches.map(match => ({
//         text: match.text,
//         score: match.score,
//         sourceType: match.metadata.sourceType || 'unknown'
//       }));

//       // 4. Combine into context for LLM
//       const context = matches
//         .map(match => match.text)
//         .join('\n\n');

//       logger.info('[Pinecone] ✓ Business search completed', {
//         businessId,
//         question: userQuestion,
//         resultsCount: results.length,
//         contextLength: context.length
//       });

//       return {
//         question: userQuestion,
//         results,
//         context
//       };

//     } catch (error: any) {
//       logger.error('[Pinecone] Business search failed', {
//         message: error?.message,
//         businessId,
//         question: userQuestion
//       });
//       throw error;
//     }
//   }

//   /**
//    * ========================================
//    * CHECK BUSINESS EXISTS
//    * ========================================
//    * 
//    * Verifies business has vectors in Pinecone
//    */
//   public static async checkBusinessExists(businessId: string): Promise<boolean> {
//     try {
//       const index = PineconeQueryService.getIndex();
//       const namespace = `business_${businessId}`;

//       const stats = await index.describeIndexStats();
//       const namespaceStats = stats.namespaces?.[namespace];

//       const vectorCount = namespaceStats?.recordCount || 0;

//       logger.info('[Pinecone] Business check', {
//         businessId,
//         vectorCount,
//         exists: vectorCount > 0
//       });

//       return vectorCount > 0;

//     } catch (error: any) {
//       logger.error('[Pinecone] Business check failed', {
//         message: error?.message,
//         businessId
//       });
//       return false;
//     }
//   }
// }

// // Exports
// export const embedQuestion = PineconeQueryService.embedQuestion.bind(PineconeQueryService);
// export const queryBusinessContext = PineconeQueryService.queryBusinessContext.bind(PineconeQueryService);
// export const searchBusiness = PineconeQueryService.searchBusiness.bind(PineconeQueryService);
// export const checkBusinessExists = PineconeQueryService.checkBusinessExists.bind(PineconeQueryService);

// export default PineconeQueryService;