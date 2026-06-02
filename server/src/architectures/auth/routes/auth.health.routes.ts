import { Router } from 'express';
import { healthController } from '../controllers/auth.health.controller';
import { asyncHandler } from '../middleware/auth.errorHandler.middleware';

const router:Router = Router();

// Basic health check
router.get('/health', asyncHandler(healthController.healthCheck)); 

// Detailed health with dependencies
router.get('/health/detailed', asyncHandler(healthController.healthDetailed));

// Kubernetes readiness probe
router.get('/ready', asyncHandler(healthController.readinessCheck));

// Kubernetes liveness probe
router.get('/live', asyncHandler(healthController.livenessCheck));

export default router;