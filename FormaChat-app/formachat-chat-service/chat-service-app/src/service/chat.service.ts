import { v4 as uuidv4 } from 'uuid';
import axios from 'axios';
import { ChatSession, ChatMessage, ContactLead } from '../model/chat.model';
import { createLogger } from '../util/chat.logger.utils';
import { checkDailyLimit, incrementSessionCount } from '../config/chat.redis.config';
import { searchBusiness } from '../config/chat.pinecone.config';
import { getLLMProvider } from '../config/llm/llm.factory';
import { buildSystemPrompt, buildHighIntentPrompt, ChatbotTone, isValidTone, getDefaultTone } from '../config/llm/llm.prompts';
import { env } from '../config/chat.env.config';

const logger = createLogger('chat-service');

/**
 * ========================================
 * CHAT SERVICE
 * ========================================
 * 
 * Core chatbot logic for FormaChat platform
 * Handles sessions, messages, contact capture, and LLM interactions
 * 
 * Communicates with Business Service via internal API for access checks
 */

export class ChatService {

  // ========================================
  // SESSION MANAGEMENT
  // ========================================

  /**
   * Create a new chat session
   * Called when end user first visits formachat.com/chat/{businessId}
   */
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

  /**
   * Get existing session
   * Called when user returns to chat (has sessionId in localStorage)
   */
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

  // ========================================
  // MESSAGE HANDLING
  // ========================================

  /**
   * Send a message (Main chat logic)
   * This is where the magic happens!
   */
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

      // 4. Extract contact info from message (if present)
      const extractedContact = this.extractContactFromMessage(userMessage);

      if (extractedContact.hasContact && !session.contact.captured) {
        await this.captureContactInfo(sessionId, extractedContact);
      }

      // 5. Detect high intent
      const highIntent = this.detectHighIntent(userMessage);

      // 6. Fetch context from Pinecone (using namespace from config)
      const vectorSearch = await searchBusiness(
        session.businessId,
        userMessage,
        5 // top 5 results
      );

      if (!vectorSearch.hasResults) {
        logger.warn('[Message] No vector results found', {
          sessionId,
          businessId: session.businessId
        });
      }

      // 7. Get conversation history (last 10 messages)
      const history = await this.getConversationHistory(sessionId, 10);

      // 8. Build system prompt

      const systemPrompt = highIntent.hasHighIntent && !session.contact.captured
        ? buildHighIntentPrompt({
            businessName: config.businessName,
            businessContext: vectorSearch.context,
            detectedIntent: highIntent.matchedKeywords,
            chatbotTone: validTone
          })
        : buildSystemPrompt({
            businessName: config.businessName,
            businessContext: vectorSearch.context,
            chatbotTone: validTone,
            chatbotGreeting: config.chatbotGreeting,
            chatbotRestrictions: config.chatbotRestrictions
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

      const totalDuration = Date.now() - startTime;

      logger.info('[Message] ✓ Response generated', {
        sessionId,
        tokensUsed: llmResponse.tokensUsed.total,
        duration: `${totalDuration}ms`,
        vectorResults: vectorSearch.results.length
      });

      return {
        success: true,
        message: {
          role: 'assistant',
          content: llmResponse.response,
          timestamp: botMsgDoc.timestamp
        },
        contactCaptured: session.contact.captured
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
   * Send message with streaming response
   */
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

      // 4. Extract contact & detect intent (same as before)
      const extractedContact = this.extractContactFromMessage(userMessage);
      if (extractedContact.hasContact && !session.contact.captured) {
        await this.captureContactInfo(sessionId, extractedContact);
      }

      const highIntent = this.detectHighIntent(userMessage);

      // 5. Get context from Pinecone
      const vectorSearch = await searchBusiness(session.businessId, userMessage, 5);

      // 6. Get conversation history
      const history = await this.getConversationHistory(sessionId, 10);

      // 7. Build system prompt
      const systemPrompt = highIntent.hasHighIntent && !session.contact.captured
        ? buildHighIntentPrompt({
            businessName: config.businessName,
            businessContext: vectorSearch.context,
            detectedIntent: highIntent.matchedKeywords,
            chatbotTone: validTone
          })
        : buildSystemPrompt({
            businessName: config.businessName,
            businessContext: vectorSearch.context,
            chatbotTone: validTone,
            chatbotGreeting: config.chatbotGreeting,
            chatbotRestrictions: config.chatbotRestrictions
          });

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

  /**
   * Get messages for a session (paginated)
   */
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

  // ========================================
  // CONTACT MANAGEMENT
  // ========================================

  /**
   * Extract contact info from message using regex
   */
  private extractContactFromMessage(message: string): {
    hasContact: boolean;
    email?: string;
    phone?: string;
    name?: string;
    confidence: number;
  } {
    const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/;
    const phoneRegex = /\b(\+?\d{1,3}[-.]?)?\(?\d{3}\)?[-.]?\d{3}[-.]?\d{4}\b/;
    const nameRegex = /(?:my name is|i'm|i am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i;

    const emailMatch = message.match(emailRegex);
    const phoneMatch = message.match(phoneRegex);
    const nameMatch = message.match(nameRegex);

    const hasContact = !!(emailMatch || phoneMatch);

    return {
      hasContact,
      email: emailMatch?.[0],
      phone: phoneMatch?.[0],
      name: nameMatch?.[1],
      confidence: hasContact ? 0.9 : 0
    };
  }

  /**
   * Detect high intent keywords
   */
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

  /**
   * Capture contact information
   */
  private async captureContactInfo(
    sessionId: string,
    contactData: {
      email?: string;
      phone?: string;
      name?: string;
    }
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
      }

    } catch (error: any) {
      logger.error('[Contact] Capture failed', {
        message: error.message,
        sessionId
      });
    }
  }

  /**
   * Get conversation history (last N messages)
   */
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

  // ========================================
  // BUSINESS OWNER DASHBOARD
  // ========================================

  /**
   * Get all sessions for a business
   */
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

  /**
   * Get all leads for a business
   */
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

  /**
   * Get session details with full conversation
   */
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

  // ========================================
  // BUSINESS ACCESS CHECK (via Business Service API)
  // ========================================

  /**
   * Check if business can accept chat sessions
   * Calls Business Service internal API
   */
  private async checkBusinessAccess(businessId: string): Promise<{
    allowed: boolean;
    config?: {
      namespace: string;
      businessName: string;
      businessDescription: string;
      chatbotTone?: string;
      chatbotGreeting?: string;
      chatbotRestrictions?: string;
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

  // ========================================
  // CRON / CLEANUP JOBS
  // ========================================

  /**
   * Delete old messages (7 days+)
   * Run daily via cron
   */
  async deleteOldMessages(): Promise<{
    success: boolean;
    deletedCount: number;
  }> {
    try {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const result = await ChatMessage.deleteMany({
        timestamp: { $lt: sevenDaysAgo }
      });

      logger.info('[Cleanup] Old messages deleted', {
        count: result.deletedCount,
        olderThan: sevenDaysAgo
      });

      return {
        success: true,
        deletedCount: result.deletedCount || 0
      };

    } catch (error: any) {
      logger.error('[Cleanup] Message deletion failed', {
        message: error.message
      });

      return {
        success: false,
        deletedCount: 0
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

  /**
   * Mark abandoned sessions (IMPROVED)
   * Run hourly via cron
   * 
   * Strategy:
   * - 2 hours of inactivity → 'abandoned' (user might return)
   * - 24 hours of inactivity → 'ended' (definitely done)
   */
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

}

export const chatService = new ChatService();