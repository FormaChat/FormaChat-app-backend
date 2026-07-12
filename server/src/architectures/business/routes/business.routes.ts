import express, {Router} from 'express';
import multer from 'multer';
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
import {
  listProducts,
  createProduct,
  updateProduct,
  updateProductStock,
  deleteProduct,
  uploadProductImage,
} from '../controllers/product.controllers';
import { uploadDocument, deleteDocument } from '../controllers/document.controllers';
import { generatePrefill } from '../controllers/prefill.controllers';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const uploadDoc = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

const router: Router = express.Router();

router.get('/businesses/public/:id', getPublicBusinessDetails);

// AI pre-fill for the create wizard - authenticated only, no ownership check
// (the business doesn't exist yet at this point).
router.post('/businesses/prefill', authMiddleware, uploadDoc.single('document'), generatePrefill);

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

// Products
router.get('/businesses/:id/products', authMiddleware, ownershipMiddleware, listProducts);
router.post('/businesses/:id/products', authMiddleware, ownershipMiddleware, createProduct);
router.put('/businesses/:id/products/:productId', authMiddleware, ownershipMiddleware, updateProduct);
router.patch('/businesses/:id/products/:productId/stock', authMiddleware, ownershipMiddleware, updateProductStock);
router.delete('/businesses/:id/products/:productId', authMiddleware, ownershipMiddleware, deleteProduct);
router.post('/businesses/:id/products/upload-image', authMiddleware, ownershipMiddleware, upload.single('image'), uploadProductImage);

// Documents (knowledge base PDFs/DOCX)
router.post('/businesses/:id/documents/upload', authMiddleware, ownershipMiddleware, uploadDoc.single('document'), uploadDocument);
router.delete('/businesses/:id/documents/:fileName', authMiddleware, ownershipMiddleware, deleteDocument);

export default router;
