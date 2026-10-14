import express, { type Express } from 'express';
import morgan from 'morgan';
import cors from 'cors';
import CookieParser from 'cookie-parser';
import { handleGlobalError } from 'shared/middlewares/global-error';
import { handle404 } from 'shared/middlewares/not-found-handler';
import { v1Routes } from './routes/v1';

const app: Express = express();

app.use(cors());
app.use(express.json());
// OAuth callback query strings contain authorization codes and state.
morgan.token('safe-path', (req) => (req.url ?? '').split('?')[0] ?? '/');
app.use(morgan(':method :safe-path :status :response-time ms'));
app.use(CookieParser());

app.use('/api/v1', v1Routes);

app.use(handle404);
app.use(handleGlobalError);

export default app;
