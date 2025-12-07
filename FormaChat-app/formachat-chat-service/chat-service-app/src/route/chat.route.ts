import { Router } from 'express';
import * as chatController from '../controller/chat.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { ownershipMiddleware } from '../middleware/ownership.middleware';
import { internalMiddleware } from '../middleware/internal.middleware';



const router: Router = Router();

// ========================================
// PUBLIC ROUTES (End User Chat)
// ========================================


/**
 * Create a new chat session
 * POST /api/chat/session/create
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
*/
router.get(
  '/session/:sessionId',
  chatController.getSessionController
);

/**
 * Send a message (Main chat endpoint)
 * POST /api/chat/session/:sessionId/message
*/
router.post(
  '/session/:sessionId/message',
  chatController.sendMessageController
);

/**
 * Get messages for a session (paginated)
 * 
 * GET /api/chat/session/:sessionId/messages?page=1&limit=20
 */
router.get(
  '/session/:sessionId/messages',
  chatController.getMessagesController
);

/**
 * End a chat session
 * POST /api/chat/session/:sessionId/end
*/
router.post(
  '/session/:sessionId/end',
  chatController.endSessionController
);

// ========================================
// PROTECTED ROUTES (Business Owner Dashboard)
// ========================================

/**
 * Get all sessions for a business
 * GET /api/chat/business/:businessId/sessions
 * 
*/
router.get(
  '/business/:businessId/sessions',
  authMiddleware,
  ownershipMiddleware,
  chatController.getSessionsController
);

/**
 * Get all leads for a business
 * GET /api/chat/business/:businessId/leads
*/
router.get(
  '/business/:businessId/leads',
  authMiddleware,
  ownershipMiddleware,
  chatController.getLeadsController
);

/**
 * Get session details with full conversation
 * GET /api/chat/business/:businessId/session/:sessionId
*/

router.get(
  '/business/:businessId/session/:sessionId',
  authMiddleware,
  ownershipMiddleware,
  chatController.getSessionDetailsController
);

/**
 * Get dashboard summary (composite endpoint - ONE ownership check)
 * GET /api/chat/business/:businessId/dashboard-summary
 * 
 * Returns sessions, leads, and analytics in a single request
 * More efficient than making 3 separate API calls
 */
router.get(
  '/business/:businessId/dashboard-summary',
  authMiddleware,
  ownershipMiddleware, // Only ONE ownership check here
  chatController.getDashboardSummaryController
);

// ========================================
// INTERNAL ROUTES (Cron Jobs / Cleanup)
// ========================================

/**
 * Delete old messages (7+ days)
 * 
 * POST /api/chat/internal/cleanup/messages
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