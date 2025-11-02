import express from 'express';
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
  deleteBusiness
} from '../controllers/business.controllers';

const router = express.Router();

router.post('/businesses', authMiddleware, createBusiness);

router.get('/businesses', authMiddleware, getUserBusinesses);

router.get('/businesses/:id', authMiddleware, ownershipMiddleware, getBusinessDetails);

router.put('/businesses/:id', authMiddleware, ownershipWithActiveCheck, updateBusiness);

router.delete('/businesses/:id', authMiddleware, ownershipMiddleware, deleteBusiness);



export default router;
