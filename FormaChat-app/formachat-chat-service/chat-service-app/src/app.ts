import express,{Express} from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import dotenv from 'dotenv';
import chatRoutes from './route/chat.route';

dotenv.config();

const app: Express = express();

app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({extended:true}));


// Routes

app.use('/api/chat', chatRoutes);

export default app;