import { Router } from 'express';
import * as chatController from '../controller/chat.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { ownershipMiddleware } from '../middleware/ownership.middleware';
import { internalMiddleware } from '../middleware/internal.middleware';

/**
 * ========================================
 * CHAT SERVICE ROUTES
 * ========================================
 * 
 * Route Structure:
 * 1. Public Routes (End User Chat) - No authentication
 * 2. Protected Routes (Business Owner Dashboard) - Auth + Ownership
 * 3. Internal Routes (Cron Jobs) - Internal service secret
 * 
 * Base Path: /api/chat (registered in main app)
 */

const router: Router = Router();

// ========================================
// PUBLIC ROUTES (End User Chat)
// ========================================
// These endpoints are called by website visitors
// No authentication required - end users are anonymous

/**
 * Create a new chat session
 * 
 * POST /api/chat/session/create
 * 
 * Body:
 * {
 *   businessId: string (required),
 *   visitorId?: string (optional)
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     sessionId: "uuid",
 *     visitorId: "visitor_uuid",
 *     businessInfo: { ... }
 *   }
 * }
 * 
 * Purpose: Start a new chat conversation
 * Used when: User first visits formachat.com/chat/{businessId}
 */
router.post(
  '/session/create',
  chatController.createSessionController
);

/**
 * Get existing session
 * 
 * GET /api/chat/session/:sessionId
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     sessionId: "...",
 *     businessId: "...",
 *     status: "active",
 *     messageCount: 15,
 *     contactCaptured: true,
 *     contact: { email, phone, name }
 *   }
 * }
 * 
 * Purpose: Resume existing conversation
 * Used when: User returns to chat (has sessionId in localStorage)
 */
router.get(
  '/session/:sessionId',
  chatController.getSessionController
);

/**
 * Send a message (Main chat endpoint)
 * 
 * POST /api/chat/session/:sessionId/message
 * 
 * Body:
 * {
 *   message: string (required, max 1000 chars)
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     message: {
 *       role: "assistant",
 *       content: "Bot response here",
 *       timestamp: "..."
 *     },
 *     contactCaptured: false
 *   }
 * }
 * 
 * Purpose: Send user message and get bot response
 * Flow:
 * 1. Store user message
 * 2. Extract contact if present
 * 3. Query Pinecone for context
 * 4. Call LLM (Groq) for response
 * 5. Store bot response
 * 6. Return to user
 */
router.post(
  '/session/:sessionId/message',
  chatController.sendMessageController
);

/**
 * Get messages for a session (paginated)
 * 
 * GET /api/chat/session/:sessionId/messages?page=1&limit=20
 * 
 * Query Params:
 * - page: number (default: 1)
 * - limit: number (default: 20, max: 100)
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     messages: [{ role, content, timestamp }, ...],
 *     pagination: { page, limit, total, hasMore }
 *   }
 * }
 * 
 * Purpose: Load conversation history
 * Used when: User scrolls up to see older messages
 */
router.get(
  '/session/:sessionId/messages',
  chatController.getMessagesController
);

/**
 * End a chat session
 * 
 * POST /api/chat/session/:sessionId/end
 * 
 * Response:
 * {
 *   success: true,
 *   message: "Session ended successfully"
 * }
 * 
 * Purpose: Explicitly close a chat session
 * Used when: User clicks "End Chat" button
 * Note: Sessions also auto-end after 30 mins of inactivity (via cron)
 */
router.post(
  '/session/:sessionId/end',
  chatController.endSessionController
);

// ========================================
// PROTECTED ROUTES (Business Owner Dashboard)
// ========================================
// These endpoints require authentication + business ownership
// Middleware chain: authMiddleware → ownershipMiddleware → controller

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
 * Headers:
 * - Authorization: Bearer <JWT_TOKEN>
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     sessions: [
 *       {
 *         sessionId: "...",
 *         contact: { email, phone, name } | null,
 *         status: "active",
 *         startedAt: "...",
 *         messageCount: 15
 *       }
 *     ],
 *     pagination: { page, limit, total, pages }
 *   }
 * }
 * 
 * Purpose: View all chat sessions for this business
 * Used in: Business owner dashboard
 * Middleware: Auth + Ownership (ensures user owns this business)
 */
router.get(
  '/business/:businessId/sessions',
  authMiddleware,
  ownershipMiddleware,
  chatController.getSessionsController
);

