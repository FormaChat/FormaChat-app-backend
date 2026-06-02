import { Router } from 'express';
import { emailHealthRoutes } from '../architectures/email/api/routes';

const router: Router = Router();

router.use('/api/v1/email', emailHealthRoutes);

export default router;
