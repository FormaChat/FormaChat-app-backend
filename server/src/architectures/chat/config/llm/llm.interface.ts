//shared types

/**
 * ========================================
 * LLM INTERFACE (Provider-Agnostic)
 * ========================================
 * 
 * Defines the contract that ALL LLM providers must implement
 * This allows switching between Groq, Gemini, Claude, OpenAI
 * by only changing environment variables
 */

/**
 * Message format (standardized across all providers)
 */
export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Request parameters for generating a response
 */
export interface LLMGenerateRequest {
  systemPrompt: string;              // Instructions for the LLM
  userMessage: string;               // Current user question
  conversationHistory?: LLMMessage[]; // Previous messages (last 10)
  temperature?: number;              // Creativity (0-1, default: 0.7)
  maxTokens?: number;                // Max response length (default: 500)
  businessContext?: string;          // Vector DB context (optional)
}

/**
 * Standardized response from any LLM provider
 */
export interface LLMResponse {
  response: string;           // Generated text
  tokensUsed: {
    prompt: number;           // Input tokens
    completion: number;       // Output tokens
    total: number;            // Total tokens
  };
  latency: number;            // Response time in milliseconds
  model: string;              // Which model was used
  provider: string;           // Which provider (groq, gemini, claude, openai)
  finishReason?: string;      // Why generation stopped (optional)
}

/**
 * Provider configuration
 */
export interface LLMProviderConfig {
  apiKey: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiUrl?: string;            // Custom API endpoint (optional)
}

/**
 * Main interface that all providers must implement
 */
export interface LLMProvider {
  readonly name: string;      // Provider name (groq, gemini, etc.)
  readonly model: string;     // Model being used
  
  /**
   * Generate a chat response
   */
  generateResponse(request: LLMGenerateRequest): Promise<LLMResponse>;
  // Add to LLMProvider interface
  generateResponseStream(request: LLMGenerateRequest): AsyncGenerator<string>;
  /**
   * Health check - verify provider is accessible
   */
  healthCheck(): Promise<boolean>;
  
  /**
   * Get provider info (for debugging/monitoring)
   */
  getInfo(): {
    name: string;
    model: string;
    apiUrl?: string;
  };
}

/**
 * Error types for better error handling
 */
export class LLMError extends Error {
  constructor(
    message: string,
    public provider: string,
    public statusCode?: number,
    public originalError?: any
  ) {
    super(message);
    this.name = 'LLMError';
  }
}

export class LLMRateLimitError extends LLMError {
  constructor(provider: string, retryAfter?: number) {
    super(
      `Rate limit exceeded for ${provider}${retryAfter ? `. Retry after ${retryAfter}s` : ''}`,
      provider
    );
    this.name = 'LLMRateLimitError';
  }
}

export class LLMAuthenticationError extends LLMError {
  constructor(provider: string) {
    super(`Authentication failed for ${provider}. Check API key.`, provider);
    this.name = 'LLMAuthenticationError';
  }
}

export class LLMTimeoutError extends LLMError {
  constructor(provider: string, timeout: number) {
    super(`Request to ${provider} timed out after ${timeout}ms`, provider);
    this.name = 'LLMTimeoutError';
  }
}