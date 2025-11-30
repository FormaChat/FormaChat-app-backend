import { createEmbeddings } from '../config/pinecone';
import axios from 'axios';
import mammoth from 'mammoth';
import Tesseract from 'tesseract.js';
import { fileTypeFromBuffer } from 'file-type';
import { createLogger } from '../utils/business.logger.utils';

const logger = createLogger('embedding-service');

/**
 * ========================================
 * EMBEDDING SERVICE
 * ========================================
 * 
 * Handles all embedding operations:
 * - Text chunks (questionnaire data)
 * - Documents (PDF/DOCX parsing → embeddings)
 * - Images (OCR text extraction → embeddings)
 * 
 * Cost Optimization:
 * - Uses FREE local parsers (pdf-parse, mammoth, tesseract)
 * - Only pays for OpenAI embedding API calls (not parsing)
*/

export interface EmbeddingResult {
  embedding: number[];      // The vector (1536 numbers)
  text: string;            // Original text that was embedded
  chunkIndex?: number;     // For tracking chunks
  sourceType: 'text' | 'document' | 'image';
  metadata?: Record<string, any>;
}

export class EmbeddingService {
  
  // Chunking configuration
  private readonly CHUNK_SIZE = 500;      // Characters per chunk
  private readonly CHUNK_OVERLAP = 50;    // Overlap to preserve context
  
  /**
   * ========================================
   * 1. EMBED TEXT CHUNKS
   * ========================================
   * 
   * For questionnaire data (business name, description, FAQs, etc.)
   * 
   * @param texts - Array of text strings to embed
   * @returns Array of embeddings with metadata
  */

  async embedTexts(texts: string[]): Promise<EmbeddingResult[]> {
    try {
      if (texts.length === 0) {
        return [];
      }

      // Filter out empty strings
      const validTexts = texts.filter(text => text.trim().length > 0);
      
      if (validTexts.length === 0) {
        return [];
      }

      // Create embeddings via OpenAI
      const embeddings = await createEmbeddings(validTexts);

      // Map to result format
      const results: EmbeddingResult[] = embeddings.map((embedding, index) => ({
        embedding,
        text: validTexts[index],
        chunkIndex: index,
        sourceType: 'text',
      }));

      logger.info(`[Embedding] Created ${results.length} text embeddings`);

      return results;

    } catch (error: any) {
      logger.error('[Embedding] Text embedding failed:', {
        message: error.message,
        name: error.name,
        stack: error.stack
      });
      throw error;
    }
  }

  /**
   * ========================================
   * 2. EMBED DOCUMENT (PDF/DOCX)
   * ========================================
   * 
   * Process:
   * 1. Download file from URL
   * 2. Parse to extract text (FREE local parsing)
   * 3. Chunk the text
   * 4. Create embeddings (only API cost)
   * 
   * @param fileUrl - URL to document (S3, Cloudinary, etc.)
   * @param fileName - Original filename (for type detection)
   * @returns Array of embeddings from document chunks
  */

  async embedDocument(fileUrl: string, fileName: string): Promise<EmbeddingResult[]> {
    try {
      logger.info(`[Embedding] Processing document: ${fileName}`);

      // 1. Download file
      const fileBuffer = await this.downloadFile(fileUrl);

      // 2. Parse based on file type
      let extractedText: string;
      const fileTypeResult = await fileTypeFromBuffer(fileBuffer);

      if (fileTypeResult?.mime === 'application/pdf') {
        extractedText = await this.parsePDF(fileBuffer);
      } else if (fileTypeResult?.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        extractedText = await this.parseDOCX(fileBuffer);
      } else {
        throw new Error(`Unsupported file type: ${fileTypeResult?.mime || 'unknown'}`);
      }

      // 3. Chunk the text
      const chunks = this.chunkText(extractedText);

      logger.info(`[Embedding] Extracted ${extractedText.length} chars, created ${chunks.length} chunks`);

      // 4. Create embeddings
      const embeddings = await createEmbeddings(chunks);

      // 5. Map to result format
      const results: EmbeddingResult[] = embeddings.map((embedding, index) => ({
        embedding,
        text: chunks[index],
        chunkIndex: index,
        sourceType: 'document',
        metadata: {
          fileName,
          fileUrl,
          totalChunks: chunks.length,
        }
      }));

      logger.info(`[Embedding] Created ${results.length} document embeddings for: ${fileName}`);

      return results;

    } catch (error: any) {
      logger.error(`[Embedding] Document embedding failed for ${fileName}:`, error.message);
      throw error;
    }
  }

  /**
   * ========================================
   * 3. EMBED IMAGE (OCR)
   * ========================================
   * 
   * Process:
   * 1. Download image from URL
   * 2. Extract text using Tesseract OCR (FREE)
   * 3. Create embedding from extracted text
   * 
   * Note: For PRO+ tier, you can upgrade to OpenAI Vision API
   * for better understanding of visual content (not just text)
   * 
   * @param imageUrl - URL to image
   * @param fileName - Original filename
   * @returns Embedding result with OCR text
  */

