import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import businessRoutes from './routes/business.routes';
import adminRoutes from './routes/admin.routes';
import internalRoutes from './routes/internal.routes';

dotenv.config();

const app = express();

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({extended:true}));


// Routes

app.use('/api/v1', businessRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/internal', internalRoutes);

export default app;