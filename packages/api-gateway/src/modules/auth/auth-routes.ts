import express, { type Router } from 'express';
// import { validate } from 'shared/utils/validate';
// import { loginSchema, signUpSchema } from './auth-schema';
// import { handleLogin, handleSignUp } from './auth-controller';
import { handleCheckAuth, handleLogout, handleRefresh } from './auth-controller';
import { authenticateTokens } from '../../middleware/authenticate-tokens';
import { githubRoutes } from './github/github-routes';

const authRoutes: Router = express.Router();

authRoutes.use('/github', githubRoutes);

// Email/password authentication is disabled; use GitHub OAuth.
// authRoutes.post('/signup', validate(signUpSchema), handleSignUp);
// authRoutes.post('/login', validate(loginSchema), handleLogin);

authRoutes.post('/logout', authenticateTokens, handleLogout);

authRoutes.get('/check', authenticateTokens, handleCheckAuth);

authRoutes.post('/refresh', handleRefresh);

export { authRoutes };
