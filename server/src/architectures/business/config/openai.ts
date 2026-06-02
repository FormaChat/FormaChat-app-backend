/**
 * ========================================
 * OPENAI CONFIGURATION (Deprecated - Using Pinecone Inference)
 * ========================================
 * 
 * This file now delegates to Pinecone Inference for embeddings.
 * Kept for backward compatibility with existing code.
 * 
 * Migration Note:
 * - OpenAI embeddings → Pinecone Inference (FREE!)
 * - No code changes needed in services
 * - Just re-export Pinecone's createEmbeddings
 */

import { 
  createEmbeddings as pineconeCreateEmbeddings,
  getEmbeddingModel as pineconeGetEmbeddingModel,
  getEmbeddingDimensions as pineconeGetEmbeddingDimensions
} from './pinecone';
import { createLogger } from '../utils/business.logger.utils';

const logger = createLogger('openai-config');

// Re-export Pinecone functions with OpenAI-compatible names
export const createEmbeddings = pineconeCreateEmbeddings;
export const getEmbeddingModel = pineconeGetEmbeddingModel;
export const getEmbeddingDimensions = pineconeGetEmbeddingDimensions;

// Deprecated functions (kept for compatibility)
export const getOpenAIClient = () => {
  logger.warn('[OpenAI] This function is deprecated. Using Pinecone Inference instead.');
  throw new Error('OpenAI client is deprecated. Use Pinecone Inference.');
};

// Log migration notice on import
logger.info('[OpenAI] Using Pinecone Inference for embeddings (OpenAI deprecated)');

export default {
  createEmbeddings,
  getEmbeddingModel,
  getEmbeddingDimensions
};