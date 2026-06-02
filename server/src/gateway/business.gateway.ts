import { Router } from 'express';
import {
  businessRoutes,
  adminRoutes,
  internalRoutes,
} from '../architectures/business/routes';

const router: Router = Router();

router.use('/api/v1', businessRoutes);
// router.use('/api/v1/admin', adminRoutes); // Enable when admin routes are ready
router.use('/api/v1/internal', internalRoutes);

export default router;
