import express from 'express';
import { securityHeadersManager } from "./config/auth.helmet";
import { corsManager } from './config/auth.cors';
import { databaseManager } from './config/auth.database';
import cors from 'cors';
import healthRoutes from './routes/auth.health.routes';
import registerRoutes from './routes/auth.register.routes';
import loginRoutes from './routes/auth.login.routes';
import otpRoutes from './routes/auth.otp.routes';
import passwordRoutes from './routes/auth.password.routes';
import tokenRoutes from './routes/auth.token.routes';
import userRoutes from './routes/auth.user.routes';
import internalRoutes from './routes/auth.internal.routes';


const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(securityHeadersManager.getSecurityConfig());
app.use(cors(corsManager.getCorsConfig()));



// Routes

app.use('/api/vi/auth', healthRoutes);
app.use('/api/v1/auth', registerRoutes);
app.use('/api/v1/auth', loginRoutes);
app.use('/api/v1/auth', otpRoutes);
app.use('/api/v1/auth', passwordRoutes);
app.use('/api/v1/auth', tokenRoutes);
app.use('/api/v1/auth', userRoutes);
app.use('/api/v1/auth', internalRoutes);

app.get('/api/v1/auth/test', (req, res) => {
  res.send('Auth service is working!');
});






export default app; 

