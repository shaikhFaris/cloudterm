import express, { type Express } from 'express';
import morgan from 'morgan';
import cors from 'cors';
import CookieParser from 'cookie-parser';
import { handleGlobalError } from '@cloudterm/shared/middlewares/global-error';
import { handle404 } from '@cloudterm/shared/middlewares/not-found-handler';
import { v1Routes } from './routes/v1';

const app: Express = express();

app.use(cors());
app.use(express.json());
app.use(morgan('dev'));
app.use(CookieParser());

app.use('/api/v1', v1Routes);

app.use(handle404);
app.use(handleGlobalError);

export default app;
