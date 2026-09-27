import express, { type Router } from 'express';
import { authRoutes } from '../modules/auth/auth-routes';

const v1Routes: Router = express.Router();

v1Routes.use('/auth', authRoutes);

export { v1Routes };
