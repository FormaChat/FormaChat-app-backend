import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { publishLeadCaptured, publishSessionStarted, publishSessionEnded, publishMessageSent } from '../config/chat.rabbitmq';
import { webhookService } from '../../business/services/webhook.service';
import { productService } from '../../business/services/product.service';
import { ChatSession, ChatMessage, ContactLead } from '../model/chat.model';
import { createLogger } from '../util/chat.logger.utils';
import { checkDailyLimit, incrementSessionCount } from '../config/chat.redis.config';
import { searchBusiness } from '../config/chat.pinecone.config';
import { getLLMProvider } from '../config/llm/llm.factory';
import {
  buildSystemPrompt,
  buildHighIntentPrompt,
  buildContactExtractionPrompt,
  buildConversationSummaryPrompt,
  ChatbotTone,
  isValidTone,
  getDefaultTone
} from '../config/llm/llm.prompts';
import { env } from '../config/chat.env.config';

const logger = createLogger('chat-service');

export class ChatService {

  async createSession(params: {
    businessId: string;
    visitorId?: string;
    metadata?: {
      userAgent?: string;
      ipAddress?: string;
      referrer?: string;
    };
  }): Promise<{
    success: boolean;
    sessionId?: string;
    visitorId?: string;
    businessInfo?: any;
    error?: string;
    reason?: string;
  }> {
    const startTime = Date.now();

    try {
      const { businessId, visitorId, metadata } = params;

      logger.info('[Session] Creating new session', { businessId });

      // 1. Check if business exists and is active (via Business Service API)
      const accessCheck = await this.checkBusinessAccess(businessId);

      if (!accessCheck.allowed) {
        logger.warn('[Session] Business access denied', {
          businessId,
          reason: accessCheck.reason
        });

        return {
          success: false,
          error: 'BUSINESS_NOT_AVAILABLE',
          reason: accessCheck.reason
        };
      }

      const config = accessCheck.config!;

      // 2. Check daily session limit (Redis)
      const limitCheck = await checkDailyLimit(businessId);

      if (limitCheck.limitExceeded) {
        logger.warn('[Session] Daily limit exceeded', {
          businessId,
          currentCount: limitCheck.currentCount,
          maxLimit: limitCheck.maxLimit
        });

        return {
          success: false,
          error: 'DAILY_LIMIT_EXCEEDED',
          reason: `Daily session limit reached (${limitCheck.currentCount}/${limitCheck.maxLimit}). Resets at ${limitCheck.resetsAt}`
        };
      }

      // 3. Generate IDs
      const sessionId = uuidv4();
      const generatedVisitorId = visitorId || `visitor_${uuidv4()}`;

      // 4. Create session in MongoDB
      const session = new ChatSession({
        sessionId,
        businessId,
        businessOwnerEmail: config.businessOwnerEmail,
        businessName: config.businessName,
        visitorId: generatedVisitorId,
        status: 'active',
        startedAt: new Date(),
        lastMessageAt: new Date(),
        messageCount: 0,
        userMessageCount: 0,
        botMessageCount: 0,
        contact: {
          captured: false
        },
        hasUnreadMessages: false,
        isStarred: false,
        tags: [],
        userAgent: metadata?.userAgent,
        ipAddress: metadata?.ipAddress,
        referrer: metadata?.referrer
      });

      await session.save();
      publishSessionStarted({ businessId, sessionId, visitorId: generatedVisitorId });
      webhookService.triggerEvent(businessId, 'session.started', { sessionId, visitorId: generatedVisitorId }).catch(() => {});

      // 5. Increment Redis session counter
      await incrementSessionCount(businessId);

      const duration = Date.now() - startTime;

      logger.info('[Session] ✓ Session created', {
        sessionId,
        businessId,
        visitorId: generatedVisitorId,
        duration: `${duration}ms`
      });

      return {
        success: true,
        sessionId,
        visitorId: generatedVisitorId,
        businessInfo: {
          businessName: config.businessName,
          chatbotGreeting: config.chatbotGreeting,
          chatbotTone: config.chatbotTone
        }
      };

    } catch (error: any) {
      logger.error('[Session] Creation failed', {
        message: error.message,
        businessId: params.businessId
      });

      return {
        success: false,
        error: 'SESSION_CREATION_FAILED',
        reason: error.message
      };
    }
  }

  
  async getSession(sessionId: string): Promise<{
    success: boolean;
    session?: any;
    error?: string;
  }> {
    try {
      const session = await ChatSession.findOne({ sessionId });

      if (!session) {
        return {
          success: false,
          error: 'SESSION_NOT_FOUND'
        };
      }

      logger.debug('[Session] Retrieved', { sessionId });

      return {
        success: true,
        session: {
          sessionId: session.sessionId,
          businessId: session.businessId,
          status: session.status,
          messageCount: session.messageCount,
          contactCaptured: session.contact.captured,
          contact: session.contact.captured ? {
            email: session.contact.email,
            phone: session.contact.phone,
            name: session.contact.name
          } : null
        }
      };

    } catch (error: any) {
      logger.error('[Session] Retrieval failed', {
        message: error.message,
        sessionId
      });

      return {
        success: false,
        error: 'SESSION_RETRIEVAL_FAILED'
      };
    }
  }