  async embedImage(imageUrl: string, fileName: string): Promise<EmbeddingResult> {
    try {
      logger.info(`[Embedding] Processing image: ${fileName}`);

      // 1. Download image
      const imageBuffer = await this.downloadFile(imageUrl);

      // 2. Extract text using OCR
      const extractedText = await this.extractTextFromImage(imageBuffer);

      // Handle empty OCR results
      if (!extractedText || extractedText.trim().length === 0) {
        logger.warn(`[Embedding] No text found in image: ${fileName}`);
        // Return a placeholder embedding or skip
        return {
          embedding: [],
          text: '',
          sourceType: 'image',
          metadata: {
            fileName,
            imageUrl,
            ocrSuccess: false,
            message: 'No text detected in image'
          }
        };
      }

      // 3. Create embedding
      const embeddings = await createEmbeddings([extractedText]);

      const result: EmbeddingResult = {
        embedding: embeddings[0],
        text: extractedText,
        sourceType: 'image',
        metadata: {
          fileName,
          imageUrl,
          ocrSuccess: true,
          textLength: extractedText.length,
        }
      };

      logger.info(`[Embedding] Created image embedding for: ${fileName} (${extractedText.length} chars extracted)`);

      return result;

    } catch (error: any) {
      logger.error(`[Embedding] Image embedding failed for ${fileName}:`, error.message);
      throw error;
    }
  }

  /**
   * ========================================
   * PRIVATE HELPERS
   * ========================================
  */

  /**
   * Download file from URL
  */
 
  private async downloadFile(url: string, retries = 3): Promise<Buffer> {
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        const response = await axios.get(url, {
          responseType: 'arraybuffer',
          timeout: 30000,
        });
        return Buffer.from(response.data);
      } catch (error) {
        if (attempt === retries) throw error;
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
    throw new Error('Max retries exceeded');
  }

  /**
   * Parse PDF to extract text
   * Uses pdf-parse (FREE, local processing)
  */
  
  private async parsePDF(buffer: Buffer): Promise<string> {
    const pdfParse = require('pdf-parse');
    try {
      const data = await pdfParse(buffer);
      return data.text;

    } catch (error: any) {
      logger.error('[Embedding] PDF parsing failed:', error.message);
      throw new Error('Failed to parse PDF document');
    }
  }

  /**
   * Parse DOCX to extract text
   * Uses mammoth (FREE, local processing)
  */

  private async parseDOCX(buffer: Buffer): Promise<string> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      return result.value;

    } catch (error: any) {
      logger.error('[Embedding] DOCX parsing failed:', error.message);
      throw new Error('Failed to parse DOCX document');
    }
  }

  /**
   * Extract text from image using OCR
   * Uses Tesseract.js (FREE, local processing)
  */

  private async extractTextFromImage(buffer: Buffer): Promise<string> {
    try {
      const worker = await Tesseract.createWorker('eng');
        
      const { data } = await worker.recognize(buffer);
      
      await worker.terminate();

      return data.text;

    } catch (error: any) {
      logger.error('[Embedding] OCR failed:', error.message);
      throw new Error('Failed to extract text from image');
    }
  }

  /**
   * Chunk text into smaller pieces
   * Prevents hitting token limits and improves search accuracy
   * 
   * @param text - Full text to chunk
   * @returns Array of text chunks
  */

  private chunkText(text: string): string[] {
    const chunks: string[] = [];
    
    // Clean text (remove excessive whitespace)
    const cleanedText = text.replace(/\s+/g, ' ').trim();

    // Handle empty text
    if (cleanedText.length === 0) {
      return [];
    }

    // If text is smaller than chunk size, return as-is
    if (cleanedText.length <= this.CHUNK_SIZE) {
      return [cleanedText];
    }

    // Split into chunks with overlap
    for (let i = 0; i < cleanedText.length; i += this.CHUNK_SIZE - this.CHUNK_OVERLAP) {
      const chunk = cleanedText.substring(i, i + this.CHUNK_SIZE);
      
      if (chunk.trim().length > 0) {
        chunks.push(chunk.trim());
      }
    }

    return chunks;
  }

  /**
   * ========================================
   * BATCH PROCESSING HELPER
   * ========================================
   * 
   * Process multiple documents/images in parallel (with limit)
   * Prevents overwhelming the system
  */

  async embedMultipleDocuments(
    documents: Array<{ fileUrl: string; fileName: string }>
  ): Promise<EmbeddingResult[]> {
    const BATCH_SIZE = 3; // Process 3 at a time
    const results: EmbeddingResult[] = [];

    for (let i = 0; i < documents.length; i += BATCH_SIZE) {
      const batch = documents.slice(i, i + BATCH_SIZE);
      
      const batchResults = await Promise.all(
        batch.map(doc => this.embedDocument(doc.fileUrl, doc.fileName))
      );

      // Flatten results (each document returns multiple chunks)
      results.push(...batchResults.flat());
    }

    return results;
  }

  async embedMultipleImages(
    images: Array<{ imageUrl: string; fileName: string }>
  ): Promise<EmbeddingResult[]> {
    const BATCH_SIZE = 5; // Process 5 at a time
    const results: EmbeddingResult[] = [];

    for (let i = 0; i < images.length; i += BATCH_SIZE) {
      const batch = images.slice(i, i + BATCH_SIZE);
      
      const batchResults = await Promise.all(
        batch.map(img => this.embedImage(img.imageUrl, img.fileName))
      );

      results.push(...batchResults);
    }

    return results;
  }
}

export const embeddingService = new EmbeddingService();