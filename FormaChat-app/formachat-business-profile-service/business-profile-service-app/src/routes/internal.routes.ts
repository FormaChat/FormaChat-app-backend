import { Router } from 'express';
import { internalMiddleware } from '../middleware/internal.middleware';
import * as internalBusinessController from '../controllers/internal.controllers';

/**
 * ========================================
 * INTERNAL BUSINESS ROUTES
 * ========================================
 * 
 * Service-to-service communication routes for internal microservices.
 * Primary consumers: Chat Service, Payment Service, Tier Service
 * 
 * Base Path: /internal
 * Authentication: internalMiddleware (service secret only)
 * 
 * Purpose:
 * - Provide business access checks for other services
 * - Return service-specific configuration (chat config, payment status, etc.)
 * - Enable services to verify business status before operations
 * 
 * Security:
 * - Single-layer authentication (service secret)
 * - Trusted internal services only
 * - No user authentication required (service-to-service)
 * 
 * Routes Overview:
 * - GET /internal/businesses/:id/chat-config → Get chat configuration and access status
 * 
 * Future Routes (when needed):
 * - GET /internal/businesses/:id/payment-status → Payment service queries
 * - GET /internal/businesses/:id/tier-info → Tier service queries
 * - GET /internal/businesses/:id/features → Feature flags based on tier
*/

const router = Router();

/**
 * ========================================
 * ROUTE DEFINITIONS
 * ========================================
*/

/**
 * GET /internal/businesses/:id/chat-config
 * 
 * Returns business access status and chat configuration in one atomic call.
 * This is the PRIMARY endpoint for the chat service.
 * 
 * Chat Service Workflow:
 * 1. User initiates chat
 * 2. Chat service calls this endpoint to get config
 * 3. If allowed === true:
 *    a. Extract namespace from config
 *    b. Query Pinecone DIRECTLY using namespace (chat service handles this)
 *    c. Use chatbot config (tone, greeting, restrictions) for response generation
 *    d. Use escalation contact if human handoff needed
 * 4. If allowed === false:
 *    a. Return friendly error message to user
 *    b. Log the denial reason
 * 
 * Path Parameters:
 * - id: MongoDB ObjectId of the business
 * 
 * Headers Required:
 * - x-service-token: <internal-service-secret>
 * 
 * Example Request:
 * GET /internal/businesses/507f1f77bcf86cd799439011/chat-config
 * Headers: { 'x-service-token': 'your-secret' }
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: {
 *     allowed: true,
 *     config: {
 *       namespace: "business_507f1f77bcf86cd799439011",
 *       vectorStatus: "completed",
 *       businessName: "Acme Corp",
 *       businessDescription: "...",
 *       chatbotTone: "Friendly",
 *       chatbotGreeting: "Hello! How can I help?",
 *       chatbotRestrictions: "Don't discuss competitors",
 *       chatbotCapabilities: ["Answer FAQs", "Book appointments"],
 *       escalationContact: {
 *         name: "John Doe",
 *         email: "support@acme.com",
 *         phone: "+1234567890"
 *       },
 *       contactMethods: [
 *         { method: "Email", value: "support@acme.com" }
 *       ],
 *       pricingDisplay: {
 *         canDiscussPricing: true,
 *         pricingNote: "Prices subject to change"
 *       }
 *     }
 *   }
 * }
 * 
 * Denied Response (403):
 * {
 *   success: false,
 *   error: {
 *     code: "BUSINESS_ACCESS_DENIED",
 *     message: "Business frozen: payment failed"
 *   }
 * }
 * 
 * Not Found Response (404):
 * {
 *   success: false,
 *   error: {
 *     code: "BUSINESS_NOT_FOUND",
 *     message: "Business not found"
 *   }
 * }
*/

router.get(
  '/businesses/:id/chat-config',
  internalMiddleware,
  internalBusinessController.getBusinessChatConfig
);

/**
 * ========================================
 * FUTURE ROUTES (PLACEHOLDER)
 * ========================================
 * 
 * These routes will be implemented when payment and tier services are built.
 * Documented here for architectural planning.
*/

/**
 * GET /internal/businesses/:id/payment-status
 * 
 * For Payment Service to check business payment status.
 * 
 * Future Implementation:
 * - Returns: { isPaid, tier, trialEndsAt, lastPaymentDate, etc. }
 * - Payment service uses this to determine access levels
 * - Billing service queries this before generating invoices
 * 
 * router.get(
 *   '/businesses/:id/payment-status',
 *   internalMiddleware,
 *   internalBusinessController.getBusinessPaymentStatus
 * );
*/


/**
 * GET /internal/businesses/:id/tier-info
 * 
 * For Tier Service to check business subscription tier.
 * 
 * Future Implementation:
 * - Returns: { tier: 'free' | 'pro' | 'pro+', features: [...], limits: {...} }
 * - Used to enforce feature access (document upload, image processing, etc.)
 * - Vector service checks this before processing files
 * 
 * router.get(
 *   '/businesses/:id/tier-info',
 *   internalMiddleware,
 *   internalBusinessController.getBusinessTierInfo
 * );
*/

/**
 * GET /internal/businesses/:id/features
 * 
 * For Feature Flag Service to check enabled features.
 * 
 * Future Implementation:
 * - Returns: { features: ['documents', 'images', 'analytics', ...] }
 * - Dynamic feature toggling based on tier and A/B tests
 * - Frontend queries this to show/hide features
 * 
 * router.get(
 *   '/businesses/:id/features',
 *   internalMiddleware,
 *   internalBusinessController.getBusinessFeatures
 * );
*/