/**
 * Get all leads for a business
 * 
 * GET /api/chat/business/:businessId/leads
 * 
 * Query Params:
 * - status: 'new' | 'contacted' | 'qualified' | 'converted' | 'spam' (optional)
 * - startDate: ISO date string (optional)
 * - endDate: ISO date string (optional)
 * - page: number (default: 1)
 * - limit: number (default: 50)
 * 
 * Headers:
 * - Authorization: Bearer <JWT_TOKEN>
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     leads: [
 *       {
 *         email: "john@example.com",
 *         phone: "+1234567890",
 *         name: "John Doe",
 *         totalSessions: 3,
 *         firstContactDate: "...",
 *         lastContactDate: "...",
 *         status: "new"
 *       }
 *     ],
 *     pagination: { page, limit, total, pages }
 *   }
 * }
 * 
 * Purpose: View all captured leads (CRM)
 * Used in: Business owner dashboard - Leads tab
 * Middleware: Auth + Ownership
 */
router.get(
  '/business/:businessId/leads',
  authMiddleware,
  ownershipMiddleware,
  chatController.getLeadsController
);

/**
 * Get session details with full conversation
 * 
 * GET /api/chat/business/:businessId/session/:sessionId
 * 
 * Headers:
 * - Authorization: Bearer <JWT_TOKEN>
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     session: {
 *       sessionId: "...",
 *       contact: { email, phone, name },
 *       status: "ended",
 *       startedAt: "...",
 *       endedAt: "...",
 *       messageCount: 25
 *     },
 *     messages: [
 *       { role: "user", content: "...", timestamp: "..." },
 *       { role: "assistant", content: "...", timestamp: "..." }
 *     ]
 *   }
 * }
 * 
 * Purpose: View full conversation for a specific session
 * Used in: Business owner clicks on a session to view details
 * Middleware: Auth + Ownership
 * Note: Also marks session as "read" (hasUnreadMessages = false)
 */
router.get(
  '/business/:businessId/session/:sessionId',
  authMiddleware,
  ownershipMiddleware,
  chatController.getSessionDetailsController
);

// ========================================
// INTERNAL ROUTES (Cron Jobs / Cleanup)
// ========================================
// These endpoints are called by scheduled jobs or internal services
// Require internal service secret (x-service-token header)

/**
 * Delete old messages (7+ days)
 * 
 * POST /api/chat/internal/cleanup/messages
 * 
 * Headers:
 * - x-service-token: <INTERNAL_SERVICE_SECRET>
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     deletedCount: 1234
 *   }
 * }
 * 
 * Purpose: Auto-delete messages older than 7 days
 * Called by: Cron job (daily at 3am)
 * Middleware: Internal service authentication
 * Keeps: Session metadata + contact leads (never deleted)
 * Deletes: Message content only
 */
router.post(
  '/internal/cleanup/messages',
  internalMiddleware,
  chatController.deleteOldMessagesController
);

/**
 * Mark abandoned sessions
 * 
 * POST /api/chat/internal/cleanup/sessions
 * 
 * Headers:
 * - x-service-token: <INTERNAL_SERVICE_SECRET>
 * 
 * Response:
 * {
 *   success: true,
 *   data: {
 *     markedCount: 15
 *   }
 * }
 * 
 * Purpose: Mark sessions as "abandoned" if inactive for 30+ mins
 * Called by: Cron job (hourly)
 * Middleware: Internal service authentication
 * Changes: status 'active' → 'abandoned', sets endedAt timestamp
 */
router.post(
  '/internal/cleanup/sessions',
  internalMiddleware,
  chatController.markAbandonedSessionsController
);

// ========================================
// HEALTH CHECK ENDPOINT (Optional)
// ========================================

/**
 * Health check
 * 
 * GET /api/chat/health
 * 
 * Response:
 * {
 *   status: "ok",
 *   timestamp: "...",
 *   service: "chat-service"
 * }
 * 
 * Purpose: Monitor service health
 * Used by: Load balancers, monitoring tools
 */
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'chat-service',
    version: '1.0.0'
  });
});

// ========================================
// ROUTE SUMMARY
// ========================================
/**
 * Public Routes (5):
 * - POST   /session/create
 * - GET    /session/:sessionId
 * - POST   /session/:sessionId/message
 * - GET    /session/:sessionId/messages
 * - POST   /session/:sessionId/end
 * 
 * Protected Routes (3):
 * - GET    /business/:businessId/sessions       [Auth + Ownership]
 * - GET    /business/:businessId/leads          [Auth + Ownership]
 * - GET    /business/:businessId/session/:sessionId [Auth + Ownership]
 * 
 * Internal Routes (2):
 * - POST   /internal/cleanup/messages           [Internal Secret]
 * - POST   /internal/cleanup/sessions           [Internal Secret]
 * 
 * Total: 10 endpoints + 1 health check
 */

export default router;