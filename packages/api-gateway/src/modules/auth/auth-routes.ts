import express, { type Router } from 'express';
import { validate } from 'shared/utils/validate';
import { loginSchema, signUpSchema } from './auth-schema';
import { handleLogin, handleLogout, handleRefresh, handleSignUp } from './auth-controller';
import { authenticateTokens } from '../../middleware/authenticate-tokens';

const authRoutes: Router = express.Router();

authRoutes.post('/signup', validate(signUpSchema), handleSignUp);

authRoutes.post('/login', validate(loginSchema), handleLogin);

authRoutes.post('/logout', authenticateTokens, handleLogout);

authRoutes.post('/refresh', handleRefresh);

export { authRoutes };
