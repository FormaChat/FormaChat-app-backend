import express from 'express';
import { securityHeadersManager } from "./config/auth.helmet";
import { CorsConfig, corsManager } from './config/auth.cors';
import { databaseManager } from './config/auth.database';
import { logger } from './utils/auth.logger.utils';
import cors from 'cors';

const app = express();

// Middleware

app.use(securityHeadersManager.getSecurityConfig());
app.use(cors(corsManager.getCorsConfig()));


// Health check route
app.get('/health', async (req, res) => {
  try {
    // Test MongoDB connection
    const dbHealth = await databaseManager.healthCheck(); 
    res.json({
      database: dbHealth.status,  
      latency: dbHealth.latency ?? null,
    });
  } catch (error: any) {
    res.status(500).json({
      status: 'error',
      message: error.message || 'Unknown error',
    });
  }
});


export default app; 

