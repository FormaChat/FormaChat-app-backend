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
  getPublicBusinessDetails
} from '../controllers/business.controllers';

const router: Router = express.Router();

router.get('/businesses/public/:id', getPublicBusinessDetails);

router.post('/businesses', authMiddleware, createBusiness);

router.get('/businesses', authMiddleware, getUserBusinesses);

router.get('/businesses/:id', authMiddleware, ownershipMiddleware, getBusinessDetails);

router.put('/businesses/:id', authMiddleware, ownershipWithActiveCheck, updateBusiness);

router.delete('/businesses/:id', authMiddleware, ownershipMiddleware, deleteBusiness);



export default router;
