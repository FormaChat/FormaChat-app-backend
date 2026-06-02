import { Router } from 'express';
import {
  healthRoutes,
  registerRoutes,
  loginRoutes,
  otpRoutes,
  passwordRoutes,
  tokenRoutes,
  userRoutes,
  internalRoutes,
} from '../architectures/auth/routes';

const router: Router = Router();

router.use('/api/v1/auth', healthRoutes);
router.use('/api/v1/auth', registerRoutes);
router.use('/api/v1/auth', loginRoutes);
router.use('/api/v1/auth', otpRoutes);
router.use('/api/v1/auth', passwordRoutes);
router.use('/api/v1/auth', tokenRoutes);
router.use('/api/v1/auth', userRoutes);
router.use('/api/v1/auth', internalRoutes);

export default router;
