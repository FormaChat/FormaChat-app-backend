import Business, { IBusiness } from '../models/business.model';
import { embeddingService, EmbeddingResult } from './embedding.service';
import { upsertVectors, deleteNamespace} from '../config/pinecone';
import { createLogger } from '../utils/business.logger.utils';

const logger = createLogger('vector-service');

/**
 * ========================================
 * VECTOR SERVICE
 * ========================================
 * 
 * Orchestrates the flow from MongoDB business data to Pinecone vectors.
 * 
 * Responsibilities:
 * 1. Fetch business data from MongoDB
 * 2. Extract and prepare text for embedding
 * 3. Coordinate with Embedding Service for transformations
 * 4. Store vectors in Pinecone with proper metadata
 * 5. Update MongoDB vectorInfo status
 * 
 * Called by Business Service on:
 * - Business creation
 * - Business updates
 * - Business deletion
 * - Business freeze/unfreeze
*/

interface VectorRecord {
  id: string;
  values: number[];
  metadata: {
    businessId: string;
    sourceType: 'questionnaire' | 'document' | 'image';
    sourceId?: string;
    chunkIndex: number;
    text: string;
    category?: string;
  };
}

export class VectorService {
  
  /**
   * ========================================
   * 1. TRIGGER VECTOR UPDATE
   * ========================================
   * 
   * Main method called by Business Service when:
   * - Business is created
   * - Business is updated
   * 
   * Process:
   * 1. Fetch business from MongoDB
   * 2. Extract questionnaire text
   * 3. Process documents (if PRO tier)
   * 4. Process images (if PRO+ tier)
   * 5. Create embeddings for all content
   * 6. Clear old vectors (for updates)
   * 7. Store new vectors in Pinecone
   * 8. Update MongoDB vectorInfo status
   * 
   * @param businessId - MongoDB business ID
  */

