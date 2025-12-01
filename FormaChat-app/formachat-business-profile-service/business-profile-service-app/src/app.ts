import express,{Express} from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import businessRoutes from './routes/business.routes';
import adminRoutes from './routes/admin.routes';
import internalRoutes from './routes/internal.routes';
import { corsManager } from './config/business.config.cors';
import { securityHeadersManager } from './config/business.helmet.config';

dotenv.config();

const app: Express = express();

app.use(securityHeadersManager.getSecurityConfig());
app.use(cors(corsManager.getCorsConfig()));
app.use(morgan('combined'));
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({extended:true}));


// Routes

app.use('/api/v1', businessRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/internal', internalRoutes);

export default app;