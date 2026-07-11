import express, {Router} from 'express';
import { authMiddleware } from '../middleware/auth.middleware';
import { 
  ownershipMiddleware, 
  ownershipWithActiveCheck, 
  bulkOwnershipMiddleware 
} from '../middleware/ownershipAndChecks.middleware';
import {
  createBusiness,
  getUserBusinesses,
  getBusinessDetails,
  updateBusiness,
  deleteBusiness,
  getPublicBusinessDetails,
  getBusinessHealthScore,
} from '../controllers/business.controllers';
import {
  listWebhooks,
  createWebhook,
  updateWebhook,
  deleteWebhook,
  listDeliveries,
  retryDelivery,
  listWebhookEvents,
} from '../controllers/webhook.controllers';

const router: Router = express.Router();

router.get('/businesses/public/:id', getPublicBusinessDetails);

router.post('/businesses', authMiddleware, createBusiness);

router.get('/businesses', authMiddleware, getUserBusinesses);

router.get('/businesses/:id', authMiddleware, ownershipMiddleware, getBusinessDetails);

router.put('/businesses/:id', authMiddleware, ownershipWithActiveCheck, updateBusiness);

router.delete('/businesses/:id', authMiddleware, ownershipMiddleware, deleteBusiness);

router.get('/businesses/:id/health-score', authMiddleware, ownershipMiddleware, getBusinessHealthScore);

// Webhooks
router.get('/webhook-events', authMiddleware, listWebhookEvents);
router.get('/businesses/:id/webhooks', authMiddleware, ownershipMiddleware, listWebhooks);
router.post('/businesses/:id/webhooks', authMiddleware, ownershipMiddleware, createWebhook);
router.patch('/businesses/:id/webhooks/:webhookId', authMiddleware, ownershipMiddleware, updateWebhook);
router.delete('/businesses/:id/webhooks/:webhookId', authMiddleware, ownershipMiddleware, deleteWebhook);
router.get('/businesses/:id/webhooks/:webhookId/deliveries', authMiddleware, ownershipMiddleware, listDeliveries);
router.post('/businesses/:id/webhooks/deliveries/:deliveryId/retry', authMiddleware, ownershipMiddleware, retryDelivery);

export default router;
