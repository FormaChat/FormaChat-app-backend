import { Request, Response } from 'express';
import { chatService } from '../service/chat.service';
import { createLogger } from '../util/chat.logger.utils';

const logger = createLogger('chat-controller');

/**
 * ========================================
 * CHAT CONTROLLER
 * ========================================
 * 
 * Handles HTTP requests for chat functionality
 * Validates input, calls service methods, returns responses
 * 
 * Responsibilities:
 * - Input validation
 * - HTTP request/response handling
 * - Error formatting
 * - Logging
 */

// ========================================
// PUBLIC ENDPOINTS (End User Chat)
// ========================================

/**
 * Create a new chat session
 * 
 * POST /api/chat/session/create
 * 
 * Body:
 * {
 *   businessId: string (required)
 *   visitorId?: string (optional - generated if not provided)
 * }
 * 
 * Success Response (201):
 * {
 *   success: true,
 *   data: {
 *     sessionId: "abc-123-xyz",
 *     visitorId: "visitor_xyz",
 *     businessInfo: {
 *       businessName: "Pizza Shop",
 *       chatbotGreeting: "Hi! How can I help?",
 *       chatbotTone: "Friendly"
 *     }
 *   }
 * }
 * 
 * Error Response (400/403/500):
 * {
 *   success: false,
 *   error: {
 *     code: "BUSINESS_NOT_AVAILABLE",
 *     message: "Business is currently unavailable"
 *   }
 * }
 */
export const createSessionController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { businessId, visitorId } = req.body;

    // Validation
    if (!businessId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_BUSINESS_ID',
          message: 'Business ID is required'
        }
      });
      return;
    }

    // Validate businessId format (MongoDB ObjectId)
    if (!businessId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BUSINESS_ID',
          message: 'Business ID must be a valid MongoDB ObjectId'
        }
      });
      return;
    }

    const referrerHeader = req.headers['referer'] || req.headers['referrer'];

    // Extract metadata from request
    const metadata = {
      userAgent: req.headers['user-agent'] as string,
      ipAddress: req.ip || req.connection.remoteAddress,
      referrer: Array.isArray(referrerHeader) ? referrerHeader[0] : referrerHeader
    };

    // Call service
    const result = await chatService.createSession({
      businessId,
      visitorId,
      metadata
    });

    // Handle errors
    if (!result.success) {
      const statusCode = 
        result.error === 'BUSINESS_NOT_AVAILABLE' ? 403 :
        result.error === 'DAILY_LIMIT_EXCEEDED' ? 429 :
        500;

      res.status(statusCode).json({
        success: false,
        error: {
          code: result.error,
          message: result.reason || 'Failed to create session'
        }
      });
      return;
    }

    // Success
    res.status(201).json({
      success: true,
      data: {
        sessionId: result.sessionId,
        visitorId: result.visitorId,
        businessInfo: result.businessInfo
      }
    });

    logger.info('[Controller] Session created', {
      sessionId: result.sessionId,
      businessId
    });

  } catch (error: any) {
    logger.error('[Controller] Create session failed', {
      message: error.message
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to create chat session'
      }
    });
  }
};

/**
 * Get existing session
 * 
 * GET /api/chat/session/:sessionId
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: {
 *     sessionId: "abc-123",
 *     businessId: "business_xyz",
 *     status: "active",
 *     messageCount: 15,
 *     contactCaptured: true,
 *     contact: {
 *       email: "john@email.com",
 *       phone: "+1234567890",
 *       name: "John"
 *     }
 *   }
 * }
 */
export const getSessionController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { sessionId } = req.params;

    // Validation
    if (!sessionId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_SESSION_ID',
          message: 'Session ID is required'
        }
      });
      return;
    }

    // Call service
    const result = await chatService.getSession(sessionId);

    // Handle errors
    if (!result.success) {
      const statusCode = result.error === 'SESSION_NOT_FOUND' ? 404 : 500;

      res.status(statusCode).json({
        success: false,
        error: {
          code: result.error,
          message: 'Session not found or unavailable'
        }
      });
      return;
    }

    // Success
    res.status(200).json({
      success: true,
      data: result.session
    });

  } catch (error: any) {
    logger.error('[Controller] Get session failed', {
      message: error.message,
      sessionId: req.params.sessionId
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve session'
      }
    });
  }
};

