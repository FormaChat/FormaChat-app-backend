import Groq from "groq-sdk";
import { 
  LLMProvider, 
  LLMGenerateRequest, 
  LLMResponse, 
  LLMMessage,
  LLMError,
  LLMRateLimitError,
  LLMAuthenticationError,
  LLMTimeoutError
} from '../llm.interface';
import { createLogger } from '../../../util/chat.logger.utils';

const logger = createLogger('groq-provider');

/**
 * ========================================
 * GROQ PROVIDER
 * ========================================
 * 
 * Implementation for Groq's LLM API
 * - Super fast inference (500+ tokens/sec)
 * - Free tier available
 * - Great for MVP testing
 */
export class GroqProvider implements LLMProvider {
  readonly name = 'groq';
  readonly model: string;
  private client: Groq;
  private temperature: number;
  private maxTokens: number;

  constructor(config: {
    apiKey: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  }) {
    if (!config.apiKey) {
      throw new Error('GROQ_API_KEY is required');
    }

    this.client = new Groq({
      apiKey: config.apiKey,
    });

    this.model = config.model || 'llama-3.3-70b-versatile';
    this.temperature = config.temperature ?? 0.7;
    this.maxTokens = config.maxTokens ?? 500;

    logger.info('[Groq] Provider initialized', {
      model: this.model,
      temperature: this.temperature,
      maxTokens: this.maxTokens
    });
  }

  /**
   * Generate chat response
   */
  async generateResponse(request: LLMGenerateRequest): Promise<LLMResponse> {
    const startTime = Date.now();

    try {
      // Build messages array
      const messages: Array<{ role: string; content: string }> = [];

      // 1. System prompt
      messages.push({
        role: 'system',
        content: request.systemPrompt
      });

      // 2. Conversation history (last 10 messages)
      if (request.conversationHistory && request.conversationHistory.length > 0) {
        const recentHistory = request.conversationHistory.slice(-10);
        messages.push(...recentHistory.map(msg => ({
          role: msg.role,
          content: msg.content
        })));
      }

      // 3. Current user message
      messages.push({
        role: 'user',
        content: request.userMessage
      });

      logger.debug('[Groq] Sending request', {
        model: this.model,
        messagesCount: messages.length,
        temperature: request.temperature ?? this.temperature,
        maxTokens: request.maxTokens ?? this.maxTokens
      });

      // Call Groq API
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: messages as any,
        temperature: request.temperature ?? this.temperature,
        max_tokens: request.maxTokens ?? this.maxTokens,
        stream: false,
      });

      const latency = Date.now() - startTime;

      // Extract response
      const responseText = completion.choices[0]?.message?.content || '';
      const finishReason = completion.choices[0]?.finish_reason || 'unknown';

      // Token usage
      const tokensUsed = {
        prompt: completion.usage?.prompt_tokens || 0,
        completion: completion.usage?.completion_tokens || 0,
        total: completion.usage?.total_tokens || 0
      };

      logger.info('[Groq] ✓ Response received', {
        model: completion.model,
        tokensUsed: tokensUsed.total,
        latency: `${latency}ms`,
        responseLength: responseText.length,
        finishReason
      });

      return {
        response: responseText,
        tokensUsed,
        latency,
        model: completion.model || this.model,
        provider: this.name,
        finishReason
      };

    } catch (error: any) {
      const latency = Date.now() - startTime;

      logger.error('[Groq] Request failed', {
        error: error.message,
        status: error.status,
        code: error.code,
        latency: `${latency}ms`
      });

      // Handle specific errors
      if (error.status === 401 || error.message?.includes('authentication')) {
        throw new LLMAuthenticationError('groq');
      }

      if (error.status === 429 || error.message?.includes('rate limit')) {
        const retryAfter = error.headers?.['retry-after'];
        throw new LLMRateLimitError('groq', retryAfter ? parseInt(retryAfter) : undefined);
      }

      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        throw new LLMTimeoutError('groq', 30000);
      }

      // Generic error
      throw new LLMError(
        error.message || 'Groq API request failed',
        'groq',
        error.status,
        error
      );
    }
  }

  /**
   * Generate streaming chat response
   */
  async *generateResponseStream(request: LLMGenerateRequest): AsyncGenerator<string> {
    try {
      // Build messages (same as above)
      const messages: Array<{ role: string; content: string }> = [];

      messages.push({
        role: 'system',
        content: request.systemPrompt
      });

      if (request.conversationHistory && request.conversationHistory.length > 0) {
        const recentHistory = request.conversationHistory.slice(-10);
        messages.push(...recentHistory.map(msg => ({
          role: msg.role,
          content: msg.content
        })));
      }

      messages.push({
        role: 'user',
        content: request.userMessage
      });

      // Call Groq API - STREAMING
      const stream = await this.client.chat.completions.create({
        model: this.model,
        messages: messages as any,
        temperature: request.temperature ?? this.temperature,
        max_tokens: request.maxTokens ?? this.maxTokens,
        stream: true, // ← Streaming enabled
      });

      // Yield chunks as they arrive
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          yield content;
        }
      }

    } catch (error: any) {
      logger.error('[Groq] Streaming failed', {
        error: error.message
      });
      throw new LLMError(
        error.message || 'Groq streaming failed',
        'groq',
        error.status,
        error
      );
    }
  }

  /**
   * Health check - verify Groq is accessible
   */
  async healthCheck(): Promise<boolean> {
    try {
      // Simple test request
      const completion = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: 'You are a test assistant.' },
          { role: 'user', content: 'Hello' }
        ],
        max_tokens: 5,
      });

      const success = !!completion.choices[0]?.message?.content;

      logger.debug('[Groq] Health check', { success });

      return success;

    } catch (error: any) {
      logger.error('[Groq] Health check failed', {
        error: error.message
      });
      return false;
    }
  }

  /**
   * Get provider info
   */
  getInfo() {
    return {
      name: this.name,
      model: this.model,
      apiUrl: 'https://api.groq.com/openai/v1'
    };
  }
}

export default GroqProvider;