  async triggerVectorUpdate(businessId: string): Promise<void> {
    logger.info(`[Vector] Starting vector update for business: ${businessId}`);
    
    let business: IBusiness | null = null;

    try {
      // 1. FETCH BUSINESS FROM MONGODB
      business = await Business.findById(businessId);

      if (!business) {
        throw new Error(`Business not found: ${businessId}`);
      }

      if (business.vectorInfo.vectorStatus === 'pending') {
        logger.info(`[Vector] Update already in progress for ${businessId}, skipping...`);
        return;
      }

      // Set status to pending
      business.vectorInfo.vectorStatus = 'pending';
      business.vectorInfo.lastSyncAttempt = new Date();
      await business.save();

      // 2. EXTRACT QUESTIONNAIRE TEXT
      logger.info(`[Vector] Extracting questionnaire text...`);
      const questionnaireTexts = this.extractBusinessText(business);
      
      if (questionnaireTexts.length === 0 || questionnaireTexts.every(t => t.trim().length === 0)) {
        throw new Error('Business has no content to embed - questionnaire data is empty');
      }

      // 3. EMBED QUESTIONNAIRE DATA
      const questionnaireEmbeddings = await embeddingService.embedTexts(questionnaireTexts);
      logger.info(`[Vector] Created ${questionnaireEmbeddings.length} questionnaire embeddings`);

      // 4. PROCESS DOCUMENTS (PRO tier)
      let documentEmbeddings: EmbeddingResult[] = [];
      if (business.files?.documents && business.files.documents.length > 0) {
        logger.info(`[Vector] Processing ${business.files.documents.length} documents...`);
        
        try {
          const docs = business.files.documents.map(doc => ({
            fileUrl: doc.fileUrl,
            fileName: doc.fileName
          }));

          documentEmbeddings = await embeddingService.embedMultipleDocuments(docs);

          documentEmbeddings = documentEmbeddings.filter(result => 
            result.embedding && result.embedding.length > 0
          );

          logger.info(`[Vector] Created ${documentEmbeddings.length} document embeddings`);
        } catch (docError: any) {
          logger.error(`[Vector] Document processing failed:`, docError.message);
          // Continue with other embeddings even if documents fail
        }
      }

      // 5. PROCESS IMAGES (PRO+ tier)
      let imageEmbeddings: EmbeddingResult[] = [];
      if (business.files?.images && business.files.images.length > 0) {
        logger.info(`[Vector] Processing ${business.files.images.length} images...`);
        
        try {
          const images = business.files.images.map(img => ({
            imageUrl: img.fileUrl,
            fileName: img.fileName
          }));

          imageEmbeddings = await embeddingService.embedMultipleImages(images);
          
          // Filter out images with no OCR text
          imageEmbeddings = imageEmbeddings.filter(result => 
            result.embedding && result.embedding.length > 0
          );
          
          logger.info(`[Vector] Created ${imageEmbeddings.length} image embeddings`);
        } catch (imgError: any) {
          logger.error(`[Vector] Image processing failed:`, imgError.message);
          // Continue with other embeddings even if images fail
        }
      }

      // 6. PREPARE VECTORS FOR PINECONE
      const allVectors = this.prepareVectorsForPinecone(
        business._id.toString(),
        questionnaireEmbeddings,
        documentEmbeddings,
        imageEmbeddings
      );

      logger.info(`[Vector] Prepared ${allVectors.length} total vectors for storage`);

      // 7. CLEAR OLD VECTORS (for updates)
      const namespace = business.vectorInfo.namespace;
      logger.info(`[Vector] Clearing old vectors in namespace: ${namespace}`);
      
      try {
        await deleteNamespace(namespace);
      } catch (deleteError: any) {
        // Namespace might not exist yet (first time), that's okay
        logger.info(`[Vector] Namespace clear skipped (may not exist yet)`);
      }

      // 8. STORE NEW VECTORS IN PINECONE
      if (allVectors.length > 0) {
        logger.info(`[Vector] Upserting ${allVectors.length} vectors to Pinecone...`);
        await upsertVectors(namespace, allVectors);
      } else {
        logger.warn(`[Vector] No vectors to store for business: ${businessId}`);
      }

      // 9. UPDATE MONGODB STATUS - SUCCESS
      business.vectorInfo.vectorStatus = 'completed';
      business.vectorInfo.lastVectorUpdate = new Date();
      business.vectorInfo.vectorCount = allVectors.length;
      business.vectorInfo.needsUpdate = false;
      await business.save();

      logger.info(`[Vector] ✓ Vector update completed successfully for: ${businessId}`);

    } catch (error: any) {
      logger.error(`[Vector] ✗ Vector update failed for ${businessId}:`, error.message);

      // UPDATE MONGODB STATUS - FAILURE
      if (business) {
        business.vectorInfo.vectorStatus = 'failed';
        business.vectorInfo.lastSyncAttempt = new Date();

        business.vectorInfo.processingErrors = {
          lastError: error.message,
          lastErrorAt: new Date(),
        };

        await business.save();
      }

      // Don't throw - graceful degradation
      // Business is still saved in MongoDB even if vectors fail
    }
  }

  /**
   * ========================================
   * 2. TRIGGER VECTOR CLEANUP
   * ========================================
   * 
   * Called by Business Service when:
   * - Business is permanently deleted
   * 
   * Hard delete - removes all vectors from Pinecone
   * 
   * @param businessId - MongoDB business ID
  */

  async triggerVectorCleanup(businessId: string): Promise<void> {
    logger.info(`[Vector] Starting vector cleanup for business: ${businessId}`);

    try {
      // Fetch business to get namespace
      const business = await Business.findById(businessId);

      if (!business) {
        logger.warn(`[Vector] Business not found, using default namespace pattern`);
        // Even if business is deleted, we know the namespace pattern
        const namespace = `business_${businessId}`;
        await deleteNamespace(namespace);
      } else {
        const namespace = business.vectorInfo.namespace;
        await deleteNamespace(namespace);
      }

      logger.info(`[Vector] ✓ Vector cleanup completed for: ${businessId}`);

    } catch (error: any) {
      logger.error(`[Vector] ✗ Vector cleanup failed for ${businessId}:`, error.message);
      // Don't throw - cleanup is best-effort
    }
  }

