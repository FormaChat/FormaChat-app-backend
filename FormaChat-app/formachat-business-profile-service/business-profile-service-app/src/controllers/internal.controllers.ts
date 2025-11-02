import { Request, Response } from 'express';
import { businessService } from '../services/business.service';

/**
 * ========================================
 * INTERNAL BUSINESS CONTROLLER
 * ========================================
 * 
 * Handles internal service-to-service requests.
 * Primary consumer: Chat Service
 * 
 * Purpose:
 * - Provide business access checks for chat service
 * - Return chat-relevant configuration
 * - Enable chat service to query Pinecone by namespace
 * 
 * Authentication:
 * - internalMiddleware (service secret only)
 * 
 * Endpoints:
 * - GET /internal/businesses/:id/chat-config
*/

/**
 * ========================================
 * GET BUSINESS CHAT CONFIGURATION
 * ========================================
 * 
 * Returns business access status and chat configuration in one call.
 * Chat service uses this to:
 * 1. Check if business can be used for chat (access control)
 * 2. Get Pinecone namespace for vector queries
 * 3. Get chatbot configuration (tone, greeting, capabilities)
 * 4. Get escalation contact information
 * 
 * Route: GET /internal/businesses/:id/chat-config
 * Middleware: internalMiddleware
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: {
 *     allowed: true,
 *     config: {
 *       namespace: "business_123",
 *       businessName: "Acme Corp",
 *       businessDescription: "...",
 *       chatbotTone: "Friendly",
 *       chatbotGreeting: "Hello! How can I help?",
 *       chatbotRestrictions: "Don't discuss competitor products",
 *       chatbotCapabilities: ["Answer FAQs", "Book appointments"],
 *       escalationContact: {
 *         name: "John Doe",
 *         email: "support@acme.com",
 *         phone: "+1234567890"
 *       },
 *       contactMethods: [
 *         { method: "Email", value: "support@acme.com" }
 *       ]
 *     }
 *   }
 * }
 * 
 * Denied Response (403):
 * {
 *   success: false,
 *   error: {
 *     code: "BUSINESS_FROZEN",
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

export const getBusinessChatConfig = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { id: businessId } = req.params;

    // 1. VALIDATE BUSINESS ID FORMAT
    if (!businessId || !businessId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BUSINESS_ID',
          message: 'Business ID must be a valid MongoDB ObjectId'
        }
      });
      return;
    }

    // 2. CHECK BUSINESS ACCESS (includes frozen/active checks)
    const accessCheck = await businessService.checkBusinessAccess(businessId);

    // 3. BUSINESS NOT FOUND
    if (!accessCheck.business) {
      res.status(404).json({
        success: false,
        error: {
          code: 'BUSINESS_NOT_FOUND',
          message: accessCheck.reason || 'Business not found'
        }
      });
      return;
    }

    // 4. BUSINESS ACCESS DENIED (frozen, inactive, vector issues)
    if (!accessCheck.allowed) {
      res.status(403).json({
        success: false,
        error: {
          code: 'BUSINESS_ACCESS_DENIED',
          message: accessCheck.reason || 'Business cannot be used for chat'
        }
      });
      return;
    }

    // 5. ACCESS ALLOWED - BUILD CHAT CONFIGURATION
    const business = accessCheck.business;

    const chatConfig = {
      allowed: true,
      config: {
        // VECTOR NAMESPACE (for Pinecone queries)
        namespace: business.vectorInfo.namespace,
        vectorStatus: business.vectorInfo.vectorStatus,

        // BUSINESS CONTEXT
        businessName: business.basicInfo.businessName,
        businessDescription: business.basicInfo.businessDescription,
        businessType: business.basicInfo.businessType,
        location: business.basicInfo.location,
        operatingHours: business.basicInfo.operatingHours,
        timezone: business.basicInfo.timezone,

        // CHATBOT CONFIGURATION
        chatbotTone: business.customerSupport.chatbotTone,
        chatbotGreeting: business.customerSupport.chatbotGreeting,
        chatbotRestrictions: business.customerSupport.chatbotRestrictions,

        // CHATBOT CAPABILITIES
        chatbotCapabilities: business.contactEscalation.chatbotCapabilities,

        // CONTACT & ESCALATION
        escalationContact: {
          name: business.contactEscalation.escalationContact.name,
          email: business.contactEscalation.escalationContact.email,
          phone: business.contactEscalation.escalationContact.phone
        },
        contactMethods: business.contactEscalation.contactMethods.map(method => ({
          method: method.method,
          value: method.value
        })),

        // PRICING DISPLAY PREFERENCES
        pricingDisplay: business.productsServices.pricingDisplay
      }
    };

    // 6. RETURN CHAT CONFIGURATION
    res.status(200).json({
      success: true,
      data: chatConfig
    });

    console.log(`[Internal] ✓ Chat config provided for business: ${businessId}`);

  } catch (error: any) {
    console.error('[Internal] Error getting chat config:', error.message);

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve business chat configuration'
      }
    });
  }
};

/**
 * ========================================
 * USAGE WORKFLOW
 * ========================================
 * 
 * Chat Service Workflow:
 * 
 * 1. User sends message to chat
 * 2. Chat service calls: GET /internal/businesses/:id/chat-config
 * 3. If allowed === true:
 *    a. Extract namespace from config
 *    b. Query Pinecone directly using namespace
 *    c. Use chatbotTone, greeting, restrictions for response generation
 *    d. If escalation needed, use escalationContact
 * 4. If allowed === false:
 *    a. Return friendly error message to user
 *    b. Log the denial reason
 * 
 * Example Chat Service Code:
 * 
 * const configResponse = await fetch(
 *   `http://business-service/internal/businesses/${businessId}/chat-config`,
 *   {
 *     headers: { 'x-service-token': process.env.INTERNAL_SERVICE_SECRET }
 *   }
 * );
 * 
 * const { success, data, error } = await configResponse.json();
 * 
 * if (!success) {
 *   return res.json({ 
 *     message: 'Sorry, this chatbot is temporarily unavailable.' 
 *   });
 * }
 * 
 * // Query Pinecone using namespace
 * const vectorResults = await pinecone.query({
 *   namespace: data.config.namespace,
 *   vector: queryEmbedding,
 *   topK: 5
 * });
 * 
 * // Generate response using chatbotTone and context
 * const response = await generateChatResponse(
 *   userMessage,
 *   vectorResults,
 *   data.config.chatbotTone,
 *   data.config.chatbotRestrictions
 * );
*/

export default {
  getBusinessChatConfig
};