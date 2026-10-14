import express, { type Router } from 'express';
import { handleGithubCallback, handleGithubLogin } from './github-controller';

const githubRoutes: Router = express.Router();
githubRoutes.get('/', handleGithubLogin);
githubRoutes.get('/callback', handleGithubCallback);

export { githubRoutes };
