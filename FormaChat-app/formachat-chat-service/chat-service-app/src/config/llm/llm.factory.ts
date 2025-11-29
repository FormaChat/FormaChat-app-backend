// provider selector

import { LLMProvider } from './llm.interface';
import { GroqProvider } from './providers/grok.provider';
import { env } from '../chat.env.config';
import { createLogger } from '../../utils/chat.logger.utils';

const logger = createLogger('llm-factory');

/**
 * ========================================
 * LLM FACTORY
 * ========================================
 * 
 * Automatically selects the correct LLM provider based on env variables
 * Switch providers by changing LLM_PROVIDER in .env
 * 
 * Supported providers:
 * - groq (active)
 * - gemini (future)
 * - claude (future)
 * - openai (future)
 */

type SupportedProvider = 'groq' | 'gemini' | 'claude' | 'openai';

/**
 * Provider configurations from environment
 */
const PROVIDER_CONFIGS = {
  groq: {
    apiKey: process.env.GROQ_API_KEY || '',
    model: process.env.GROQ_MODEL || 'llama-3.1-70b-versatile',
    temperature: parseFloat(process.env.GROQ_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.GROQ_MAX_TOKENS || '500'),
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    model: process.env.GEMINI_MODEL || 'gemini-pro',
    temperature: parseFloat(process.env.GEMINI_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.GEMINI_MAX_TOKENS || '500'),
  },
  claude: {
    apiKey: process.env.CLAUDE_API_KEY || '',
    model: process.env.CLAUDE_MODEL || 'claude-sonnet-4',
    temperature: parseFloat(process.env.CLAUDE_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.CLAUDE_MAX_TOKENS || '500'),
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE || '0.7'),
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '500'),
  },
};

/**
 * Singleton instance
 */
let cachedProvider: LLMProvider | null = null;

/**
 * Get the configured LLM provider
 * Returns singleton instance (creates once, reuses)
 */
export function getLLMProvider(): LLMProvider {
  // Return cached instance if exists
  if (cachedProvider) {
    return cachedProvider;
  }

  const provider = (env.LLM_PROVIDER).toLowerCase() as SupportedProvider;

  logger.info('[LLM Factory] Initializing provider', {
    provider,
    model: PROVIDER_CONFIGS[provider]?.model
  });

  // Validate provider is supported
  if (!['groq', 'gemini', 'claude', 'openai'].includes(provider)) {
    throw new Error(
      `Unsupported LLM provider: ${provider}. ` +
      `Supported providers: groq, gemini, claude, openai`
    );
  }

  // Get provider config
  const config = PROVIDER_CONFIGS[provider];

  if (!config.apiKey) {
    throw new Error(
      `Missing API key for provider: ${provider}. ` +
      `Please set ${provider.toUpperCase()}_API_KEY in environment variables.`
    );
  }

  // Create provider instance
  switch (provider) {
    case 'groq':
      cachedProvider = new GroqProvider(config);
      break;

    case 'gemini':
      throw new Error(
        'Gemini provider not yet implemented. ' +
        'To add support, create providers/gemini.provider.ts'
      );

    case 'claude':
      throw new Error(
        'Claude provider not yet implemented. ' +
        'To add support, create providers/claude.provider.ts'
      );

    case 'openai':
      throw new Error(
        'OpenAI provider not yet implemented. ' +
        'To add support, create providers/openai.provider.ts'
      );

    default:
      throw new Error(`Unknown provider: ${provider}`);
  }

  logger.info('[LLM Factory] ✓ Provider initialized', {
    provider: cachedProvider.name,
    model: cachedProvider.model
  });

  return cachedProvider;
}

/**
 * Reset cached provider (for testing)
 */
export function resetProvider(): void {
  cachedProvider = null;
  logger.debug('[LLM Factory] Provider cache reset');
}

/**
 * Get current provider name (without initializing)
 */
export function getCurrentProviderName(): string {
  return process.env.LLM_PROVIDER || 'groq';
}

/**
 * Check if provider is configured
 */
export function isProviderConfigured(provider: SupportedProvider): boolean {
  return !!PROVIDER_CONFIGS[provider]?.apiKey;
}

/**
 * Get list of configured providers
 */
export function getConfiguredProviders(): SupportedProvider[] {
  return Object.entries(PROVIDER_CONFIGS)
    .filter(([_, config]) => !!config.apiKey)
    .map(([name]) => name as SupportedProvider);
}

/**
 * Validate provider configuration
 */
export function validateProviderConfig(provider: SupportedProvider): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];
  const config = PROVIDER_CONFIGS[provider];

  if (!config) {
    errors.push(`Unknown provider: ${provider}`);
    return { valid: false, errors };
  }

  if (!config.apiKey) {
    errors.push(`Missing API key for ${provider}`);
  }

  if (!config.model) {
    errors.push(`Missing model for ${provider}`);
  }

  if (config.temperature < 0 || config.temperature > 2) {
    errors.push(`Invalid temperature for ${provider}: ${config.temperature} (must be 0-2)`);
  }

  if (config.maxTokens < 1) {
    errors.push(`Invalid maxTokens for ${provider}: ${config.maxTokens} (must be > 0)`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}

// Log current configuration on load (development only)
if (process.env.NODE_ENV === 'development') {
  const currentProvider = getCurrentProviderName();
  const configured = getConfiguredProviders();
  
  logger.info('\n🤖 LLM Configuration:');
  logger.info(`   Active Provider: ${currentProvider}`);
  logger.info(`   Configured Providers: ${configured.join(', ') || 'none'}`);
  logger.info(`   Model: ${PROVIDER_CONFIGS[currentProvider as SupportedProvider]?.model || 'unknown'}\n`);
}