/**
 * Send a message (Main chat endpoint)
 * 
 * POST /api/chat/session/:sessionId/message
 * 
 * Body:
 * {
 *   message: string (required)
 * }
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: {
 *     message: {
 *       role: "assistant",
 *       content: "We're open 9am-5pm!",
 *       timestamp: "2025-01-15T10:30:00Z"
 *     },
 *     contactCaptured: false
 *   }
 * }
 */
export const sendMessageController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;

    // Validation
    if (!sessionId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_SESSION_ID',
          message: 'Session ID is required'
        }
      });
      return;
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_MESSAGE',
          message: 'Message is required and must be a non-empty string'
        }
      });
      return;
    }

    // Check message length (prevent abuse)
    if (message.length > 1000) {
      res.status(400).json({
        success: false,
        error: {
          code: 'MESSAGE_TOO_LONG',
          message: 'Message must be less than 1000 characters'
        }
      });
      return;
    }

    // Call service
    const result = await chatService.sendMessage({
      sessionId,
      userMessage: message.trim()
    });

    // Handle errors
    if (!result.success) {
      const statusCode = 
        result.error === 'SESSION_NOT_FOUND' ? 404 :
        result.error === 'SESSION_NOT_ACTIVE' ? 403 :
        result.error === 'BUSINESS_NOT_AVAILABLE' ? 503 :
        500;

      res.status(statusCode).json({
        success: false,
        error: {
          code: result.error,
          message: 'Failed to process message'
        }
      });
      return;
    }

    // Success
    res.status(200).json({
      success: true,
      data: {
        message: result.message,
        contactCaptured: result.contactCaptured
      }
    });

  } catch (error: any) {
    logger.error('[Controller] Send message failed', {
      message: error.message,
      sessionId: req.params.sessionId
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to send message'
      }
    });
  }
};

/**
 * Get messages for a session (paginated)
 * 
 * GET /api/chat/session/:sessionId/messages?page=1&limit=20
 * 
 * Query Params:
 * - page: number (default: 1)
 * - limit: number (default: 20, max: 100)
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: {
 *     messages: [
 *       { role: "user", content: "Hello", timestamp: "..." },
 *       { role: "assistant", content: "Hi!", timestamp: "..." }
 *     ],
 *     pagination: {
 *       page: 1,
 *       limit: 20,
 *       total: 45,
 *       hasMore: true
 *     }
 *   }
 * }
 */
export const getMessagesController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100); // Max 100

    // Validation
    if (!sessionId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_SESSION_ID',
          message: 'Session ID is required'
        }
      });
      return;
    }

    if (page < 1) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_PAGE',
          message: 'Page must be greater than 0'
        }
      });
      return;
    }

    // Call service
    const result = await chatService.getMessages({
      sessionId,
      page,
      limit
    });

    // Handle errors
    if (!result.success) {
      res.status(500).json({
        success: false,
        error: {
          code: result.error,
          message: 'Failed to retrieve messages'
        }
      });
      return;
    }

    // Success
    res.status(200).json({
      success: true,
      data: {
        messages: result.messages,
        pagination: result.pagination
      }
    });

  } catch (error: any) {
    logger.error('[Controller] Get messages failed', {
      message: error.message,
      sessionId: req.params.sessionId
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve messages'
      }
    });
  }
};

/**
 * End a chat session
 * 
 * POST /api/chat/session/:sessionId/end
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   message: "Session ended successfully"
 * }
 */
export const endSessionController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { sessionId } = req.params;

    // Validation
    if (!sessionId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_SESSION_ID',
          message: 'Session ID is required'
        }
      });
      return;
    }

    // Call service
    const result = await chatService.endSession(sessionId);

    // Handle errors
    if (!result.success) {
      const statusCode = result.error === 'SESSION_NOT_FOUND' ? 404 : 500;

      res.status(statusCode).json({
        success: false,
        error: {
          code: result.error,
          message: 'Failed to end session'
        }
      });
      return;
    }

    // Success
    res.status(200).json({
      success: true,
      message: 'Session ended successfully'
    });

    logger.info('[Controller] Session ended', { sessionId });

  } catch (error: any) {
    logger.error('[Controller] End session failed', {
      message: error.message,
      sessionId: req.params.sessionId
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to end session'
      }
    });
  }
};

// ========================================
// BUSINESS OWNER DASHBOARD ENDPOINTS
// ========================================

/**
 * Get all sessions for a business
 * 
 * GET /api/chat/business/:businessId/sessions
 * 
 * Query Params:
 * - status: 'active' | 'ended' | 'abandoned' (optional)
 * - contactCaptured: boolean (optional)
 * - startDate: ISO date string (optional)
 * - endDate: ISO date string (optional)
 * - page: number (default: 1)
 * - limit: number (default: 20)
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: {
 *     sessions: [...],
 *     pagination: { page, limit, total, pages }
 *   }
 * }
 */
