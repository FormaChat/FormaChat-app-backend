import { Router } from 'express';
import { chatRoutes } from '../architectures/chat/route';

const router: Router = Router();

router.use('/api/chat', chatRoutes);

export default router;
