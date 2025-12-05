import { Request, Response } from 'express';
import { businessService } from '../services/business.service';
import { createLogger } from '../utils/business.logger.utils';

const logger = createLogger('internal-controller');

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

    logger.info(`[Internal] ✓ Chat config provided for business: ${businessId}`);

  } catch (error: any) {
    logger.error('[Internal] Error getting chat config:', error.message);

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve business chat configuration'
      }
    });
  }
};


export default {
  getBusinessChatConfig
};