  /**
   * ========================================
   * 3. FREEZE VECTOR ACCESS
   * ========================================
   * 
   * Called by Business Service when:
   * - Business is frozen (trial expired, payment failed, admin action)
   * 
   * Strategy: SOFT FREEZE (MongoDB flag only)
   * - Vectors remain in Pinecone (ZERO cost!)
   * - MongoDB pre-save hook updates vectorStatus to 'frozen'
   * - Chat Service MUST check business.canChat() before querying
   * - Instant reactivation when unfrozen (no re-embedding needed)
   * 
   * CRITICAL DEPENDENCY:
   * Chat Service must call business.canChat() before every Pinecone query.
   * Do NOT query Pinecone if canChat() returns false.
   * 
   * @param businessId - MongoDB business ID
  */

  async freezeVectorAccess(businessId: string): Promise<void> {
    logger.info(`[Vector] Freezing vector access for business: ${businessId}`);

    try {
      // OPTION A: Do nothing (recommended)
      // Chat Service will check business.isActive in MongoDB before querying
      logger.info(`[Vector] Soft freeze - vectors preserved, access controlled via MongoDB`);

    

      logger.info(`[Vector] ✓ Vector freeze completed for: ${businessId}`);

    } catch (error: any) {
      logger.error(`[Vector] ✗ Vector freeze failed for ${businessId}:`, error.message);
     
    }
  }

    /**
   * ========================================
   * 4. RESUME VECTOR ACCESS
   * ========================================
   * 
   * Called by Business Service when:
   * - Business is unfrozen (payment received, admin unfreeze)
   * 
   * Strategy: INSTANT RESUME
   * - Vectors already exist in Pinecone (never deleted!)
   * - MongoDB pre-save hook updates vectorStatus from 'frozen' → 'pending' → 'completed'
   * - Chat Service can immediately query (zero latency)
   * - No re-embedding or re-upsert needed (zero cost)
   * 
   * @param businessId - MongoDB business ID
  */

  async resumeVectorAccess(businessId: string): Promise<void> {
    logger.info(`[Vector] Resuming vector access for business: ${businessId}`);

    try {
      // OPTION A: Do nothing (recommended)
      // Vectors already exist, MongoDB isActive is now true
      logger.info(`[Vector] Vectors already available, access restored via MongoDB`);


      logger.info(`[Vector] ✓ Vector resume completed for: ${businessId}`);

    } catch (error: any) {
      logger.error(`[Vector] ✗ Vector resume failed for ${businessId}:`, error.message);
     
    }
  }

  /**
   * ========================================
   * PRIVATE HELPER: EXTRACT BUSINESS TEXT
   * ========================================
   * 
   * Extracts meaningful text from business questionnaire data.
   * Formats it as natural language for better embedding quality.
   * 
   * @param business - Business document from MongoDB
   * @returns Array of text strings to embed
  */