  /**
   * End a chat session
   * Called when user explicitly closes chat or after 30 mins inactivity
   */
  async endSession(sessionId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const session = await ChatSession.findOne({ sessionId });

      if (!session) {
        return { success: false, error: 'SESSION_NOT_FOUND' };
      }

      // Calculate duration
      const duration = Date.now() - session.startedAt.getTime();

      session.status = 'ended';
      session.endedAt = new Date();
      await session.save();
      publishSessionEnded({ businessId: session.businessId, sessionId, messageCount: session.messageCount, durationMs: duration });
      webhookService.triggerEvent(session.businessId, 'session.ended', {
        sessionId,
        messageCount: session.messageCount,
        durationMs: duration,
      }).catch(() => {});

      logger.info('[Session] Ended', {
        sessionId,
        duration: `${Math.round(duration / 1000)}s`,
        messageCount: session.messageCount,
        contactCaptured: session.contact.captured
      });

      return { success: true };

    } catch (error: any) {
      logger.error('[Session] End failed', {
        message: error.message,
        sessionId
      });

      return { success: false, error: 'SESSION_END_FAILED' };
    }
  }

  async sendMessage(params: {
    sessionId: string;
    userMessage: string;
  }): Promise<{
    success: boolean;
    message?: {
      role: string;
      content: string;
      timestamp: Date;
    };
    contactCaptured?: boolean;
    products?: Array<{ id: string; name: string; price: number; stockQuantity: number; imageUrl?: string }>;
    error?: string;
  }> {
    const startTime = Date.now();

    try {
      const { sessionId, userMessage } = params;

      logger.info('[Message] Processing user message', {
        sessionId,
        messageLength: userMessage.length
      });

      // 1. Validate session
      const session = await ChatSession.findOne({ sessionId });

      if (!session) {
        return { success: false, error: 'SESSION_NOT_FOUND' };
      }

      if (session.status === 'ended') {
        return { 
          success: false, 
          error: 'SESSION_ENDED'
        };
      }

      if (session.status === 'abandoned') {
        logger.info('[Message] Reactivating abandoned session', { sessionId });
        session.status = 'active';
      }

      // 2. Check if business is still active (via Business Service API)
      const accessCheck = await this.checkBusinessAccess(session.businessId);

      if (!accessCheck.allowed) {
        return {
          success: false,
          error: 'BUSINESS_NOT_AVAILABLE',
        };
      }

      const config = accessCheck.config!;

      const validTone: ChatbotTone = 
        config.chatbotTone && isValidTone(config.chatbotTone)
          ? config.chatbotTone
          : getDefaultTone();

      // 3. Store user message
      const userMsgDoc = new ChatMessage({
        sessionId,
        businessId: session.businessId,
        role: 'user',
        content: userMessage,
        timestamp: new Date()
      });

      await userMsgDoc.save();

      // Update session
      session.messageCount++;
      session.userMessageCount++;
      session.lastMessageAt = new Date();
      await session.save();

      // 4. Detect high intent
      const highIntent = this.detectHighIntent(userMessage);

      // 5. Fetch context from Pinecone
      const vectorSearch = await searchBusiness(
        session.businessId,
        userMessage,
        5
      );

      if (!vectorSearch.hasResults) {
        logger.warn('[Message] No vector results found', { sessionId, businessId: session.businessId });
      }

      // Confidence scoring — low if all results are below threshold
      const CONFIDENCE_THRESHOLD = 0.45;
      const maxScore = vectorSearch.results.reduce((max, r) => Math.max(max, r.score ?? 0), 0);
      const lowConfidence = vectorSearch.results.length > 0 && maxScore < CONFIDENCE_THRESHOLD;

      if (lowConfidence) {
        logger.info('[Message] Low confidence context', { sessionId, maxScore });
      }

      // 6. Build conversation history with rolling summary for long chats
      const { summary, history } = await this.buildHistoryWithSummary(sessionId, 10);

      const summaryInjection = summary
        ? `\nEARLIER CONVERSATION SUMMARY:\n${summary}\n`
        : '';

      // 7. Extract contact info using LLM (last 3 user messages)
      if (!session.contact.captured) {
        const recentUserMessages = await ChatMessage.find({ sessionId, role: 'user', deletedAt: null })
          .select('content')
          .sort({ timestamp: -1 })
          .limit(3);

        if (recentUserMessages.length > 0) {
          const extracted = await this.extractContactWithLLM(
            recentUserMessages.map(m => m.content).reverse()
          );
          if (extracted.hasContact) {
            await this.captureContactInfo(sessionId, extracted, config.webhookUrl);
          }
        }
      }

      // 8. Build system prompt
      const sharedPromptParams = {
        businessName: config.businessName,
        businessContext: vectorSearch.context + summaryInjection,
        chatbotTone: validTone,
        customInstructions: config.chatbotCustomInstructions,
        lowConfidence,
      };

      const systemPrompt = highIntent.hasHighIntent && !session.contact.captured
        ? buildHighIntentPrompt({
            ...sharedPromptParams,
            detectedIntent: highIntent.matchedKeywords,
          })
        : buildSystemPrompt({
            ...sharedPromptParams,
            chatbotGreeting: config.chatbotGreeting,
            chatbotRestrictions: config.chatbotRestrictions,
          });

      // 9. Call LLM
      const llm = getLLMProvider();

      const llmResponse = await llm.generateResponse({
        systemPrompt,
        userMessage,
        conversationHistory: history
      });

      // 10. Store bot response
      const botMsgDoc = new ChatMessage({
        sessionId,
        businessId: session.businessId,
        role: 'assistant',
        content: llmResponse.response,
        timestamp: new Date(),
        llmModel: llmResponse.model,
        tokens: llmResponse.tokensUsed,
        latency: llmResponse.latency,
        vectorsUsed: vectorSearch.results.map(r => ({
          chunkId: r.chunkId,
          relevanceScore: r.score,
          sourceType: r.sourceType as any
        }))
      });

      await botMsgDoc.save();

      // Update session
      session.messageCount++;
      session.botMessageCount++;
      session.lastMessageAt = new Date();
      await session.save();

      publishMessageSent({ businessId: session.businessId, sessionId, role: 'assistant', tokensUsed: llmResponse.tokensUsed.total });

      const totalDuration = Date.now() - startTime;

      logger.info('[Message] ✓ Response generated', {
        sessionId,
        tokensUsed: llmResponse.tokensUsed.total,
        duration: `${totalDuration}ms`,
        vectorResults: vectorSearch.results.length
      });

      const products = await this.getProductsFromSearch(session.businessId, vectorSearch.results);

      return {
        success: true,
        message: {
          role: 'assistant',
          content: llmResponse.response,
          timestamp: botMsgDoc.timestamp
        },
        contactCaptured: session.contact.captured,
        products
      };

    } catch (error: any) {
      logger.error('[Message] Processing failed', {
        message: error.message,
        sessionId: params.sessionId
      });

      return {
        success: false,
        error: 'MESSAGE_PROCESSING_FAILED'
      };
    }
  }

  /**
   * Looks up live stock/price in MongoDB for any product matches in a vector
   * search result, so the chat response never shows numbers stale relative
   * to the last Pinecone sync - MongoDB is always the source of truth.
   */
  private async getProductsFromSearch(
    businessId: string,
    results: Array<{ metadata: Record<string, any> }>
  ): Promise<Array<{ id: string; name: string; price: number; stockQuantity: number; imageUrl?: string }>> {
    try {
      const productIds = [...new Set(
        results
          .filter(r => r.metadata?.type === 'product' && r.metadata?.productId)
          .map(r => r.metadata.productId as string)
      )];

      if (productIds.length === 0) return [];

      const products = await productService.getProductsByIds(businessId, productIds);

      return products.map(p => ({
        id: String(p._id),
        name: p.name,
        price: p.price,
        stockQuantity: p.stockQuantity,
        imageUrl: p.imageUrl
      }));
    } catch (error: any) {
      logger.warn('[Message] Failed to attach live product data', { businessId, message: error.message });
      return [];
    }
  }

  async *sendMessageStream(params: {
    sessionId: string;
    userMessage: string;
  }): AsyncGenerator<string> {
    try {
      const { sessionId, userMessage } = params;

      // 1. Validate session (same as sendMessage)
      const session = await ChatSession.findOne({ sessionId });
      if (!session) throw new Error('SESSION_NOT_FOUND');
      if (session.status === 'ended') throw new Error('SESSION_ENDED');
      if (session.status === 'abandoned') {
        session.status = 'active';
      }

      // 2. Check business access
      const accessCheck = await this.checkBusinessAccess(session.businessId);
      if (!accessCheck.allowed) throw new Error('BUSINESS_NOT_AVAILABLE');
      const config = accessCheck.config!;

      const validTone: ChatbotTone = 
        config.chatbotTone && isValidTone(config.chatbotTone)
          ? config.chatbotTone
          : getDefaultTone();

      // 3. Store user message
      const userMsgDoc = new ChatMessage({
        sessionId,
        businessId: session.businessId,
        role: 'user',
        content: userMessage,
        timestamp: new Date()
      });
      await userMsgDoc.save();

      session.messageCount++;
      session.userMessageCount++;
      session.lastMessageAt = new Date();
      await session.save();

      // 4. Detect intent + fetch context
      const highIntent = this.detectHighIntent(userMessage);
      const vectorSearch = await searchBusiness(session.businessId, userMessage, 5);

      const CONFIDENCE_THRESHOLD = 0.45;
      const maxScore = vectorSearch.results.reduce((max, r) => Math.max(max, r.score ?? 0), 0);
      const lowConfidence = vectorSearch.results.length > 0 && maxScore < CONFIDENCE_THRESHOLD;

      // Extract contact via LLM (best-effort, non-blocking for stream)
      if (!session.contact.captured) {
        const recentUserMessages = await ChatMessage.find({ sessionId, role: 'user', deletedAt: null })
          .select('content').sort({ timestamp: -1 }).limit(3);
        if (recentUserMessages.length > 0) {
          this.extractContactWithLLM(recentUserMessages.map(m => m.content).reverse())
            .then(extracted => {
              if (extracted.hasContact) {
                this.captureContactInfo(sessionId, extracted, config.webhookUrl).catch(() => {});
              }
            })
            .catch(() => {});
        }
      }

      // 5. Build history + prompt
      const { summary, history } = await this.buildHistoryWithSummary(sessionId, 10);
      const summaryInjection = summary ? `\nEARLIER CONVERSATION SUMMARY:\n${summary}\n` : '';

      const sharedParams = {
        businessName: config.businessName,
        businessContext: vectorSearch.context + summaryInjection,
        chatbotTone: validTone,
        customInstructions: config.chatbotCustomInstructions,
        lowConfidence,
      };

      const systemPrompt = highIntent.hasHighIntent && !session.contact.captured
        ? buildHighIntentPrompt({ ...sharedParams, detectedIntent: highIntent.matchedKeywords })
        : buildSystemPrompt({ ...sharedParams, chatbotGreeting: config.chatbotGreeting, chatbotRestrictions: config.chatbotRestrictions });

      // 8. Stream LLM response
      const llm = getLLMProvider();
      let fullResponse = '';

      for await (const chunk of llm.generateResponseStream({
        systemPrompt,
        userMessage,
        conversationHistory: history
      })) {
        fullResponse += chunk;
        yield chunk; // Stream to client
      }

      // 9. Store complete bot response after streaming
      const botMsgDoc = new ChatMessage({
        sessionId,
        businessId: session.businessId,
        role: 'assistant',
        content: fullResponse,
        timestamp: new Date(),
        vectorsUsed: vectorSearch.results.map(r => ({
          chunkId: r.chunkId,
          relevanceScore: r.score,
          sourceType: r.sourceType as any
        }))
      });
      await botMsgDoc.save();

      session.messageCount++;
      session.botMessageCount++;
      session.lastMessageAt = new Date();
      await session.save();

    } catch (error: any) {
      logger.error('[Stream] Message streaming failed', {
        message: error.message,
        sessionId: params.sessionId
      });
      throw error;
    }
  }

  async getMessages(params: {
    sessionId: string;
    page?: number;
    limit?: number;
  }): Promise<{
    success: boolean;
    messages?: Array<{
      role: string;
      content: string;
      timestamp: Date;
    }>;
    pagination?: {
      page: number;
      limit: number;
      total: number;
      hasMore: boolean;
    };
    error?: string;
  }> {
    try {
      const { sessionId, page = 1, limit = 20 } = params;

      const skip = (page - 1) * limit;

      const [messages, total] = await Promise.all([
        ChatMessage.find({ sessionId, deletedAt: null })
          .select('role content timestamp')
          .sort({ timestamp: 1 }) // Oldest first
          .skip(skip)
          .limit(limit),
        ChatMessage.countDocuments({ sessionId, deletedAt: null })
      ]);

      return {
        success: true,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp
        })),
        pagination: {
          page,
          limit,
          total,
          hasMore: skip + messages.length < total
        }
      };

    } catch (error: any) {
      logger.error('[Messages] Retrieval failed', {
        message: error.message,
        sessionId: params.sessionId
      });

      return { success: false, error: 'MESSAGES_RETRIEVAL_FAILED' };
    }
  }

  private async extractContactWithLLM(recentMessages: string[]): Promise<{
    hasContact: boolean;
    email?: string;
    phone?: string;
    name?: string;
  }> {
    try {
      const llm = getLLMProvider();
      const prompt = buildContactExtractionPrompt(recentMessages);
      const result = await llm.generateResponse({
        systemPrompt: 'You are a data extraction assistant. Return only valid JSON.',
        userMessage: prompt,
        conversationHistory: []
      });

      const parsed = JSON.parse(result.response.trim());
      const hasContact = !!(parsed.email || parsed.phone);
      return {
        hasContact,
        email: parsed.email ?? undefined,
        phone: parsed.phone ?? undefined,
        name: parsed.name ?? undefined,
      };
    } catch {
      // Fall back to regex if LLM extraction fails
      const text = recentMessages.join(' ');
      const emailMatch = text.match(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/);
      const phoneMatch = text.match(/\b(\+?\d{1,3}[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/);
      const nameMatch = text.match(/(?:my name is|i'm|i am)\s+([A-Za-z]+(?:\s+[A-Za-z]+)?)/i);
      return {
        hasContact: !!(emailMatch || phoneMatch),
        email: emailMatch?.[0],
        phone: phoneMatch?.[0],
        name: nameMatch?.[1],
      };
    }
  }

  private async buildHistoryWithSummary(
    sessionId: string,
    limit: number = 10
  ): Promise<{ summary?: string; history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> }> {
    const allMessages = await ChatMessage.find({ sessionId, deletedAt: null })
      .select('role content')
      .sort({ timestamp: 1 });

    if (allMessages.length <= limit) {
      return {
        history: allMessages.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }))
      };
    }

    // Summarize the early portion, keep the tail as verbatim history
    const tailStart = allMessages.length - 6;
    const toSummarise = allMessages.slice(0, tailStart);
    const tail = allMessages.slice(tailStart);

    try {
      const llm = getLLMProvider();
      const summaryPrompt = buildConversationSummaryPrompt(
        toSummarise.map(m => ({ role: m.role, content: m.content }))
      );
      const summaryResult = await llm.generateResponse({
        systemPrompt: 'You summarize conversations concisely.',
        userMessage: summaryPrompt,
        conversationHistory: []
      });

      return {
        summary: summaryResult.response.trim(),
        history: tail.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }))
      };
    } catch {
      return {
        history: tail.map(m => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }))
      };
    }
  }

  private detectHighIntent(message: string): {
    hasHighIntent: boolean;
    matchedKeywords: string[];
  } {
    const highIntentKeywords = [
      'price', 'cost', 'pricing', 'buy', 'purchase', 'order',
      'book', 'reserve', 'schedule', 'appointment',
      'available', 'availability', 'in stock',
      'deliver', 'delivery', 'shipping', 'ship',
      'contact', 'call me', 'email me', 'reach out'
    ];

    const lowerMessage = message.toLowerCase();
    const matched = highIntentKeywords.filter(keyword =>
      lowerMessage.includes(keyword)
    );

    return {
      hasHighIntent: matched.length > 0,
      matchedKeywords: matched
    };
  }

  private async captureContactInfo(
    sessionId: string,
    contactData: { email?: string; phone?: string; name?: string },
    webhookUrl?: string
  ): Promise<void> {
    try {
      // 1. Update ChatSession
      const session = await ChatSession.findOneAndUpdate(
        { sessionId },
        {
          'contact.captured': true,
          'contact.email': contactData.email,
          'contact.phone': contactData.phone,
          'contact.name': contactData.name,
          'contact.capturedAt': new Date()
        },
        { new: true }
      );

      if (!session) {
        throw new Error('Session not found');
      }

      // 2. Upsert into ContactLead (deduplicated)
      const leadData: any = {
        businessId: session.businessId,
        lastSessionId: sessionId,
        lastContactDate: new Date()
      };

      if (contactData.email) leadData.email = contactData.email;
      if (contactData.phone) leadData.phone = contactData.phone;
      if (contactData.name) leadData.name = contactData.name;

      const existingLead = await ContactLead.findOne({
        businessId: session.businessId,
        email: contactData.email
      });

      if (existingLead) {
        // Update existing lead
        existingLead.lastSessionId = sessionId;
        existingLead.lastContactDate = new Date();
        existingLead.totalSessions++;
        if (contactData.phone) existingLead.phone = contactData.phone;
        if (contactData.name) existingLead.name = contactData.name;
        await existingLead.save();

        logger.info('[Contact] Lead updated', {
          sessionId,
          email: contactData.email,
          totalSessions: existingLead.totalSessions
        });
      } else {
        // Create new lead
        const newLead = new ContactLead({
          ...leadData,
          firstSessionId: sessionId,
          firstContactDate: new Date(),
          totalSessions: 1,
          totalMessages: session.messageCount,
          status: 'new',
          isStarred: false,
          tags: []
        });

        await newLead.save();

        logger.info('[Contact] New lead captured', {
          sessionId,
          email: contactData.email
        });

        // Legacy: fire unsigned webhook to the simple `webhookUrl` wizard field
        // (best-effort). Kept for backward compatibility - businesses that
        // never created a real Webhook record still get this.
        if (webhookUrl) {
          axios.post(webhookUrl, {
            event: 'lead.captured',
            businessId: session.businessId,
            sessionId,
            lead: {
              name: contactData.name,
              email: contactData.email,
              phone: contactData.phone,
            },
            messageCount: session.messageCount,
            capturedAt: new Date().toISOString(),
          }, { timeout: 5000 }).catch(() => {/* best-effort */});
        }

        // New: signed, retried, logged delivery to any properly-registered
        // Webhook records for this business (see Webhooks dashboard).
        webhookService.triggerEvent(session.businessId, 'lead.captured', {
          sessionId,
          lead: {
            name: contactData.name,
            email: contactData.email,
            phone: contactData.phone,
          },
          messageCount: session.messageCount,
          capturedAt: new Date().toISOString(),
        }).catch(() => {});

        // Notify the business owner via email (best-effort, non-blocking)
        if (session.businessOwnerEmail) {
          publishLeadCaptured({
            businessId: session.businessId,
            businessOwnerEmail: session.businessOwnerEmail,
            businessName: session.businessName || session.businessId,
            leadName: contactData.name,
            leadEmail: contactData.email,
            leadPhone: contactData.phone,
            sessionId,
            messageCount: session.messageCount,
            capturedAt: new Date(),
          }).catch(() => { /* best-effort */ });
        }
      }

    } catch (error: any) {
      logger.error('[Contact] Capture failed', {
        message: error.message,
        sessionId
      });
    }
  }

  private async getConversationHistory(
    sessionId: string,
    limit: number = 10
  ): Promise<Array<{ role: 'user' | 'assistant' | 'system'; content: string }>> {
    try {
      const messages = await ChatMessage.find({
        sessionId,
        deletedAt: null,
        role: { $in: ['user', 'assistant'] }
      })
        .select('role content')
        .sort({ timestamp: -1 })
        .limit(limit);

      // Reverse to get chronological order
      return messages.reverse().map(m => ({
        role: m.role as any,
        content: m.content
      }));

    } catch (error: any) {
      logger.error('[History] Retrieval failed', {
        message: error.message,
        sessionId
      });
      return [];
    }
  }

  async getSessionsForBusiness(params: {
    businessId: string;
    filters?: {
      status?: 'active' | 'ended' | 'abandoned';
      contactCaptured?: boolean;
      startDate?: Date;
      endDate?: Date;
    };
    page?: number;
    limit?: number;
  }): Promise<{
    success: boolean;
    sessions?: any[];
    pagination?: any;
    error?: string;
  }> {
    try {
      const { businessId, filters = {}, page = 1, limit = 20 } = params;

      const skip = (page - 1) * limit;

      // Build query
      const query: any = { businessId, deletedAt: null };

      if (filters.status) query.status = filters.status;
      if (filters.contactCaptured !== undefined) {
        query['contact.captured'] = filters.contactCaptured;
      }
      if (filters.startDate || filters.endDate) {
        query.startedAt = {};
        if (filters.startDate) query.startedAt.$gte = filters.startDate;
        if (filters.endDate) query.startedAt.$lte = filters.endDate;
      }

      const [sessions, total] = await Promise.all([
        ChatSession.find(query)
          .select('sessionId contact status startedAt messageCount')
          .sort({ startedAt: -1 })
          .skip(skip)
          .limit(limit),
        ChatSession.countDocuments(query)
      ]);

      return {
        success: true,
        sessions: sessions.map(s => ({
          sessionId: s.sessionId,
          contact: s.contact.captured ? {
            email: s.contact.email,
            phone: s.contact.phone,
            name: s.contact.name
          } : null,
          status: s.status,
          startedAt: s.startedAt,
          messageCount: s.messageCount
        })),
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };

    } catch (error: any) {
      logger.error('[Dashboard] Sessions retrieval failed', {
        message: error.message,
        businessId: params.businessId
      });

      return { success: false, error: 'SESSIONS_RETRIEVAL_FAILED' };
    }
  }

  async getLeadsForBusiness(params: {
    businessId: string;
    filters?: {
      status?: string;
      startDate?: Date;
      endDate?: Date;
    };
    page?: number;
    limit?: number;
  }): Promise<{
    success: boolean;
    leads?: any[];
    pagination?: any;
    error?: string;
  }> {
    try {
      const { businessId, filters = {}, page = 1, limit = 50 } = params;

      const skip = (page - 1) * limit;

      const query: any = { businessId };

      if (filters.status) query.status = filters.status;
      if (filters.startDate || filters.endDate) {
        query.createdAt = {};
        if (filters.startDate) query.createdAt.$gte = filters.startDate;
        if (filters.endDate) query.createdAt.$lte = filters.endDate;
      }

      const [leads, total] = await Promise.all([
        ContactLead.find(query)
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
        ContactLead.countDocuments(query)
      ]);

      return {
        success: true,
        leads,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit)
        }
      };

    } catch (error: any) {
      logger.error('[Dashboard] Leads retrieval failed', {
        message: error.message,
        businessId: params.businessId
      });

      return { success: false, error: 'LEADS_RETRIEVAL_FAILED' };
    }
  }

  async getSessionDetails(sessionId: string, businessId: string): Promise<{
    success: boolean;
    session?: any;
    messages?: any[];
    error?: string;
  }> {
    try {
      const session = await ChatSession.findOne({ sessionId, businessId, deletedAt: null });

      if (!session) {
        return { success: false, error: 'SESSION_NOT_FOUND' };
      }

      const messages = await ChatMessage.find({
        sessionId,
        deletedAt: null
      })
        .select('role content timestamp')
        .sort({ timestamp: 1 });

      // Mark as read
      if (session.hasUnreadMessages) {
        session.hasUnreadMessages = false;
        await session.save();
      }

      return {
        success: true,
        session: {
          sessionId: session.sessionId,
          contact: session.contact,
          status: session.status,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          messageCount: session.messageCount
        },
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
          timestamp: m.timestamp
        }))
      };

    } catch (error: any) {
      logger.error('[Dashboard] Session details retrieval failed', {
        message: error.message,
        sessionId
      });

      return { success: false, error: 'SESSION_DETAILS_RETRIEVAL_FAILED' };
    }
  }

  private async checkBusinessAccess(businessId: string): Promise<{
    allowed: boolean;
    config?: {
      namespace: string;
      businessOwnerEmail: string;
      businessName: string;
      businessDescription: string;
      chatbotTone?: string;
      chatbotGreeting?: string;
      chatbotRestrictions?: string;
      chatbotCustomInstructions?: string;
      webhookUrl?: string;
      escalationContact: any;
    };
    reason?: string;
  }> {
    try {
      // Call Business Service internal endpoint
      const response = await axios.get(
        `${env.BUSINESS_SERVICE_URL}/api/v1/internal/businesses/${businessId}/chat-config`,
        {
          headers: {
            'x-service-token': env.INTERNAL_SERVICE_SECRET
          },
          timeout: 5000
        }
      );

      const { success, data, error } = response.data;

      if (!success) {
        logger.warn('[Access] Business access denied', {
          businessId,
          reason: error?.message
        });

        return {
          allowed: false,
          reason: error?.message || 'Business not available'
        };
      }

      logger.info('[Access] ✓ Business access granted', {
        businessId,
        businessName: data.config.businessName
      });

      return {
        allowed: true,
        config: data.config
      };

    } catch (error: any) {
      logger.error('[Access] Business service call failed', {
        message: error.message,
        businessId,
        status: error.response?.status
      });

      return {
        allowed: false,
        reason: 'Unable to verify business access'
      };
    }
  }

  async softDeleteSession(params: {
    sessionId: string;
    businessId: string;
  }): Promise<{
    success: boolean;
    error?: string;
    message?: string;
    metadata?: any;
  }> {
    try {
      const {sessionId, businessId} = params;

      const session = await ChatSession.findOne({sessionId, businessId});

      if (!session) {
        return {
          success: false,
          error: 'SESSION_NOT_FOUND'
        };
      }

      if (session.deletedAt) {
        return {
          success: false,
          error: 'SESSION_ALREADY_DELETED'
        };
      }

      if (session.contact.captured) {
        return {
          success: false,
          error: 'SESSION_HAS_LEADS',
          metadata: {
            contactInfo: session.contact
          }
        }
      }

      session.deletedAt = new Date();
      await session.save();

      logger.info('[Session] Soft deleted', {
        sessionId,
        businessId,
        messageCount: session.messageCount,
        contactCaptured: session.contact.captured
      });

      return {
        success: true,
        message: 'Session deleted successfully'
      };

    } catch (error: any) {
      logger.error('[Session] Soft delete failed', {
        message: error.message,
        sessionId: params.sessionId
      });

      return {
        success: false,
        error: 'SESSION_DELETE_FAILED'
      };
    }
  }

 
  // Cron Jobs

  async markAbandonedSessions(): Promise<{
    success: boolean;
    abandonedCount: number;
    endedCount: number;
  }> {
    try {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

      // 1. Mark sessions as 'abandoned' after 2 hours
      const abandonedResult = await ChatSession.updateMany(
        {
          status: 'active',
          lastMessageAt: { $lt: twoHoursAgo, $gte: twentyFourHoursAgo }
        },
        {
          status: 'abandoned'
        }
      );

      // 2. Mark sessions as 'ended' after 24 hours
      const endedResult = await ChatSession.updateMany(
        {
          status: { $in: ['active', 'abandoned'] },
          lastMessageAt: { $lt: twentyFourHoursAgo }
        },
        {
          status: 'ended',
          endedAt: new Date()
        }
      );

      logger.info('[Cleanup] Sessions processed', {
        abandoned: abandonedResult.modifiedCount,
        ended: endedResult.modifiedCount
      });

      return {
        success: true,
        abandonedCount: abandonedResult.modifiedCount || 0,
        endedCount: endedResult.modifiedCount || 0
      };

    } catch (error: any) {
      logger.error('[Cleanup] Session marking failed', {
        message: error.message
      });

      return {
        success: false,
        abandonedCount: 0,
        endedCount: 0
      };
    }
  }

   async permanentlyDeleteSessions(): Promise<{
    success: boolean;
    deletedCount: number;
    skippedCount: number;
  }> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      // Find sessions eligible for permanent deletion
      const sessionsToDelete = await ChatSession.find({
        deletedAt: { $ne: null, $lt: sevenDaysAgo },  // Soft-deleted 7+ days ago
        'contact.captured': false                      // No lead captured
      });

      let deletedCount = 0;
      let skippedCount = 0;

      for (const session of sessionsToDelete) {
        // SAFETY CHECK: Double-verify no ContactLead references this session
        const hasLinkedLead = await ContactLead.findOne({
          $or: [
            { firstSessionId: session.sessionId },
            { lastSessionId: session.sessionId }
          ]
        });

        if (hasLinkedLead) {
          // CRITICAL: Skip deletion if lead exists (safety net)
          logger.warn('[Cleanup] Skipping deletion - lead found', {
            sessionId: session.sessionId,
            leadEmail: hasLinkedLead.email
          });
          skippedCount++;
          continue;
        }

        // Safe to permanently delete
        await Promise.all([
          ChatSession.deleteOne({ sessionId: session.sessionId }),
          ChatMessage.deleteMany({ sessionId: session.sessionId })
        ]);

        logger.info('[Cleanup] Permanently deleted session', {
          sessionId: session.sessionId,
          messageCount: session.messageCount,
          deletedAt: session.deletedAt,
          daysSinceDeletion: session.deletedAt 
            ? Math.floor((Date.now() - session.deletedAt.getTime()) / (24 * 60 * 60 * 1000))
            : 0
        });

        deletedCount++;
      }

      logger.info('[Cleanup] Permanent deletion complete', {
        eligible: sessionsToDelete.length,
        deleted: deletedCount,
        skipped: skippedCount
      });

      return {
        success: true,
        deletedCount,
        skippedCount
      };

    } catch (error: any) {
      logger.error('[Cleanup] Permanent deletion failed', {
        message: error.message,
        stack: error.stack
      });

      return {
        success: false,
        deletedCount: 0,
        skippedCount: 0
      };
    }
  }

  /**
   * [TEST ONLY] Permanently delete sessions without grace period
   * Use this to test the deletion logic immediately
   */
  // async permanentlyDeleteSessionsNoGracePeriod(): Promise<{
  //   success: boolean;
  //   deletedCount: number;
  //   skippedCount: number;
  // }> {
  //   try {
  //     // NO grace period - delete immediately
  //     const sessionsToDelete = await ChatSession.find({
  //       deletedAt: { $ne: null },              // Just needs to be soft-deleted
  //       'contact.captured': false              // No lead captured
  //     });

  //     let deletedCount = 0;
  //     let skippedCount = 0;

  //     for (const session of sessionsToDelete) {
  //       const hasLinkedLead = await ContactLead.findOne({
  //         $or: [
  //           { firstSessionId: session.sessionId },
  //           { lastSessionId: session.sessionId }
  //         ]
  //       });

  //       if (hasLinkedLead) {
  //         logger.warn('[TEST] Skipping deletion - lead found', {
  //           sessionId: session.sessionId,
  //           leadEmail: hasLinkedLead.email
  //         });
  //         skippedCount++;
  //         continue;
  //       }

  //       await Promise.all([
  //         ChatSession.deleteOne({ sessionId: session.sessionId }),
  //         ChatMessage.deleteMany({ sessionId: session.sessionId })
  //       ]);

  //       logger.info('[TEST] Permanently deleted session', {
  //         sessionId: session.sessionId,
  //         messageCount: session.messageCount
  //       });

  //       deletedCount++;
  //     }

  //     logger.info('[TEST] Permanent deletion complete', {
  //       eligible: sessionsToDelete.length,
  //       deleted: deletedCount,
  //       skipped: skippedCount
  //     });

  //     return {
  //       success: true,
  //       deletedCount,
  //       skippedCount
  //     };

  //   } catch (error: any) {
  //     logger.error('[TEST] Permanent deletion failed', {
  //       message: error.message
  //     });

  //     return {
  //       success: false,
  //       deletedCount: 0,
  //       skippedCount: 0
  //     };
  //   }
  // }

  /**
   * Day-by-day counts for the analytics charts. Reads directly from the
   * operational collections (ChatSession/ChatMessage/ContactLead) rather than
   * the new AnalyticsEvent collection - that collection only starts
   * accumulating data from when its consumer was wired up, so it has no
   * history yet for existing businesses. This gives real charts immediately;
   * a future pass can move this to AnalyticsEvent once enough history exists.
   */
  async getChartData(businessId: string, days: number = 7): Promise<{
    sessionsPerDay: Array<{ date: string; count: number }>;
    messagesPerDay: Array<{ date: string; count: number }>;
    leadsPerDay: Array<{ date: string; count: number }>;
  }> {
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    since.setDate(since.getDate() - (days - 1));

    const dateKey = (field: string) => ({ $dateToString: { format: '%Y-%m-%d', date: `$${field}` } });

    const [sessionRows, messageRows, leadRows] = await Promise.all([
      ChatSession.aggregate([
        { $match: { businessId, startedAt: { $gte: since } } },
        { $group: { _id: dateKey('startedAt'), count: { $sum: 1 } } },
      ]),
      ChatMessage.aggregate([
        { $match: { businessId, timestamp: { $gte: since }, deletedAt: null } },
        { $group: { _id: dateKey('timestamp'), count: { $sum: 1 } } },
      ]),
      ContactLead.aggregate([
        { $match: { businessId, firstContactDate: { $gte: since } } },
        { $group: { _id: dateKey('firstContactDate'), count: { $sum: 1 } } },
      ]),
    ]);

    // Aggregation only returns days that had data - fill in the gaps so the
    // chart always shows a full, continuous N-day range.
    const fillDays = (rows: Array<{ _id: string; count: number }>) => {
      const byDate = new Map(rows.map(r => [r._id, r.count]));
      const result: Array<{ date: string; count: number }> = [];
      for (let i = 0; i < days; i++) {
        const d = new Date(since);
        d.setDate(since.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        result.push({ date: key, count: byDate.get(key) || 0 });
      }
      return result;
    };

    return {
      sessionsPerDay: fillDays(sessionRows),
      messagesPerDay: fillDays(messageRows),
      leadsPerDay: fillDays(leadRows),
    };
  }

}

export const chatService = new ChatService();