import express, { Express, Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { applyGateways } from './gateway';

dotenv.config();

const app: Express = express();

// Render (and most PaaS hosts) sit behind a reverse proxy. Without this,
// req.ip resolves to the proxy's own address instead of the real visitor
// IP from X-Forwarded-For - which is why IPs in logs/audit trails/session
// records were showing up wrong (not actually "truncated", just the wrong
// address entirely). `1` trusts exactly one hop, matching a single
// reverse proxy in front of the app.
app.set('trust proxy', 1);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", 'https:', "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'", 'https:', 'data:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: process.env.NODE_ENV === 'production',
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: process.env.NODE_ENV === 'production',
    },
  })
);

// CORS
const allowedOrigins = [
  'http://localhost:5173',
  'https://www.formachat.com',
  'https://frontend-mockup-phi.vercel.app',
];

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} not allowed by CORS policy`));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-Idempotency-Key',
      'X-Correlation-Id',
      'Idempotency-Key',
      'idempotency-key',
      'Accept',
      'Origin',
    ],
    optionsSuccessStatus: 204,
  })
);

// Request logging
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Mount all service routes through the gateway
applyGateways(app);

// 404 handler
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'The requested resource was not found.' },
  });
});

// Global error handler
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    success: false,
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected error occurred.',
    },
  });
});

export default app;
