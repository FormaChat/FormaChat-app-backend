import { Router } from 'express';
import * as chatController from '../controller/chat.controller';
import { authMiddleware } from '../middleware/auth.middleware';
import { ownershipMiddleware } from '../middleware/ownership.middleware';
import { internalMiddleware } from '../middleware/internal.middleware';

const router: Router = Router();

router.post(
  '/session/create',
  chatController.createSessionController
);

router.get(
  '/session/:sessionId',
  chatController.getSessionController
);

router.post(
  '/session/:sessionId/message',
  chatController.sendMessageController
);

router.post('/session/:sessionId/message/stream', chatController.sendMessageStreamController);

router.get(
  '/session/:sessionId/messages',
  chatController.getMessagesController
);

router.post(
  '/session/:sessionId/end',
  chatController.endSessionController
);

router.get(
  '/business/:businessId/sessions',
  authMiddleware,
  ownershipMiddleware,
  chatController.getSessionsController
);

router.get(
  '/business/:businessId/leads',
  authMiddleware,
  ownershipMiddleware,
  chatController.getLeadsController
);

router.get(
  '/business/:businessId/session/:sessionId',
  authMiddleware,
  ownershipMiddleware,
  chatController.getSessionDetailsController
);

router.get(
  '/business/:businessId/dashboard-summary',
  authMiddleware,
  ownershipMiddleware, // Only ONE ownership check here
  chatController.getDashboardSummaryController
);

router.post(
  '/internal/cleanup/messages',
  internalMiddleware,
  chatController.deleteOldMessagesController
);

router.post(
  '/internal/cleanup/sessions',
  internalMiddleware,
  chatController.markAbandonedSessionsController
);

router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'chat-service',
    version: '1.0.0'
  });
});

// router.post('/test/cleanup/messages', chatController.testDeleteMessagesController);
router.post('/test/cleanup/sessions', chatController.testMarkAbandonedController);

export default router;