  private extractBusinessText(business: IBusiness): string[] {
    const texts: string[] = [];

    // 1. BASIC INFO
    const basicText = `
      ${business.basicInfo.businessName} is a ${business.basicInfo.businessType} business.
      ${business.basicInfo.businessDescription}
      Located in ${business.basicInfo.location}.
      Operating hours: ${business.basicInfo.operatingHours}.
      ${business.basicInfo.timezone ? `Timezone: ${business.basicInfo.timezone}.` : ''}
    `.trim();
    texts.push(basicText);

    // 2. PRODUCTS & SERVICES
    const productsText = `
      Products and Services: ${business.productsServices.offerings}
      Service delivery options: ${business.productsServices.serviceDelivery.join(', ')}.
      ${business.productsServices.pricingDisplay?.pricingNote || ''}
    `.trim();
    texts.push(productsText);

    // 3. POPULAR ITEMS
    if (business.productsServices.popularItems && business.productsServices.popularItems.length > 0) {
      const itemsText = business.productsServices.popularItems
        .map(item => {
          let itemStr = `${item.name}`;
          if (item.description) itemStr += `: ${item.description}`;
          if (item.price) itemStr += ` - $${item.price}`;
          return itemStr;
        })
        .join('. ');
      texts.push(`Popular items: ${itemsText}.`);
    }

    // 4. FAQs
    if (business.customerSupport.faqs && business.customerSupport.faqs.length > 0) {
      business.customerSupport.faqs.forEach(faq => {
        if (faq.question?.trim() && faq.answer?.trim()) {
          texts.push(`Question: ${faq.question} Answer: ${faq.answer}`);
        }
      });
    }

    // 5. POLICIES
    const policiesText = `
      Refund Policy: ${business.customerSupport.policies.refundPolicy}
      ${business.customerSupport.policies.cancellationPolicy ? `Cancellation Policy: ${business.customerSupport.policies.cancellationPolicy}` : ''}
      ${business.customerSupport.policies.importantPolicies ? `Important Policies: ${business.customerSupport.policies.importantPolicies}` : ''}
    `.trim();
    texts.push(policiesText);

    // 6. CHATBOT CONFIGURATION
    const chatbotText = `
      Chatbot tone: ${business.customerSupport.chatbotTone}.
      ${business.customerSupport.chatbotGreeting ? `Greeting: ${business.customerSupport.chatbotGreeting}` : ''}
      ${business.customerSupport.chatbotRestrictions ? `Restrictions: ${business.customerSupport.chatbotRestrictions}` : ''}
    `.trim();
    texts.push(chatbotText);

    // 7. CONTACT INFORMATION
    const contactMethods = business.contactEscalation.contactMethods
      .map(c => `${c.method}: ${c.value}`)
      .join(', ');
    
    const contactText = `
      Contact methods: ${contactMethods}.
      Escalation contact: ${business.contactEscalation.escalationContact.name} (${business.contactEscalation.escalationContact.email}${business.contactEscalation.escalationContact.phone ? `, ${business.contactEscalation.escalationContact.phone}` : ''}).
      Chatbot capabilities: ${business.contactEscalation.chatbotCapabilities.join(', ')}.
    `.trim();
    texts.push(contactText);

    // Filter out empty strings and clean whitespace
    return texts
      .filter(text => text.length > 0)
      .map(text => text.replace(/\s+/g, ' ').trim());
  }

  /**
   * ========================================
   * PRIVATE HELPER: PREPARE VECTORS
   * ========================================
   * 
   * Combines all embeddings and formats them for Pinecone storage.
   * Adds proper IDs and metadata for each vector.
   * 
   * @param businessId - Business ID for metadata
   * @param questionnaireEmbeddings - Embeddings from questionnaire
   * @param documentEmbeddings - Embeddings from documents
   * @param imageEmbeddings - Embeddings from images
   * @returns Array of vectors ready for Pinecone
  */

  private prepareVectorsForPinecone(
    businessId: string,
    questionnaireEmbeddings: EmbeddingResult[],
    documentEmbeddings: EmbeddingResult[],
    imageEmbeddings: EmbeddingResult[]
  ): VectorRecord[] {
    const vectors: VectorRecord[] = [];

    // 1. QUESTIONNAIRE VECTORS
    questionnaireEmbeddings.forEach((result, index) => {
      vectors.push({
        id: `chunk_${businessId}_questionnaire_${index}`,
        values: result.embedding,
        metadata: {
          businessId,
          sourceType: 'questionnaire',
          chunkIndex: index,
          text: result.text,
          category: 'business_info'
        }
      });
    });

    // 2. DOCUMENT VECTORS
    documentEmbeddings.forEach((result, index) => {
      vectors.push({
        id: `chunk_${businessId}_document_${index}`,
        values: result.embedding,
        metadata: {
          businessId,
          sourceType: 'document',
          sourceId: result.metadata?.fileName,
          chunkIndex: result.chunkIndex || index,
          text: result.text,
          category: 'document'
        }
      });
    });

    // 3. IMAGE VECTORS
    imageEmbeddings.forEach((result, index) => {
      vectors.push({
        id: `chunk_${businessId}_image_${index}`,
        values: result.embedding,
        metadata: {
          businessId,
          sourceType: 'image',
          sourceId: result.metadata?.fileName,
          chunkIndex: index,
          text: result.text,
          category: 'image_text'
        }
      });
    });

    return vectors;
  }
}

export const vectorService = new VectorService();