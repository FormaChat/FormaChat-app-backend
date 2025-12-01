import express,{Express} from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import chatRoutes from './route/chat.route';
import { securityHeadersManager } from './config/chat.helmet.config';
import { corsManager } from './config/chat.cors.config';

dotenv.config();

const app: Express = express();

app.use(securityHeadersManager.getSecurityConfig());
app.use(cors(corsManager.getCorsConfig()));
app.use(morgan('combined'));
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({extended:true}));


// Routes

app.use('/api/chat', chatRoutes);

export default app;