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

const router: Router = Router();

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



export default router;