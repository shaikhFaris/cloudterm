import express, { type Router } from 'express';
import { authRoutes } from '../modules/auth/auth-routes';
import { labRoutes } from '../modules/lab/lab-routes';

const v1Routes: Router = express.Router();

v1Routes.use('/auth', authRoutes);
v1Routes.use('/labs', labRoutes);

export { v1Routes };