/**
 * POST /internal/businesses/:id/usage-log
 * 
 * For services to log usage metrics (chat messages, API calls, etc.)
 * 
 * Future Implementation:
 * - Body: { service: 'chat', action: 'message_sent', metadata: {...} }
 * - Used for analytics and billing
 * - Rate limiting based on tier
 * 
 * router.post(
 *   '/businesses/:id/usage-log',
 *   internalMiddleware,
 *   internalBusinessController.logBusinessUsage
 * );
*/

/**
 * ========================================
 * ROUTE REGISTRATION
 * ========================================
 * 
 * To use these routes in your Express app:
 * 
 * import internalBusinessRoutes from './routes/internal.business.routes';
 * 
 * app.use('/internal', internalBusinessRoutes);
 * 
 * This will register routes as:
 * - GET /internal/businesses/:id/chat-config
 * 
 * Future routes will follow the same pattern:
 * - GET /internal/businesses/:id/payment-status
 * - GET /internal/businesses/:id/tier-info
 * - GET /internal/businesses/:id/features
 * - POST /internal/businesses/:id/usage-log
*/

/**
 * ========================================
 * EXAMPLE USAGE FROM CHAT SERVICE
 * ========================================
 * 
 * // Chat Service: Check business and get config
 * const getChatConfig = async (businessId: string) => {
 *   try {
 *     const response = await fetch(
 *       `http://business-service/internal/businesses/${businessId}/chat-config`,
 *       {
 *         headers: {
 *           'x-service-token': process.env.INTERNAL_SERVICE_SECRET
 *         }
 *       }
 *     );
 * 
 *     const { success, data, error } = await response.json();
 * 
 *     if (!success) {
 *       console.error('Business access denied:', error.message);
 *       return {
 *         allowed: false,
 *         message: 'Sorry, this chatbot is temporarily unavailable.'
 *       };
 *     }
 * 
 *     // Business is accessible - proceed with chat
 *     const { namespace, chatbotTone, chatbotGreeting } = data.config;
 * 
 *     // Query Pinecone using namespace (chat service handles this)
 *     const vectorResults = await pinecone.query({
 *       namespace: namespace,
 *       vector: queryEmbedding,
 *       topK: 5,
 *       includeMetadata: true
 *     });
 * 
 *     // Generate response using chatbot config
 *     const response = await generateChatResponse(
 *       userMessage,
 *       vectorResults,
 *       chatbotTone,
 *       data.config.chatbotRestrictions
 *     );
 * 
 *     return {
 *       allowed: true,
 *       message: response,
 *       config: data.config
 *     };
 * 
 *   } catch (error) {
 *     console.error('Failed to get chat config:', error);
 *     return {
 *       allowed: false,
 *       message: 'Service temporarily unavailable.'
 *     };
 *   }
 * };
 * 
 * // Handle user chat message
 * app.post('/chat/:businessId', async (req, res) => {
 *   const { businessId } = req.params;
 *   const { message } = req.body;
 * 
 *   // Get config and check access
 *   const chatConfig = await getChatConfig(businessId);
 * 
 *   if (!chatConfig.allowed) {
 *     return res.json({ 
 *       message: chatConfig.message 
 *     });
 *   }
 * 
 *   // Process chat message with Pinecone and GPT
 *   // ...
 * });
*/

/**
 * ========================================
 * SECURITY NOTES
 * ========================================
 * 
 * 1. Service-to-Service Authentication:
 *    - Only services with INTERNAL_SERVICE_SECRET can call these routes
 *    - No user authentication required (trusted services)
 *    - Service secret should be rotated periodically
 * 
 * 2. Data Exposure:
 *    - Returns only service-relevant data (chat config, not full business doc)
 *    - Principle of least privilege
 *    - No sensitive user data exposed
 * 
 * 3. Access Control:
 *    - Business access checks done via businessService.checkBusinessAccess()
 *    - Respects freeze status, active status, vector status
 *    - Chat service cannot bypass business freezes
 * 
 * 4. Rate Limiting:
 *    - Should be implemented at API gateway level
 *    - Or add rate limiting middleware if needed
 *    - Prevent abuse from compromised services
 * 
 * 5. Environment Variables Required:
 *    - INTERNAL_SERVICE_SECRET (shared across internal services)
*/

/**
 * ========================================
 * ARCHITECTURE NOTES
 * ========================================
 * 
 * Why Chat Service Queries Pinecone Directly:
 * 
 * 1. Performance:
 *    - Eliminates double hop (chat → business → pinecone)
 *    - Chat service can optimize queries for its use case
 *    - Reduces latency for real-time chat
 * 
 * 2. Separation of Concerns:
 *    - Business service: Manages business data and vector UPLOADS
 *    - Chat service: Handles conversations and vector QUERIES
 *    - Each service owns its domain
 * 
 * 3. Scalability:
 *    - Chat service can scale independently
 *    - Business service not bottleneck for chat queries
 *    - Pinecone can be queried in parallel
 * 
 * 4. Business Service Role:
 *    - Provides namespace and configuration
 *    - Enforces access control (freeze checks)
 *    - Manages vector lifecycle (create/update/delete)
 *    - Does NOT handle vector retrieval for chat
 * 
 * This Design Pattern is CORRECT for microservices architecture! 
*/

export default router;