export const getSessionsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { businessId } = req.params;
    const {
      status,
      contactCaptured,
      startDate,
      endDate,
      page = '1',
      limit = '20'
    } = req.query;

    // Validation
    if (!businessId || !businessId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BUSINESS_ID',
          message: 'Valid Business ID is required'
        }
      });
      return;
    }

    // Build filters
    const filters: any = {};
    if (status) filters.status = status;
    if (contactCaptured !== undefined) {
      filters.contactCaptured = contactCaptured === 'true';
    }
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    // Call service
    const result = await chatService.getSessionsForBusiness({
      businessId,
      filters,
      page: parseInt(page as string),
      limit: parseInt(limit as string)
    });

    // Handle errors
    if (!result.success) {
      res.status(500).json({
        success: false,
        error: {
          code: result.error,
          message: 'Failed to retrieve sessions'
        }
      });
      return;
    }

    // Success
    res.status(200).json({
      success: true,
      data: {
        sessions: result.sessions,
        pagination: result.pagination
      }
    });

  } catch (error: any) {
    logger.error('[Controller] Get sessions failed', {
      message: error.message,
      businessId: req.params.businessId
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve sessions'
      }
    });
  }
};

/**
 * Get all leads for a business
 * 
 * GET /api/chat/business/:businessId/leads
 * 
 * Query Params:
 * - status: string (optional)
 * - startDate: ISO date string (optional)
 * - endDate: ISO date string (optional)
 * - page: number (default: 1)
 * - limit: number (default: 50)
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: {
 *     leads: [...],
 *     pagination: { page, limit, total, pages }
 *   }
 * }
 */
export const getLeadsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { businessId } = req.params;
    const {
      status,
      startDate,
      endDate,
      page = '1',
      limit = '50'
    } = req.query;

    // Validation
    if (!businessId || !businessId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BUSINESS_ID',
          message: 'Valid Business ID is required'
        }
      });
      return;
    }

    // Build filters
    const filters: any = {};
    if (status) filters.status = status;
    if (startDate) filters.startDate = new Date(startDate as string);
    if (endDate) filters.endDate = new Date(endDate as string);

    // Call service
    const result = await chatService.getLeadsForBusiness({
      businessId,
      filters,
      page: parseInt(page as string),
      limit: parseInt(limit as string)
    });

    // Handle errors
    if (!result.success) {
      res.status(500).json({
        success: false,
        error: {
          code: result.error,
          message: 'Failed to retrieve leads'
        }
      });
      return;
    }

    // Success
    res.status(200).json({
      success: true,
      data: {
        leads: result.leads,
        pagination: result.pagination
      }
    });

  } catch (error: any) {
    logger.error('[Controller] Get leads failed', {
      message: error.message,
      businessId: req.params.businessId
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve leads'
      }
    });
  }
};

/**
 * Get session details with full conversation
 * 
 * GET /api/chat/business/:businessId/session/:sessionId
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: {
 *     session: {
 *       sessionId, contact, status, startedAt, endedAt, messageCount
 *     },
 *     messages: [...]
 *   }
 * }
 */
export const getSessionDetailsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { businessId, sessionId } = req.params;

    // Validation
    if (!businessId || !businessId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BUSINESS_ID',
          message: 'Valid Business ID is required'
        }
      });
      return;
    }

    if (!sessionId) {
      res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_SESSION_ID',
          message: 'Session ID is required'
        }
      });
      return;
    }

    // Call service
    const result = await chatService.getSessionDetails(sessionId, businessId);

    // Handle errors
    if (!result.success) {
      const statusCode = result.error === 'SESSION_NOT_FOUND' ? 404 : 500;

      res.status(statusCode).json({
        success: false,
        error: {
          code: result.error,
          message: 'Failed to retrieve session details'
        }
      });
      return;
    }

    // Success
    res.status(200).json({
      success: true,
      data: {
        session: result.session,
        messages: result.messages
      }
    });

  } catch (error: any) {
    logger.error('[Controller] Get session details failed', {
      message: error.message,
      sessionId: req.params.sessionId,
      businessId: req.params.businessId
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve session details'
      }
    });
  }
};

// ========================================
// INTERNAL/CRON ENDPOINTS
// ========================================

