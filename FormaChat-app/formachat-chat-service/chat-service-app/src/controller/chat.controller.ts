import { Request, Response } from 'express';
import { chatService } from '../service/chat.service';
import { createLogger } from '../util/chat.logger.utils';

const logger = createLogger('chat-controller');


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

export const sendMessageStreamController = async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;
    const { message } = req.body;

    // Validation
    if (!sessionId) {
      res.status(400).json({
        success: false,
        error: { code: 'MISSING_SESSION_ID', message: 'Session ID is required' }
      });
      return;
    }

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_MESSAGE', message: 'Message is required' }
      });
      return;
    }

    if (message.length > 1000) {
      res.status(400).json({
        success: false,
        error: { code: 'MESSAGE_TOO_LONG', message: 'Message must be less than 1000 characters' }
      });
      return;
    }

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    // Stream chunks
    for await (const chunk of chatService.sendMessageStream({
      sessionId,
      userMessage: message.trim()
    })) {
      res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
    }
    
    res.write('data: [DONE]\n\n');
    res.end();

  } catch (error: any) {
    logger.error('[Controller] Stream message failed', {
      message: error.message,
      sessionId: req.params.sessionId
    });

    res.write(`data: ${JSON.stringify({ error: 'STREAMING_FAILED' })}\n\n`);
    res.end();
  }
};

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

export const deleteSessionController = async (
  req: Request,
  res: Response
) : Promise<void> => {
  try {
    const {businessId, sessionId} = req.params;

    if (!businessId || !businessId.match(/^[0-9a-fA-F]{24}$/)) {
      res.status(400).json({
        success: false,
        error: {
          code: 'INVALID_BUSINESS_ID',
          message: 'Valid Buisness ID is required'
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

    const result = await chatService.softDeleteSession({
      sessionId,
      businessId
    });

    if (!result.success) {
      const statusCode = result.error === 'SESSION_NOT_FOUND' ? 404 : result.error === 'SESSION_ALREADY_DELETED' ? 409 :result.error === 'SESSION_HAS_LEADS'? 403 : 500;
      res.status(statusCode).json({
        success: false,
        error: {
          code: result.error,
          message: result.error === 'SESSION_NOT_FOUND' ? 'Session not found' : result.error === 'SESSION_ALREADY_DELETED' ? 'Session is already deleted' : result.error === 'SESSION_HAS_LEADS' ? 'Cannot delete session with captured leads ': 'Failed to delete session',
          metadata: result.metadata
        }
      });
      return;
    }

    res.status(200).json({
      success: true,
      data: {
        message: result.message,
        sessionId,
        businessId
      }
    });

    logger.info('[Controller] Session deleted', {
      sessionId,
      businessId
    });

  } catch (error: any) {
    logger.error('[Controller] Delete session failed', {
      message: error.message,
      sessionId: req.params.sessionId,
      businessId: req.params.businessId 
    });

    res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL SERVER ERROR',
        message: 'Failed to delete session'
      }
    });
  }
};

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
        abandonedCount: result.abandonedCount,
        endedCount: result.endedCount
      }
    });

    logger.info('[Controller] Sessions marked', {
      abandoned: result.abandonedCount,
      ended: result.endedCount
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

export const permanentlyDeleteSessionsController = async (
  req: Request,
  res: Response
): Promise<void> => {
  try {
    logger.info('[TEST] Manually triggering permanent deletion...');
    
    const result = await chatService.permanentlyDeleteSessions();
    
    res.status(200).json({
      success: true,
      message: 'Permanent deletion completed',
      data: {
        deletedCount: result.deletedCount,
        skippedCount: result.skippedCount
      }
    });

  } catch (error: any) {
    logger.error('[TEST] Manual permanent deletion failed', {
      message: error.message
    });

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// export const testPermanentDeletionNoGraceController = async (
//   req: Request,
//   res: Response
// ): Promise<void> => {
//   try {
//     logger.info('[TEST] Triggering permanent deletion WITHOUT grace period...');
    
//     const result = await chatService.permanentlyDeleteSessionsNoGracePeriod();
    
//     res.status(200).json({
//       success: true,
//       message: 'Permanent deletion completed (no grace period)',
//       data: result
//     });

//   } catch (error: any) {
//     logger.error('[TEST] Test deletion failed', {
//       message: error.message
//     });

//     res.status(500).json({
//       success: false,
//       error: error.message
//     });
//   }
// };

export default {
  // Public endpoints
  createSessionController,
  getSessionController,
  sendMessageController,
  sendMessageStreamController,
  getMessagesController,
  endSessionController,

  // Business owner dashboard
  getSessionsController,
  getLeadsController,
  getSessionDetailsController,
  getDashboardSummaryController,

  
  deleteSessionController,

  // Internal/cron
  markAbandonedSessionsController,
  permanentlyDeleteSessionsController,
  
  // testPermanentDeletionNoGraceController,

};