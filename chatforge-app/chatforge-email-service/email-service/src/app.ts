import express from 'express';
import { securityHeadersManager } from "./config/email.helmet";
import { corsManager } from './config/email.cors';
import cors from 'cors';
import healthRoutes from './api/routes/email.health.routes';

const app = express();

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(securityHeadersManager.getSecurityConfig());
app.use(cors(corsManager.getCorsConfig()));

// Routes - only health check for now
app.use('/api/v1/email', healthRoutes);

// No external routes needed since it's all internal via RabbitMQ

export default app;