/**
 * Delete old messages (7+ days)
 * Called by cron job
 * 
 * POST /api/chat/internal/cleanup/messages
 * 
 * Headers:
 * - x-service-token: <internal-secret>
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: {
 *     deletedCount: 1234
 *   }
 * }
 */
export const deleteOldMessagesController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Call service
    const result = await chatService.deleteOldMessages();

    // Success
    res.status(200).json({
      success: true,
      data: {
        deletedCount: result.deletedCount
      }
    });

    logger.info('[Controller] Old messages deleted', {
      count: result.deletedCount
    });

  } catch (error: any) {
    logger.error('[Controller] Delete old messages failed', {
      message: error.message
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete old messages'
      }
    });
  }
};

/**
 * Mark abandoned sessions
 * Called by cron job
 * 
 * POST /api/chat/internal/cleanup/sessions
 * 
 * Headers:
 * - x-service-token: <internal-secret>
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: {
 *     markedCount: 15
 *   }
 * }
 */
export const markAbandonedSessionsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    // Call service
    const result = await chatService.markAbandonedSessions();

    // Success
    res.status(200).json({
      success: true,
      data: {
        markedCount: result.markedCount
      }
    });

    logger.info('[Controller] Abandoned sessions marked', {
      count: result.markedCount
    });

  } catch (error: any) {
    logger.error('[Controller] Mark abandoned sessions failed', {
      message: error.message
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to mark abandoned sessions'
      }
    });
  }
};

/**
 * Get dashboard summary (composite endpoint)
 * 
 * GET /api/chat/business/:businessId/dashboard-summary
 * 
 * Returns business sessions, leads, and analytics in ONE request
 * Only ONE ownership check is performed
 * 
 * Success Response (200):
 * {
 *   success: true,
 *   data: {
 *     sessions: [...],  // Recent 5 sessions
 *     leads: [...],     // Recent 5 leads
 *     analytics: {
 *       totalSessions: 45,
 *       activeSessions: 3,
 *       totalLeads: 12,
 *       totalMessages: 234,
 *       conversionRate: 27
 *     }
 *   }
 * }
 */
export const getDashboardSummaryController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    const { businessId } = req.params;

    // Validation
    if (!businessId || !businessId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BUSINESS_ID',
          message: 'Valid Business ID is required'
        }
      });
      return;
    }

    // Fetch all data in parallel (NO additional ownership checks needed)
    const [sessionsResult, leadsResult] = await Promise.all([
      chatService.getSessionsForBusiness({
        businessId,
        page: 1,
        limit: 5
      }),
      chatService.getLeadsForBusiness({
        businessId,
        page: 1,
        limit: 5
      })
    ]);

    // Handle errors
    if (!sessionsResult.success || !leadsResult.success) {
      res.status(500).json({
        success: false,
        error: {
          code: 'DASHBOARD_FETCH_FAILED',
          message: 'Failed to retrieve dashboard data'
        }
      });
      return;
    }

    // Calculate analytics from the data
    const sessions = sessionsResult.sessions || [];
    const leads = leadsResult.leads || [];
    
    const activeSessions = sessions.filter(s => s.status === 'active').length;
    const totalMessages = sessions.reduce((sum: number, s: any) => sum + (s.messageCount || 0), 0);
    const sessionsWithContact = sessions.filter((s: any) => s.contact?.email || s.contact?.phone).length;
    const conversionRate = sessions.length > 0 
      ? Math.round((sessionsWithContact / sessions.length) * 100)
      : 0;

    // Success - return composite response
    res.status(200).json({
      success: true,
      data: {
        sessions,
        leads,
        analytics: {
          totalSessions: sessionsResult.pagination?.total || sessions.length,
          activeSessions,
          totalLeads: leadsResult.pagination?.total || leads.length,
          totalMessages,
          conversionRate
        }
      }
    });

    logger.info('[Controller] Dashboard summary retrieved', {
      businessId,
      sessionCount: sessions.length,
      leadCount: leads.length
    });

  } catch (error: any) {
    logger.error('[Controller] Get dashboard summary failed', {
      message: error.message,
      businessId: req.params.businessId
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to retrieve dashboard summary'
      }
    });
  }
};

// ========================================
// EXPORTS
// ========================================

export default {
  // Public endpoints
  createSessionController,
  getSessionController,
  sendMessageController,
  getMessagesController,
  endSessionController,

  // Business owner dashboard
  getSessionsController,
  getLeadsController,
  getSessionDetailsController,
  getDashboardSummaryController,

  // Internal/cron
  deleteOldMessagesController,
  markAbandonedSessionsController
};