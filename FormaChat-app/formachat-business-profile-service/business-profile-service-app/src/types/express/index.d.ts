import { IBusiness } from '../../models/business.model';


declare global {
  namespace Express {
    
    interface Request {
      user?: {
        userId: string;
        email: string;
        role?: string;
      };

      adminUser?: {
        userId: string;
        email: string;
        role: string;
      };

      business?: IBusiness;

      internalService?: {
        authenticated: boolean;
        timestamp: Date;
      };
    }
  }
}

export {};