import Groq from 'groq-sdk';
import { env } from '../config/business.env';
import { createLogger } from '../utils/business.logger.utils';

const logger = createLogger('prefill-service');

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

const BUSINESS_TYPES = ['E-commerce', 'Real Estate', 'Restaurant', 'Hotel', 'Service-based', 'Tech/SaaS', 'Healthcare', 'Education', 'Other'];
const TONES = ['Friendly', 'Professional', 'Casual', 'Formal', 'Playful'];

export interface PrefillResult {
  businessDescription?: string;
  businessType?: string;
  offerings?: string;
  faqs?: Array<{ question: string; answer: string }>;
  refundPolicy?: string;
  chatbotTone?: string;
}

const MAX_INPUT_CHARS = 12000; // keep prompt + response comfortably inside context/token limits

/**
 * Extract plain text from an uploaded PDF or DOCX buffer. Deliberately a
 * small, self-contained duplicate of the parsing already done in
 * embedding.service.ts rather than a shared refactor - this pre-dates a
 * business existing at all (no businessId yet), so reusing that service's
 * URL-download-based flow would mean uploading the file to Cloudinary first
 * just to immediately re-download it. Keeping this separate avoids that
 * round-trip and avoids touching the working embedding pipeline.
 */
async function extractTextFromFile(buffer: Buffer, mimetype: string): Promise<string> {
  if (mimetype === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buffer);
    return data.text;
  }

  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  }

  throw new Error(`Unsupported file type: ${mimetype}`);
}

function buildExtractionPrompt(rawText: string): string {
  return `You are helping a business owner fill out a chatbot setup form. Below is raw text describing their business (could be website copy, a brochure, a menu, or a document). Extract what you can into the exact JSON shape below. Only include fields you're confident about from the text - omit anything not clearly supported rather than guessing or inventing details.

Return ONLY valid JSON, no markdown fences, no commentary. Shape:
{
  "businessDescription": "1-3 sentence overview of what the business does",
  "businessType": "one of: ${BUSINESS_TYPES.join(', ')}",
  "offerings": "description of products/services offered",
  "faqs": [{ "question": "...", "answer": "..." }],
  "refundPolicy": "refund/return policy if mentioned",
  "chatbotTone": "one of: ${TONES.join(', ')} - best guess based on the business's voice"
}

Include at most 5 faqs. If the text doesn't support a field, omit that key entirely. Do not extract individual product listings - just a general description of what's offered.

RAW TEXT:
"""
${rawText.slice(0, MAX_INPUT_CHARS)}
"""`;
}

function sanitizeResult(raw: any): PrefillResult {
  const result: PrefillResult = {};

  if (typeof raw.businessDescription === 'string') result.businessDescription = raw.businessDescription.slice(0, 500);
  if (BUSINESS_TYPES.includes(raw.businessType)) result.businessType = raw.businessType;
  if (typeof raw.offerings === 'string') result.offerings = raw.offerings.slice(0, 1000);
  if (typeof raw.refundPolicy === 'string') result.refundPolicy = raw.refundPolicy.slice(0, 500);
  if (TONES.includes(raw.chatbotTone)) result.chatbotTone = raw.chatbotTone;

  if (Array.isArray(raw.faqs)) {
    result.faqs = raw.faqs
      .slice(0, 5)
      .filter((f: any) => f && typeof f.question === 'string' && typeof f.answer === 'string')
      .map((f: any) => ({ question: f.question.slice(0, 200), answer: f.answer.slice(0, 500) }));
  }

  return result;
}

export class PrefillService {
  async generatePrefill(input: { rawText?: string; file?: { buffer: Buffer; mimetype: string } }): Promise<PrefillResult> {
    let text = input.rawText || '';

    if (input.file) {
      const extracted = await extractTextFromFile(input.file.buffer, input.file.mimetype);
      text = `${text}\n\n${extracted}`.trim();
    }

    if (!text || text.trim().length < 20) {
      throw new Error('Not enough text to work with - paste more detail or upload a longer document');
    }

    try {
      const completion = await groq.chat.completions.create({
        model: env.GROQ_MODEL,
        messages: [
          { role: 'system', content: 'You extract structured business information from raw text and respond with strict JSON only.' },
          { role: 'user', content: buildExtractionPrompt(text) },
        ],
        temperature: 0.3,
        max_tokens: 1200,
      });

      const raw = completion.choices[0]?.message?.content || '{}';
      const cleaned = raw.trim().replace(/^```json?\s*/i, '').replace(/```\s*$/, '');

      let parsed: any;
      try {
        parsed = JSON.parse(cleaned);
      } catch {
        logger.warn('Prefill LLM response was not valid JSON', { raw: cleaned.slice(0, 200) });
        throw new Error('Could not understand the document - try pasting the key details as plain text instead');
      }

      return sanitizeResult(parsed);
    } catch (error: any) {
      logger.error('Prefill generation failed', { error: error.message });
      throw error instanceof Error ? error : new Error('Failed to generate pre-fill suggestions');
    }
  }
}

export const prefillService = new PrefillService();
